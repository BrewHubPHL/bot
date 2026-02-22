// get-receipts.js — Server-side proxy for ReceiptRoll.
// Returns the latest receipts from receipt_queue using service_role
// to bypass RLS restrictions on the anon key.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  // Staff-only (PIN or JWT)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit, 10) || 10, 25);

    const { data, error } = await supabase
      .from('receipt_queue')
      .select('id, receipt_text, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ receipts: data || [] }),
    };
  } catch (err) {
    return sanitizedError(err, 'get-receipts');
  }
};
