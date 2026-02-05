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

      // DETECT: Marketing Bot Post vs Instagram Lead
      if (record.day_of_week && record.topic) {
        // Marketing Bot Post -> SocialPosts tab
        const sheetPayload = {
          auth_key: "BrewHub-Marketing-2026",
          target_sheet: "SocialPosts",
          day: record.day_of_week,
          topic: record.topic,
          caption: record.caption,
          added: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        };

        console.log('[MARKETING] Sending Social Post:', JSON.stringify(sheetPayload));

        const response = await fetch(process.env.MARKETING_SHEET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sheetPayload)
        });

        const responseText = await response.text();
        console.log('[MARKETING] Sheets response:', response.status, responseText);

        return { statusCode: 200, body: "Social post pushed to Sheets" };
      }

      // Instagram Lead -> IG_Leads tab
      // Format timestamp for easy reading in Sheets
      const postedDate = record.posted_at ? new Date(record.posted_at) : new Date();
      const formattedDate = postedDate.toLocaleDateString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric' 
      });
      const formattedTime = postedDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', minute: '2-digit', hour12: true 
      });

      const sheetPayload = {
        auth_key: "BrewHub-Marketing-2026",
        username: record.username,
        likes: record.likes,
        caption: record.caption,
        link: record.id,
        posted: `${formattedDate} @ ${formattedTime}`,
        added: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

      // Dedupe by id - keep last occurrence
      const deduped = Object.values(
        sheetData.reduce((acc, row) => {
          if (row.id) acc[row.id] = row;
          return acc;
        }, {})
      );

      console.log(`[MARKETING] Syncing ${deduped.length} unique leads (from ${sheetData.length} rows)`);

      const { error } = await supabase
        .from('marketing_leads')
        .upsert(deduped, { onConflict: 'id' });

      if (error) throw error;
      return { statusCode: 200, body: `Synced ${deduped.length} leads back to DB` };
    }

    // DIRECTION C: EXPORT (Bulk Supabase -> Sheets)
    if (mode === 'export') {
      // Fetch all local_mentions from Supabase
      const { data: mentions, error } = await supabase
        .from('local_mentions')
        .select('*')
        .order('likes', { ascending: false });

      if (error) throw error;

      console.log(`[MARKETING] Exporting ${mentions.length} mentions to Sheets`);

      // Format all records
      const records = mentions.map(record => {
        const postedDate = record.posted_at ? new Date(record.posted_at) : new Date();
        const formattedDate = postedDate.toLocaleDateString('en-US', { 
          month: 'short', day: 'numeric', year: 'numeric' 
        });
        const formattedTime = postedDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', minute: '2-digit', hour12: true 
        });

        return {
          username: record.username,
          likes: record.likes,
          caption: record.caption,
          link: record.id,
          posted: `${formattedDate} @ ${formattedTime}`,
          added: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        };
      });

      // Send bulk payload
      const response = await fetch(process.env.MARKETING_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_key: "BrewHub-Marketing-2026",
          bulk: true,
          records: records
        })
      });

      const result = await response.text();
      console.log('[MARKETING] Bulk export result:', result);

      return { 
        statusCode: 200, 
        body: `Exported ${mentions.length} records to Sheets. Result: ${result}` 
      };
    }

  } catch (err) {
    console.error("Sync Error:", err);
    return { statusCode: 500, body: err.message };
  }
};