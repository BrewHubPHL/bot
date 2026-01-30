// This function receives a webhook from Supabase (time_logs table) and forwards it to Google Sheets
exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        
        // Supabase webhook payload structure: { type: 'INSERT', table: 'time_logs', record: { ... }, ... }
        const { record, type } = payload;

        if (!record || type !== 'INSERT') {
            return { statusCode: 200, body: 'Not an INSERT event or missing record' };
        }

        // Your Google Script URL (from index.html)
        const GS_URL = 'https://script.google.com/macros/s/AKfycbx49FnNhO6K4Ns1TYrcjCQKDzcLF_95YE3dBQlk6t1mgxobGVJTAQ-TEK_nFZTSYAAiuw/exec';

        // Format data for your Google Script. 
        // Note: Your Google Script likely expects specific field names (e.g. 'email', 'action', 'name').
        // We map the Supabase 'time_logs' columns to what the sheet likely expects.
        // Columns: employee_email, action_type, employee_id
        
        const sheetData = {
            email: record.employee_email,
            action: record.action_type,
            name: record.employee_email, // Using email as name for now since we don't have a separate name field
            timestamp: record.created_at,
            source: 'supabase_webhook'
        };

        // Send to Google Sheets
        const response = await fetch(GS_URL, {
            method: 'POST',
            body: JSON.stringify(sheetData),
            headers: { 'Content-Type': 'application/json' }
        });

        return {
            statusCode: response.status,
            body: JSON.stringify({ message: 'Forwarded to Google Sheets' })
        };

    } catch (error) {
        console.error('Error forwarding to sheets:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
