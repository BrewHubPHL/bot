const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Check for POST request
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { orderId } = JSON.parse(event.body || '{}');

  if (!orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing orderId" }) };
  }

  try {
    // Update preparation status to 'ready'
    const { data, error } = await supabase
      .from('orders')
      .update({ preparation_status: 'ready' })
      .eq('id', orderId)
      .select();

    if (error) throw error;

    console.log(`Barista confirmed: Order ${orderId} is ready.`);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Order status updated to ready", order: data[0] }) 
    };
  } catch (err) {
    console.error("Database Update Error:", err.message);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};