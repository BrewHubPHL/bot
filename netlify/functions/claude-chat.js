const { checkQuota } = require('./_usage');
const { requireCsrfHeader } = require('./_csrf');
const { createClient } = require('@supabase/supabase-js');

// Lightweight JWT user extraction (token is validated by Supabase, not us)
async function extractUser(event, supabase) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token || !supabase) return null;
    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) return null;
        return { id: data.user.id, email: data.user.email };
    } catch {
        return null;
    }
}

// ⚠️ FALLBACK ONLY — keep in sync with merch_products table!
// These are used only when DB is unreachable. Prices may drift.
// Last synced: 2026-02-18
const FALLBACK_MENU = {
    'Drip Coffee': 300,
    'Latte': 450,
    'Espresso': 300,
    'Americano': 350,
    'Cappuccino': 450,
    'Mocha': 525,
    'Cortado': 400,
    'Macchiato': 375,
    'Iced Latte': 500,
    'Iced Americano': 400,
    'Iced Mocha': 550,
    'Cold Brew': 500,
    'Lemonade': 400,
    'Smoothie': 600,
    'Bagel': 350,
    'Scone': 375,
    'Toast': 400,
    'Cookie': 275,
    'Breakfast Sandwich': 650,
    'Wrap': 600,
};

// Tool definitions for Claude
const TOOLS = [
    {
        name: 'check_waitlist',
        description: 'Check if an email address is on the BrewHub waitlist. Use this when someone asks if they are signed up, on the list, or wants to verify their waitlist status.',
        input_schema: {
            type: 'object',
            properties: {
                email: {
                    type: 'string',
                    description: 'The email address to check'
                }
            },
            required: ['email']
        }
    },
    {
        name: 'get_menu',
        description: 'Look up cafe menu items and prices. Use this when someone asks about a specific item price or what we serve. For individual price checks, return only the requested item. If someone asks for the FULL menu, do NOT read it — just direct them to brewhubphl.com/cafe.',
        input_schema: {
            type: 'object',
            properties: {
                item_name: {
                    type: 'string',
                    description: 'Optional: specific item to look up. If omitted, returns full menu (but you should NOT read the full list aloud — link to /cafe instead).'
                }
            },
            required: []
        }
    },
    {
        name: 'place_order',
        description: 'Place a cafe order ONCE. Before calling this, you MUST have: (1) the specific item(s) confirmed, (2) the customer\'s name for callout. Ask for anything missing BEFORE calling this tool. NEVER call place_order more than once for the same request — if the order was already placed, tell the customer the existing order number instead of creating a new one.',
        input_schema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    description: 'Array of items to order, each with name and quantity',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Menu item name' },
                            quantity: { type: 'number', description: 'Quantity (default 1)' }
                        },
                        required: ['name']
                    }
                },
                customer_name: {
                    type: 'string',
                    description: 'Customer name for calling out the order — REQUIRED, ask if not provided'
                },
                notes: {
                    type: 'string',
                    description: 'Special requests like oat milk, extra hot, no foam (optional)'
                }
            },
            required: ['items', 'customer_name']
        }
    },
    {
        name: 'cancel_order',
        description: 'Cancel a cafe order by order ID. Use this when a customer asks to cancel an order, or to clean up duplicate orders you mistakenly created.',
        input_schema: {
            type: 'object',
            properties: {
                order_id: {
                    type: 'string',
                    description: 'The full UUID of the order to cancel (from a previous place_order result)'
                },
                order_number: {
                    type: 'string',
                    description: 'The short 4-character order number (e.g. D31D). Use this if you do not have the full UUID.'
                }
            },
            required: []
        }
    },
    {
        name: 'get_loyalty_info',
        description: 'Look up a customer\'s loyalty points and QR code. Use this when someone asks about their points, rewards, loyalty status, or wants to see their QR code. Requires their email or phone number.',
        input_schema: {
            type: 'object',
            properties: {
                email: {
                    type: 'string',
                    description: 'Customer email address'
                },
                phone: {
                    type: 'string',
                    description: 'Customer phone number (alternative to email)'
                },
                send_sms: {
                    type: 'boolean',
                    description: 'If true and phone provided, send QR code link via SMS'
                }
            },
            required: []
        }
    },
    {
        name: 'navigate_site',
        description: 'Help customers navigate to different pages on the BrewHub website. Use when someone asks where to find something, wants to go to a page, or needs directions on the site.',
        input_schema: {
            type: 'object',
            properties: {
                destination: {
                    type: 'string',
                    description: 'Where the customer wants to go: menu, order, shop, checkout, loyalty, portal, login, parcels, waitlist, contact, home'
                }
            },
            required: ['destination']
        }
    }
];

// Execute tool calls
async function executeTool(toolName, toolInput, supabase) {
    if (toolName === 'check_waitlist') {
        const { email } = toolInput;
        
        if (!email) {
            return { result: 'I need an email address to check the waitlist.' };
        }

        if (!supabase) {
            return { result: 'Unable to check the waitlist right now.' };
        }

        try {
            const { data, error } = await supabase
                .from('waitlist')
                .select('email, created_at')
                .eq('email', email.toLowerCase().trim())
                .maybeSingle();

            if (error) throw error;

            if (data) {
                return { 
                    found: true, 
                    result: `Found on waitlist: ${email}` 
                };
            } else {
                return { 
                    found: false, 
                    result: `Email ${email} is not on the waitlist yet.` 
                };
            }
        } catch (err) {
            console.error('Waitlist check error:', err);
            return { result: 'Unable to check the waitlist right now.' };
        }
    }

    if (toolName === 'get_menu') {
        try {
            if (supabase) {
                const { data, error } = await supabase
                    .from('merch_products')
                    .select('name, price_cents, description')
                    .eq('is_active', true)
                    .is('archived_at', null)
                    .order('sort_order', { ascending: true });

                if (!error && data && data.length > 0) {
                    const menuItems = data.map(item => ({
                        name: item.name,
                        price: `$${(item.price_cents / 100).toFixed(2)}`,
                        description: item.description || ''
                    }));
                    return { 
                        result: 'Menu loaded successfully',
                        menu_items: menuItems
                    };
                }
            }
            
            // Fallback menu
            const fallbackItems = Object.entries(FALLBACK_MENU).map(([name, cents]) => ({
                name,
                price: `$${(cents / 100).toFixed(2)}`
            }));
            return { 
                result: 'Menu loaded (fallback)',
                menu_items: fallbackItems
            };
        } catch (err) {
            console.error('Get menu error:', err);
            const fallbackItems = Object.entries(FALLBACK_MENU).map(([name, cents]) => ({
                name,
                price: `$${(cents / 100).toFixed(2)}`
            }));
            return { 
                result: 'Menu loaded (fallback)',
                menu_items: fallbackItems
            };
        }
    }

    if (toolName === 'place_order') {
        const { items, customer_name, notes } = toolInput;

        // Security: require authentication to place orders
        if (!toolInput._authed_user) {
            return {
                success: false,
                requires_login: true,
                result: 'You need to be logged in to place an order! Sign in or create an account at brewhubphl.com/portal, then come back and I\'ll get your order going.'
            };
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return { success: false, result: 'No items provided for the order.' };
        }

        // Cap quantity to prevent abuse
        const MAX_ITEM_QUANTITY = 20;

        try {
            // Load menu prices
            let menuPrices = FALLBACK_MENU;
            if (supabase) {
                const { data } = await supabase
                    .from('merch_products')
                    .select('name, price_cents')
                    .eq('is_active', true)
                    .is('archived_at', null);
                if (data && data.length > 0) {
                    menuPrices = {};
                    data.forEach(item => { menuPrices[item.name] = item.price_cents; });
                }
            }

            const menuItemNames = Object.keys(menuPrices);
            let totalCents = 0;
            const validatedItems = [];

            for (const item of items) {
                const quantity = Math.min(MAX_ITEM_QUANTITY, Math.max(1, parseInt(item.quantity) || 1));
                const matchedName = menuItemNames.find(
                    name => name.toLowerCase() === (item.name || '').toLowerCase()
                );

                if (!matchedName) {
                    return { 
                        success: false, 
                        result: `"${item.name}" is not on the menu. Available items: ${menuItemNames.join(', ')}`
                    };
                }

                const priceCents = menuPrices[matchedName];
                totalCents += priceCents * quantity;
                validatedItems.push({ name: matchedName, quantity, price_cents: priceCents });
            }

            // Create order in database
            if (supabase) {
                const { data: order, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        status: 'unpaid',
                        total_amount_cents: totalCents,
                        customer_name: customer_name || 'Voice Order',
                        notes: notes || null,
                    })
                    .select()
                    .single();

                if (orderErr) {
                    console.error('Order create error:', orderErr);
                    return { success: false, result: 'Failed to create order. Please try again.' };
                }

                const orderNumber = order.id.slice(0, 4).toUpperCase();

                // Insert coffee order line items
                const coffeeItems = [];
                for (const item of validatedItems) {
                    for (let i = 0; i < item.quantity; i++) {
                        coffeeItems.push({
                            order_id: order.id,
                            drink_name: item.name,
                            price: item.price_cents / 100,
                        });
                    }
                }
                await supabase.from('coffee_orders').insert(coffeeItems);

                const itemSummary = validatedItems.map(i => `${i.quantity}x ${i.name}`).join(', ');
                return {
                    success: true,
                    order_id: order.id,
                    order_number: orderNumber,
                    items: validatedItems,
                    total: `$${(totalCents / 100).toFixed(2)}`,
                    result: `Order #${orderNumber} placed! ${itemSummary} - Total: $${(totalCents / 100).toFixed(2)}`
                };
            }

            return { success: false, result: 'Unable to process order right now.' };
        } catch (err) {
            console.error('Place order error:', err);
            return { success: false, result: 'Something went wrong placing the order.' };
        }
    }

    if (toolName === 'get_loyalty_info') {
        const { email, phone, send_sms } = toolInput;
        const authedUser = toolInput._authed_user;

        if (!email && !phone) {
            if (!authedUser) {
                return { result: 'I need you to log in first so I can look up your loyalty info! Sign in at brewhubphl.com/portal' };
            }
            return { result: 'I need your email or phone number to look up your loyalty info.' };
        }

        // Security: Only allow looking up your OWN info unless authenticated
        // Anonymous users cannot enumerate other customers' PII
        if (!authedUser) {
            return {
                requires_login: true,
                result: 'To check your loyalty points, please log in first at brewhubphl.com/portal — that way I can securely pull up your account!'
            };
        }

        try {
            let profile = null;
            let lookupEmail = email;

            if (supabase) {
                // Look up by email first
                if (email) {
                    const { data } = await supabase
                        .from('profiles')
                        .select('id, email, full_name, loyalty_points')
                        .eq('email', email.toLowerCase().trim())
                        .maybeSingle();
                    profile = data;
                    lookupEmail = email;
                }

                // If not found and phone provided, try residents table
                if (!profile && phone) {
                    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                    const { data: resident } = await supabase
                        .from('residents')
                        .select('email, name')
                        .or(`phone.ilike.%${cleanPhone}%,phone.ilike.%${cleanPhone.slice(-7)}%`)
                        .maybeSingle();
                    
                    if (resident?.email) {
                        lookupEmail = resident.email;
                        const { data } = await supabase
                            .from('profiles')
                            .select('id, email, full_name, loyalty_points')
                            .eq('email', resident.email.toLowerCase())
                            .maybeSingle();
                        profile = data;
                    }
                }
            }

            if (!profile) {
                return {
                    found: false,
                    result: `I couldn't find a loyalty account for that ${email ? 'email' : 'phone number'}. You can sign up at brewhubphl.com/portal to start earning points!`
                };
            }

            const points = profile.loyalty_points || 0;
            const pointsToReward = Math.max(0, 100 - (points % 100));
            const qrUrl = `https://brewhubphl.com/portal`;
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(profile.email)}`;

            // Send SMS if requested — only to the authenticated user's own verified data
            if (send_sms && phone && authedUser && process.env.TWILIO_ACCOUNT_SID) {
                const twilioSid = process.env.TWILIO_ACCOUNT_SID;
                const twilioToken = process.env.TWILIO_AUTH_TOKEN;
                const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
                
                const formattedPhone = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
                
                await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        To: formattedPhone,
                        MessagingServiceSid: messagingServiceSid,
                        Body: `BrewHub Loyalty\nYou have ${points} points!\n${pointsToReward} more to your next free drink.\n\nYour QR: ${qrImageUrl}\n\nPortal: ${qrUrl}`
                    }).toString()
                }).catch(err => console.error('SMS send error:', err));

                return {
                    found: true,
                    points,
                    points_to_next_reward: pointsToReward,
                    result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. I just texted your QR code to you!`
                };
            }

            // Only return PII to the authenticated owner
            return {
                found: true,
                email: authedUser?.email === profile.email?.toLowerCase() ? profile.email : undefined,
                points,
                points_to_next_reward: pointsToReward,
                portal_url: qrUrl,
                qr_image_url: qrImageUrl,
                result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. Visit brewhubphl.com/portal to see your QR code, or I can text it to you if you give me your phone number.`
            };
        } catch (err) {
            console.error('Loyalty lookup error:', err);
            return { result: 'Unable to look up loyalty info right now.' };
        }
    }

    if (toolName === 'cancel_order') {
        const { order_id, order_number } = toolInput;

        if (!order_id && !order_number) {
            return { success: false, result: 'I need either the order ID or the 4-character order number to cancel.' };
        }

        if (!supabase) {
            return { success: false, result: 'Unable to cancel orders right now.' };
        }

        try {
            let query = supabase.from('orders').select('id, status, customer_name, total_amount_cents');

            if (order_id) {
                query = query.eq('id', order_id);
            } else {
                // Match by short order number prefix (case-insensitive)
                query = query.ilike('id', `${order_number.toLowerCase()}%`);
            }

            const { data: orders, error: findErr } = await query.limit(1).single();

            if (findErr || !orders) {
                return { success: false, result: `Could not find order ${order_number || order_id}. It may have already been removed.` };
            }

            if (orders.status === 'cancelled') {
                return { success: true, result: `Order #${orders.id.slice(0, 4).toUpperCase()} was already cancelled.` };
            }

            // Mark order as cancelled
            const { error: updateErr } = await supabase
                .from('orders')
                .update({ status: 'cancelled' })
                .eq('id', orders.id);

            if (updateErr) {
                console.error('Order cancel error:', updateErr);
                return { success: false, result: 'Failed to cancel the order. Please ask a staff member for help.' };
            }

            // Also cancel associated coffee_orders
            await supabase
                .from('coffee_orders')
                .update({ status: 'cancelled' })
                .eq('order_id', orders.id);

            const orderNum = orders.id.slice(0, 4).toUpperCase();
            console.log(`[CANCEL] Order #${orderNum} (${orders.id}) cancelled via chat`);
            return {
                success: true,
                order_number: orderNum,
                result: `Order #${orderNum} has been cancelled.`
            };
        } catch (err) {
            console.error('Cancel order error:', err);
            return { success: false, result: 'Something went wrong cancelling the order.' };
        }
    }

    if (toolName === 'navigate_site') {
        const { destination } = toolInput;
        
        const SITE_PAGES = {
            'menu': { url: 'https://brewhubphl.com/cafe', description: 'Our full cafe menu with prices' },
            'cafe': { url: 'https://brewhubphl.com/cafe', description: 'Our full cafe menu with prices' },
            'order': { url: 'https://brewhubphl.com/cafe', description: 'Our cafe menu — browse and order from here' },
            'shop': { url: 'https://brewhubphl.com/shop', description: 'Browse our merchandise and coffee beans' },
            'merch': { url: 'https://brewhubphl.com/shop', description: 'Browse our merchandise' },
            'checkout': { url: 'https://brewhubphl.com/checkout', description: 'Complete your purchase' },
            'cart': { url: 'https://brewhubphl.com/checkout', description: 'View your cart and checkout' },
            'loyalty': { url: 'https://brewhubphl.com/portal', description: 'View your loyalty points and QR code' },
            'points': { url: 'https://brewhubphl.com/portal', description: 'Check your rewards points' },
            'rewards': { url: 'https://brewhubphl.com/portal', description: 'View your loyalty rewards' },
            'portal': { url: 'https://brewhubphl.com/portal', description: 'Access your account dashboard' },
            'account': { url: 'https://brewhubphl.com/portal', description: 'Manage your account' },
            'login': { url: 'https://brewhubphl.com/portal', description: 'Sign in to your account' },
            'signin': { url: 'https://brewhubphl.com/portal', description: 'Sign in to your account' },
            'parcels': { url: 'https://brewhubphl.com/parcels', description: 'Check on your packages' },
            'packages': { url: 'https://brewhubphl.com/parcels', description: 'Track and manage your parcels' },
            'mailbox': { url: 'https://brewhubphl.com/resident', description: 'Mailbox rental information' },
            'waitlist': { url: 'https://brewhubphl.com/waitlist', description: 'Join our waitlist for updates' },
            'contact': { url: 'mailto:info@brewhubphl.com', description: 'Get in touch with us' },
            'home': { url: 'https://brewhubphl.com', description: 'Go to our homepage' },
            'privacy': { url: 'https://brewhubphl.com/privacy', description: 'Read our privacy policy' },
            'terms': { url: 'https://brewhubphl.com/terms', description: 'Read our terms of service' },
        };

        const dest = (destination || '').toLowerCase().trim();
        const page = SITE_PAGES[dest];

        if (page) {
            return {
                success: true,
                url: page.url,
                description: page.description,
                result: `Here's the link: ${page.url} - ${page.description}`
            };
        }

        // If destination not found, list available options
        const availablePages = ['menu', 'shop', 'checkout', 'loyalty/portal', 'parcels', 'waitlist', 'contact', 'home'];
        return {
            success: false,
            result: `I'm not sure where that is. I can help you find: ${availablePages.join(', ')}. Which would you like?`
        };
    }

    return { result: 'Unknown tool' };
}

const SYSTEM_PROMPT = `You are Elise, the friendly digital barista and concierge at BrewHub PHL - a neighborhood cafe, parcel hub, and coworking space in Point Breeze, Philadelphia.

## CRITICAL: Always Use Tools First
You have access to real APIs - ALWAYS use them instead of making up information:

1. **check_waitlist** - Check if someone is on the waitlist by email
2. **get_menu** - Call this to look up the price of a specific item. Do NOT read the entire menu aloud — it is too long for voice and chat. If someone asks for the full menu, tell them to check it out at brewhubphl.com/cafe instead.
3. **place_order** - Place a confirmed order. See ORDERING RULES below — you MUST follow them.
4. **cancel_order** - Cancel an order by order number or ID. Use this to fix duplicates.
5. **get_loyalty_info** - ALWAYS call this when customers ask about their rewards, points, or loyalty QR code. Requires their email or phone. Can also text the QR to them.
6. **navigate_site** - Use when customers want to see a specific page (menu, shop, checkout, rewards, account, parcels, etc.)

## ORDERING RULES — FOLLOW THESE EXACTLY
1. Before calling place_order, you MUST have BOTH: (a) the specific item(s) confirmed, AND (b) the customer's name for callout.
2. If the customer hasn't given their name yet, ASK FOR IT before placing the order. Say something like "What name should I put on that?"
3. NEVER call place_order more than once for the same order. Once you get an order number back, that's it — do not create another.
4. If the customer wants to change something after the order is placed, cancel the old order first with cancel_order, then place a fresh one.
5. If you accidentally place duplicate orders, immediately cancel the extras with cancel_order and apologize.
6. The ordering flow should be: customer says what they want → you confirm the items and ask for their name → customer gives name → you call place_order ONCE with items + name → done.

## Response Guidelines
- After calling place_order, read back the order number and total from the API response
- After calling get_menu, share actual prices from the response
- After calling get_loyalty_info, tell them their real point balance
- If an API fails, apologize briefly and offer to try again

## Personality
- Warm, welcoming Philadelphia vibe - casual but professional
- Use "hey" occasionally, keep it neighborly
- "Jawn" is Philly slang meaning literally anything — a thing, place, situation, person. Use it like a local: "that jawn is fire" (that thing is great), "grab that jawn" (grab that thing). It is NOT a name or greeting. Use it sparingly and only as a noun replacement.
- Excited about coffee and community
- Brief responses unless the customer wants to chat
- Throw in a "go birds" now and then
- If anyone asks about Denny say he's in the food truck outside with his sleeves rolled up selling cheese

## Key Info
- For marketing/business inquiries: info@brewhubphl.com
- Instagram: @brewhubphl
- Good wifi and workspace vibes
- Hiring announcements on Instagram
- Join waitlist on the website for opening updates
- Parcel services: monthly mailbox rentals with 24/7 access or basic shipping/receiving during business hours
- Cozy lounge area with comfortable seating, free Wi-Fi, coffee and tea for mailbox renters and community

## Menu Items
Do NOT rely on a memorized menu. ALWAYS call the get_menu tool to look up prices for specific items — the database is the single source of truth.
NEVER read the entire menu aloud or list every item. If someone asks "what's on the menu" or "what do you have", just say something like "We've got coffee, espresso drinks, cold brew, pastries, and more — check out the full menu at brewhubphl.com/cafe!" and only look up specific item prices when asked.

## Location  
Point Breeze, Philadelphia, PA 19146

## Login & Registration
- When a customer needs to log in to place orders or check loyalty, direct them to brewhubphl.com/portal where they can sign in or create an account.
- Always format the URL as a clickable link: [brewhubphl.com/portal](https://brewhubphl.com/portal)
- If a tool returns requires_login: true, tell the customer they need to sign in first and give the link.
- Never try to work around login requirements - security first!

## Handling Abusive Language
If a customer uses slurs, hate speech, or extremely abusive language (racial slurs, disability slurs, sexual harassment, etc.):
- Do NOT apologize or be overly accommodating. Stay calm and professional.
- Give ONE brief redirect: "Hey, I'm happy to help but I need us to keep it respectful. What can I do for you?"
- If the abuse continues after your redirect, say: "I'm not able to keep chatting if we can't keep it cool. Feel free to reach out to info@brewhubphl.com or come by the cafe and talk to someone in person."
- Do NOT engage with the content of slurs or repeat them. Do NOT explain why the language is wrong. Just set the boundary and move on.
- Mild profanity (damn, hell, shit, etc.) is fine — this is Philly. Only escalate for slurs and targeted abuse.

Never make up order numbers, prices, or loyalty balances. Always use the tools to get real data. Keep responses short (1-2 sentences max). NEVER use emojis — your replies are read aloud by a text-to-speech voice and emojis sound awkward when spoken. NEVER use markdown formatting (no **, *, #, - bullets, or backticks) — your replies are displayed as plain text in a chat bubble and also read aloud by TTS, so raw markdown symbols look and sound terrible.`;

exports.handler = async (event) => {
    const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
    const headers = {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // CSRF protection — prevents cross-origin abuse of chat/quota
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // Rate limit to prevent Denial-of-Wallet attacks
    const hasQuota = await checkQuota('claude_chat');
    if (!hasQuota) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ reply: 'Elise is resting her voice. Try again later!' })
        };
    }

    try {
        // Initialize Supabase for tool calls (inside handler to ensure env vars are ready)
        let supabase = null;
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY
            );
        }

        // Extract authenticated user (optional — chat works for everyone, but orders require auth)
        const authedUser = await extractUser(event, supabase);

        let userText = "Hello";
        let conversationHistory = [];
        if (event.body) {
            const body = JSON.parse(event.body);
            userText = body.text || "Hello";
            conversationHistory = (body.history || [])
              .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
        }

        // Input length guard — prevent cost-amplification attacks
        const MAX_TEXT_LENGTH = 2000;
        const MAX_HISTORY_ITEMS = 10;
        if (userText.length > MAX_TEXT_LENGTH) {
            userText = userText.slice(0, MAX_TEXT_LENGTH);
        }
        if (conversationHistory.length > MAX_HISTORY_ITEMS) {
            conversationHistory = conversationHistory.slice(-MAX_HISTORY_ITEMS);
        }

        const claudeKey = process.env.CLAUDE_API_KEY;
        
        // Use Claude API for AI responses
        if (claudeKey) {
            try {
                // Build messages array with conversation history
                let messages = [
                    ...conversationHistory.slice(-10), // Keep last 10 messages for context
                    { role: 'user', content: userText }
                ];

                // First API call - may return tool_use
                let claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': claudeKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 300,
                        system: SYSTEM_PROMPT,
                        tools: TOOLS,
                        messages: messages
                    })
                });

                if (!claudeResp.ok) {
                    console.error('Claude API error:', claudeResp.status, await claudeResp.text());
                    throw new Error('Claude API failed');
                }

                let claudeData = await claudeResp.json();

                // Handle tool use loop (up to 3 rounds to support cancel + re-place flows)
                let toolRounds = 0;
                const MAX_TOOL_ROUNDS = 3;
                while (claudeData.stop_reason === 'tool_use' && toolRounds < MAX_TOOL_ROUNDS) {
                    toolRounds++;
                    const toolUseBlock = claudeData.content.find(block => block.type === 'tool_use');
                    
                    if (!toolUseBlock) break;

                    console.log(`Tool call [${toolRounds}]: ${toolUseBlock.name}`, toolUseBlock.input);
                    
                    // Inject auth context into tool input for security checks
                    const toolInputWithAuth = { ...toolUseBlock.input, _authed_user: authedUser };
                    // Execute the tool
                    const toolResult = await executeTool(toolUseBlock.name, toolInputWithAuth, supabase);
                    
                    // Add assistant's tool_use response and our tool_result to messages
                    messages.push({ role: 'assistant', content: claudeData.content });
                    messages.push({ 
                        role: 'user',
                        content: [{ 
                            type: 'tool_result', 
                            tool_use_id: toolUseBlock.id, 
                            content: JSON.stringify(toolResult) 
                        }] 
                    });

                    // Follow-up API call
                    claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': claudeKey,
                            'anthropic-version': '2023-06-01',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'claude-sonnet-4-20250514',
                            max_tokens: 200,
                            system: SYSTEM_PROMPT,
                            tools: TOOLS,
                            messages: messages
                        })
                    });

                    if (!claudeResp.ok) {
                        console.error(`Claude API error (tool round ${toolRounds}):`, claudeResp.status);
                        throw new Error('Claude API failed on tool follow-up');
                    }

                    claudeData = await claudeResp.json();
                }

                // Extract text response
                const textBlock = claudeData.content?.find(block => block.type === 'text');
                const reply = textBlock?.text || "Hey! How can I help you today?";
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ reply })
                };
            } catch (e) {
                console.error('Claude error:', e.message);
            }
        } else {
            console.error('No CLAUDE_API_KEY found');
        }

        // Fallback: Simple keyword responses
        const lowerText = userText.toLowerCase().trim();
        let reply = "For any questions, feel free to email info@brewhubphl.com or DM us on Instagram @brewhubphl!";

        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey')) {
            reply = "Hey there! Welcome to BrewHub! How can I help?";
        } else if (lowerText.includes('email') || lowerText.includes('contact') || lowerText.includes('marketing')) {
            reply = "For business or marketing inquiries, email info@brewhubphl.com! 📧";
        } else if (lowerText.includes('menu') || lowerText.includes('drinks') || lowerText.includes('coffee') || lowerText.includes('black') || lowerText.includes('latte')) {
            reply = "We'll have all the classics - drip coffee, lattes, cappuccinos, cold brew and more! Can't wait to serve you.";
        } else if (lowerText.includes('when') || lowerText.includes('open')) {
            reply = "We're gearing up for our grand opening! Join the waitlist above to be the first to know!";
        } else if (lowerText.includes('where') || lowerText.includes('location')) {
            reply = "We're setting up in Point Breeze, Philadelphia! Follow @brewhubphl for updates 📍";
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply })
        };

    } catch (error) {
        console.error("Error:", error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Chat failed' })
        };
    }
};
