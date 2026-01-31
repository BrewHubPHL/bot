exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        const { record, type, table, auth_key } = payload;

        console.log(`Incoming Webhook: Table=${table}, Type=${type}`);

        // 1. THE UPDATED BOUNCER
        // Allow INSERT for anything, but also allow UPDATE for employee_profiles
        const isAllowedType = (type === 'INSERT' || (type === 'UPDATE' && table === 'employee_profiles'));

        if (!record || !isAllowedType) {
            console.log('Ignored event type:', type);
            return { statusCode: 200, body: `Event type ${type} on table ${table} ignored.` };
        }

        const GS_URL = process.env.GOOGLE_SCRIPT_URL;
        let sheetData = {
            auth_key: auth_key || "BrewHub-Sync-2027-Secure", // Use key from payload or fallback
        };

        // 2. DATA ROUTING
        if (table === 'time_logs') {
            sheetData.target_sheet = 'Logs';
            sheetData.timestamp = record.created_at;
            sheetData.email = record.employee_email;
            sheetData.action = record.action_type;
            sheetData.status = record.status;
        } 
        
        else if (table === 'employee_profiles') {
            sheetData.target_sheet = 'Employees';
            sheetData.name = record.full_name;
            sheetData.email = record.email; // Matches your log: "email": "samantharoze..."
            sheetData.role = record.role;
            sheetData.pay_rate = record.pay_rate;
            sheetData.action = type;
        }

        // 3. SEND TO GOOGLE
        console.log('Forwarding to Google Sheets:', sheetData.target_sheet);
        
        const response = await fetch(GS_URL, {
            method: 'POST',
            body: JSON.stringify(sheetData),
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.text();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Success', google_response: result })
        };

    } catch (error) {
        console.error('Error in Netlify Function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};