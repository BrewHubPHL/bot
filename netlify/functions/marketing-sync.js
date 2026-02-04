const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const mode = event.queryStringParameters.mode || 'push';

  try {
    // DIRECTION A: PUSH (Supabase -> Sheets)
    if (mode === 'push') {
      const { record } = JSON.parse(event.body);
      await fetch(process.env.MARKETING_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_key: "BrewHub-Marketing-2026",
          username: record.username,
          likes: record.likes,
          caption: record.caption,
          link: record.id
        })
      });
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