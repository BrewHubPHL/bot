/**
 * SECURE PARCEL PICKUP — Cryptographic Handoff Protocol
 *
 * Flow (standard value):
 *   1. POST { parcel_id, pickup_code }
 *   2. Server hashes code -> calls verify_pickup_code RPC (constant-time, lockout)
 *   3. On success -> calls finalize_parcel_pickup RPC (atomic status + audit)
 *
 * Flow (high_value / premium):
 *   1. POST { parcel_id, pickup_code, collector_name, id_last4 }
 *   2. Server verifies code + requires ID fields
 *   3. finalize_parcel_pickup enforces ID requirement at DB level
 *
 * Flow (manager override — lost code):
 *   1. POST { parcel_id, manager_override: true, override_reason: "..." }
 *   2. Caller must have manager/admin role
 *   3. Logged separately in audit trail
 *
 * Anti-brute-force: 3 wrong codes -> 15 min lockout (enforced at DB level)
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { hashIP } = require('./_ip-hash');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * SHA-256 hash a pickup code — must match how check-in hashes it.
 * Uses HMAC with a server secret to prevent rainbow table attacks.
 */
function hashPickupCode(code) {
  const secret = process.env.PICKUP_CODE_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error('PICKUP_CODE_SECRET or INTERNAL_SYNC_SECRET env var required');
  return crypto.createHmac('sha256', secret).update(String(code).trim()).digest('hex');
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  const staffUser = auth.user?.email || auth.user?.id || 'unknown-staff';
  const isManager = (auth.role === 'manager' || auth.role === 'admin');
  const isStaff = isManager || auth.role === 'staff';
  const clientIp = event.headers?.['x-forwarded-for']
    || event.headers?.['x-nf-client-connection-ip']
    || 'unknown';

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { parcel_id, pickup_code, collector_name, id_last4, manager_override, override_reason } = body;

  if (!parcel_id || typeof parcel_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parcel_id)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Valid parcel_id (UUID) required' }) };
  }

  // ── Fetch parcel to verify it exists + current state ──────────────────
  const { data: parcel, error: fetchErr } = await supabase
    .from('parcels')
    .select('id, tracking_number, status, estimated_value_tier, pickup_locked_until, pickup_attempts, recipient_name, recipient_email')
    .eq('id', parcel_id)
    .single();

  if (fetchErr || !parcel) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Parcel not found' }) };
  }

  if (parcel.status !== 'arrived') {
    return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: `Parcel status is "${parcel.status}", not "arrived"` }) };
  }

  // ── IDOR guard for non-staff ──────────────────────────────────────────
  if (!isStaff) {
    const userEmail = (auth.user?.email || '').toLowerCase();
    if (!userEmail || userEmail !== (parcel.recipient_email || '').toLowerCase()) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Forbidden' }) };
    }
  }

  // ── PATH A: Manager Override (lost code scenario) ─────────────────────
  if (manager_override) {
    if (!isManager) {
      // Log the denied attempt
      await logPickupAttempt(parcel, 'denied', staffUser, null, null, 'Non-manager attempted override', clientIp);
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Manager role required for override' }) };
    }

    if (!override_reason || typeof override_reason !== 'string' || override_reason.trim().length < 5) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'override_reason required (min 5 chars)' }) };
    }

    const { data: result, error: finalizeErr } = await supabase.rpc('finalize_parcel_pickup', {
      p_parcel_id: parcel_id,
      p_verified_via: 'manager_override',
      p_staff_user: staffUser,
      p_collector_name: sanitize(collector_name) || parcel.recipient_name,
      p_id_last4: sanitize(id_last4) || null,
      p_override_reason: sanitize(override_reason.trim()),
    });

    if (finalizeErr || !result?.[0]?.success) {
      console.error('[PICKUP] Manager override finalize failed:', finalizeErr?.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Override failed' }) };
    }

    console.log(`[PICKUP] MANAGER OVERRIDE: ${staffUser} released ${parcel.tracking_number} — reason: ${override_reason.trim()}`);

    bustCache();
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        verified_via: 'manager_override',
        tracking: parcel.tracking_number,
        message: 'Parcel released via manager override (logged)',
      }),
    };
  }

  // ── PATH B: Standard code verification ────────────────────────────────
  if (!pickup_code || typeof pickup_code !== 'string') {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'pickup_code required' }) };
  }

  // Sanitize code: strip whitespace, allow only digits (6-digit code)
  const cleanCode = pickup_code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Pickup code must be 6 digits' }) };
  }

  const codeHash = hashPickupCode(cleanCode);

  // Verify code via RPC (constant-time comparison + lockout at DB level)
  const { data: verifyResult, error: verifyErr } = await supabase.rpc('verify_pickup_code', {
    p_parcel_id: parcel_id,
    p_code_hash: codeHash,
  });

  if (verifyErr) {
    console.error('[PICKUP] Verification RPC error:', verifyErr?.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Verification failed' }) };
  }

  const vr = verifyResult?.[0];
  if (!vr) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Verification returned no result' }) };
  }

  // ── Locked out (too many failed attempts) ─────────────────────────────
  if (vr.locked) {
    await logPickupAttempt(parcel, 'locked_out', staffUser, collector_name, null, null, clientIp);
    console.warn(`[PICKUP] LOCKED OUT: ${parcel.tracking_number} after ${vr.attempts} attempts`);
    return {
      statusCode: 429,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Too many failed attempts. Parcel locked for 15 minutes. Manager override available.',
        locked: true,
        attempts: vr.attempts,
      }),
    };
  }

  // ── Wrong code ────────────────────────────────────────────────────────
  if (!vr.verified) {
    await logPickupAttempt(parcel, 'code_fail', staffUser, collector_name, null, null, clientIp);
    console.warn(`[PICKUP] CODE FAIL: ${parcel.tracking_number} attempt ${vr.attempts}/3`);
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Invalid pickup code',
        attempts: vr.attempts,
        max_attempts: 3,
      }),
    };
  }

  // ── Code verified! Check if high-value requires ID ────────────────────
  const requiresId = vr.value_tier === 'high_value' || vr.value_tier === 'premium';
  const verifiedVia = requiresId ? 'code_and_id' : 'code';

  if (requiresId) {
    if (!collector_name || typeof collector_name !== 'string' || collector_name.trim().length < 2) {
      return {
        statusCode: 422,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'High-value parcel: collector_name required (ask for ID)',
          requires_id: true,
          value_tier: vr.value_tier,
        }),
      };
    }
    if (!id_last4 || typeof id_last4 !== 'string' || !/^\d{4}$/.test(id_last4)) {
      return {
        statusCode: 422,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'High-value parcel: id_last4 required (last 4 digits of government ID)',
          requires_id: true,
          value_tier: vr.value_tier,
        }),
      };
    }
  }

  // ── Finalize pickup (atomic status update + audit log) ────────────────
  const { data: finalResult, error: finalErr } = await supabase.rpc('finalize_parcel_pickup', {
    p_parcel_id: parcel_id,
    p_verified_via: verifiedVia,
    p_staff_user: staffUser,
    p_collector_name: sanitize(collector_name) || parcel.recipient_name,
    p_id_last4: sanitize(id_last4) || null,
    p_override_reason: null,
  });

  if (finalErr || !finalResult?.[0]?.success) {
    console.error('[PICKUP] Finalize failed:', finalErr?.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Pickup finalization failed' }) };
  }

  console.log(`[PICKUP] SUCCESS: ${parcel.tracking_number} verified via ${verifiedVia} by ${staffUser}`);

  bustCache();
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      verified_via: verifiedVia,
      tracking: parcel.tracking_number,
      message: 'Parcel released — verified and logged',
    }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Log a pickup attempt to the immutable audit table */
async function logPickupAttempt(parcel, type, staffUser, collectorName, idLast4, reason, ip) {
  try {
    await supabase.from('parcel_pickup_log').insert({
      parcel_id: parcel.id,
      tracking_number: parcel.tracking_number,
      attempt_type: type,
      staff_user: staffUser,
      collector_name: sanitize(collectorName) || null,
      collector_id_last4: sanitize(idLast4) || null,
      override_reason: sanitize(reason) || null,
      value_tier: parcel.estimated_value_tier || 'standard',
      ip_address: hashIP(String(ip || '')),
    });
  } catch (e) {
    console.error('[PICKUP] Audit log insert failed:', e?.message);
  }
}

/** Strip control chars, limit length */
function sanitize(val) {
  if (!val || typeof val !== 'string') return null;
  return val.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200);
}

/** Best-effort cache bust for portal/parcels pages */
function bustCache() {
  const siteUrl = process.env.SITE_URL || 'https://brewhubphl.com';
  fetch(`${siteUrl}/api/revalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET || '',
    },
    body: JSON.stringify({ paths: ['/portal', '/parcels'] }),
  }).catch(() => {}); // Fire and forget
}