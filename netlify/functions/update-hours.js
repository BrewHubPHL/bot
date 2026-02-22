// update-hours.js — Manager-only endpoint for IRS-compliant payroll adjustments.
// Never edits existing time_logs rows. Inserts immutable adjustment records
// via the atomic_payroll_adjustment RPC with full audit trail.

const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { z } = require('zod');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

const cors = (code, data) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

// ── Zod schema ──────────────────────────────────────────────
const AdjustmentSchema = z.object({
  employee_email: z
    .string({ required_error: 'employee_email is required' })
    .email('employee_email must be a valid email address')
    .transform((v) => v.toLowerCase().trim()),

  delta_minutes: z
    .number({ required_error: 'delta_minutes is required' })
    .refine((n) => n !== 0, { message: 'delta_minutes must be non-zero' })
    .refine((n) => Math.abs(n) <= 1440, {
      message: 'delta_minutes cannot exceed ±1440 (24 hours)',
    }),

  reason: z
    .string({ required_error: 'reason is required' })
    .min(5, 'reason must be at least 5 characters')
    .max(500, 'reason must be at most 500 characters'),

  target_date: z
    .string()
    .datetime({ message: 'target_date must be a valid ISO 8601 datetime' })
    .optional(),
});

exports.handler = async (event) => {
  // ── CORS preflight ──────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return cors(405, { error: 'Method not allowed' });
  }

  // ── CSRF protection ─────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Manager auth + PIN required ─────────────────────────
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    // ── Parse body ────────────────────────────────────────
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return cors(422, {
        error: 'Request body must be valid JSON',
        details: [],
      });
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
      console.error('[UPDATE-HOURS] Manager lookup failed:', mgrErr);
      return cors(403, { error: 'Manager not found in staff directory' });
    }

    // ── Call the atomic RPC ───────────────────────────────
    const rpcParams = {
      p_employee_email: employee_email,
      p_delta_minutes: delta_minutes,
      p_reason: reason,
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
      console.error('[UPDATE-HOURS] RPC error:', rpcErr);

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

      return cors(500, { error: 'Failed to record adjustment. Please try again.' });
    }

    console.log(
      `[UPDATE-HOURS] Manager ${managerEmail} adjusted ${employee_email} by ${delta_minutes} min: ${reason}`
    );

    return cors(200, {
      success: true,
      adjustment: result,
    });
  } catch (err) {
    console.error('[UPDATE-HOURS] Unhandled error:', err?.message || err);
    return cors(500, { error: 'An unexpected error occurred. Please try again.' });
  }
};
