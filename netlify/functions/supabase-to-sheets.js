const fetch = require('node-fetch');

// This function receives a webhook from Supabase (time_logs table) and forwards it to Google Sheets
exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        console.log('Method Not Allowed:', event.httpMethod);
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log('Incoming Webhook Body:', event.body);
        const payload = JSON.parse(event.body);
        
        // Supabase webhook payload structure: { type: 'INSERT', table: 'time_logs', record: { ... }, ... }
        const { record, type, table, schema } = payload;

        if (!record || type !== 'INSERT') {
            console.log('Ignored event type:', type);
            return { statusCode: 200, body: 'Not an INSERT event or missing record' };
        }

        console.log(`Processing ${type} on ${schema}.${table}`);

        const GS_URL = 'https://script.google.com/macros/s/AKfycbxYO7QiPDxUTc7cxV5T5g8RZ4Fd2UWBcUdTvZfhU7AFXGNFtkr1y6ABtA_4eaG1hLLkng/exec';

        let sheetData = {};

        // CASE 1: Employee Clock In/Out (public.time_logs)
        if (table === 'time_logs') {
            sheetData = {
                email: record.employee_email,
                action: record.action_type, // "CLOCK_IN" or "CLOCK_OUT"
                name: record.employee_email,
                timestamp: record.created_at,
                source: 'supabase_time_Log'
            };
        } 
        // CASE 2: New Employee Created (auth.users)
        else if (table === 'users' && schema === 'auth') {
            sheetData = {
                email: record.email,
                action: 'EMPLOYEE_CREATED',
                name: record.email, // Auth table doesn't have a name field by default, defaulting to email
                timestamp: record.created_at,
                source: 'supabase_auth'
            };
        }
        else {
            console.log('Unknown table/schema:', schema, table);
            return { statusCode: 200, body: 'Table not supported by this webhook handler' };
        }

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
