const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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

  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  let tracking_number;
  try {
    ({ tracking_number } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!tracking_number || typeof tracking_number !== 'string') {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'tracking_number required' }) };
  }

  // ── IDOR GUARD ────────────────────────────────────────────
  // Residents can only pick up their own parcels.
  // Staff/Managers can pick up any parcel.
  const isStaff = (auth.role === 'staff' || auth.role === 'manager' || auth.role === 'admin');

  let query = supabase
    .from('parcels')
    .update({ 
      status: 'picked_up', 
      picked_up_at: new Date().toISOString() 
    })
    .eq('tracking_number', tracking_number);

  if (!isStaff) {
    // Non-staff: enforce ownership — only allow pickup of parcels addressed to them
    const userEmail = (auth.user?.email || '').toLowerCase();
    if (!userEmail) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }
    query = query.eq('recipient_email', userEmail);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Pickup failed' }) };
  }

  // Bust Next.js cache so portal shows up-to-date parcel status
  try {
    const siteUrl = process.env.SITE_URL || 'https://brewhubphl.com';
    await fetch(`${siteUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET || '',
      },
      body: JSON.stringify({ paths: ['/portal', '/parcels'] }),
    }).catch(() => {}); // Best-effort; not critical
  } catch { /* swallow */ }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Cleared from inventory" }) };
};