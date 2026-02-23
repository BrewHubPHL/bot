const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');

// Helper: fetch with timeout
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
    // CORS + method guard
    const ALLOWED_ORIGINS = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
    const origin = (event.headers?.['origin'] || '').replace(/\/$/, '');
    const referer = (event.headers?.['referer'] || '');
    const isLocalDev = process.env.NODE_ENV !== 'production' && (origin.includes('://localhost') || referer.includes('://localhost'));
    const isValidOrigin = ALLOWED_ORIGINS.some(a => a === origin || referer.startsWith(a));

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
        'Cache-Control': 'no-store'
    };
    if (isValidOrigin || isLocalDev) headers['Access-Control-Allow-Origin'] = origin || ALLOWED_ORIGINS[0];

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    // Internal-only: called by Supabase webhooks
    // Uses timing-safe comparison with null guard
    const serviceAuth = verifyServiceSecret(event);
    if (!serviceAuth.valid) return serviceAuth.response;

    // Ensure required envs exist
    if (!process.env.GOOGLE_SHEETS_AUTH_KEY || !process.env.MARKETING_SHEET_URL || !process.env.INTERNAL_SYNC_SECRET || !process.env.GOOGLE_SCRIPT_URL) {
        console.error('supabase-to-sheets: missing GOOGLE_SHEETS_AUTH_KEY or MARKETING_SHEET_URL or INTERNAL_SYNC_SECRET or GOOGLE_SCRIPT_URL');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
    }

    // Create Supabase client per-request (avoid module-scope service-role client)
    const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
        : null;

    try {
        let payload;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
        }
        const { record: rawRecord, old_record, type, table } = payload;
        let record = rawRecord;
        
        // SSoT Fix: Handle Deletions
        if (type === 'DELETE' && old_record) {
            record = old_record;
            // Add a flag we can use later or just rely on 'type'
        }

        console.log(`Incoming Webhook: Table=${table}, Type=${type}`);

        // SSoT Fix: Allow DELETE events to propagate (Audit Log)
        const isAllowedType = (type === 'INSERT' || type === 'DELETE' || (type === 'UPDATE' && table === 'employee_profiles'));
        if (!record || !isAllowedType) {
            return { statusCode: 200, headers, body: JSON.stringify({ ignored: true }) };
        }

        const GS_URL = process.env.GOOGLE_SCRIPT_URL;
        let sheetData = { auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY };

        // 2. DATA ROUTING
        
        // --- MARKETING: Route to specialized handler ---
        if (table === 'marketing_posts' || table === 'marketing_leads') {
            // If it's a DELETE, we might want to tell marketing-sync to handle it (if supported)
            // or just log it. For now, let's just log in sheets that it was deleted if possible.
            // But marketing-sync PUSH logic expects specific fields.
            
            if (type === 'DELETE') {
                 // GDPR FIX: Propagate deletion to Google Sheet
                 const emailRaw = sanitizeInput((record.email || record.username || '')).toLowerCase();
                 const email = emailRaw.slice(0, 254);
                 if (email) {
                     console.log('[GDPR] Propagating deletion to Sheet (preview):', email.slice(0, 64));
                     try {
                         await fetchWithTimeout(process.env.MARKETING_SHEET_URL, {
                             method: 'POST',
                             headers: { 'Content-Type': 'application/json' },
                             body: JSON.stringify({
                                 auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
                                 action: 'DELETE',
                                 email: email,
                                 reason: 'GDPR Deletion from Supabase SSoT'
                             })
                         }, 10000, 'marketing-sheet-delete');
                     } catch (sheetErr) {
                         console.error('[GDPR] Sheet deletion failed (truncated):', String(sheetErr)?.slice(0,200));
                         // Don't fail the webhook - the tombstone in DB is the SSoT
                     }
                 }
                 return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'GDPR deletion propagated' }) };
            }

            console.log('➡️ Routing to Marketing Sync (preview)');
            const baseUrl = process.env.URL || 'https://brewhubphl.com';
            try {
                const res = await fetchWithTimeout(`${baseUrl}/.netlify/functions/marketing-sync?mode=push`, {
                    method: 'POST',
                    body: JSON.stringify({ record: {
                        day_of_week: sanitizeInput(record.day_of_week || ''),
                        topic: sanitizeInput(record.topic || ''),
                        caption: sanitizeInput(String(record.caption || '')).slice(0,1000),
                        username: sanitizeInput(record.username || ''),
                        id: sanitizeInput(record.id || '')
                    } }),
                    headers: {
                        'Content-Type': 'application/json',
                        'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET
                    }
                }, 15000, 'marketing-sync-forward');

                const respText = await (res ? res.text().catch(() => '') : '');
                console.log('[SUPABASE-TO-SHEETS] marketing-sync forwarded, status:', res ? res.status : 'no-response', String(respText).slice(0,200));
                if (!res || !res.ok) {
                    console.warn('[SUPABASE-TO-SHEETS] marketing-sync returned non-OK', res ? res.status : 'no-response');
                }
            } catch (e) {
                console.error('[SUPABASE-TO-SHEETS] marketing-sync forward failed (truncated):', String(e)?.slice(0,200));
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true, routed: 'marketing-sync' }) };
        }

        // --- MASTER SHEET: time_logs, employees, waitlist ---
        if (table === 'time_logs') {
            sheetData.target_sheet = 'Logs';
            sheetData.email = sanitizeInput(record.employee_email || '').slice(0,254);
            sheetData.action = sanitizeInput(record.action_type || '').slice(0,100);
        } 
        else if (table === 'employee_profiles') {
            sheetData.target_sheet = 'Employees';
            sheetData.name = sanitizeInput(record.full_name || '').slice(0,200);
            sheetData.email = sanitizeInput(record.email || '').slice(0,254);
        }
        else if (table === 'waitlist') {
            sheetData.target_sheet = 'Waitlist';
            sheetData.email = sanitizeInput(record.email || '').slice(0,254);
            sheetData.action = 'New Signup';

            // Check if this email is already a registered customer (skip welcome email if so)
            if (supabase) {
                const { data: existingCustomer } = await supabase
                    .from('customers')
                    .select('email')
                    .eq('email', sheetData.email)
                    .single();

                if (!existingCustomer) {
                    // Only send welcome email to new users not already in customers table
                    console.log('Triggering Welcome Email (preview) for:', sheetData.email.slice(0,64));
                    try {
                        const { error: emailError } = await supabase.functions.invoke('welcome-email', {
                            body: { record: { email: sheetData.email } } 
                        });
                        if (emailError) console.error('Email Trigger Failed (truncated):', String(emailError).slice(0,200));
                    } catch (e) {
                        console.error('welcome-email invoke failed (truncated):', String(e).slice(0,200));
                    }
                } else {
                    console.log('Skipping welcome email - already a customer (preview):', sheetData.email.slice(0,64));
                }
            } else {
                console.warn('Supabase client not available; skipping welcome email check');
            }
        }

        // 3. SEND TO GOOGLE
        const response = await fetchWithTimeout(GS_URL, {
            method: 'POST',
            body: JSON.stringify(sheetData),
            headers: { 'Content-Type': 'application/json' }
        }, 15000, 'google-sheets-post');

        const result = await (response ? response.text().catch(() => '') : '');
        console.log('[SUPABASE-TO-SHEETS] Google post result (truncated):', String(result).slice(0,1000));
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('Error:', String(error).slice(0,500));
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sync failed' }) };
    }
};