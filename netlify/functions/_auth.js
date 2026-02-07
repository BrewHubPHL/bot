const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
const allowlist = (process.env.STAFF_ALLOWLIST || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

async function authorize(event) {
  const secret = event.headers?.['x-brewhub-secret'];
  if (secret && secret === process.env.INTERNAL_SYNC_SECRET) {
    return { ok: true, via: 'secret' };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  const email = (data.user.email || '').toLowerCase();
  if (allowlist.length && !allowlist.includes(email)) {
    return { ok: false, response: json(403, { error: 'Forbidden' }) };
  }

  return { ok: true, via: 'jwt', user: data.user };
}

module.exports = { authorize, json };