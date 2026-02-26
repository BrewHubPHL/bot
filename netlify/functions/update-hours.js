// update-hours.js — Manager-only endpoint for IRS-compliant payroll adjustments.
// Never edits existing time_logs rows. Inserts immutable adjustment records
// via the atomic_payroll_adjustment RPC with full audit trail.

const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { hashIP } = require('./_ip-hash');
const { staffBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');
const { z } = require('zod');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // fallback to same-origin if running from site URL
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const cors = (code, data, headers = {}) => ({
  statusCode: code,
  headers: Object.assign({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }, headers),
  body: JSON.stringify(data),
});

function corsWithOrigin(code, data, origin) {
  const hdrs = {};
  if (origin) hdrs['Access-Control-Allow-Origin'] = origin;
  return cors(code, data, hdrs);
}

// ── Zod schema ──────────────────────────────────────────────
const AdjustmentSchema = z.object({
  employee_email: z
    .string({ required_error: 'employee_email is required' })
    .email('employee_email must be a valid email address')
    .max(254, 'employee_email must be at most 254 characters')
    .transform((v) => v.toLowerCase().trim()),

  delta_minutes: z
    .number({ required_error: 'delta_minutes is required' })
    .refine((n) => n !== 0, { message: 'delta_minutes must be non-zero' })
    .refine((n) => Math.abs(n) <= 1440, {
      message: 'delta_minutes cannot exceed ±1440 (24 hours)',
    }),

  reason: z
    .string({ required_error: 'reason is required' })
    .min(10, 'reason must be at least 10 characters (IRS compliance)')
    .max(500, 'reason must be at most 500 characters'),

  target_date: z
    .string()
    .datetime({ message: 'target_date must be a valid ISO 8601 datetime' })
    .optional(),
});

exports.handler = async (event) => {
  if (MISSING_ENV) return cors(500, { error: 'Server misconfiguration' });
  // ── CORS preflight ──────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    const origin = validateOrigin(event.headers || {});
    return {
      statusCode: 204,
      headers: Object.assign({ 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return cors(405, { error: 'Method not allowed' });
  }

  // ── CSRF protection ─────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Manager auth + PIN required + challenge nonce for insider-threat defense ─
  const auth = await authorize(event, {
    requireManager: true,
    requirePin: true,
    requireManagerChallenge: true,
    challengeActionType: 'adjust_hours',
  });
  if (!auth.ok) return auth.response;

  try {
    // ── Enforce conservative request body size cap (pre-parse) ──
    const bodyBytes = Buffer.byteLength(event.body || '', 'utf8');
    const MAX_BYTES = 8 * 1024; // 8KB
    if (bodyBytes > MAX_BYTES) {
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(413, { error: 'Request body too large' }, origin);
    }

    // ── Rate limiting: per-manager (or per-IP) token bucket
    const clientIP = event.headers['x-nf-client-connection-ip']
      || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';
    // ── Parse body ────────────────────────────────────────
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(422, {
        error: 'Request body must be valid JSON',
        details: [],
      }, origin);
    }

    // ── Validate with Zod ─────────────────────────────────
    const parsed = AdjustmentSchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      return cors(422, {
        error: 'Validation failed',
        details: issues,
      });
    }

    const { employee_email, delta_minutes, reason, target_date } = parsed.data;

    // ── Resolve manager identity ──────────────────────────
    const managerEmail = auth.user?.email;
    if (!managerEmail) {
      return cors(403, { error: 'Could not resolve manager identity' });
    }

    // Look up the manager's staff_directory UUID
    const { data: managerRow, error: mgrErr } = await supabase
      .from('staff_directory')
      .select('id')
      .eq('email', managerEmail.toLowerCase().trim())
      .limit(1)
      .single();

    if (mgrErr || !managerRow) {
      console.error('[UPDATE-HOURS] Manager lookup failed:', mgrErr?.message || 'unknown');
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(403, { error: 'Manager not found in staff directory' }, origin);
    }

    // Rate limit key: manager id + client IP (prevents hot-client flood)
    try {
      const rlKey = `${managerRow.id}:${clientIP}`;
      const take = staffBucket.consume(rlKey);
      if (!take.allowed) {
        const origin = validateOrigin(event.headers || {});
        const resp = {
          error: 'Rate limit exceeded',
          retryAfterMs: take.retryAfterMs,
        };
        return {
          statusCode: 429,
          headers: Object.assign({ 'Retry-After': Math.ceil((take.retryAfterMs || 0) / 1000) }, origin ? { 'Access-Control-Allow-Origin': origin } : {}, { 'Vary': 'Origin' }),
          body: JSON.stringify(resp),
        };
      }
    } catch (rlErr) {
      console.error('[UPDATE-HOURS] Rate-limit check failed (continuing):', rlErr?.message || 'unknown');
    }

    // ── Call the atomic RPC ───────────────────────────────
    // Sanitize and redact reason before passing to RPC / audit log
    const sanitizedReason = sanitizeInput(reason);

    function redactPII(s) {
      if (!s) return '';
      let out = String(s);
      // redact emails
      out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
      // redact phone-like sequences (7+ digits)
      out = out.replace(/\b\d[\d\-\s]{6,}\d\b/g, '[REDACTED_PHONE]');
      // redact long digit sequences (possible SSN/IDs)
      out = out.replace(/\b\d{4,}\b/g, '[REDACTED_NUMBER]');
      return out;
    }

    const redactedReason = redactPII(sanitizedReason);

    const rpcParams = {
      p_employee_email: employee_email,
      p_delta_minutes: delta_minutes,
      p_reason: redactedReason,
      p_manager_id: managerRow.id,
    };

    if (target_date) {
      rpcParams.p_target_date = target_date;
    }

    const { data: result, error: rpcErr } = await supabase.rpc(
      'atomic_payroll_adjustment',
      rpcParams
    );

    if (rpcErr) {
      console.error('[UPDATE-HOURS] RPC error:', rpcErr?.message || 'unknown');

      // Surface known validation errors from the DB as 422
      if (rpcErr.code === 'P0002') {
        return cors(422, { error: 'Employee not found', details: [{ field: 'employee_email', message: rpcErr.message }] });
      }
      if (rpcErr.code === 'P0003') {
        return cors(422, { error: 'Invalid delta', details: [{ field: 'delta_minutes', message: rpcErr.message }] });
      }
      if (rpcErr.code === 'P0004') {
        return cors(422, { error: 'Reason required', details: [{ field: 'reason', message: rpcErr.message }] });
      }
      if (rpcErr.code === 'P0005') {
        return cors(422, { error: 'Manager not found', details: [{ field: 'manager_id', message: rpcErr.message }] });
      }

      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(500, { error: 'Failed to record adjustment. Please try again.' }, origin);
    }

    console.log(`[UPDATE-HOURS] Manager ${managerRow.id} recorded adjustment id=${result?.id} delta=${delta_minutes}`);

    // ── Schema 47: Immutable manager override audit log ────
    try {
      await supabase.from('manager_override_log').insert({
        action_type: 'adjust_hours',
        manager_email: managerEmail,
        manager_staff_id: managerRow.id,
        target_entity: 'time_logs',
        target_id: result?.id || null,
        target_employee: employee_email,
        details: {
          delta_minutes,
          reason: redactedReason,
          target_date: target_date || null,
        },
        device_fingerprint: auth.deviceFingerprint || null,
        ip_address: hashIP(clientIP),
        challenge_method: 'totp',
      });
    } catch (auditLogErr) {
      console.error('[UPDATE-HOURS] Override audit log failed (non-fatal):', auditLogErr?.message || 'unknown');
    }

    const origin = validateOrigin(event.headers || {});
    return corsWithOrigin(200, {
      success: true,
      adjustment: result,
    }, origin);
  } catch (err) {
    console.error('[UPDATE-HOURS] Unhandled error:', err?.message || 'unknown');
    const origin = validateOrigin(event.headers || {});
    return corsWithOrigin(500, { error: 'An unexpected error occurred. Please try again.' }, origin);
  }
};
