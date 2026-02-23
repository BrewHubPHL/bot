// ═══════════════════════════════════════════════════════════════════════════
// pin-change.js — Secure PIN Rotation Endpoint
// ═══════════════════════════════════════════════════════════════════════════
// Allows authenticated staff to change their own PIN.
// Old PIN must be verified before the new one is set.
// After change, version_updated_at is bumped to invalidate all sessions.

const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

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
    'Access-Control-Allow-Credentials': 'true',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
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

  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method not allowed' });

  // CSRF
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Must be authenticated via PIN session
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  const email = auth.user?.email;
  if (!email) return cors(403, { error: 'Could not resolve identity' });

  try {
    const { old_pin, new_pin } = JSON.parse(event.body || '{}');

    // Basic validation
    if (!old_pin || typeof old_pin !== 'string' || !/^\d{6}$/.test(old_pin)) {
      return cors(400, { error: 'Current PIN must be exactly 6 digits' });
    }
    if (!new_pin || typeof new_pin !== 'string' || !/^\d{6}$/.test(new_pin)) {
      return cors(400, { error: 'New PIN must be exactly 6 digits' });
    }
    if (old_pin === new_pin) {
      return cors(400, { error: 'New PIN must be different from current PIN' });
    }

    // Call the atomic RPC which verifies old PIN and sets new hash
    const { data: result, error: rpcErr } = await supabase.rpc('update_staff_pin', {
      p_email: email,
      p_old_pin: old_pin,
      p_new_pin: new_pin,
    });

    if (rpcErr) {
      console.error('[PIN-CHANGE] RPC error:', rpcErr);
      return cors(500, { error: 'PIN change failed' });
    }

    const row = result?.[0] || result;
    if (!row?.success) {
      return cors(400, { error: row?.error_message || 'PIN change failed' });
    }

    // Also clear the legacy plaintext PIN column (migration cleanup)
    await supabase
      .from('staff_directory')
      .update({ pin: null })
      .eq('email', email);

    console.log(`[PIN-CHANGE] ${email} changed their PIN`);

    return cors(200, { success: true, message: 'PIN updated. Please log in again with your new PIN.' });

  } catch (err) {
    console.error('[PIN-CHANGE] Error:', err?.message || err);
    return cors(500, { error: 'An error occurred. Please try again.' });
  }
};
