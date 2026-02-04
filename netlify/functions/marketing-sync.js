const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const mode = event.queryStringParameters?.mode || 'push';

  // Check env vars first
  if (!process.env.MARKETING_SHEET_URL) {
    console.error('MARKETING_SHEET_URL not set');
    return { statusCode: 500, body: 'MARKETING_SHEET_URL not configured' };
  }

  try {
    // DIRECTION A: PUSH (Supabase -> Sheets)
    if (mode === 'push') {
      const body = JSON.parse(event.body || '{}');
      const record = body.record;
      
      console.log('[MARKETING] Received:', JSON.stringify(record));
      
      if (!record) {
        return { statusCode: 400, body: 'Missing record in body' };
      }

      const sheetPayload = {
        auth_key: "BrewHub-Marketing-2026",
        username: record.username,
        likes: record.likes,
        caption: record.caption,
        link: record.id
      };
      
      console.log('[MARKETING] Sending to Sheets:', JSON.stringify(sheetPayload));

      const response = await fetch(process.env.MARKETING_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetPayload)
      });
      
      const responseText = await response.text();
      console.log('[MARKETING] Sheets response:', response.status, responseText);
      
      return { statusCode: 200, body: "Pushed to Sheets" };
    }

    // DIRECTION B: PULL (Sheets -> Supabase)
    if (mode === 'pull') {
      const response = await fetch(process.env.MARKETING_SHEET_URL);
      const sheetData = await response.json();

      const { error } = await supabase
        .from('marketing_leads')
        .upsert(sheetData, { onConflict: 'id' });

      if (error) throw error;
      return { statusCode: 200, body: `Synced ${sheetData.length} leads back to DB` };
    }

  } catch (err) {
    console.error("Sync Error:", err);
    return { statusCode: 500, body: err.message };
  }
};