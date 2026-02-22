const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { generateReceiptString, queueReceipt } = require('./_receipt');
const { requireCsrfHeader } = require('./_csrf');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // 2. Staff Authentication Required
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const { orderId, status, paymentMethod, reason } = JSON.parse(event.body);

    if (!orderId) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Missing Order ID' }) };
    }

    // Validate status is one of allowed values
    const allowedStatuses = ['paid', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }) };
    }

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(orderId)) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Invalid order ID format' }) };
    }

    // ── STATUS TRANSITION STATE MACHINE ──────────────────────
    // Enforce valid transitions to prevent going backwards or from terminal states
    const VALID_TRANSITIONS = {
      pending:   ['paid', 'preparing', 'cancelled'],
      paid:      ['preparing', 'cancelled'],
      preparing: ['preparing', 'ready', 'cancelled'],  // preparing→preparing: idempotent for cash after KDS tap
      ready:     ['completed', 'cancelled'],
      // Abandoned orders (15-min cron) can be revived by a cash/comp payment
      abandoned: ['preparing', 'cancelled'],
      // Terminal states — no transitions allowed:
      completed: [],
      cancelled: [],
      refunded:  [],
      amount_mismatch: ['cancelled'],
    };

    const { data: currentOrder, error: lookupErr } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();

    if (lookupErr || !currentOrder) {
      return { statusCode: 404, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Order not found' }) };
    }

    const allowed = VALID_TRANSITIONS[currentOrder.status] || [];
    if (!allowed.includes(status)) {
      return {
        statusCode: 409,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({
          error: `Cannot transition from '${currentOrder.status}' to '${status}'`,
        }),
      };
    }

    // ── COMP ORDER GUARD ─────────────────────────────────────
    // Comps require a reason and are dollar-capped for non-managers.
    // Every comp is logged to comp_audit for manager review.
    const COMP_CAP_CENTS = 1500; // $15 — baristas can comp up to this
    const isComp = paymentMethod === 'comp';

    if (isComp) {
      // Require a reason for every comp
      const compReason = (reason || '').trim();
      if (!compReason || compReason.length < 2) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({ error: 'A reason is required when comping an order.' }),
        };
      }

      // Fetch order total to enforce dollar cap
      const { data: orderCheck, error: checkErr } = await supabase
        .from('orders')
        .select('total_amount_cents')
        .eq('id', orderId)
        .single();

      if (checkErr || !orderCheck) {
        return { statusCode: 404, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Order not found' }) };
      }

      const orderCents = orderCheck.total_amount_cents || 0;
      const isManager = auth.role === 'manager' || auth.role === 'admin';

      // Non-managers cannot comp orders above the cap
      if (!isManager && orderCents > COMP_CAP_CENTS) {
        console.warn(`[COMP BLOCKED] Staff ${auth.user?.email} tried to comp $${(orderCents/100).toFixed(2)} order ${orderId} (cap: $${(COMP_CAP_CENTS/100).toFixed(2)})`);
        return {
          statusCode: 403,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({
            error: `Comp limit is $${(COMP_CAP_CENTS/100).toFixed(2)} for non-manager staff. Ask a manager to approve.`,
          }),
        };
      }

      // Write audit row (non-fatal — don't block the comp if logging fails)
      try {
        await supabase.from('comp_audit').insert({
          order_id:     orderId,
          staff_id:     auth.user?.id || null,
          staff_email:  auth.user?.email || 'unknown',
          staff_role:   auth.role || 'unknown',
          amount_cents: orderCents,
          reason:       compReason.slice(0, 500), // cap length
        });
        console.log(`[COMP AUDIT] ${auth.user?.email} comped order ${orderId} ($${(orderCents/100).toFixed(2)}): ${compReason}`);
      } catch (auditErr) {
        console.error('[COMP AUDIT] Non-fatal audit insert error:', auditErr.message);
      }
    }

    // Build update payload
    const updatePayload = { status };

    // Track order completion speed
    if (status === 'completed') {
      updatePayload.completed_at = new Date().toISOString();
    }

    // Record payment method (cash, comp, etc.) and set payment_id marker
    const ALLOWED_PAYMENT_METHODS = ['cash', 'comp', 'square', 'other'];
    if (paymentMethod && ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      updatePayload.payment_id = paymentMethod;    // marks order as paid
    }

    // Update the Order Status
    const { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select();

    if (error) throw error;

    // Verify the update actually matched a row
    if (!data || data.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'Order not found or update had no effect' }),
      };
    }

    // Generate receipt for cash/comp payments (Square receipts handled by webhook)
    if (paymentMethod && ['cash', 'comp'].includes(paymentMethod) && data && data[0]) {
      try {
        const { data: lineItems } = await supabase
          .from('coffee_orders')
          .select('drink_name, price')
          .eq('order_id', orderId);

        const receiptText = generateReceiptString(data[0], lineItems || []);
        await queueReceipt(supabase, orderId, receiptText);
      } catch (receiptErr) {
        console.error('[RECEIPT] Non-fatal receipt error:', receiptErr.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ success: true, order: data })
    };

  } catch (err) {
    console.error('[COMPLETE-ORDER] Error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};