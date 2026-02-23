const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { checkVoucherRateLimit, logVoucherFail } = require('./_usage');
const { redactIP } = require('./_ip-hash');

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization, Cookie',
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getClientIP(event) {
  return event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

function json(status, data) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  // RV-4: CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // RV-1: CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // RV-3: Safe JSON parse
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  const { code, orderId, managerOverride } = body;

  // RV-2: Input length caps (DB validates too, but reject early)
  if (code && String(code).length > 100) {
    return json(400, { error: 'Voucher code too long' });
  }
  if (orderId && String(orderId).length > 36) {
    return json(400, { error: 'Invalid order ID' });
  }

  const voucherCode = (code || '').toUpperCase();

  // Manager override for the daily-3 cap — only honoured for manager/admin roles
  const isManager = auth.role === 'manager' || auth.role === 'admin';
  const applyOverride = !!(managerOverride && isManager);

  if (!voucherCode) return json(400, { error: 'Voucher code required' });

  const clientIP = getClientIP(event);

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUIT BREAKER: 5 failures per IP in 10 minutes → lockout
  // Prevents brute-force guessing of voucher codes.
  // ═══════════════════════════════════════════════════════════════════════════
  const rateResult = await checkVoucherRateLimit(clientIP);
  if (!rateResult.allowed) {
    console.warn(`[REDEEM] IP ${redactIP(clientIP)} locked out (${rateResult.failCount} failures)`);
    return json(429, {
      error: 'Too many failed attempts. Please wait before trying again.',
      retryAfter: rateResult.lockoutSeconds
    });
  }

  console.log(`[REDEEM] Attempt burn: code prefix "${voucherCode.slice(0, 8)}***"`);

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // RACE-TO-REDEEM FIX: Use atomic RPC with pg_advisory_xact_lock
    // ═══════════════════════════════════════════════════════════════════════════
    // The RPC performs ALL of the following atomically in a single transaction:
    // 1. Acquires transaction-level advisory lock on user ID
    // 2. Checks for active refund locks (rejects if refund in progress)
    // 3. Validates voucher ownership and order status
    // 4. Burns the voucher and applies discount to order
    //
    // This prevents the 10ms race window between refund.created and redemption.
    // ═══════════════════════════════════════════════════════════════════════════
    
    const { data: result, error: rpcError } = await supabase.rpc('atomic_redeem_voucher', {
      p_voucher_code: voucherCode,
      p_order_id: orderId,
      p_user_id: auth.userId || null,
      p_manager_override: applyOverride
    });

    if (applyOverride) {
      console.warn(`[REDEEM] Manager override by ${auth.user?.email || auth.role} for code prefix "${voucherCode.slice(0, 8)}***"`);
    }

    if (rpcError) {
      console.error('[REDEEM] RPC error:', rpcError.message || rpcError);
      return json(500, { error: 'Redemption failed' });
    }

    const redeemResult = result?.[0] || result;
    
    if (!redeemResult?.success) {
      const errorCode = redeemResult?.error_code || 'UNKNOWN';
      const errorMessage = redeemResult?.error_message || 'Redemption failed';
      
      console.warn(`[REDEEM BLOCKED] ${errorCode}: ${errorMessage}`);

      // Log failure to circuit breaker (non-blocking — don't fail the response)
      logVoucherFail(clientIP, voucherCode.slice(0, 4)).catch(
        e => console.error('[REDEEM] Failed to log voucher fail:', e.message)
      );
      
      // Map error codes to appropriate HTTP status codes
      const statusMap = {
        'VOUCHER_NOT_FOUND': 404,
        'ALREADY_REDEEMED': 400,
        'REFUND_IN_PROGRESS': 423,  // Locked
        'ORDER_NOT_FOUND': 404,
        'ORDER_COMPLETE': 400,
        'OWNERSHIP_MISMATCH': 403,
        'RACE_CONDITION': 409,  // Conflict
        'DAILY_LIMIT': 429,    // Too many redemptions today
        'INVALID_CODE': 400
      };
      
      return json(statusMap[errorCode] || 400, { error: errorMessage, code: errorCode });
    }

    console.log(`[VOUCHER REDEEMED] ${voucherCode.slice(0, 8)}*** applied to order ${orderId} (voucher ID: ${redeemResult.voucher_id})`);

    return json(200, { message: 'Success! Order is now free.' });
  } catch (err) {
    console.error("Redemption Error:", err.message);
    return sanitizedError(err, 'REDEEM');
  }
};

// Note: Rollback is no longer needed - atomic RPC handles all-or-nothing transaction
