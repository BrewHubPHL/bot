'use strict';

/**
 * record-agreement-signature.js — Processes a staff member's digital signature
 * on the Mutual Working Agreement.
 *
 * POST /.netlify/functions/record-agreement-signature
 * Body: { pin: string, staff_id: string, version_tag?: string }
 *
 * 1. Verifies PIN against staff_directory via the verify_staff_pin RPC.
 * 2. Validates that body staff_id matches authenticated session identity.
 * 3. Fetches full_name + hourly_rate from staff_directory and regenerates
 *    the agreement text entirely server-side via generateStaffAgreement().
 * 4. SHA-256 hashes the server-generated canonical text (non-repudiation).
 * 5. Calls the record_agreement_signature Postgres RPC which ATOMICALLY:
 *    a) Inserts an audit row into agreement_signatures.
 *    b) Updates staff_directory: contract_signed = true, onboarding_complete = true.
 * 6. Sends a notification email to all active managers via Resend.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { hashIP, redactIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');
const { getCanonicalAgreementText } = require('./_crypto-utils');
const { generateStaffAgreement } = require('./_staff-agreement');

// ── Server-authoritative agreement version ──────────────────────
// The frontend may send version_tag for display/logging, but the
// server ALWAYS stamps this constant into the DB.  Bump this when
// the canonical agreement text changes.
const CURRENT_VERSION = '2027-Q1';

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  // ── Preflight ──────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (MISSING_ENV) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // ── CSRF protection ────────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders } };

  // ── Rate limiting ──────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `agreement-sign:${hashIP(clientIp)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      console.warn(`[RECORD-AGREEMENT] Rate limit hit from IP: ${redactIP(clientIp)}`);
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests. Please wait.', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[RECORD-AGREEMENT] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // ── Authentication — require active PIN session ────────────
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  // ── Parse & validate body ──────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const pin = sanitizeInput(String(body.pin || ''));
  const staffId = sanitizeInput(String(body.staff_id || ''));
  // version_tag from the client is logged for diagnostics but never
  // used for the DB write — CURRENT_VERSION is stamped instead.
  const clientVersionTag = sanitizeInput(String(body.version_tag || ''));

  if (!pin || !/^\d{6}$/.test(pin)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'PIN must be exactly 6 digits' }) };
  }
  if (!staffId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'staff_id is required' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Verify PIN via the verify_staff_pin Postgres RPC
    // This uses bcrypt comparison inside the DB — no plaintext
    // PIN is ever stored or compared in JS.
    // ═══════════════════════════════════════════════════════════
    const { data: rpcRows, error: rpcError } = await supabase.rpc('verify_staff_pin', { p_pin: pin });

    if (rpcError) {
      console.error('[RECORD-AGREEMENT] verify_staff_pin RPC error:', rpcError.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'PIN verification failed' }) };
    }

    const verifiedStaff = rpcRows?.[0] || null;
    if (!verifiedStaff) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid PIN' }) };
    }

    // Ensure the PIN belongs to the claimed staff_id (prevents signing as someone else)
    if (verifiedStaff.staff_id !== staffId) {
      console.warn(`[RECORD-AGREEMENT] staff_id mismatch: claimed=${staffId} verified=${verifiedStaff.staff_id}`);
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'PIN does not match the specified employee' }) };
    }

    // Also cross-check against the authenticated session email
    const sessionEmail = auth.user?.email?.toLowerCase();
    const verifiedEmail = (verifiedStaff.staff_email || '').toLowerCase();
    if (sessionEmail && verifiedEmail && sessionEmail !== verifiedEmail) {
      console.warn(`[RECORD-AGREEMENT] Session/PIN email mismatch: session=${sessionEmail} pin=${verifiedEmail}`);
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Session identity does not match PIN' }) };
    }

    // Cross-check: body staff_id must match the authenticated session user id
    const sessionStaffId = auth.user?.id;
    if (sessionStaffId && sessionStaffId !== staffId) {
      console.warn(`[RECORD-AGREEMENT] Session staff_id mismatch: session=${sessionStaffId} body=${staffId}`);
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'staff_id does not match authenticated session' }) };
    }

    const staffName = verifiedStaff.full_name || verifiedStaff.staff_name || 'Staff Member';

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Fetch staff data & regenerate agreement server-side
    // (Ticket H-1 — Canonical Agreement Hashing)
    // We NEVER hash client-supplied agreement text. Instead we
    // fetch the employee's full_name + hourly_rate from the DB
    // and regenerate the canonical agreement entirely on the
    // server.  This prevents a tampered client from altering the
    // text that gets hashed into the audit row.
    // ═══════════════════════════════════════════════════════════
    const { data: staffRow, error: staffFetchErr } = await supabase
      .from('staff_directory')
      .select('full_name, hourly_rate')
      .eq('id', staffId)
      .eq('is_active', true)
      .single();

    if (staffFetchErr) {
      console.error('[RECORD-AGREEMENT] staff_directory fetch error:', staffFetchErr.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to load employee data' }) };
    }
    if (!staffRow) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Employee record not found' }) };
    }

    const employeeName = staffRow.full_name || staffName;
    const baseRate = staffRow.hourly_rate != null
      ? Number(staffRow.hourly_rate).toFixed(2)
      : '0.00';

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const serverAgreement = generateStaffAgreement({
      employeeName,
      baseRate,
      effectiveDate: today,
      noticePeriodDays: 14,
    });

    const canonicalText = getCanonicalAgreementText(serverAgreement);

    const sha256Hash = crypto
      .createHash('sha256')
      .update(canonicalText, 'utf8')
      .digest('hex');

    console.info(
      `[RECORD-AGREEMENT] Server-side canonical hash generated for staff=${staffId} version=${CURRENT_VERSION}`,
    );

    const userAgent = (event.headers['user-agent'] || '').slice(0, 500);

    // ═══════════════════════════════════════════════════════════
    // STEP 3: ATOMIC — Insert signature + update staff_directory
    // via a single Postgres RPC (record_agreement_signature).
    // Both writes happen inside one transaction; if either fails
    // the whole thing rolls back — no partial state.
    // ═══════════════════════════════════════════════════════════
    const { data: rpcResult, error: rpcSignErr } = await supabase.rpc(
      'record_agreement_signature',
      {
        p_staff_id: staffId,
        p_version_tag: CURRENT_VERSION,
        p_sha256_hash: sha256Hash,
        p_ip_address: hashIP(clientIp),
        p_user_agent: userAgent,
      },
    );

    // Log the client-supplied version for diagnostic drift detection
    if (clientVersionTag && clientVersionTag !== CURRENT_VERSION) {
      console.warn(`[RECORD-AGREEMENT] Client version drift: client=${clientVersionTag} server=${CURRENT_VERSION} staff=${staffId}`);
    }

    if (rpcSignErr) {
      console.error('[RECORD-AGREEMENT] record_agreement_signature RPC error:', rpcSignErr.message);
      await logSystemError(supabase, {
        error_type: 'db_insert_failed',
        severity: 'critical',
        source_function: 'record-agreement-signature',
        error_message: `record_agreement_signature RPC failed: ${rpcSignErr.message}`,
        context: { staff_id: staffId, version_tag: CURRENT_VERSION },
      });

      // Surface a specific message when the staff row was not updateable
      // (deactivated between PIN check and RPC execution). ERRCODE P0002
      // is raised by the RPC when the UPDATE matches 0 rows.
      const isStaffMissing = /matched 0 rows|no_data_found|P0002/.test(rpcSignErr.message || '');
      if (isStaffMissing) {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'Staff record is inactive or missing. Signature was NOT recorded.' }) };
      }

      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to record signature' }) };
    }

    // Belt-and-suspenders: verify the RPC returned a success payload.
    // If the RPC returned without error but without the expected fields,
    // treat it as a failure — we cannot confirm atomicity.
    if (!rpcResult?.success || !rpcResult?.signature_id) {
      console.error('[RECORD-AGREEMENT] RPC returned unexpected payload:', JSON.stringify(rpcResult));
      await logSystemError(supabase, {
        error_type: 'db_insert_failed',
        severity: 'critical',
        source_function: 'record-agreement-signature',
        error_message: 'RPC returned no success flag or signature_id',
        context: { staff_id: staffId, rpc_result: rpcResult },
      });
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Signature recording could not be confirmed' }) };
    }

    const signatureId = rpcResult?.signature_id || null;

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Notify managers via Resend
    // ═══════════════════════════════════════════════════════════
    if (process.env.RESEND_API_KEY) {
      try {
        // Fetch all active manager/admin emails
        const { data: managers, error: mgrErr } = await supabase
          .from('staff_directory')
          .select('email')
          .in('role', ['manager', 'admin'])
          .eq('is_active', true);

        if (mgrErr) {
          console.error('[RECORD-AGREEMENT] Manager email query failed:', mgrErr.message);
        }

        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const recipients = (managers || [])
          .map(m => m.email)
          .filter(e => e && EMAIL_RE.test(e));

        if (recipients.length > 0) {
          // Truncate server-generated agreement for email body (keep first 3000 chars to stay under email limits)
          const agreementPreview = serverAgreement.length > 3000
            ? serverAgreement.slice(0, 3000) + '\n\n[… truncated — full text on file …]'
            : serverAgreement;

          const signedDate = new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: 'BrewHub PHL <info@brewhubphl.com>',
              to: recipients,
              subject: `📝 Agreement Signed — ${staffName}`,
              text: [
                '═══════════════════════════════════════════════',
                '  BrewHub PHL — Agreement Signature Notification',
                '═══════════════════════════════════════════════',
                '',
                `Employee:      ${staffName}`,
                `Staff ID:      ${staffId}`,
                `Version:       ${CURRENT_VERSION}`,
                `Signed At:     ${signedDate}`,
                `Signature ID:  ${signatureId || 'N/A'}`,
                `SHA-256 Hash:  ${sha256Hash}`,
                `IP (hashed):   ${hashIP(clientIp)}`,
                '',
                '───────────────────────────────────────────────',
                '  SIGNED AGREEMENT TEXT',
                '───────────────────────────────────────────────',
                '',
                agreementPreview,
                '',
                '───────────────────────────────────────────────',
                'This is an automated notification from the BrewHub Staff Portal.',
              ].join('\n'),
            }),
          });
        }
      } catch (emailErr) {
        // Email is non-critical — log but don't fail the request
        console.error('[RECORD-AGREEMENT] Resend notification error:', emailErr?.message || emailErr);
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        signature_id: signatureId,
        sha256_hash: sha256Hash,
      }),
    };
  } catch (err) {
    console.error('[RECORD-AGREEMENT] Unexpected error:', err?.message || err);
    await logSystemError(supabase, {
      error_type: 'unhandled_exception',
      severity: 'critical',
      source_function: 'record-agreement-signature',
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
