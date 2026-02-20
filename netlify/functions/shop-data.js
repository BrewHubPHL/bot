const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Public endpoint - no auth required for browsing shop products
    // Uses service role key to read products but only exposes safe fields

    try {
        // Check shop status
        const { data: settingsData } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'shop_enabled')
            .single();

        const shopEnabled = settingsData?.value !== false;

        if (!shopEnabled) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ shopEnabled: false, products: [] }),
            };
        }

        // Fetch active products
        const { data: products, error } = await supabase
            .from('merch_products')
            .select('name, price_cents, description, image_url, checkout_url, sort_order, category')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });

        if (error) {
            console.error('Shop data fetch error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to load products' }),
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ shopEnabled: true, products: products || [] }),
        };
    } catch (err) {
        console.error('Shop data error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Server error' }),
        };
    }
};
