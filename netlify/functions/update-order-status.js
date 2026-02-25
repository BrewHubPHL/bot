const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { generateReceiptString, queueReceipt } = require('./_receipt');
const { requireCsrfHeader } = require('./_csrf');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Postgres SQLSTATE → human-readable map ─────────────────
const PG_ERROR_MAP = {
  '23505': { status: 409, label: 'UNIQUE_VIOLATION',    msg: 'Duplicate record conflict' },
  '23503': { status: 409, label: 'FK_VIOLATION',        msg: 'Referenced record does not exist' },
  '23514': { status: 422, label: 'CHECK_VIOLATION',     msg: 'Value violates a database constraint' },
  '23502': { status: 422, label: 'NOT_NULL_VIOLATION',  msg: 'A required field is missing' },
  '40001': { status: 503, label: 'SERIALIZATION_FAIL',  msg: 'Transaction conflict — please retry' },
  '40P01': { status: 503, label: 'DEADLOCK',            msg: 'Database deadlock detected — please retry' },
  '55P03': { status: 503, label: 'LOCK_TIMEOUT',        msg: 'Order is being processed by another request. Please retry.' },
  '57014': { status: 503, label: 'STATEMENT_TIMEOUT',   msg: 'Database operation timed out — please retry' },
  'P0001': { status: 422, label: 'RAISE_EXCEPTION',     msg: 'Business rule violation' },
  'PGRST': { status: 500, label: 'POSTGREST_ERROR',     msg: 'Database gateway error' },
};

/**
 * Extract the SQLSTATE from a Supabase/PostgREST error object.
 * PostgREST puts it in `code`; sometimes it's buried in `message` or `details`.
 */
function extractSqlState(err) {
  if (!err) return null;
  // Direct code field (Supabase JS v2 surfaces this)
  if (err.code && /^[A-Z0-9]{5}$/.test(err.code)) return err.code;
  // PostgREST wraps PG errors in the message
  const m = (err.message || '').match(/\b([A-Z0-9]{5})\b/);
  if (m) return m[1];
  // Hint or details
  const d = (err.details || err.hint || '');
  const m2 = d.match(/\b([A-Z0-9]{5})\b/);
  if (m2) return m2[1];
  return null;
}

/**
 * Generate a short, URL-safe error reference ID for log correlation.
 * Format: ERR-<timestamp_hex>-<random_hex>  (e.g. ERR-1a2b3c4d-f7e8)
 */
function generateErrorId() {
  const ts = Date.now().toString(16);
  const rand = Math.random().toString(16).substring(2, 6);
  return `ERR-${ts}-${rand}`;
}

/**
 * Log an error to system_sync_logs and return the generated error_id.
 * Non-fatal — swallows its own failures so the caller can still respond.
 */
async function logSyncError(source, detail, extra = {}) {
  const errorId = generateErrorId();
  try {
    await supabase.from('system_sync_logs').insert({
      source,
      detail: `[${errorId}] ${detail}`,
      severity: extra.severity || 'error',
      profile_id: extra.profileId || null,
      email: extra.email || null,
      sql_state: extra.sqlState || null,
    });
  } catch (logErr) {
    console.error(`[LOG-SYNC] Failed to write sync log ${errorId}:`, logErr.message);
  }
  return errorId;
}

/**
 * Build an error response from a Postgres/Supabase error, logging it
 * to system_sync_logs and returning a mapped HTTP status + errorId.
 */
async function buildPgErrorResponse(err, orderId, authEmail, corsHeaders) {
  const sqlState = extractSqlState(err) || 'UNKNOWN';
  const mapped = PG_ERROR_MAP[sqlState] || PG_ERROR_MAP[sqlState.substring(0, 5)] || null;

  const errorId = await logSyncError(
    'update_order_status',
    `Order ${orderId}: [${sqlState}] ${err.message || String(err)}`,
    { sqlState, email: authEmail }
  );

  const httpStatus = mapped ? mapped.status : 500;
  const userMsg = mapped ? mapped.msg : 'Internal server error';
  const retryable = httpStatus === 503;

  console.error(`[UPDATE-ORDER] ${errorId} [${sqlState}]:`, err.message || err);

  const headers = { ...corsHeaders };
  if (retryable) headers['Retry-After'] = '2';

  return {
    statusCode: httpStatus,
    headers,
    body: JSON.stringify({ error: userMsg, errorId, sqlState }),
  };
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [
    process.env.SITE_URL,
    'https://brewhubphl.com',
    'https://www.brewhubphl.com',
  ].filter(Boolean);
  const origin = event.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
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
    const body = JSON.parse(event.body);
    const orderId = body.orderId;
    const paymentMethod = body.paymentMethod;
    const reason = body.reason;

    // ── NORMALIZE STATUS TO LOWERCASE ──────────────────────────
    const status = typeof body.status === 'string'
      ? body.status.trim().toLowerCase()
      : '';

    if (!orderId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing Order ID' }) };
    }

    // Validate status is one of allowed values
    const allowedStatuses = ['paid', 'preparing', 'ready', 'completed', 'cancelled', 'shipped'];
    if (!status || !allowedStatuses.includes(status)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }) };
    }

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(orderId)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid order ID format' }) };
    }

    // ── STATUS TRANSITION STATE MACHINE ──────────────────────
    // Enforce valid transitions to prevent going backwards or from terminal states.
    // Self-transitions (e.g. ready→ready) are idempotent — handled below.
    const VALID_TRANSITIONS = {
      unpaid:    ['unpaid', 'preparing', 'paid', 'cancelled'],  // chatbot orders — staff prepares, collects payment on pickup
      pending:   ['paid', 'preparing', 'cancelled'],
      paid:      ['paid', 'preparing', 'cancelled'],
      preparing: ['preparing', 'ready', 'cancelled'],
      ready:     ['ready', 'completed', 'cancelled'],
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
      .select('status, total_amount_cents')
      .eq('id', orderId)
      .single();

    if (lookupErr || !currentOrder) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // ── GRACEFUL IDEMPOTENCY ─────────────────────────────────
    // If the order is already in the requested state, return 200
    // immediately — no DB write, no trigger chain, no lock risk.
    if (currentOrder.status === status) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          idempotent: true,
          order: [currentOrder],
        }),
      };
    }

    // ── ALREADY-PAST-PAID GUARD ──────────────────────────────
    // If the POS sends 'paid' but the order already moved past paid
    // (e.g. a race where the order was auto-advanced to 'preparing'),
    // treat it as success and still queue a receipt if needed.
    const PAST_PAID_STATUSES = ['preparing', 'ready', 'completed'];
    if (status === 'paid' && PAST_PAID_STATUSES.includes(currentOrder.status)) {
      // Generate receipt if cash/comp (may have been missed on the earlier transition)
      if (paymentMethod && ['cash', 'comp'].includes(paymentMethod)) {
        try {
          const { data: existingReceipt } = await supabase
            .from('receipt_queue').select('id').eq('order_id', orderId).limit(1).single();
          if (!existingReceipt) {
            const { data: fullOrder } = await supabase
              .from('orders').select('*').eq('id', orderId).single();
            const { data: lineItems } = await supabase
              .from('coffee_orders').select('drink_name, price').eq('order_id', orderId);
            if (fullOrder) {
              const receiptText = generateReceiptString(fullOrder, lineItems || []);
              await queueReceipt(supabase, orderId, receiptText);
            }
          }
        } catch (receiptErr) {
          console.error('[RECEIPT] Non-fatal receipt backfill error:', receiptErr.message);
        }
      }
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          idempotent: true,
          alreadyPastPaid: true,
          order: [currentOrder],
        }),
      };
    }

    // ── ALREADY-PAST-PREPARING GUARD (cash/comp idempotency) ──
    // POS sends status='preparing' + paymentMethod='cash'. If the order
    // already raced past preparing (KDS advanced it), treat as success
    // and backfill receipt/paid_at if needed.
    const PAST_PREPARING_STATUSES = ['preparing', 'ready', 'completed'];
    if (status === 'preparing' && paymentMethod && ['cash', 'comp'].includes(paymentMethod)
        && PAST_PREPARING_STATUSES.includes(currentOrder.status)
        && currentOrder.status !== status) {
      // Backfill receipt if missing
      try {
        const { data: existingReceipt } = await supabase
          .from('receipt_queue').select('id').eq('order_id', orderId).limit(1).single();
        if (!existingReceipt) {
          const { data: fullOrder } = await supabase
            .from('orders').select('*').eq('id', orderId).single();
          const { data: lineItems } = await supabase
            .from('coffee_orders').select('drink_name, price').eq('order_id', orderId);
          if (fullOrder) {
            const receiptText = generateReceiptString(fullOrder, lineItems || []);
            await queueReceipt(supabase, orderId, receiptText);
          }
        }
      } catch (receiptErr) {
        console.error('[RECEIPT] Non-fatal receipt backfill error:', receiptErr.message);
      }
      // Backfill paid_at if not already set
      try {
        await supabase.from('orders')
          .update({ paid_at: new Date().toISOString(), paid_amount_cents: currentOrder.total_amount_cents || 0 })
          .eq('id', orderId)
          .is('paid_at', null);
      } catch (paidErr) {
        console.error('[UPDATE-ORDER] Non-fatal paid_at backfill error:', paidErr.message);
      }
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          idempotent: true,
          alreadyPastPreparing: true,
          currentStatus: currentOrder.status,
          order: [currentOrder],
        }),
      };
    }

    const allowed = VALID_TRANSITIONS[currentOrder.status] || [];
    if (!allowed.includes(status)) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `Cannot transition from '${currentOrder.status}' to '${status}'`,
          currentStatus: currentOrder.status,
        }),
      };
    }

    // ── COMP ORDER GUARD ─────────────────────────────────────
    // Comps require a reason, a manager/admin role check, and are
    // dollar-capped for non-managers. Every comp is audit-logged.
    const COMP_CAP_CENTS = 1500; // $15 — baristas can comp up to this
    const isComp = paymentMethod === 'comp';

    if (isComp) {
      const isManager = auth.role === 'manager' || auth.role === 'admin';

      // Require a reason for every comp
      const compReason = (reason || '').trim();
      if (!compReason || compReason.length < 2) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'A reason is required when comping an order.' }),
        };
      }

      const orderCents = currentOrder.total_amount_cents || 0;

      // Non-managers cannot comp orders above the cap
      if (!isManager && orderCents > COMP_CAP_CENTS) {
        console.warn(`[COMP BLOCKED] Staff ${auth.user?.email} tried to comp $${(orderCents/100).toFixed(2)} order ${orderId} (cap: $${(COMP_CAP_CENTS/100).toFixed(2)})`);
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
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
          is_manager:   isManager,
        });
        console.log(`[COMP AUDIT] ${auth.user?.email} (${auth.role}) comped order ${orderId} ($${(orderCents/100).toFixed(2)}): ${compReason}`);
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

    // ── UPDATE VIA RPC: sets app.voucher_bypass GUC inside a transaction ──
    // This prevents prevent_order_amount_tampering from rejecting vouchered
    // ($0.00) orders when handle_order_completion modifies the row.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'safe_update_order_status',
      {
        p_order_id:     orderId,
        p_status:       status,
        p_completed_at: status === 'completed' ? new Date().toISOString() : null,
        p_payment_id:   updatePayload.payment_id || null,
      }
    );

    if (rpcError) {
      return await buildPgErrorResponse(rpcError, orderId, auth.user?.email, CORS_HEADERS);
    }

    // RPC returns the updated order as a single JSON row
    const updatedOrder = rpcResult;
    if (!updatedOrder || (Array.isArray(updatedOrder) && updatedOrder.length === 0)) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Order not found or update had no effect' }),
      };
    }

    // Normalize to array for downstream compatibility
    const data = Array.isArray(updatedOrder) ? updatedOrder : [updatedOrder];

    // ── Stamp paid_at & paid_amount_cents for cash/comp payments ──
    // The RPC only handles status/completed_at/payment_id. We supplement
    // with paid_at and paid_amount_cents so receipt and audit queries work.
    if (paymentMethod && ['cash', 'comp'].includes(paymentMethod) && data[0]) {
      try {
        const paidAt = new Date().toISOString();
        const paidAmountCents = currentOrder.total_amount_cents || 0;
        // Only stamp paid_at if not already set (idempotent on retry)
        const { data: paidUpdate } = await supabase
          .from('orders')
          .update({ paid_at: paidAt, paid_amount_cents: paidAmountCents })
          .eq('id', orderId)
          .is('paid_at', null)
          .select('paid_at, paid_amount_cents')
          .maybeSingle();
        // Update local copy for receipt generation
        data[0].paid_at = paidUpdate?.paid_at || data[0].paid_at || paidAt;
        data[0].paid_amount_cents = paidUpdate?.paid_amount_cents || data[0].paid_amount_cents || paidAmountCents;
      } catch (paidErr) {
        console.error('[UPDATE-ORDER] Non-fatal paid_at stamp error:', paidErr.message);
      }
    }

    // Generate receipt for cash/comp payments (Square receipts handled by webhook)
    if (paymentMethod && ['cash', 'comp'].includes(paymentMethod) && data[0]) {
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
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, order: data })
    };

  } catch (err) {
    // ── Structured error logging with SQLSTATE extraction ──────
    const sqlState = extractSqlState(err) || err.code || null;
    const errorId = await logSyncError(
      'update_order_status',
      `[${sqlState || 'UNKNOWN'}] ${err.message || String(err)}`,
      {
        sqlState,
        email: auth?.user?.email || null,
      }
    );

    console.error(`[UPDATE-ORDER] ${errorId} [${sqlState}]:`, err?.message || String(err));
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Internal server error',
        errorId,
        sqlState,
      })
    };
  }
};