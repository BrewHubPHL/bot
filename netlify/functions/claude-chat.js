const { checkQuota } = require('./_usage');
const { requireCsrfHeader } = require('./_csrf');
const { createClient } = require('@supabase/supabase-js');
const { chatBucket } = require('./_token-bucket');
const { sendSMS } = require('./_sms');
const { hashIP } = require('./_ip-hash');
const { sanitizeInput } = require('./_sanitize');
const { logSystemError } = require('./_system-errors');
const { calculateTaxInclusive } = require('./_pricing');
const { generateText, tool, embed, jsonSchema } = require('ai');
const { createAnthropic } = require('@ai-sdk/anthropic');
const { createCohere } = require('@ai-sdk/cohere');

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

/**
 * Creates AI SDK tool definitions with closure over request-scoped context.
 * Each tool's execute() function has access to supabase, authedUser, and clientIp
 * without needing them injected into the AI's tool input.
 */
function createTools({ supabase, authedUser, clientIp }) {
    return {
        check_waitlist: tool({
            description: 'Check if an email address is on the BrewHub waitlist. Use this when someone asks if they are signed up, on the list, or wants to verify their waitlist status.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    email: { type: 'string', description: 'The email address to check' },
                },
                required: ['email'],
            }),
            execute: async ({ email }) => {
                if (!authedUser) {
                    return { requires_login: true, result: 'You need to be logged in first to check the waitlist! Sign in at brewhubphl.com/portal' };
                }
                const lookupEmail = authedUser.email;
                if (!lookupEmail) return { result: 'I need an email address to check the waitlist.' };
                if (!supabase) return { result: 'Unable to check the waitlist right now.' };
                try {
                    const { data, error } = await supabase.from('waitlist').select('email, created_at').eq('email', lookupEmail.toLowerCase().trim()).maybeSingle();
                    if (error) throw error;
                    return data ? { found: true, result: `Found on waitlist: ${lookupEmail}` } : { found: false, result: `Email ${lookupEmail} is not on the waitlist yet.` };
                } catch (err) {
                    console.error('Waitlist check error:', err?.message);
                    return { result: 'Unable to check the waitlist right now.' };
                }
            },
        }),

        get_menu: tool({
            description: 'Look up cafe menu items and prices. Use this when someone asks about a specific item price or what we serve. For individual price checks, return only the requested item. If someone asks for the FULL menu, do NOT read it — just direct them to brewhubphl.com/cafe.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    item_name: { type: 'string', description: 'Optional: specific item to look up. If omitted, returns full menu (but you should NOT read the full list aloud — link to /cafe instead).' },
                },
            }),
            execute: async () => {
                try {
                    if (supabase) {
                        const { data, error } = await supabase.from('merch_products').select('name, price_cents, description').eq('is_active', true).is('archived_at', null).order('sort_order', { ascending: true });
                        if (!error && data && data.length > 0) {
                            return { result: 'Menu loaded successfully', menu_items: data.map(item => ({ name: item.name, price: `$${(item.price_cents / 100).toFixed(2)}`, description: item.description || '' })) };
                        }
                    }
                    return { result: '⚠️ Menu loaded from cache — prices may not be current. Please confirm at the counter.', menu_items: Object.entries(FALLBACK_MENU).map(([name, cents]) => ({ name, price: `$${(cents / 100).toFixed(2)}` })) };
                } catch (err) {
                    console.error('Get menu error:', err?.message);
                    return { result: '⚠️ Menu loaded from cache — prices may not be current. Please confirm at the counter.', menu_items: Object.entries(FALLBACK_MENU).map(([name, cents]) => ({ name, price: `$${(cents / 100).toFixed(2)}` })) };
                }
            },
        }),

        place_order: tool({
            description: 'Place a cafe order ONCE. Before calling this, you MUST have: (1) the specific item(s) confirmed, (2) the customer\'s name for callout. Ask for anything missing BEFORE calling this tool. NEVER call place_order more than once for the same request.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: 'Array of items to order',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Menu item name' },
                                quantity: { type: 'number', description: 'Quantity (default 1)' },
                            },
                            required: ['name'],
                        },
                    },
                    customer_name: { type: 'string', description: 'Customer name for calling out the order — REQUIRED, ask if not provided' },
                    notes: { type: 'string', description: 'Special requests like oat milk, extra hot, no foam' },
                },
                required: ['items', 'customer_name'],
            }),
            execute: async ({ items, customer_name, notes }) => {
                // ── ALLERGEN / MEDICAL INJECTION DEFENSE ──
                if (isAllergenOrMedicalQuery(notes) || isAllergenOrMedicalQuery(customer_name)) {
                    console.warn('[SAFETY] Allergen/medical content detected in place_order fields — aborting order');
                    return { success: false, result: ALLERGEN_SAFE_RESPONSE };
                }

                if (!items || !Array.isArray(items) || items.length === 0) {
                    return { success: false, result: 'No items provided for the order.' };
                }

                const MAX_ORDER_LINE_ITEMS = 10;
                if (items.length > MAX_ORDER_LINE_ITEMS) {
                    return { success: false, result: `Orders are limited to ${MAX_ORDER_LINE_ITEMS} different items. Please reduce your order.` };
                }

                const MAX_ITEM_QUANTITY = 20;

                try {
                    let menuPrices = null;
                    let usingFallbackPrices = false;
                    if (supabase) {
                        try {
                            const { data, error } = await supabase.from('merch_products').select('name, price_cents').eq('is_active', true).is('archived_at', null);
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
                        const matchedName = menuItemNames.find(name => name.toLowerCase() === (item.name || '').toLowerCase());
                        if (!matchedName) {
                            return { success: false, result: `"${item.name}" is not on the menu. Available items: ${menuItemNames.join(', ')}` };
                        }
                        const priceCents = menuPrices[matchedName];
                        totalDrinkCount += quantity;
                        if (totalDrinkCount > MAX_TOTAL_DRINKS) {
                            return { success: false, result: `Orders are limited to ${MAX_TOTAL_DRINKS} total items. Please reduce your quantities.` };
                        }
                        totalCents += priceCents * quantity;
                        validatedItems.push({ name: matchedName, quantity, price_cents: priceCents });
                    }

                    if (supabase) {
                        const isGuest = !authedUser;
                        const ipHash = hashIP(clientIp || '');

                        if (isGuest) {
                            console.log(`[place_order] Guest order from ip_hash=${ipHash.slice(0, 12)}... name="${customer_name}"`);
                        }

                        // ── Denylist check (guest orders only) ──
                        if (isGuest && ipHash && ipHash !== 'unknown') {
                            try {
                                const { data: blocked } = await supabase.from('guest_order_denylist').select('id').eq('client_ip_hash', ipHash).or('expires_at.is.null,expires_at.gt.now()').maybeSingle();
                                if (blocked) {
                                    console.warn(`[place_order] DENYLIST HIT ip_hash=${ipHash.slice(0, 12)}... name="${customer_name}"`);
                                    return { success: false, result: "Sorry, we're unable to process orders from your connection right now. Please order at the counter or contact info@brewhubphl.com for help." };
                                }
                            } catch (denyErr) {
                                console.error('[place_order] Denylist lookup error (fail-open):', denyErr?.message);
                            }
                        }

                        // ── Geo/IP Security Checks (guest orders only) ──
                        // TODO(geofence-v2): IP geolocation is unreliable for local Philly users —
                        // ISPs (Comcast, Verizon) route through NJ/DE gateways, placing real
                        // Point Breeze customers 20-40+ miles away. Refactor to:
                        //   1. Accept a zip code from the client and validate against an
                        //      allowlist of Philly-area zips (19xxx, 080xx, etc.), OR
                        //   2. Use HTML5 Geolocation (navigator.geolocation) on the frontend
                        //      and pass lat/lon to this endpoint for server-side verification.
                        // IP lookup should remain as a fallback/fraud signal, not the primary gate.
                        const ipKey = process.env.IPGEOLOCATION_API_KEY;
                        if (isGuest && clientIp && clientIp !== 'unknown' && ipKey) {
                            try {
                                const geoRes = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${ipKey}&ip=${clientIp}`);
                                const geoData = await geoRes.json();
                                if (geoData.security?.is_vpn || geoData.security?.is_proxy || geoData.security?.is_tor) {
                                    console.warn(`[SECURITY] VPN/Proxy/Tor Blocked: ip_hash=${ipHash.slice(0,12)}`);
                                    return { success: false, result: "For security, guest orders cannot be placed over a VPN or proxy. Please connect to a standard network." };
                                }
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
                                console.error('[GEOFENCE] API Error:', err?.message);
                            }
                        }

                        const safeCustomerName = sanitizeInput(customer_name || 'Voice Order').slice(0, 100);
                        const safeNotes = notes ? sanitizeInput(notes).slice(0, 500) : null;

                        // ── Tax & total calculation (Schema 75) ──
                        const { subtotalCents, taxCents: taxAmountCents, totalCents: grandTotalCents } = calculateTaxInclusive(totalCents);

                        const { data: order, error: orderErr } = await supabase.from('orders').insert({
                            status: 'unpaid',
                            type: 'cafe',
                            subtotal_cents: subtotalCents,
                            tax_amount_cents: taxAmountCents,
                            total_amount_cents: grandTotalCents,
                            customer_name: safeCustomerName,
                            notes: safeNotes,
                            is_guest_order: isGuest,
                            client_ip_hash: ipHash !== 'unknown' ? ipHash : null,
                            ...(authedUser?.id ? { user_id: authedUser.id } : {}),
                            ...(authedUser?.email ? { customer_email: authedUser.email } : {}),
                        }).select().single();

                        if (orderErr) {
                            console.error('Order create error:', orderErr?.message);
                            return { success: false, result: 'Failed to create order. Please try again.' };
                        }

                        const orderNumber = order.id.slice(-4).toUpperCase();
                        const coffeeItems = [];
                        for (const item of validatedItems) {
                            for (let i = 0; i < item.quantity; i++) {
                                coffeeItems.push({ order_id: order.id, drink_name: item.name, price: item.price_cents / 100 });
                            }
                        }
                        const { error: coffeeErr } = await supabase.from('coffee_orders').insert(coffeeItems);
                        if (coffeeErr) {
                            const { error: deleteErr } = await supabase.from('orders').delete().eq('id', order.id);
                            if (deleteErr) console.error('[CLAUDE-CHAT] Order rollback delete failed for order', order.id, ':', deleteErr.message);
                            return { success: false, result: 'Failed to save order items. Please try again.' };
                        }

                        const itemSummary = validatedItems.map(i => `${i.quantity}x ${i.name}`).join(', ');
                        return {
                            success: true,
                            order_id: order.id,
                            order_number: orderNumber,
                            customer_name: safeCustomerName,
                            subtotal_cents: subtotalCents,
                            tax_amount_cents: taxAmountCents,
                            total_amount_cents: grandTotalCents,
                            items: validatedItems,
                            subtotal: `$${(subtotalCents / 100).toFixed(2)}`,
                            tax: `$${(taxAmountCents / 100).toFixed(2)}`,
                            total: `$${(grandTotalCents / 100).toFixed(2)}`,
                            result: `Order #${orderNumber} placed! ${itemSummary} — Subtotal: $${(subtotalCents / 100).toFixed(2)}, Tax: $${(taxAmountCents / 100).toFixed(2)}, Total: $${(grandTotalCents / 100).toFixed(2)}${usingFallbackPrices ? ' (prices from cached menu — confirm at counter if needed)' : ''}. I've sent that to the KDS! You can track your order live here: /queue`
                        };
                    }

                    return { success: false, result: 'Unable to process order right now.' };
                } catch (err) {
                    console.error('Place order error:', err?.message);
                    return { success: false, result: 'Something went wrong placing the order.' };
                }
            },
        }),

        cancel_order: tool({
            description: 'Cancel a cafe order by order ID. Use this when a customer asks to cancel an order, or to clean up duplicate orders you mistakenly created.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    order_id: { type: 'string', description: 'The full UUID of the order to cancel (from a previous place_order result)' },
                    order_number: { type: 'string', description: 'The short 4-character order number (e.g. D31D). Use this if you do not have the full UUID.' },
                },
            }),
            execute: async ({ order_id, order_number }) => {
                if (!order_id && !order_number) {
                    return { success: false, result: 'I need either the order ID or the 4-character order number to cancel.' };
                }
                if (!supabase) return { success: false, result: 'Unable to cancel orders right now.' };

                try {
                    let query = supabase.from('orders').select('id, status, customer_name, customer_email, user_id, total_amount_cents');
                    if (order_id) {
                        query = query.eq('id', order_id);
                    } else {
                        query = query.ilike('id', `${order_number.toLowerCase()}%`);
                    }
                    const { data: orders, error: findErr } = await query.limit(1).single();
                    if (findErr || !orders) {
                        return { success: false, result: `Could not find order ${order_number || order_id}. It may have already been removed.` };
                    }

                    if (authedUser) {
                        const ownsOrder = (orders.user_id && orders.user_id === authedUser.id)
                            || (orders.customer_email && authedUser.email && orders.customer_email.toLowerCase() === authedUser.email.toLowerCase());
                        if (!ownsOrder) return { success: false, result: 'You can only cancel your own orders. If you need help, ask a barista!' };
                    } else {
                        return { success: false, result: 'You need to be signed in to cancel orders. Head to brewhubphl.com/portal to log in, or ask a barista for help!' };
                    }

                    if (orders.status === 'cancelled') {
                        return { success: true, result: `Order #${orders.id.slice(0, 4).toUpperCase()} was already cancelled.` };
                    }

                    const { error: updateErr } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orders.id);
                    if (updateErr) {
                        console.error('Order cancel error:', updateErr?.message);
                        return { success: false, result: 'Failed to cancel the order. Please ask a staff member for help.' };
                    }

                    const { error: coffeeUpdateErr } = await supabase.from('coffee_orders').update({ status: 'cancelled' }).eq('order_id', orders.id);
                    if (coffeeUpdateErr) console.error('[CANCEL] coffee_orders cancel failed (non-fatal):', coffeeUpdateErr.message);

                    const orderNum = orders.id.slice(0, 4).toUpperCase();
                    console.log(`[CANCEL] Order #${orderNum} (${orders.id}) cancelled via chat`);
                    return { success: true, order_number: orderNum, result: `Order #${orderNum} has been cancelled.` };
                } catch (err) {
                    console.error('Cancel order error:', err?.message);
                    return { success: false, result: 'Something went wrong cancelling the order.' };
                }
            },
        }),

        get_loyalty_info: tool({
            description: 'Look up a customer\'s loyalty points and QR code. Use this when someone asks about their points, rewards, loyalty status, or wants to see their QR code. Requires their email or phone number.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    email: { type: 'string', description: 'Customer email address' },
                    phone: { type: 'string', description: 'Customer phone number (alternative to email)' },
                    send_sms: { type: 'boolean', description: 'If true and phone provided, send QR code link via SMS' },
                },
            }),
            execute: async ({ phone, send_sms }) => {
                if (!authedUser) {
                    return { requires_login: true, result: 'To check your loyalty points, please log in first at brewhubphl.com/portal — that way I can securely pull up your account!' };
                }
                const email = authedUser.email;
                if (!email && !phone) return { result: 'I need your email or phone number to look up your loyalty info.' };

                try {
                    let customer = null;
                    let lookupEmail = email;

                    if (supabase) {
                        if (email) {
                            const { data, error: emailLookupErr } = await supabase.from('customers').select('id, email, full_name, loyalty_points').eq('email', email.toLowerCase().trim()).maybeSingle();
                            if (emailLookupErr) console.error('[LOYALTY] Customer email lookup failed:', emailLookupErr.message);
                            customer = data;
                            lookupEmail = email;
                        }
                        if (!customer && phone) {
                            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                            const { data: byPhone, error: phoneLookupErr } = await supabase.from('customers').select('id, email, full_name, loyalty_points').like('phone', `%${cleanPhone}`).maybeSingle();
                            if (phoneLookupErr) console.error('[LOYALTY] Customer phone lookup failed:', phoneLookupErr.message);
                            if (byPhone?.email && byPhone.email.toLowerCase() === authedUser.email?.toLowerCase()) {
                                lookupEmail = byPhone.email;
                                customer = byPhone;
                            }
                        }
                    }

                    if (!customer) {
                        return { found: false, result: `I couldn't find a loyalty account for that ${email ? 'email' : 'phone number'}. You can sign up at brewhubphl.com/portal to start earning points!` };
                    }

                    const points = customer.loyalty_points || 0;
                    const pointsToReward = Math.max(0, 100 - (points % 100));
                    const qrUrl = `https://brewhubphl.com/portal`;
                    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;

                    if (send_sms && phone && authedUser && process.env.TWILIO_ACCOUNT_SID) {
                        const smsBody = `BrewHub Loyalty\nYou have ${points} points!\n${pointsToReward} more to your next free drink.\n\nYour QR: ${qrImageUrl}\n\nPortal: ${qrUrl}`;
                        const smsResult = await sendSMS({ to: phone, body: smsBody, messageType: 'loyalty_qr', sourceFunction: 'claude-chat' });
                        if (smsResult.sent) {
                            return { found: true, points, points_to_next_reward: pointsToReward, result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. I just texted your QR code to you!` };
                        } else if (smsResult.blocked) {
                            return {
                                found: true, points, points_to_next_reward: pointsToReward, portal_url: qrUrl, qr_image_url: qrImageUrl,
                                result: smsResult.reason === 'opted_out'
                                    ? `You have ${points} loyalty points! It looks like you've opted out of SMS. Visit brewhubphl.com/portal to see your QR code, or text START to our number to re-enable texts.`
                                    : `You have ${points} loyalty points! I couldn't text right now (quiet hours). Visit brewhubphl.com/portal to see your QR code!`
                            };
                        } else {
                            return { found: true, points, points_to_next_reward: pointsToReward, portal_url: qrUrl, qr_image_url: qrImageUrl, result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. I couldn't send the text, but you can see your QR at brewhubphl.com/portal` };
                        }
                    }

                    return {
                        found: true,
                        email: authedUser?.email === customer.email?.toLowerCase() ? customer.email : undefined,
                        points, points_to_next_reward: pointsToReward, portal_url: qrUrl, qr_image_url: qrImageUrl,
                        result: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink. Visit brewhubphl.com/portal to see your QR code, or I can text it to you if you give me your phone number.`
                    };
                } catch (err) {
                    console.error('Loyalty lookup error:', err?.message);
                    return { result: 'Unable to look up loyalty info right now.' };
                }
            },
        }),

        check_loyalty_points: tool({
            description: 'Check a customer\'s loyalty points balance. Use this when someone asks about their account, points, rewards balance, or how many points they have. Returns structured loyalty data for rich display.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    email: { type: 'string', description: 'Customer email (ignored — uses authenticated identity)' },
                },
            }),
            execute: async () => {
                if (!authedUser) {
                    return { type: 'loyalty_card', requires_login: true, result: 'To check your points, please log in first at brewhubphl.com/portal!' };
                }
                if (!supabase) return { type: 'loyalty_card', error: true, result: 'Unable to check points right now.' };

                try {
                    const { data: customer, error } = await supabase
                        .from('customers')
                        .select('id, full_name, loyalty_points')
                        .eq('email', authedUser.email.toLowerCase().trim())
                        .maybeSingle();
                    if (error) throw error;

                    if (!customer) {
                        return { type: 'loyalty_card', found: false, result: 'No loyalty account found. Sign up at brewhubphl.com/portal to start earning points!' };
                    }

                    const points = customer.loyalty_points || 0;
                    const pointsToReward = Math.max(0, 100 - (points % 100));
                    const tier = points >= 500 ? 'Gold' : points >= 200 ? 'Silver' : 'Bronze';

                    return {
                        type: 'loyalty_card',
                        found: true,
                        customer_name: customer.full_name || 'BrewHub Member',
                        points,
                        points_to_next_reward: pointsToReward,
                        tier,
                        portal_url: 'https://brewhubphl.com/portal',
                        result: `You have ${points} loyalty points (${tier} tier)! ${pointsToReward} more until your next free drink.`
                    };
                } catch (err) {
                    console.error('[check_loyalty_points] Error:', err?.message);
                    logSystemError({ source: 'claude-chat/check_loyalty_points', message: err?.message, stack: err?.stack });
                    return { type: 'loyalty_card', error: true, result: 'Unable to check points right now.' };
                }
            },
        }),

        navigate_site: tool({
            description: 'Help customers navigate to different pages on the BrewHub website. Use when someone asks where to find something, wants to go to a page, or needs directions on the site.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    destination: { type: 'string', description: 'Where the customer wants to go: menu, order, shop, checkout, loyalty, portal, login, parcels, waitlist, contact, home' },
                },
                required: ['destination'],
            }),
            execute: async ({ destination }) => {
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
                if (page) return { success: true, url: page.url, description: page.description, result: `Here's the link: ${page.url} - ${page.description}` };
                const availablePages = ['menu', 'shop', 'checkout', 'loyalty/portal', 'parcels', 'waitlist', 'contact', 'home'];
                return { success: false, result: `I'm not sure where that is. I can help you find: ${availablePages.join(', ')}. Which would you like?` };
            },
        }),

        search_catalog: tool({
            description: 'Search the menu catalog using natural language. Use this when a customer asks for recommendations, flavor profiles, drink styles, or wants to find specific types of items (e.g. "sweet iced drinks", "strong espresso", "something fruity"). Returns the top matching items with names, descriptions, and prices.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    search_query: { type: 'string', description: 'A natural language search query describing what the customer is looking for, e.g. "sweet iced drinks" or "strong black coffee"' },
                },
                required: ['search_query'],
            }),
            execute: async ({ search_query }) => {
                try {
                    const cohereKey = process.env.COHERE_API_KEY;
                    if (!cohereKey) {
                        console.error('[search_catalog] No COHERE_API_KEY configured');
                        return { result: 'Catalog search is not available right now. Try asking me about a specific item instead!' };
                    }
                    if (!supabase) {
                        return { result: 'Unable to search the catalog right now. Try asking me about a specific item instead!' };
                    }

                    const safeQuery = sanitizeInput(search_query).slice(0, 200);
                    const cohere = createCohere({ apiKey: cohereKey });
                    const { embedding } = await embed({
                        model: cohere.embedding('embed-english-v3.0'),
                        value: safeQuery,
                    });

                    const { data, error } = await supabase.rpc('match_menu_items', {
                        query_embedding: embedding,
                        match_threshold: 0.7,
                        match_count: 3,
                    });
                    if (error) {
                        console.error('[search_catalog] RPC error:', error.message);
                        return { result: 'Catalog search hit a snag. Try asking me about a specific item instead!' };
                    }

                    if (!data || data.length === 0) {
                        return { result: `No close matches found for "${safeQuery}". Try a different description or ask me what we have!` };
                    }

                    return {
                        result: 'Found matching items',
                        matches: data.map(item => ({
                            name: item.name,
                            description: item.description || '',
                            price: `$${(item.price_cents / 100).toFixed(2)}`,
                        })),
                    };
                } catch (err) {
                    console.error('[search_catalog] Error:', err?.message);
                    return { result: 'Catalog search is not available right now. Try asking me about a specific item instead!' };
                }
            },
        }),

        check_parcels: tool({
            description: 'Checks the database to see if a resident has any pending packages waiting for pickup. Use when someone asks about packages, mail, or deliveries.',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    resident_name: { type: 'string', description: 'The resident or recipient name to search for (fuzzy match)' },
                    unit_number: { type: 'string', description: 'The mailbox / unit number to search for' },
                },
            }),
            execute: async ({ resident_name, unit_number }) => {
                if (!resident_name && !unit_number) return { result: 'I need at least a name or unit number to look up packages.' };
                if (!supabase) return { result: 'Unable to check parcels right now.' };

                const stripLikeWildcards = (s) => s.replace(/[%_]/g, '');
                const SELECT_COLS = 'id, recipient_name, unit_number, carrier, tracking_number, received_at, status';

                try {
                    let data;
                    if (resident_name && unit_number) {
                        const safeName = stripLikeWildcards(sanitizeInput(resident_name).slice(0, 120));
                        const safeUnit = stripLikeWildcards(sanitizeInput(unit_number).slice(0, 20));
                        if (safeName.length < 2 && safeUnit.length < 1) return { result: 'I need a longer name or valid unit number to search.' };

                        const [byName, byUnit] = await Promise.all([
                            safeName.length >= 2
                                ? supabase.from('parcels').select(SELECT_COLS).eq('status', 'arrived').ilike('recipient_name', `%${safeName}%`).order('received_at', { ascending: false }).limit(10)
                                : Promise.resolve({ data: [], error: null }),
                            safeUnit.length >= 1
                                ? supabase.from('parcels').select(SELECT_COLS).eq('status', 'arrived').eq('unit_number', safeUnit).order('received_at', { ascending: false }).limit(10)
                                : Promise.resolve({ data: [], error: null }),
                        ]);
                        if (byName.error) throw byName.error;
                        if (byUnit.error) throw byUnit.error;
                        const seen = new Set();
                        data = [...(byName.data || []), ...(byUnit.data || [])].filter(p => {
                            if (seen.has(p.id)) return false;
                            seen.add(p.id);
                            return true;
                        });
                    } else if (resident_name) {
                        const safeName = stripLikeWildcards(sanitizeInput(resident_name).slice(0, 120));
                        if (safeName.length < 2) return { result: 'I need at least two characters of a name to search.' };
                        const result = await supabase.from('parcels').select(SELECT_COLS).eq('status', 'arrived').ilike('recipient_name', `%${safeName}%`).order('received_at', { ascending: false }).limit(20);
                        if (result.error) throw result.error;
                        data = result.data;
                    } else {
                        const safeUnit = stripLikeWildcards(sanitizeInput(unit_number).slice(0, 20));
                        if (safeUnit.length < 1) return { result: 'I need a valid unit number to search.' };
                        const result = await supabase.from('parcels').select(SELECT_COLS).eq('status', 'arrived').eq('unit_number', safeUnit).order('received_at', { ascending: false }).limit(20);
                        if (result.error) throw result.error;
                        data = result.data;
                    }

                    if (!data || data.length === 0) {
                        const displayName = resident_name ? sanitizeInput(resident_name).slice(0, 60) : null;
                        const displayUnit = unit_number ? sanitizeInput(unit_number).slice(0, 20) : null;
                        return { found: false, result: `No pending packages found${displayName ? ` for "${displayName}"` : ''}${displayUnit ? ` (unit ${displayUnit})` : ''}. If you're expecting something, it may not have been scanned in yet — check back later or ask at the front desk.` };
                    }

                    const parcels = data.map(p => ({ carrier: p.carrier || 'Unknown carrier', arrived: p.received_at || 'Unknown', status: 'Waiting in your secure locker' }));
                    return { found: true, count: parcels.length, parcels, result: `Found ${parcels.length} pending package${parcels.length === 1 ? '' : 's'}. Details attached.` };
                } catch (err) {
                    console.error('check_parcels error:', err?.message);
                    logSystemError({ source: 'claude-chat/check_parcels', message: err?.message, stack: err?.stack });
                    return { result: 'Unable to check parcels right now. Please ask at the front desk.' };
                }
            },
        }),
    };
}

// executeTool dispatch replaced by AI SDK tool() execute functions above

const SYSTEM_PROMPT = `You are Elise, the friendly digital barista and concierge at BrewHub PHL - a neighborhood cafe, parcel hub, and coworking space in Point Breeze, Philadelphia.

## VOICE INPUT — EXPECT TRANSCRIPTION ERRORS
Many customers use voice input. Browser speech-to-text frequently mishears words. Before asking for clarification, silently correct obvious errors:
- Menu items: "trip coffee" → "drip coffee", "lot eh/lottie" → "latte", "motor/mocker" → "mocha", "cap a chino/cappachino" → "cappuccino", "american oh" → "americano", "ice tea/I see" → "iced tea", "core tado" → "cortado", "call brew/cold blue" → "cold brew", "ice lot eh" → "iced latte", "school" → "scone", "bangle" → "bagel", "smooth E" → "smoothie"
- Customer names: "time" → "Tom" or "Tim", "John/Shawn" → context-dependent, "mark/Marc" → "Mark", "era/Erica" → "Erica", "lease/Elise" → keep as-is (that's you!), "den E" → "Denny", "Alex/Alec" → "Alex"
- Quantities: "to" → "two", "for" → "four" (when before a menu item, e.g. "for lattes" → "four lattes"; but "latte for Tom" → name is Tom)
- General: "I'd like a" may come through as "I like a" or "I'd light a" — treat as an order intent
If the corrected version makes sense as a valid order, proceed with it. Only ask for clarification if you genuinely cannot determine what was meant.

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
7. **check_parcels** - Check if a resident has pending packages. If someone asks about packages, mail, or deliveries, politely ask for their name and/or unit number if they have not provided it, then use this tool to look it up. Return the results in a friendly conversational way (carrier, when it arrived). NEVER reveal tracking numbers, sender details, or unit numbers from the tool response. After confirming a package exists, always remind the user: "You will need your physical key or ButterflyMX credential to access your mailbox."
8. **search_catalog** - When a user asks for recommendations, flavor profiles, or specific types of items (e.g. "something sweet and icy", "strong espresso drinks"), ALWAYS use this tool first to find the best matches before answering. It searches the menu using semantic similarity and returns the top results with names, descriptions, and prices.

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

## AI & Privacy
- You are powered by Claude. BrewHub is committed to privacy-first AI — we chose a model with strong internal guardrails around safety, data sovereignty, and responsible use.
- If customers ask about our AI, emphasize that BrewHub prioritizes your data staying yours, safety over scale, and community over contracts. Keep the vibe friendly, local, and slightly rebellious.
- We don't sell your data, we don't do surveillance, and we don't take government contracts. We make coffee.

## Key Info
- For marketing/business inquiries: info@brewhubphl.com
- Instagram: @brewhubphl
- Good wifi and workspace vibes
- Hiring announcements on Instagram
- Join waitlist on the website for opening updates
- Parcel services: monthly mailbox rentals with 24/7 access or basic shipping/receiving during business hours
- Cozy lounge area with comfortable seating, free Wi-Fi, coffee and tea for mailbox renters and community

## Menu Items
YOU MUST NEVER INVENT OR GUESS MENU ITEMS. If a user asks for a recommendation or orders food/drink, YOU MUST ALWAYS call the search_catalog tool first. ONLY recommend items explicitly returned by the tool.
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
        
        // Use Vercel AI SDK with Anthropic provider
        if (claudeKey) {
            try {
                // Build messages array with conversation history
                const messages = [
                    ...conversationHistory.slice(-10),
                    { role: 'user', content: userText }
                ];

                // Create Anthropic provider instance scoped to this request
                const anthropic = createAnthropic({ apiKey: claudeKey });

                // Create tools with request-scoped context (supabase, auth, IP)
                const tools = createTools({ supabase, authedUser, clientIp: getClientIP(event) });

                // AI SDK handles the full tool call loop automatically via maxSteps
                const result = await generateText({
                    model: anthropic('claude-sonnet-4-20250514'),
                    system: SYSTEM_PROMPT,
                    messages,
                    tools,
                    maxSteps: 3,
                    maxTokens: 300,
                });

                let reply = result.text || "Hey! How can I help you today?";

                // ═══════════════════════════════════════════════════
                // POST-RESPONSE SCRUBBER (Layer 3 — after LLM)
                // Catches hallucinated allergen assurances that slip
                // past the system prompt (e.g. via history injection).
                // ═══════════════════════════════════════════════════
                reply = scrubDangerousReply(reply);

                // Extract loyalty card data from tool results for rich frontend rendering
                let loyaltyCard = null;
                let orderConfirmation = null;
                if (result.steps) {
                    for (const step of result.steps) {
                        if (step.toolResults) {
                            for (const toolResult of step.toolResults) {
                                if (toolResult.toolName === 'check_loyalty_points' && toolResult.result?.type === 'loyalty_card' && toolResult.result?.found) {
                                    loyaltyCard = {
                                        customer_name: toolResult.result.customer_name,
                                        points: toolResult.result.points,
                                        points_to_next_reward: toolResult.result.points_to_next_reward,
                                        tier: toolResult.result.tier,
                                        portal_url: toolResult.result.portal_url,
                                    };
                                }
                                if (toolResult.toolName === 'place_order' && toolResult.result?.success && toolResult.result?.order_id) {
                                    orderConfirmation = {
                                        order_id: toolResult.result.order_id,
                                        customer_name: toolResult.result.customer_name,
                                        amount_cents: toolResult.result.amount_cents,
                                    };
                                }
                            }
                        }
                    }
                }

                const responseBody = { reply };
                if (loyaltyCard) responseBody.loyaltyCard = loyaltyCard;
                if (orderConfirmation) responseBody.orderConfirmation = orderConfirmation;

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(responseBody)
                };
            } catch (e) {
                console.error('AI SDK error:', e.message);
                logSystemError({ source: 'claude-chat/ai-sdk', message: e?.message, stack: e?.stack });
                // Return a clear degraded-mode message instead of silently falling through
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ reply: "Hey, sorry about that — I'm having a little trouble on my end right now. Try again in a sec, or reach out to info@brewhubphl.com if you need help!" })
                };
            }
        } else {
            console.error('No CLAUDE_API_KEY found');
            logSystemError({ source: 'claude-chat/config', message: 'CLAUDE_API_KEY is not set — all chat requests will use fallback mode' });
        }

        // Fallback: only reached when CLAUDE_API_KEY is not configured at all.
        // Provides minimal helpful responses without pretending to be the full AI.
        const lowerText = userText.toLowerCase().trim();
        let reply = "Hey! I'm not fully online right now, but I'd love to help. Email info@brewhubphl.com or DM us on Instagram @brewhubphl and a human will get back to you!";

        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey')) {
            reply = "Hey there! Welcome to BrewHub! I'm running in limited mode right now — for ordering and questions, come see us at the cafe or email info@brewhubphl.com!";
        } else if (lowerText.includes('email') || lowerText.includes('contact') || lowerText.includes('marketing')) {
            reply = "For business or marketing inquiries, email info@brewhubphl.com!";
        } else if (lowerText.includes('menu') || lowerText.includes('drinks') || lowerText.includes('coffee') || lowerText.includes('latte') || lowerText.includes('order')) {
            reply = "I can't pull up the live menu right now, but check out brewhubphl.com/cafe for our full menu and prices! You can also order in person at the cafe.";
        } else if (lowerText.includes('where') || lowerText.includes('location') || lowerText.includes('address')) {
            reply = "We're in Point Breeze, Philadelphia, PA 19146! Come say hi.";
        } else if (lowerText.includes('points') || lowerText.includes('loyalty') || lowerText.includes('reward')) {
            reply = "I can't check your points right now, but you can view your loyalty balance at brewhubphl.com/portal!";
        } else if (lowerText.includes('parcel') || lowerText.includes('package') || lowerText.includes('mail')) {
            reply = "I can't check parcels right now — please ask at the front desk or visit brewhubphl.com/parcels!";
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
