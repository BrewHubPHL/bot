
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { redactIP } = require('./_ip-hash');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const json = (statusCode, data) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body' });
  }
  const { pin, totpCode } = body;

  // Validate PIN format
  if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return json(400, { error: 'PIN must be exactly 6 digits' });
  }

  // Check against env PINs
  const ADMIN_PIN = process.env.ADMIN_PIN;
  const MANAGER_PIN = process.env.MANAGER_PIN;
  const BARISTA_PIN = process.env.BARISTA_PIN;

  let role = null;
  if (pin === ADMIN_PIN) role = 'admin';
  else if (pin === MANAGER_PIN) role = 'manager';
  else if (pin === BARISTA_PIN) role = 'barista';

  if (!role) {
    return json(401, { error: 'Invalid PIN' });
  }

  // Admin: global access
  if (role === 'admin') {
    return issueToken({ role, ip });
  }

  // Fetch shop_ip_address from DB
  const { data: settings, error: settingsError } = await supabase
    .from('store_settings')
    .select('shop_ip_address')
    .limit(1)
    .single();

  if (settingsError || !settings) {
    return json(503, { error: 'Shop IP unavailable' });
  }
  const shopIp = (settings.shop_ip_address || '').trim();

  // IP check
  if (ip === shopIp) {
    return issueToken({ role, ip });
  }

  // Off-site logic
  if (role === 'barista') {
    return json(403, { error: 'Off-site access denied. Connect to shop Wi-Fi.' });
  }

  // Manager: TOTP fallback
  if (role === 'manager') {
    if (!totpCode) {
      return json(403, { error: 'TOTP_REQUIRED', message: 'Unrecognized network. Enter Manager Authenticator code.' });
    }
    const secret = process.env.MANAGER_TOTP_SECRET;
    if (!secret) {
      return json(503, { error: 'TOTP not configured' });
    }
    const isValid = authenticator.check(totpCode, secret);
    if (!isValid) {
      return json(401, { error: 'Invalid TOTP code' });
    }
    return issueToken({ role, ip });
  }

  // Should never reach here
  return json(500, { error: 'Unknown error' });
};

// Helper to issue ops_token
function issueToken({ role, ip }) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8 hours
  const payload = JSON.stringify({
    sid: sessionId,
    role,
    iat: Date.now(),
    exp: expiresAt,
    ip,
  });
  const secret = process.env.INTERNAL_SYNC_SECRET;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(payload).toString('base64') + '.' + signature;
  return json(200, {
    success: true,
    token,
    staff: { role },
  });
}
