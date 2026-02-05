const { createClient } = require('@supabase/supabase-js');

// 1. Initialize the Master Client (Kills the 403 error)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        const { record, type, table, auth_key } = payload;

        console.log(`Incoming Webhook: Table=${table}, Type=${type}`);

        const isAllowedType = (type === 'INSERT' || (type === 'UPDATE' && table === 'employee_profiles'));
        if (!record || !isAllowedType) {
            return { statusCode: 200, body: `Ignored event.` };
        }

        const GS_URL = process.env.GOOGLE_SCRIPT_URL;
        let sheetData = { auth_key: auth_key || "BrewHub-Sync-2027-Secure" };

        // 2. DATA ROUTING
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

            // --- THE EMAIL TRIGGER (The fix for the email problem) ---
            console.log('Triggering Welcome Email for:', record.email);
            const { error: emailError } = await supabase.functions.invoke('welcome-email', {
                body: { record: { email: record.email } } 
            });
            if (emailError) console.error('Email Trigger Failed:', emailError);
        }
        // --- MARKETING BOT POSTS ---
        else if (table === 'marketing_posts') {
            sheetData.target_sheet = 'SocialPosts';
            sheetData.action = record.day_of_week;  // Day column
            sheetData.name = record.topic;           // Topic column
            sheetData.email = record.caption;        // Caption column
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
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};