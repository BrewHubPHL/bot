const fetch = require('node-fetch');

exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const record = body.record; // Data from Supabase
  
  const carrier = record.carrier || "a delivery service";
  
  // Since there is no name column, we use a generic friendly greeting
  const announcementText = `Attention in the Hub! A new delivery has arrived from ${carrier}. Please check your email for your pickup notification!`;

  const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; 
  const API_KEY = process.env.ELEVEN_LABS_KEY;

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': API_KEY,
      },
      body: JSON.stringify({
        text: announcementText,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
    });

    const audioBuffer = await response.buffer();
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "audio/mpeg" },
      body: audioBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};