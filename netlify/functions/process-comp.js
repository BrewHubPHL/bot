// ═══════════════════════════════════════════════════════════════════════════
// process-comp.js — Manager-Authorized Comp Order (100% Discount)
// ═══════════════════════════════════════════════════════════════════════════
//
// FLOW:
//   1. POS barista builds a cart and taps "Comp Order"
//   2. Manager enters their 6-digit PIN into the modal
//   3. Frontend calls this endpoint with the manager_pin + cart + reason
//   4. This function verifies the manager PIN server-side (bcrypt via RPC)
//   5. Creates the order with total_amount_cents = 0, status = 'comped'
//   6. Logs the event in comp_audit with the manager as the authorizing actor
//
// SECURITY:
//   - CSRF header required (X-BrewHub-Action: true)
//   - Rate limited via staffBucket (token bucket per IP)
//   - POS operator authenticated via PIN session (HMAC cookie)
//   - Manager PIN verified separately (bcrypt via verify_staff_pin RPC)
//   - Server-side price lookup (client prices NEVER trusted)
//   - Input sanitization on reason field
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { redactIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');
const { generateReceiptString, queueReceipt } = require('./_receipt');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getClientIP(event) {
  return event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

// UUID v4 format check
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cart size / quantity limits
const MAX_CART_SIZE = 50;
const MAX_QUANTITY = 20;
const MAX_MODS_PER_ITEM = 10;

// Server-authoritative modifier prices (cents) — matches cafe-checkout.js
const KNOWN_MODIFIERS = {
  'Oat Milk': 75,
  'Almond Milk': 75,
  'Extra Shot': 100,
  'Vanilla Syrup': 50,
  'Caramel Syrup': 50,
  'Make it Iced': 0,
  'Sugar': 0,
};

// CORS origin allowlist
const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);
const getCorsOrigin = (event) => {
  const origin = event.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
};

/**
 * Constant-time PIN comparison (legacy fallback only).
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const crypto = require('crypto');
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  // ── CORS preflight ──────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': getCorsOrigin(event),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── CSRF protection ─────────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Rate limiting (staffBucket — 20 tokens, refills 1/3s) ──
  const clientIP = getClientIP(event);
  const rl = staffBucket.consume(clientIP);
  if (!rl.allowed) {
    console.warn(`[PROCESS-COMP] Rate limit hit from IP: ${redactIP(clientIP)}`);
    return json(429, { error: 'Rate limit exceeded. Please slow down.' });
  }

  // ── Authenticate POS operator session (staff PIN token) ─────
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = JSON.parse(event.body || '{}');

    // ── Reject client-supplied totals / prices ────────────────
    if ('total' in body || 'total_cents' in body || 'total_amount_cents' in body || 'price' in body) {
      return json(400, { error: 'Client-supplied totals/prices are not accepted.' });
    }

    const { manager_pin, items, reason, customer_name, customer_email, user_id, verify_only } = body;

    // ════════════════════════════════════════════════════════════
    // STEP 1: Verify Manager PIN (server-side, bcrypt via RPC)
    // ════════════════════════════════════════════════════════════
    if (!manager_pin || typeof manager_pin !== 'string' || !/^\d{6}$/.test(manager_pin)) {
      return json(400, { error: 'Manager PIN must be exactly 6 digits.' });
    }

    let manager = null;

    // Try bcrypt-based verification first (post-migration)
    try {
      const { data: bcryptResult, error: bcryptErr } = await supabase.rpc('verify_staff_pin', { p_pin: manager_pin });
      if (!bcryptErr && bcryptResult && bcryptResult.length > 0) {
        const row = bcryptResult[0];
        manager = {
          id: row.staff_id,
          name: row.staff_name,
          email: row.staff_email,
          role: row.staff_role,
        };
      } else if (bcryptErr) {
        console.warn('[PROCESS-COMP] verify_staff_pin RPC unavailable, falling back to legacy:', bcryptErr.message);
      }
    } catch (rpcErr) {
      console.warn('[PROCESS-COMP] bcrypt RPC failed, falling back to legacy:', rpcErr.message);
    }

    // Legacy fallback: plaintext comparison (remove after full migration)
    if (!manager) {
      const { data: staff, error: staffErr } = await supabase
        .from('staff_directory')
        .select('id, name, email, role, pin, is_active')
        .not('pin', 'is', null)
        .eq('is_active', true);

      if (staffErr) {
        console.error('[PROCESS-COMP] DB error fetching staff:', staffErr.message);
        return json(500, { error: 'Failed to verify manager PIN.' });
      }

      // Constant-time comparison across ALL records to prevent timing attacks
      for (const s of (staff || [])) {
        if (safeCompare(manager_pin, s.pin)) {
          manager = { id: s.id, name: s.name, email: s.email, role: s.role };
        }
      }
    }

    if (!manager) {
      console.warn(`[PROCESS-COMP] Invalid manager PIN attempt from IP: ${redactIP(clientIP)}`);
      return json(403, { error: 'Invalid manager PIN.' });
    }

    // ── Verify manager/admin role ─────────────────────────────
    if (manager.role !== 'manager' && manager.role !== 'admin') {
      console.warn(`[PROCESS-COMP] Non-manager PIN used (role: ${manager.role}) from IP: ${redactIP(clientIP)}`);
      return json(403, { error: 'Only managers or admins can authorize comp orders.' });
    }

    // ── Verify-only mode: return manager info without processing ─
    if (verify_only === true) {
      return json(200, {
        verified: true,
        manager: {
          id: manager.id,
          name: manager.name || 'Manager',
          role: manager.role,
        },
      });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 2: Validate inputs
    // ════════════════════════════════════════════════════════════
    const cleanReason = sanitizeInput(reason).slice(0, 500);
    if (!cleanReason || cleanReason.length < 2) {
      return json(400, { error: 'A comp reason is required (min 2 characters).' });
    }

    // Validate customer name
    const cn = typeof customer_name === 'string' ? sanitizeInput(customer_name).slice(0, 100) : null;
    if (!cn || cn.length === 0) {
      return json(400, { error: 'customer_name is required for comp orders.' });
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { error: 'items[] cannot be empty.' });
    }
    if (items.length > MAX_CART_SIZE) {
      return json(400, { error: `Cart cannot exceed ${MAX_CART_SIZE} items.` });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: Server-side price lookup (NEVER trust client)
    // ════════════════════════════════════════════════════════════
    const normalized = [];

    for (const entry of items) {
      if (entry && typeof entry === 'object' && ('price' in entry || 'price_cents' in entry || 'total' in entry)) {
        return json(400, { error: 'Per-item prices are not accepted. Server calculates pricing.' });
      }

      const pid = entry?.product_id;
      const name = entry?.name;
      const qty = Number(entry?.quantity) || 1;

      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
        return json(400, { error: `Invalid quantity. Must be 1–${MAX_QUANTITY}.` });
      }

      // Validate customizations (modifier names only)
      const rawMods = Array.isArray(entry?.customizations) ? entry.customizations : [];
      if (rawMods.length > MAX_MODS_PER_ITEM) {
        return json(400, { error: `Maximum ${MAX_MODS_PER_ITEM} modifiers per item.` });
      }
      const validMods = [];
      for (const mod of rawMods) {
        if (typeof mod !== 'string' || !Object.prototype.hasOwnProperty.call(KNOWN_MODIFIERS, mod)) {
          return json(400, { error: `Unknown modifier: ${String(mod).slice(0, 50)}` });
        }
        validMods.push(mod);
      }

      // Open-price for shipping items
      const openPrice = entry?.open_price_cents;
      if (openPrice !== undefined && openPrice !== null) {
        const cents = parseInt(openPrice);
        if (!Number.isInteger(cents) || cents < 1 || cents > 99999) {
          return json(400, { error: 'open_price_cents must be 1–99999.' });
        }
      }

      if (pid && typeof pid === 'string' && UUID_RE.test(pid)) {
        normalized.push({ product_id: pid, quantity: qty, customizations: validMods, open_price_cents: openPrice ?? null });
      } else if (name && typeof name === 'string' && name.length > 0 && name.length <= 200) {
        normalized.push({ name, quantity: qty, customizations: validMods, open_price_cents: openPrice ?? null });
      } else {
        return json(400, { error: 'Each item must have a valid product_id (UUID) or name.' });
      }
    }

    // ── Fetch authoritative prices from DB ────────────────────
    const byId = normalized.filter(i => i.product_id);
    const byName = normalized.filter(i => i.name);

    let productsById = [];
    if (byId.length > 0) {
      const uniqueIds = [...new Set(byId.map(i => i.product_id))];
      const { data, error: prodErr } = await supabase
        .from('merch_products')
        .select('id, name, price_cents, category')
        .in('id', uniqueIds)
        .eq('is_active', true)
        .is('archived_at', null);
      if (prodErr) {
        console.error('[PROCESS-COMP] Product ID lookup error:', prodErr.message);
        return json(500, { error: 'Failed to verify product prices.' });
      }
      productsById = data || [];
    }

    let productsByName = [];
    if (byName.length > 0) {
      const uniqueNames = [...new Set(byName.map(i => i.name))];
      const { data, error: prodErr } = await supabase
        .from('merch_products')
        .select('id, name, price_cents, category')
        .in('name', uniqueNames)
        .eq('is_active', true)
        .is('archived_at', null);
      if (prodErr) {
        console.error('[PROCESS-COMP] Product name lookup error:', prodErr.message);
        return json(500, { error: 'Failed to verify product prices.' });
      }
      productsByName = data || [];
    }

    // Build lookup maps
    const foundById = {};
    for (const p of productsById) foundById[p.id] = p;
    const foundByName = {};
    for (const p of productsByName) foundByName[p.name] = p;

    // ── Server-side price calculation + validated items ───────
    const qtyMap = {};

    for (const item of normalized) {
      const product = item.product_id ? foundById[item.product_id] : foundByName[item.name];
      if (!product) {
        return json(400, { error: `Unknown or inactive product: ${item.product_id || item.name}` });
      }

      let effectivePriceCents = product.price_cents;
      if (item.open_price_cents !== null && item.open_price_cents !== undefined) {
        if (product.category !== 'shipping') {
          return json(400, { error: `Open pricing is only allowed for shipping items.` });
        }
        effectivePriceCents = parseInt(item.open_price_cents);
      }

      const mods = item.customizations || [];
      const modKey = mods.slice().sort().join(',');
      const compositeKey = `${product.id}::${modKey}`;
      if (!qtyMap[compositeKey]) {
        const modCostCents = mods.reduce((sum, m) => sum + (KNOWN_MODIFIERS[m] || 0), 0);
        qtyMap[compositeKey] = { product, totalQty: 0, customizations: mods, modCostCents, effectivePriceCents };
      }
      qtyMap[compositeKey].totalQty += item.quantity;
    }

    let originalTotalCents = 0;
    const validatedItems = [];

    for (const { product, totalQty, customizations, modCostCents, effectivePriceCents: epCents } of Object.values(qtyMap)) {
      const unitCents = epCents + modCostCents;
      const lineCents = unitCents * totalQty;
      originalTotalCents += lineCents;
      validatedItems.push({
        drink_name: product.name,
        price: unitCents / 100,
        quantity: totalQty,
        customizations: customizations.length > 0 ? customizations : null,
      });
    }

    originalTotalCents = Math.max(0, originalTotalCents);

    // ════════════════════════════════════════════════════════════
    // STEP 4: Create order (total_amount_cents = 0, status = 'comped')
    // ════════════════════════════════════════════════════════════
    const orderRow = {
      status: 'comped',
      type: 'cafe',
      total_amount_cents: 0,
      payment_id: `comp-mgr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paid_at: new Date().toISOString(),
      paid_amount_cents: 0,
    };

    // Attach customer fields
    if (cn) orderRow.customer_name = cn;
    const ce = typeof customer_email === 'string' ? sanitizeInput(customer_email).slice(0, 254) : null;
    if (ce) orderRow.customer_email = ce;
    if (user_id && typeof user_id === 'string' && UUID_RE.test(user_id)) {
      orderRow.user_id = user_id;
    }

    const { data: insertedOrder, error: orderErr } = await supabase
      .from('orders')
      .insert(orderRow)
      .select()
      .single();

    if (orderErr) {
      console.error('[PROCESS-COMP] Order insert error:', orderErr.message);
      await logSystemError(supabase, {
        error_type: 'db_insert_failed',
        severity: 'critical',
        source_function: 'process-comp',
        amount_cents: originalTotalCents,
        error_message: `Comp order INSERT failed: ${orderErr.message}`,
        context: {
          manager_email: manager.email,
          operator_email: auth.user?.email || 'unknown',
          customer_name: cn,
          original_total_cents: originalTotalCents,
        },
      });
      return json(500, { error: 'Failed to create comp order.' });
    }

    const order = insertedOrder;

    // ── Insert coffee line items (one row per unit for KDS) ───
    const coffeeItems = [];
    for (const item of validatedItems) {
      for (let i = 0; i < item.quantity; i++) {
        coffeeItems.push({
          order_id: order.id,
          drink_name: item.drink_name,
          price: item.price,
          customizations: item.customizations || null,
        });
      }
    }

    const { error: itemErr } = await supabase
      .from('coffee_orders')
      .insert(coffeeItems);

    if (itemErr) {
      // Rollback the parent order to prevent ghost KDS cards
      const { error: rollbackErr } = await supabase.from('orders').delete().eq('id', order.id);
      if (rollbackErr) {
        console.error('[PROCESS-COMP] CRITICAL: Rollback delete failed for order', order.id, rollbackErr.message);
        await logSystemError(supabase, {
          error_type: 'rollback_failed',
          severity: 'critical',
          source_function: 'process-comp',
          order_id: order.id,
          error_message: `Rollback DELETE failed: ${rollbackErr.message}`,
        });
      }
      await logSystemError(supabase, {
        error_type: 'db_insert_failed',
        severity: 'critical',
        source_function: 'process-comp',
        order_id: order.id,
        amount_cents: originalTotalCents,
        error_message: `Coffee items INSERT failed (rolled back): ${itemErr.message}`,
        context: {
          manager_email: manager.email,
          operator_email: auth.user?.email || 'unknown',
        },
      });
      return json(500, { error: 'Failed to save order items. Please try again.' });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: CRITICAL — Audit trail in comp_audit
    // Records: action = ORDER_COMPED, actor_id = manager_id,
    //          order_id, metadata with original_total
    // ════════════════════════════════════════════════════════════
    const { error: auditErr } = await supabase.from('comp_audit').insert({
      order_id: order.id,
      staff_id: manager.id,           // actor_id = manager who authorized
      staff_email: manager.email,
      staff_role: manager.role,
      amount_cents: originalTotalCents,
      reason: `[ORDER_COMPED] ${cleanReason} | Original total: $${(originalTotalCents / 100).toFixed(2)}`,
      is_manager: true,
    });

    if (auditErr) {
      // Non-fatal: order was already created; log the failure but don't rollback
      console.error('[COMP AUDIT] Audit insert failed for order:', order.id);
      await logSystemError(supabase, {
        error_type: 'audit_insert_failed',
        severity: 'high',
        source_function: 'process-comp',
        order_id: order.id,
        error_message: `Comp audit INSERT failed: ${auditErr.message}`,
        context: {
          manager_id: manager.id,
          original_total_cents: originalTotalCents,
          reason: cleanReason,
        },
      });
    } else {
      console.log(
        `[COMP AUDIT] ORDER_COMPED | Manager ID: ${manager.id} | Order: ${order.id} | Original: $${(originalTotalCents / 100).toFixed(2)}`
      );
    }

    // ── Receipt generation ─────────────────────────────────────
    try {
      const lineItems = coffeeItems.map(ci => ({
        drink_name: ci.drink_name,
        price: ci.price,
      }));
      const receiptText = generateReceiptString(order, lineItems);
      await queueReceipt(supabase, order.id, receiptText);
    } catch (receiptErr) {
      console.error('[PROCESS-COMP] Non-fatal receipt error:', receiptErr.message);
    }

    return json(200, {
      success: true,
      order,
      original_total_cents: originalTotalCents,
      manager_name: manager.name || 'Manager',
    });

  } catch (err) {
    console.error('[PROCESS-COMP] Unexpected error:', err?.message);
    return json(500, { error: 'Failed to process comp order.' });
  }
};
