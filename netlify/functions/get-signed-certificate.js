'use strict';

/**
 * get-signed-certificate.js — Returns a "Certificate of Agreement" payload
 * for a staff member's previously signed Mutual Working Agreement.
 *
 * GET /.netlify/functions/get-signed-certificate?staff_id=<uuid>
 *
 * Auth: PIN session (requirePin: true)
 *
 * The certificate includes the staff name, version tag, signature date,
 * truncated SHA-256 seal, and — critically — re-derives the canonical
 * hash from the agreement template to confirm it still matches the
 * stored hash.  This proves the agreement text has not been tampered
 * with since signing.
 *
 * Response:
 *   {
 *     staff_name, version_tag, signed_at, signature_id,
 *     stored_hash, derived_hash, integrity_ok
 *   }
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { hashIP, redactIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');
const { sanitizeInput } = require('./_sanitize');
const { getCanonicalAgreementText } = require('./_crypto-utils');
const { generateStaffAgreement } = require('./_staff-agreement');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  // ── Preflight ──────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (MISSING_ENV) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // ── Rate limiting ──────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `signed-cert:${hashIP(clientIp)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      console.warn(`[GET-SIGNED-CERT] Rate limit hit from IP: ${redactIP(clientIp)}`);
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests. Please wait.', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[GET-SIGNED-CERT] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // ── Authentication ─────────────────────────────────────────
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  // ── Parse query params ─────────────────────────────────────
  const staffId = sanitizeInput(
    String(event.queryStringParameters?.staff_id || auth.user?.id || ''),
  );
  if (!staffId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'staff_id is required' }) };
  }

  // Staff may only view their own certificate unless they are a manager
  const sessionStaffId = auth.user?.id;
  const isManager = auth.user?.role === 'manager' || auth.user?.role === 'admin';
  if (!isManager && sessionStaffId && sessionStaffId !== staffId) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Cannot view another employee\'s certificate' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── Fetch latest signature row ─────────────────────────
    const { data: sigRow, error: sigErr } = await supabase
      .from('agreement_signatures')
      .select('id, staff_id, version_tag, sha256_hash, signed_at')
      .eq('staff_id', staffId)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sigErr) {
      console.error('[GET-SIGNED-CERT] Signature query error:', sigErr.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to retrieve signature' }) };
    }

    if (!sigRow) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'No signed agreement found for this staff member' }) };
    }

    // ── Fetch staff details to re-hydrate agreement ────────
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff_directory')
      .select('full_name, hourly_rate')
      .eq('id', staffId)
      .maybeSingle();

    if (staffErr) {
      console.error('[GET-SIGNED-CERT] Staff query error:', staffErr.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to retrieve staff record' }) };
    }

    if (!staffRow) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Staff record not found' }) };
    }

    // ── Re-derive the canonical hash from the template ─────
    const rehydratedText = generateStaffAgreement({
      employeeName: staffRow.full_name || 'Staff Member',
      baseRate: String(staffRow.hourly_rate || '0.00'),
      effectiveDate: new Date(sigRow.signed_at).toLocaleDateString('en-US'),
      noticePeriodDays: 7,
    });

    const canonicalText = getCanonicalAgreementText(rehydratedText);
    const derivedHash = crypto
      .createHash('sha256')
      .update(canonicalText, 'utf8')
      .digest('hex');

    const integrityOk = derivedHash === sigRow.sha256_hash;

    if (!integrityOk) {
      console.warn(
        `[GET-SIGNED-CERT] Hash mismatch for staff=${staffId}: stored=${sigRow.sha256_hash} derived=${derivedHash}`,
      );
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staff_name: staffRow.full_name,
        version_tag: sigRow.version_tag,
        signed_at: sigRow.signed_at,
        signature_id: sigRow.id,
        stored_hash: sigRow.sha256_hash,
        derived_hash: derivedHash,
        integrity_ok: integrityOk,
      }),
    };
  } catch (err) {
    console.error('[GET-SIGNED-CERT] Unexpected error:', err?.message || err);
    await logSystemError(supabase, {
      error_type: 'unhandled_exception',
      severity: 'high',
      source_function: 'get-signed-certificate',
      error_message: String(err?.message || err).slice(0, 500),
      context: { staff_id: staffId },
    }).catch(() => {});
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
