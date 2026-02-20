// PHILLY WAY: Search residents by name prefix (first 3+ letters)
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // CORS preflight must be handled BEFORE auth (OPTIONS carries no Authorization)
  if (event.httpMethod === 'OPTIONS') {
    const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action' }, body: '' };
  }

  // 1. Staff auth (contains resident PII - parcels workflow)
  // High-sensitivity: Require token issued within last 15 minutes
  const auth = await authorize(event, { maxTokenAgeMinutes: 15 });
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const { prefix } = event.queryStringParameters || {};

    if (!prefix || prefix.length < 2) {
      return json(400, { error: 'Need at least 2 characters to search' });
    }

    // SECURITY: Escape SQL LIKE wildcards to prevent table-wide enumeration
    // % and _ are special characters in LIKE/ILIKE queries
    const escapeWildcards = (str) => str
      .replace(/\\/g, '\\\\')  // Escape backslash first
      .replace(/%/g, '\\%')      // Escape %
      .replace(/_/g, '\\_');     // Escape _
    
    // SECURITY: Only allow letters, spaces, hyphens, apostrophes (valid name characters)
    const NAME_REGEX = /^[A-Za-z\s\-']{2,30}$/;
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
    console.error('[SEARCH-RESIDENTS ERROR]', err);
    return json(500, { error: 'Search failed' });
  }
};
