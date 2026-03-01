// PHILLY WAY: Search residents by phone (primary) or name prefix (fallback)
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

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

  try {
    const { prefix, phone } = event.queryStringParameters || {};

    // ── Phone lookup (primary) ─────────────────────────────────
    if (phone) {
      // Strip everything except digits
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 15) {
        return json(400, { error: 'Phone number must be 4-15 digits' });
      }

      // Search by phone suffix (last N digits) to handle +1 prefix variations
      const { data, error } = await supabase
        .from('residents')
        .select('id, name, unit_number, phone')
        .like('phone', `%${digits.slice(-10)}`)
        .order('name')
        .limit(10);

      if (error) throw error;

      return json(200, {
        results: data || [],
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

    // Search residents by name prefix (case-insensitive)
    const { data, error } = await supabase
      .from('residents')
      .select('id, name, unit_number, phone')
      .ilike('name', `${safePrefix}%`)
      .order('name')
      .limit(10);

    if (error) throw error;

    return json(200, { 
      results: data || [],
      count: data?.length || 0
    });

  } catch (err) {
    console.error('[SEARCH-RESIDENTS ERROR]', err?.message);
    return json(500, { error: 'Search failed' });
  }
};
