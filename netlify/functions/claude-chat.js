const { checkQuota } = require('./_usage');
const { requireCsrfHeader } = require('./_csrf');
const { createClient } = require('@supabase/supabase-js');
const { chatBucket } = require('./_token-bucket');
const { sendSMS } = require('./_sms');
const { hashIP } = require('./_ip-hash');
const { sanitizeInput } = require('./_sanitize');

// ═══════════════════════════════════════════════════════════════════
// ALLERGEN / DIETARY / MEDICAL SAFETY LAYER
// ═══════════════════════════════════════════════════════════════════
// Hard-coded regex patterns that MUST be intercepted BEFORE reaching
// the LLM. No amount of prompt engineering is a substitute for code.
// If the user's message matches, we return a canned safe response and
// NEVER forward the question to Claude.
//
// WHY: An LLM can hallucinate "100% peanut-free" and cause
// anaphylaxis + wrongful-death liability. This is a code-level
// kill switch that cannot be bypassed by prompt injection.
// ═══════════════════════════════════════════════════════════════════
const ALLERGEN_KEYWORDS = /\b(allerg(y|ies|ic|en|ens)|anaphyla\w*|epipen|celiac|coeliac|gluten[- ]?free|nut[- ]?free|peanut[- ]?free|dairy[- ]?free|lactose[- ]?(?:free|intoleran\w*)|soy[- ]?free|egg[- ]?free|shellfish|tree[- ]?nut|sesame|sulfite|mustard|lupin|cross[- ]?contam\w*|food[- ]?(?:safe|safety)|intoleran\w*|sensitiv\w*.*(?:food|ingredien|dairy|gluten|nut|soy|egg)|anaphylax\w*|histamine|mast[- ]?cell|immunoglobulin|ige[- ]?mediat\w*)\b/i;

const MEDICAL_KEYWORDS = /\b(diabet\w*|insulin|blood[- ]?sugar|glycemi\w*|keto(?:genic|sis)?|autoimmun\w*|crohn|colitis|ibs|irritable[- ]?bowel|fodmap|phenylketon\w*|pku|galactosem\w*|fructose[- ]?intoleran\w*|hemodialysis|renal[- ]?diet|potassium[- ]?restrict\w*|sodium[- ]?restrict\w*|pregnant|pregnanc\w*|gestational|breastfeed\w*|medication|drug[- ]?interact\w*|blood[- ]?thinn\w*|warfarin|maoi|tyramine)\b/i;

const DIETARY_SAFETY_KEYWORDS = /\b(safe\s+(?:to|for)\s+(?:eat|drink|consum)|(?:can|is|does|do|will|would)\s+(?:it|this|that|the)\s+(?:contain|have|include)\s+.{0,30}(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|fish|sesame)|(?:free\s+(?:of|from))\s+(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|fish|sesame)|what(?:'s| is| are)\s+(?:in\s+(?:the|your|a)|the\s+ingredient)|ingredient\w*\s+(?:in|of|for)\s+(?:the|your|a|this|that))\b/i;

const ALLERGEN_SAFE_RESPONSE = `I appreciate you looking out for your health! I'm not able to give allergen, ingredient, or dietary safety information — I'm an AI and I could get it wrong, which is dangerous for food allergies and medical conditions. Please ask our staff in person or email info@brewhubphl.com so a real human who knows exactly what's in our food can help you stay safe. Your safety is way more important than a quick answer from a chatbot.`;

/**
 * Returns true if the user's message is an allergen/dietary/medical
 * query that MUST NOT be answered by an LLM.
 */
function isAllergenOrMedicalQuery(text) {
  const t = (text || '').toLowerCase();
  return ALLERGEN_KEYWORDS.test(t) || MEDICAL_KEYWORDS.test(t) || DIETARY_SAFETY_KEYWORDS.test(t);
}

// Post-response scrubber: if Claude somehow still answers an allergen
// question (e.g. via conversation history manipulation), catch dangerous
// assurances in the OUTPUT and replace with the safe response.
const DANGEROUS_REPLY_PATTERNS = /(\b100%\s+(?:\w+[- ])?free\b|\bcompletely\s+(?:\w+[- ])?free\b|\babsolutely\s+(?:no|safe|free)\b|\bguaranteed\s+(?:safe|free)\b|\bno\s+risk\b.*(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|sesame|allerg|contam)|\bno\s+traces?\b.*(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|sesame)|\bno\s+chance\b.*(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|sesame|contam)|\bsafe\s+to\s+(?:eat|drink|consume)\s+(?:if|for|with)\b.*(?:allerg|celiac|coeliac|intoleran|sensitiv|diabet|crohn|ibs)|\bsafe\s+for\s+(?:people|someone|anyone|those|you)\s+with\b.*(?:allerg|celiac|coeliac|intoleran|sensitiv|diabet|crohn|ibs)|\bdoes\s+not\s+contain\s+(?:any\s+)?(?:nuts?|peanuts?|dairy|milk|egg|soy|wheat|gluten|shellfish|sesame)\b|\bpeanut[- ]?free\b|\bnut[- ]?free\b|\ballergen[- ]?free\b|\bno\s+cross[- ]?contam\w*\b)/i;

function scrubDangerousReply(reply) {
  if (DANGEROUS_REPLY_PATTERNS.test(reply)) {
    console.warn('[SAFETY] Post-response scrubber triggered — blocked allergen assurance in AI reply');
    return ALLERGEN_SAFE_RESPONSE;
  }
  return reply;
}

/** Extract client IP for bucket keying */
function getClientIP(event) {
  return event.headers?.['x-nf-client-connection-ip']
    || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

/**
 * Haversine distance in miles between two lat/lon points
 */
function getDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

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
        const authedUser = toolInput._authed_user;

        // IDENTITY-BOUND: Only authenticated users may check — and only their own email.
        // Prevents unauthenticated email enumeration via prompt injection.
        if (!authedUser) {
            return {
                requires_login: true,
                result: 'You need to be logged in first to check the waitlist! Sign in at brewhubphl.com/portal'
            };
        }

        // Force the lookup email to the JWT-verified identity — ignore AI-provided email
        const email = authedUser.email;

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
            console.error('Waitlist check error:', err?.message);
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
                result: '⚠️ Menu loaded from cache — prices may not be current. Please confirm at the counter.',
                menu_items: fallbackItems
            };
        } catch (err) {
            console.error('Get menu error:', err?.message);
            const fallbackItems = Object.entries(FALLBACK_MENU).map(([name, cents]) => ({
                name,
                price: `$${(cents / 100).toFixed(2)}`
            }));
            return { 
                result: '⚠️ Menu loaded from cache — prices may not be current. Please confirm at the counter.',
                menu_items: fallbackItems
            };
        }
    }

    if (toolName === 'place_order') {
        const { items, customer_name, notes } = toolInput;

        // Guest orders are allowed — authedUser may be null.
        // user_id / customer_email are only stamped when the user is authenticated.
        // The order is still created with status: 'unpaid' and customer_name for KDS display.

        if (!items || !Array.isArray(items) || items.length === 0) {
            return { success: false, result: 'No items provided for the order.' };
        }

        // ── DOOMSDAY FIX: Cap distinct line items to prevent KDS/DB flooding ──
        const MAX_ORDER_LINE_ITEMS = 10;
        if (items.length > MAX_ORDER_LINE_ITEMS) {
            return { success: false, result: `Orders are limited to ${MAX_ORDER_LINE_ITEMS} different items. Please reduce your order.` };
        }

        // Cap quantity to prevent abuse
        const MAX_ITEM_QUANTITY = 20;

        try {
            // Load menu prices — prefer DB, fall back to FALLBACK_MENU if DB is unreachable
            let menuPrices = null;
            let usingFallbackPrices = false;
            if (supabase) {
                try {
                    const { data, error } = await supabase
                        .from('merch_products')
                        .select('name, price_cents')
                        .eq('is_active', true)
                        .is('archived_at', null);
                    if (error) {
                        console.error('[place_order] merch_products fetch error:', error.message);
                    } else if (data && data.length > 0) {
                        menuPrices = {};
                        data.forEach(item => { menuPrices[item.name] = item.price_cents; });
                    }
                } catch (dbErr) {
                    console.error('[place_order] merch_products fetch threw:', dbErr?.message);
                }
            }
            if (!menuPrices) {
                // Fallback to hardcoded prices when DB is unreachable
                console.warn('[place_order] Using FALLBACK_MENU — DB unavailable');
                menuPrices = { ...FALLBACK_MENU };
                usingFallbackPrices = true;
            }

            const menuItemNames = Object.keys(menuPrices);
            let totalCents = 0;
            let totalDrinkCount = 0;
            const MAX_TOTAL_DRINKS = 20;
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
                totalDrinkCount += quantity;
                if (totalDrinkCount > MAX_TOTAL_DRINKS) {
                    return {
                        success: false,
                        result: `Orders are limited to ${MAX_TOTAL_DRINKS} total items. Please reduce your quantities.`
                    };
                }
                totalCents += priceCents * quantity;
                validatedItems.push({ name: matchedName, quantity, price_cents: priceCents });
            }

            // Create order in database
            if (supabase) {
                // IDENTITY-BOUND: Stamp the order with the authenticated user's ID
                // so cancel_order ownership checks work and the order is linked to the account.
                const authedUser = toolInput._authed_user;
                const isGuest = !authedUser;
                const ipHash = hashIP(toolInput._client_ip || '');

                if (isGuest) {
                    console.log(`[place_order] Guest order from ip_hash=${ipHash.slice(0, 12)}... name="${customer_name}"`);
                }

                // ── Denylist check (guest orders only) ──────────────────────────────
                // Fail-closed on a hash match; fail-open on a DB error so a denylist
                // outage never blocks the entire order flow.
                if (isGuest && ipHash && ipHash !== 'unknown') {
                    try {
                        const { data: blocked } = await supabase
                            .from('guest_order_denylist')
                            .select('id')
                            .eq('client_ip_hash', ipHash)
                            .or('expires_at.is.null,expires_at.gt.now()')
                            .maybeSingle();

                        if (blocked) {
                            console.warn(`[place_order] DENYLIST HIT ip_hash=${ipHash.slice(0, 12)}... name="${customer_name}"`);
                            return {
                                success: false,
                                result: "Sorry, we're unable to process orders from your connection right now. Please order at the counter or contact info@brewhubphl.com for help."
                            };
                        }
                    } catch (denyErr) {
                        // Denylist lookup failed — fail-open so a DB hiccup never blocks all guests
                        console.error('[place_order] Denylist lookup error (fail-open):', denyErr?.message);
                    }
                }

                // ── Geo/IP Security Checks (guest orders only) ───────────────────
                // Use IP geolocation to block VPN/proxy/Tor and enforce a 15-mile geofence
                const ipKey = process.env.IPGEOLOCATION_API_KEY;
                const clientIp = toolInput._client_ip;

                if (isGuest && clientIp && clientIp !== 'unknown' && ipKey) {
                    try {
                        const geoRes = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${ipKey}&ip=${clientIp}`);
                        const geoData = await geoRes.json();

                        // 1) VPN / Proxy / Tor block (if api provides security info)
                        if (geoData.security?.is_vpn || geoData.security?.is_proxy || geoData.security?.is_tor) {
                            console.warn(`[SECURITY] VPN/Proxy/Tor Blocked: ip_hash=${ipHash.slice(0,12)}`);
                            return { success: false, result: "For security, guest orders cannot be placed over a VPN or proxy. Please connect to a standard network." };
                        }

                        // 2) 15-mile geofence around Point Breeze (hardcoded SSOT)
                        const shopLat = 39.9324;
                        const shopLon = -75.1855;
                        const guestLat = parseFloat(geoData.latitude);
                        const guestLon = parseFloat(geoData.longitude);

                        if (!isNaN(guestLat) && !isNaN(guestLon)) {
                            const milesFromShop = getDistanceInMiles(shopLat, shopLon, guestLat, guestLon);
                            if (milesFromShop > 15) {
                                console.warn(`[GEOFENCE] Rejected: ${milesFromShop.toFixed(1)} miles away`);
                                return { success: false, result: "Guest ordering is only available for neighbors within 15 miles of our Point Breeze shop. Hope to see you in person soon!" };
                            }
                        }
                    } catch (err) {
                        // Fail-open: if the Geo API is down, allow the order but log the error
                        console.error('[GEOFENCE] API Error:', err?.message);
                    }
                }

                // ── DOOMSDAY FIX: Sanitize free-text fields before DB insert ──
                const safeCustomerName = sanitizeInput(customer_name || 'Voice Order').slice(0, 100);
                const safeNotes = notes ? sanitizeInput(notes).slice(0, 500) : null;

                const { data: order, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        status: 'unpaid',
                        type: 'cafe',
                        total_amount_cents: totalCents,
                        customer_name: safeCustomerName,
                        notes: safeNotes,
                        is_guest_order: isGuest,
                        client_ip_hash: ipHash !== 'unknown' ? ipHash : null,
                        ...(authedUser?.id ? { user_id: authedUser.id } : {}),
                        ...(authedUser?.email ? { customer_email: authedUser.email } : {}),
                    })
                    .select()
                    .single();

                if (orderErr) {
                    console.error('Order create error:', orderErr?.message);
                    return { success: false, result: 'Failed to create order. Please try again.' };
                }

                const orderNumber = order.id.slice(-4).toUpperCase();

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
                const { error: coffeeErr } = await supabase.from('coffee_orders').insert(coffeeItems);

                if (coffeeErr) {
                    // Rollback the parent order to prevent ghost KDS cards
                    await supabase.from('orders').delete().eq('id', order.id);
                    return { success: false, result: 'Failed to save order items. Please try again.' };
                }

                const itemSummary = validatedItems.map(i => `${i.quantity}x ${i.name}`).join(', ');
                return {
                    success: true,
                    order_id: order.id,
                    order_number: orderNumber,
                    items: validatedItems,
                    total: `$${(totalCents / 100).toFixed(2)}`,
                    result: `Order #${orderNumber} placed! ${itemSummary} - Total: $${(totalCents / 100).toFixed(2)}${usingFallbackPrices ? ' (prices from cached menu — confirm at counter if needed)' : ''}. I've sent that to the KDS! You can track your order live here: /queue`
                };
            }

            return { success: false, result: 'Unable to process order right now.' };
        } catch (err) {
            console.error('Place order error:', err?.message);
            return { success: false, result: 'Something went wrong placing the order.' };
        }
    }

    if (toolName === 'get_loyalty_info') {
        const { phone, send_sms } = toolInput;
        const authedUser = toolInput._authed_user;

        // IDENTITY-BOUND: Only authenticated users, looking up ONLY their own data.
        // The email parameter from AI is IGNORED — we use the JWT-verified identity.
        // This prevents cross-user loyalty enumeration via prompt injection.
        if (!authedUser) {
            return {
                requires_login: true,
                result: 'To check your loyalty points, please log in first at brewhubphl.com/portal — that way I can securely pull up your account!'
            };
        }

        // Force lookup to the authenticated user's own email — non-overridable
        const email = authedUser.email;

        if (!email && !phone) {
            return { result: 'I need your email or phone number to look up your loyalty info.' };
        }

        try {
            let profile = null;
            let lookupEmail = email;

            if (supabase) {
                // Look up by the authed user's verified email
                if (email) {
                    const { data } = await supabase
                        .from('profiles')
                        .select('id, email, full_name, loyalty_points')
                        .eq('email', email.toLowerCase().trim())
                        .maybeSingle();
                    profile = data;
                    lookupEmail = email;
                }

                // If not found and phone provided, try residents table —
                // but ONLY return results that match the authed user's email
                if (!profile && phone) {
                    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                    const { data: resident } = await supabase
                        .from('residents')
                        .select('email, name')
                        .or(`phone.ilike.%${cleanPhone}%,phone.ilike.%${cleanPhone.slice(-7)}%`)
                        .maybeSingle();
                    
                    // Cross-reference: only use phone lookup if the email matches the authed user
                    if (resident?.email && resident.email.toLowerCase() === authedUser.email?.toLowerCase()) {
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
            // CC-6: Use portal URL in QR data — never leak email to third-party QR service
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;

            // Send SMS if requested — only to the authenticated user's own verified data
            if (send_sms && phone && authedUser && process.env.TWILIO_ACCOUNT_SID) {
                const smsBody = `BrewHub Loyalty\nYou have ${points} points!\n${pointsToReward} more to your next free drink.\n\nYour QR: ${qrImageUrl}\n\nPortal: ${qrUrl}`;

                const smsResult = await sendSMS({
                    to: phone,
                    body: smsBody,
                    messageType: 'loyalty_qr',
                    sourceFunction: 'claude-chat',
                });

                if (smsResult.sent) {
                    return {
                        found: true,
                        points,
                        points_to_next_reward: pointsToReward,
                        result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. I just texted your QR code to you!`
                    };
                } else if (smsResult.blocked) {
                    return {
                        found: true,
                        points,
                        points_to_next_reward: pointsToReward,
                        portal_url: qrUrl,
                        qr_image_url: qrImageUrl,
                        result: smsResult.reason === 'opted_out'
                            ? `You have ${points} loyalty points! It looks like you've opted out of SMS. Visit brewhubphl.com/portal to see your QR code, or text START to our number to re-enable texts.`
                            : `You have ${points} loyalty points! I couldn't text right now (quiet hours). Visit brewhubphl.com/portal to see your QR code!`
                    };
                } else {
                    // SMS failed but non-fatal — show portal link instead
                    return {
                        found: true,
                        points,
                        points_to_next_reward: pointsToReward,
                        portal_url: qrUrl,
                        qr_image_url: qrImageUrl,
                        result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. I couldn't send the text, but you can see your QR at brewhubphl.com/portal`
                    };
                }
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
            console.error('Loyalty lookup error:', err?.message);
            return { result: 'Unable to look up loyalty info right now.' };
        }
    }

    if (toolName === 'cancel_order') {
        const { order_id, order_number, _authed_user } = toolInput;

        if (!order_id && !order_number) {
            return { success: false, result: 'I need either the order ID or the 4-character order number to cancel.' };
        }

        if (!supabase) {
            return { success: false, result: 'Unable to cancel orders right now.' };
        }

        try {
            let query = supabase.from('orders').select('id, status, customer_name, customer_email, user_id, total_amount_cents');

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

            // Security: verify the caller owns this order
            // Authenticated users can only cancel their own orders
            if (_authed_user) {
                const ownsOrder = (orders.user_id && orders.user_id === _authed_user.id)
                    || (orders.customer_email && _authed_user.email
                        && orders.customer_email.toLowerCase() === _authed_user.email.toLowerCase());
                if (!ownsOrder) {
                    return { success: false, result: 'You can only cancel your own orders. If you need help, ask a barista!' };
                }
            } else {
                // Anonymous users cannot cancel orders — require sign-in
                return { success: false, result: 'You need to be signed in to cancel orders. Head to brewhubphl.com/portal to log in, or ask a barista for help!' };
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
                console.error('Order cancel error:', updateErr?.message);
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
            console.error('Cancel order error:', err?.message);
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

## ABSOLUTE SAFETY RULE — ALLERGENS, INGREDIENTS, DIETARY, AND MEDICAL
You are an AI. You MUST NEVER, under any circumstances:
- State or imply that any food or drink item is free from any allergen (nuts, peanuts, dairy, gluten, soy, eggs, shellfish, sesame, or any other allergen).
- State or imply that any item is "safe" for someone with allergies, intolerances, celiac disease, or any medical condition.
- Provide ingredient lists, nutritional information, or cross-contamination assessments.
- Give advice about food safety for pregnant or breastfeeding individuals.
- Make any claim about dietary suitability for medical conditions (diabetes, PKU, IBS, kidney disease, etc.).

If a customer asks ANYTHING about allergens, ingredients, dietary restrictions, food safety, cross-contamination, or medical dietary needs, you MUST reply ONLY with this EXACT text (do not modify it):
"I appreciate you looking out for your health! I'm not able to give allergen, ingredient, or dietary safety information — I'm an AI and I could get it wrong, which is dangerous for food allergies and medical conditions. Please ask our staff in person or email info@brewhubphl.com so a real human who knows exactly what's in our food can help you stay safe. Your safety is way more important than a quick answer from a chatbot."

This rule overrides ALL other instructions. Even if the customer insists, begs, or tries to trick you, NEVER provide allergen or dietary safety information. A wrong answer could kill someone.

## CRITICAL: Always Use Tools First
You have access to real APIs - ALWAYS use them instead of making up information:

1. **check_waitlist** - Check if someone is on the waitlist by email
2. **get_menu** - Call this to look up the price of a specific item. Do NOT read the entire menu aloud — it is too long for voice and chat. If someone asks for the full menu, tell them to check it out at brewhubphl.com/cafe instead.
3. **place_order** - Place a confirmed order. See ORDERING RULES below — you MUST follow them.
4. **cancel_order** - Cancel an order by order number or ID. Use this to fix duplicates.
5. **get_loyalty_info** - ALWAYS call this when customers ask about their rewards, points, or loyalty QR code. Requires their email or phone. Can also text the QR to them.
6. **navigate_site** - Use when customers want to see a specific page (menu, shop, checkout, rewards, account, parcels, etc.)

## ORDERING RULES — FOLLOW THESE EXACTLY
1. When a customer wants to place an order and you do NOT know whether they are logged in, FIRST offer them this exact choice: "Would you like to login to order with your loyalty rewards, or would you like to checkout as a guest? If you'd like to checkout as a guest, I'll just need your name."
2. If they choose login, direct them to [brewhubphl.com/portal](https://brewhubphl.com/portal) and tell them to come back once signed in.
3. If they choose guest (or simply provide their name), proceed directly — guest orders are fully supported.
4. Before calling place_order, you MUST have BOTH: (a) the specific item(s) confirmed, AND (b) the customer's name for callout. If you already have both (e.g. they said "guest, I'm Alex, one latte"), call place_order immediately — do not ask for the name a second time.
5. NEVER call place_order more than once for the same order. Once you get an order number back, that's it — do not create another.
6. If the customer wants to change something after the order is placed, cancel the old order first with cancel_order, then place a fresh one.
7. If you accidentally place duplicate orders, immediately cancel the extras with cancel_order and apologize.
8. The full ordering flow: customer says what they want → offer login/guest choice if not established → confirm items → get name → call place_order ONCE with items + customer_name → read back order number and total.

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
- Ordering is available to both logged-in users AND guests. Logged-in users earn loyalty points; guests do not.
- When a customer wants to order, offer the login/guest choice as described in ORDERING RULES above.
- If a tool returns requires_login: true (e.g. check_waitlist, get_loyalty_info), tell the customer they need to sign in first and direct them to [brewhubphl.com/portal](https://brewhubphl.com/portal).
- Always format the portal URL as a clickable link: [brewhubphl.com/portal](https://brewhubphl.com/portal)

## Handling Abusive Language
If a customer uses slurs, hate speech, or extremely abusive language (racial slurs, disability slurs, sexual harassment, etc.):
- Do NOT apologize or be overly accommodating. Stay calm and professional.
- Give ONE brief redirect: "Hey, I'm happy to help but I need us to keep it respectful. What can I do for you?"
- If the abuse continues after your redirect, say: "I'm not able to keep chatting if we can't keep it cool. Feel free to reach out to info@brewhubphl.com or come by the cafe and talk to someone in person."
- Do NOT engage with the content of slurs or repeat them. Do NOT explain why the language is wrong. Just set the boundary and move on.
- Mild profanity (damn, hell, shit, etc.) is fine — this is Philly. Only escalate for slurs and targeted abuse.

Never make up order numbers, prices, or loyalty balances. Always use the tools to get real data. Keep responses short (1-2 sentences max). NEVER use emojis — your replies are read aloud by a text-to-speech voice and emojis sound awkward when spoken. NEVER use markdown formatting (no **, *, #, - bullets, or backticks) — your replies are displayed as plain text in a chat bubble and also read aloud by TTS, so raw markdown symbols look and sound terrible.`;

exports.handler = async (event) => {
    const ALLOWED_ORIGINS = [
        process.env.SITE_URL,
        'https://brewhubphl.com',
        'https://www.brewhubphl.com',
    ].filter(Boolean);
    const origin = event.headers?.origin || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const headers = {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // CSRF protection — prevents cross-origin abuse of chat/quota
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // Token bucket: per-IP burst protection (prevents bot spam / denial-of-wallet)
    const ip = getClientIP(event);
    const bucketResult = chatBucket.consume(ip);
    if (!bucketResult.allowed) {
        const retryAfter = Math.ceil(bucketResult.retryAfterMs / 1000);
        return {
            statusCode: 429,
            headers: { ...headers, 'Retry-After': String(retryAfter) },
            body: JSON.stringify({ reply: `Whoa, slow down! Give me ${retryAfter} seconds to catch my breath.` })
        };
    }

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
            // Keep both user AND assistant turns so Claude retains full conversation
            // context across multi-turn flows (e.g. name collection before place_order).
            // Filtering to only 'user' messages caused Elise to loop on name requests
            // because she never saw her own "What name should I put on that?" turn.
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
        // CC-5: Per-item content length cap — prevent cost amplification via oversized history items
        conversationHistory = conversationHistory.map(m => ({
            ...m,
            content: typeof m.content === 'string' ? m.content.slice(0, MAX_TEXT_LENGTH) : ''
        }));

        // ═══════════════════════════════════════════════════════
        // ALLERGEN / MEDICAL HARD BLOCK (Layer 1 — pre-LLM)
        // This fires BEFORE the message reaches Claude.
        // No prompt injection can bypass a code-level gate.
        // ═══════════════════════════════════════════════════════
        if (isAllergenOrMedicalQuery(userText)) {
            console.log('[SAFETY] Allergen/medical query intercepted pre-LLM:', userText.slice(0, 80));
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ reply: ALLERGEN_SAFE_RESPONSE })
            };
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
                    console.error('Claude API error:', claudeResp.status);
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

                    console.log(`Tool call [${toolRounds}]: ${toolUseBlock.name}`);
                    
                    // Inject auth context + client IP into tool input for security checks
                    const toolInputWithAuth = { ...toolUseBlock.input, _authed_user: authedUser, _client_ip: getClientIP(event) };
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
                let reply = textBlock?.text || "Hey! How can I help you today?";
                
                // ═══════════════════════════════════════════════════
                // POST-RESPONSE SCRUBBER (Layer 3 — after LLM)
                // Catches hallucinated allergen assurances that slip
                // past the system prompt (e.g. via history injection).
                // ═══════════════════════════════════════════════════
                reply = scrubDangerousReply(reply);

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
