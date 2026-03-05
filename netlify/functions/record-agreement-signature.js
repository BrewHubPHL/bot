'use strict';

/**
 * record-agreement-signature.js — Processes a staff member's digital signature
 * on the Mutual Working Agreement.
 *
 * POST /.netlify/functions/record-agreement-signature
 * Body: { pin: string, staff_id: string, agreement_text: string, version_tag: string }
 *
 * 1. Verifies PIN against staff_directory via the verify_staff_pin RPC.
 * 2. Validates that body staff_id matches authenticated session identity.
 * 3. Hashes agreement_text server-side (SHA-256).
 * 4. Calls the record_agreement_signature Postgres RPC which ATOMICALLY:
 *    a) Inserts an audit row into agreement_signatures.
 *    b) Updates staff_directory: contract_signed = true, onboarding_complete = true.
 * 5. Sends a notification email to all active managers via Resend.
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
  const agreementText = String(body.agreement_text || '');
  // version_tag from the client is logged for diagnostics but never
  // used for the DB write — CURRENT_VERSION is stamped instead.
  const clientVersionTag = sanitizeInput(String(body.version_tag || ''));

  if (!pin || !/^\d{6}$/.test(pin)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'PIN must be exactly 6 digits' }) };
  }
  if (!staffId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'staff_id is required' }) };
  }
  if (!agreementText || agreementText.length < 100) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'agreement_text is required' }) };
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
    // STEP 2: Canonicalize, then SHA-256 hash the agreement text
    // at the moment of signing — immutable audit proof.
    // Canonical normalization guarantees that trivial whitespace
    // or line-ending differences never alter the hash.
    // ═══════════════════════════════════════════════════════════
    const originalLength = agreementText.length;
    const canonicalText = getCanonicalAgreementText(agreementText);
    const normalizedLength = canonicalText.length;
    const normDelta = originalLength - normalizedLength;

    // Ops diagnostic: log the normalization delta so we can
    // verify the transform is reasonable (not stripping content).
    console.info(
      `[RECORD-AGREEMENT] Normalization: original=${originalLength} normalized=${normalizedLength} delta=${normDelta} staff=${staffId}`,
    );

    // Guard: if normalization removed more than 5 % of content,
    // something unexpected was in the payload — log a warning.
    if (normDelta > originalLength * 0.05) {
      console.warn(
        `[RECORD-AGREEMENT] Large normalization delta (${normDelta} chars, ${((normDelta / originalLength) * 100).toFixed(1)}%) — review payload for staff=${staffId}`,
      );
    }

    const sha256Hash = crypto
      .createHash('sha256')
      .update(canonicalText, 'utf8')
      .digest('hex');

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
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to record signature' }) };
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
          // Truncate agreement for email body (keep first 3000 chars to stay under email limits)
          const agreementPreview = agreementText.length > 3000
            ? agreementText.slice(0, 3000) + '\n\n[… truncated — full text on file …]'
            : agreementText;

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
