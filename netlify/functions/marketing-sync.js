const { createClient } = require('@supabase/supabase-js');
const { filterTombstoned } = require('./_gdpr');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // Internal-only: called by supabase-to-sheets.js or scheduled tasks
  const incomingSecret = event.headers?.['x-brewhub-secret'];
  if (!incomingSecret || incomingSecret !== process.env.INTERNAL_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

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
          auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
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
        auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
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
      // ═══════════════════════════════════════════════════════════════════════════
      // ZOMBIE SYNC PREVENTION: Pull from Sheets is PERMANENTLY DISABLED
      // ═══════════════════════════════════════════════════════════════════════════
      // 
      // Why this matters:
      // 1. Google Sheets is NOT the Source of Truth - Supabase is.
      // 2. If a resident is "tombstoned" in Supabase (GDPR deletion), but their
      //    data remains in the Sheet, a pull sync would resurrect the zombie.
      // 3. Attackers with Sheet access could directly insert/modify records to
      //    bypass GDPR deletion logic.
      //
      // Security Controls:
      // - This endpoint returns 403 unconditionally
      // - Even if enabled, filterTombstoned() would block resurrection
      // - Tombstones are checked BEFORE any upsert (fail-safe)
      //
      // To re-enable (NOT RECOMMENDED):
      // 1. Implement row-level checksums in the Sheet
      // 2. Add last_modified_by column to detect unauthorized edits
      // 3. Compare checksums before accepting any record
      // ═══════════════════════════════════════════════════════════════════════════
      
      console.warn('[MARKETING SYNC] Pull from Sheets is PERMANENTLY DISABLED (Zombie Prevention)');
      
      // Log the attempt for security monitoring
      console.warn('[SECURITY AUDIT] Pull attempt blocked. Origin:', {
        ip: event.headers?.['x-forwarded-for'] || 'unknown',
        userAgent: event.headers?.['user-agent'] || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      return { 
          statusCode: 403, 
          body: JSON.stringify({
            error: 'Pull disabled',
            reason: 'Supabase is the Single Source of Truth. Google Sheets are downstream-only.',
            mitigation: 'Updates in Sheets do not propagate back to DB to prevent zombie data resurrection.'
          })
      };

      /* 
      // DISABLED CODE FOLLOWS:
      const response = await fetch(process.env.MARKETING_SHEET_URL);
      const sheetData = await response.json();
      
      ... 
      */
    }

    // DIRECTION C: EXPORT (Bulk Supabase -> Sheets)
    if (mode === 'export') {
      // Fetch all local_mentions from Supabase
      const { data: mentions, error } = await supabase
        .from('local_mentions')
        .select('*')
        .order('likes', { ascending: false });

      if (error) throw error;

      // GDPR FIX: Filter out tombstoned records before export
      const safeMentions = await filterTombstoned('local_mentions', mentions, 'username');

      console.log(`[MARKETING] Exporting ${safeMentions.length} mentions to Sheets`);

      // Format all records
      const records = safeMentions.map(record => {
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
          auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
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
    return { statusCode: 500, body: JSON.stringify({ error: 'Sync failed' }) };
  }
};