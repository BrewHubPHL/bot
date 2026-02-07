const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from('merch_products')
    .select('*')
    .eq('is_active', true);

  return {
    statusCode: 200,
    body: JSON.stringify(data || [])
  };
};