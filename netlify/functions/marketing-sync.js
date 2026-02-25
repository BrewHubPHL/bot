const { createClient } = require('@supabase/supabase-js');
const { filterTombstoned } = require('./_gdpr');
const { verifyServiceSecret } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');

// Config
const EXPORT_ROW_LIMIT = Math.min(Math.max(Number(process.env.EXPORT_ROW_LIMIT) || 1000, 10), 10000);

function fetchWithTimeout(url, options = {}, ms = 15000, label = 'fetch') {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return fetch(url, { ...options, signal }).finally(() => clearTimeout(timer));
  } catch (e) {
    clearTimeout(timer);
    return Promise.reject(e);
  }
}

exports.handler = async (event) => {
  // CORS allowlist + headers (echo validated origin)
  const ALLOWED_ORIGINS = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = (event.headers?.['origin'] || '').replace(/\/$/, '');
  const referer = (event.headers?.['referer'] || '');
  const isLocalDev = process.env.NODE_ENV !== 'production' && (origin.includes('://localhost') || referer.includes('://localhost'));
  const isValidOrigin = ALLOWED_ORIGINS.some(a => a === origin || referer.startsWith(a));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
  if (isValidOrigin || isLocalDev) headers['Access-Control-Allow-Origin'] = origin || ALLOWED_ORIGINS[0];

  // Preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Method guard
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // Internal-only: called by supabase-to-sheets.js or scheduled tasks
  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return { ...serviceAuth.response, headers };

  const mode = event.queryStringParameters?.mode || 'push';

  // Check env vars first (sheet URL and auth key are required for outbound calls)
  if (!process.env.MARKETING_SHEET_URL || !process.env.GOOGLE_SHEETS_AUTH_KEY) {
    console.error('MARKETING_SHEET_URL or GOOGLE_SHEETS_AUTH_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'MARKETING_SHEET_URL/GOOGLE_SHEETS_AUTH_KEY not configured' }) };
  }

  // Create Supabase client per-request when needed
  const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

  try {
    // DIRECTION A: PUSH (Supabase -> Sheets)
    if (mode === 'push') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
      }
      const record = body.record;

      if (!record) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing record in body' }) };
      }

      // Sanitize record for logs and downstream
      const safeRecord = {
        day_of_week: sanitizeInput(record.day_of_week || ''),
        topic: sanitizeInput(record.topic || ''),
        caption: sanitizeInput((record.caption || '')).slice(0, 1000),
        username: sanitizeInput(record.username || '').slice(0, 200),
        likes: Number(record.likes) || 0,
        id: sanitizeInput(record.id || '')
      };

      // DETECT: Marketing Bot Post vs Instagram Lead
      if (record.day_of_week && record.topic) {
        // Marketing Bot Post -> SocialPosts tab
        const sheetPayload = {
          auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
          target_sheet: 'SocialPosts',
          day: safeRecord.day_of_week,
          topic: safeRecord.topic,
          caption: safeRecord.caption,
          added: new Date().toISOString()
        };

        const response = await fetchWithTimeout(process.env.MARKETING_SHEET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sheetPayload)
        }, 15000, 'marketing-sheets-push');

        await (response ? response.text().catch(() => '') : '');

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Social post pushed to Sheets' }) };
      }

      // Instagram Lead -> IG_Leads tab
      // Format timestamp for easy reading in Sheets
      const postedDate = record.posted_at ? new Date(record.posted_at) : new Date();
      const postedISO = postedDate.toISOString();

      const sheetPayload = {
        auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
        username: safeRecord.username,
        likes: safeRecord.likes,
        caption: safeRecord.caption,
        link: safeRecord.id,
        posted: postedISO,
        added: new Date().toISOString()
      };

      const response = await fetchWithTimeout(process.env.MARKETING_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetPayload)
      }, 15000, 'marketing-sheets-push');

      await (response ? response.text().catch(() => '') : '');

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Pushed to Sheets' }) };
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
          headers,
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
      // Fetch local_mentions from Supabase with a safe limit
      if (!supabase) {
        console.error('[MARKETING SYNC] Missing SUPABASE env for export mode');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE not configured for export' }) };
      }

      const { data: mentions, error } = await supabase
        .from('local_mentions')
        .select('*')
        .order('likes', { ascending: false })
        .limit(EXPORT_ROW_LIMIT);

      if (error) throw error;

      // GDPR FIX: Filter out tombstoned records before export
      const safeMentions = await filterTombstoned('local_mentions', mentions, 'username');

      console.log(`[MARKETING] Exporting ${safeMentions.length} mentions to Sheets (limit ${EXPORT_ROW_LIMIT})`);

      // Format all records
      const records = safeMentions.map(record => {
        const postedDate = record.posted_at ? new Date(record.posted_at) : new Date();
        const postedISO = postedDate.toISOString();

        return {
          username: sanitizeInput(record.username || ''),
          likes: Number(record.likes) || 0,
          caption: sanitizeInput(String(record.caption || '')).slice(0, 2000),
          link: sanitizeInput(String(record.id || '')),
          posted: postedISO,
          added: new Date().toISOString()
        };
      });

      // Send bulk payload with timeout
      const response = await fetchWithTimeout(process.env.MARKETING_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
          bulk: true,
          records: records
        })
      }, 30000, 'marketing-sheets-bulk');

      const result = await (response ? response.text().catch(() => '') : '');
      console.log('[MARKETING] Bulk export result:', String(result).slice(0, 500));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, exported: safeMentions.length })
      };
    }

  } catch (err) {
    console.error("Sync Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sync failed' }) };
  }
};