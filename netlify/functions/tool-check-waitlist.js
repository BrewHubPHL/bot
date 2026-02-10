const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // 1. Only allow POST requests (standard for ElevenLabs tools)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 2. Parse the email from the agent
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return { 
        statusCode: 200, // Return 200 so the agent can handle the error verbally
        body: JSON.stringify({ result: "I need an email address to check the list." }) 
      };
    }

    // 3. Query Supabase
    // We assume the table is named 'waitlist' and has an 'email' column
    const { data, error } = await supabase
      .from('waitlist')
      .select('name, created_at')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle(); // Returns null if not found, instead of throwing an error

    if (error) throw error;

    // 4. Formulate the response for Elise
    if (data) {
      // User IS on the list
      const name = data.name || "friend";
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          result: `Yes! I found you on the list, ${name}. You are all set for updates.` 
        })
      };
    } else {
      // User is NOT on the list
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          result: "I couldn't find that email on our waitlist yet. You can sign up manually at our website!" 
        })
      };
    }

  } catch (err) {
    console.error("Check Waitlist Error:", err);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ result: "I'm having trouble accessing the list right now. Please try again later." }) 
    };
  }
};