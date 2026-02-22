const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { checkVoucherRateLimit, logVoucherFail } = require('./_usage');

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

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { code, orderId, managerOverride } = JSON.parse(event.body || '{}');
  const voucherCode = (code || '').toUpperCase();

  // Manager override for the daily-3 cap — only honoured for manager/admin roles
  const isManager = auth.role === 'manager' || auth.role === 'admin';
  const applyOverride = !!(managerOverride && isManager);

  if (!voucherCode) return { statusCode: 400, body: "Voucher code required" };

  const clientIP = getClientIP(event);

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUIT BREAKER: 5 failures per IP in 10 minutes → lockout
  // Prevents brute-force guessing of voucher codes.
  // ═══════════════════════════════════════════════════════════════════════════
  const rateResult = await checkVoucherRateLimit(clientIP);
  if (!rateResult.allowed) {
    console.warn(`[REDEEM] IP ${clientIP} locked out (${rateResult.failCount} failures)`);
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: 'Too many failed attempts. Please wait before trying again.',
        retryAfter: rateResult.lockoutSeconds
      })
    };
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
      console.error('[REDEEM] RPC error:', rpcError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Redemption failed' }) };
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
      
      return { 
        statusCode: statusMap[errorCode] || 400, 
        body: JSON.stringify({ error: errorMessage, code: errorCode }) 
      };
    }

    console.log(`[VOUCHER REDEEMED] ${voucherCode.slice(0, 8)}*** applied to order ${orderId} (voucher ID: ${redeemResult.voucher_id})`);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Success! Order is now free." }) 
    };
  } catch (err) {
    console.error("Redemption Error:", err.message);
    return sanitizedError(err, 'REDEEM');
  }
};

// Note: Rollback is no longer needed - atomic RPC handles all-or-nothing transaction
