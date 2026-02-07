const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const { tracking_number } = JSON.parse(event.body);

  const { data, error } = await supabase
    .from('parcels')
    .update({ 
      status: 'picked_up', 
      picked_up_at: new Date().toISOString() 
    })
    .eq('tracking_number', tracking_number);

  if (error) return { statusCode: 500, body: error.message };

  return { statusCode: 200, body: JSON.stringify({ message: "Cleared from inventory" }) };
};