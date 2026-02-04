// PHILLY WAY: Search residents by name prefix (first 3+ letters)
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rruionkpgswvncypweiv.supabase.co';
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  try {
    const { prefix } = event.queryStringParameters || {};

    if (!prefix || prefix.length < 2) {
      return { 
        statusCode: 400, 
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Need at least 2 characters to search' }) 
      };
    }

    // Search residents by name prefix (case-insensitive)
    const { data, error } = await supabase
      .from('residents')
      .select('id, name, unit_number, phone')
      .ilike('name', `${prefix}%`)
      .order('name')
      .limit(10);

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        results: data || [],
        count: data?.length || 0
      })
    };

  } catch (err) {
    console.error('[SEARCH-RESIDENTS ERROR]', err);
    return { 
      statusCode: 500, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }) 
    };
  }
};
