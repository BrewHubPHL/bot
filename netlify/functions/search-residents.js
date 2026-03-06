// PHILLY WAY: Search customers by phone (primary) or name prefix (fallback)
// Unified CRM: all person data lives in the single `customers` table.
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { logSystemError } = require('./_system-errors');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function getCorsOrigin(event) {
  const origin = event.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

exports.handler = async (event) => {
  // CORS preflight must be handled BEFORE auth (OPTIONS carries no Authorization)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': getCorsOrigin(event), 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
  }

  // 1. Staff auth (contains resident PII - parcels workflow)
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  // Rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rl = staffBucket.consume(`search-residents:${clientIp}`);
  if (!rl.allowed) {
    return json(429, { error: 'Too many requests' });
  }

  try {
    const { prefix, phone, unit } = event.queryStringParameters || {};

    // ── Unit lookup (parcel intake) ────────────────────────────
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.length < 1 || trimmed.length > 10) {
        return json(400, { error: 'Unit must be 1-10 characters' });
      }
      const { data, error } = await supabase
        .from('customers')
        .select('id, full_name, unit_number, phone')
        .ilike('unit_number', trimmed)
        .order('full_name')
        .limit(5);

      if (error) throw error;

      // Map full_name → name for backward-compatible API shape
      return json(200, {
        results: (data || []).map(r => ({ id: r.id, name: r.full_name, unit_number: r.unit_number, phone: r.phone })),
        count: data?.length || 0,
      });
    }

    // ── Phone lookup (primary) ─────────────────────────────────
    if (phone) {
      // Strip everything except digits
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 15) {
        return json(400, { error: 'Phone number must be 4-15 digits' });
      }

      // Search by phone suffix (last N digits) to handle +1 prefix variations
      const { data, error } = await supabase
        .from('customers')
        .select('id, full_name, unit_number, phone')
        .like('phone', `%${digits.slice(-10)}`)
        .order('full_name')
        .limit(10);

      if (error) throw error;

      return json(200, {
        results: (data || []).map(r => ({ id: r.id, name: r.full_name, unit_number: r.unit_number, phone: r.phone })),
        count: data?.length || 0,
      });
    }

    // ── Name prefix lookup (fallback) ──────────────────────────
    if (!prefix || prefix.length < 1) {
      return json(400, { error: 'Need at least 1 character to search' });
    }

    // SECURITY: Escape SQL LIKE wildcards to prevent table-wide enumeration
    const escapeWildcards = (str) => str
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    
    // SECURITY: Only allow letters, spaces, hyphens, apostrophes (valid name characters)
    const NAME_REGEX = /^[A-Za-z\s\-']{1,30}$/;
    const sanitized = prefix.trim();
    
    if (!NAME_REGEX.test(sanitized)) {
      console.warn('[SECURITY] Invalid search prefix rejected:', prefix.substring(0, 20));
      return json(400, { error: 'Invalid search characters' });
    }

    const safePrefix = escapeWildcards(sanitized);

    // Search customers by name prefix (case-insensitive)
    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, unit_number, phone')
      .ilike('full_name', `${safePrefix}%`)
      .order('full_name')
      .limit(10);

    if (error) throw error;

    return json(200, { 
      results: (data || []).map(r => ({ id: r.id, name: r.full_name, unit_number: r.unit_number, phone: r.phone })),
      count: data?.length || 0
    });

  } catch (err) {
    console.error('[SEARCH-RESIDENTS ERROR]', err?.message);
    await logSystemError(supabase, {
      error_type: 'unhandled_exception',
      severity: 'critical',
      source_function: 'search-residents',
      error_message: err?.message || 'Unknown error',
      context: { stack: err?.stack },
    });
    return json(500, { error: 'Search failed' });
  }
};
