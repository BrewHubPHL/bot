const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

// 1. Initialize the Master Client (Kills the 403 error)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Internal-only: called by Supabase webhooks
    // Uses timing-safe comparison with null guard
    const serviceAuth = verifyServiceSecret(event);
    if (!serviceAuth.valid) return serviceAuth.response;

    try {
        const payload = JSON.parse(event.body);
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
            return { statusCode: 200, body: `Ignored event.` };
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
                 // Send a "delete" command to the Sheet with the record identifier
                 const email = (record.email || record.username || '').toLowerCase();
                 if (email) {
                     console.log(`[GDPR] Propagating deletion to Sheet: ${email}`);
                     try {
                         await fetch(process.env.MARKETING_SHEET_URL, {
                             method: 'POST',
                             headers: { 'Content-Type': 'application/json' },
                             body: JSON.stringify({
                                 auth_key: process.env.GOOGLE_SHEETS_AUTH_KEY,
                                 action: 'DELETE',
                                 email: email,
                                 reason: 'GDPR Deletion from Supabase SSoT'
                             })
                         });
                     } catch (sheetErr) {
                         console.error('[GDPR] Sheet deletion failed:', sheetErr);
                         // Don't fail the webhook - the tombstone in DB is the SSoT
                     }
                 }
                 return { statusCode: 200, body: "GDPR deletion propagated" };
            }

            console.log("➡️ Routing to Marketing Sync...");
            const baseUrl = process.env.URL || 'https://brewhubphl.com';
            
            await fetch(`${baseUrl}/.netlify/functions/marketing-sync?mode=push`, {
                method: 'POST',
                body: JSON.stringify({ record: record }),
                headers: {
                    'Content-Type': 'application/json',
                    'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET
                }
            });

            return { statusCode: 200, body: "Routed to Marketing Sync" };
        }

        // --- MASTER SHEET: time_logs, employees, waitlist ---
        if (table === 'time_logs') {
            sheetData.target_sheet = 'Logs';
            sheetData.email = record.employee_email;
            sheetData.action = record.action_type;
        } 
        else if (table === 'employee_profiles') {
            sheetData.target_sheet = 'Employees';
            sheetData.name = record.full_name;
            sheetData.email = record.email;
        }
        else if (table === 'waitlist') {
            sheetData.target_sheet = 'Waitlist';
            sheetData.email = record.email;
            sheetData.action = 'New Signup';

            // Check if this email is already a registered customer (skip welcome email if so)
            const { data: existingCustomer } = await supabase
                .from('customers')
                .select('email')
                .eq('email', record.email)
                .single();

            if (!existingCustomer) {
                // Only send welcome email to new users not already in customers table
                console.log('Triggering Welcome Email for:', record.email);
                const { error: emailError } = await supabase.functions.invoke('welcome-email', {
                    body: { record: { email: record.email } } 
                });
                if (emailError) console.error('Email Trigger Failed:', emailError);
            } else {
                console.log('Skipping welcome email - already a customer:', record.email);
            }
        }

        // 3. SEND TO GOOGLE
        const response = await fetch(GS_URL, {
            method: 'POST',
            body: JSON.stringify(sheetData),
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.text();
        return { statusCode: 200, body: JSON.stringify({ message: 'Success', google_response: result }) };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Sync failed' }) };
    }
};