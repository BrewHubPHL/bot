const { createClient } = require('@supabase/supabase-js');
const axios = require('axios'); // You might need to 'npm install axios'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
  // 1. Get the parcel data from the Supabase trigger
  const { record } = JSON.parse(event.body); 
  const recipient = record.recipient_name;
  const carrier = record.carrier;

  // 2. Craft the message for the shop
  const message = `Attention Tom, a new ${carrier} package has arrived for ${recipient}.`;

  // 3. Send to ElevenLabs (using your saved voice ID)
  try {
    await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      { text: message },
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
    );
    
    return { statusCode: 200, body: "Announcement sent!" };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};