/**
 * _system-errors.js — Shared dead-letter / system error logger.
 *
 * Writes critical failures to the system_errors table and optionally
 * fires a Discord/Slack webhook alert for real-time notification.
 *
 * Used by: cafe-checkout.js, square-webhook.js, _process-payment.js
 * Doomsday Scenario 5: THE PAPER TRAIL DISCREPANCY
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ERROR_WEBHOOK_URL || null;

/**
 * Log a system error to the dead-letter queue.
 * Non-fatal — if this fails, we console.error and move on.
 *
 * @param {object} supabase - Supabase service-role client
 * @param {object} params
 * @param {string}  params.error_type      - 'orphan_payment', 'db_insert_failed', 'webhook_error'
 * @param {string}  [params.severity]      - 'critical' | 'warning' | 'info'
 * @param {string}  params.source_function - 'cafe-checkout', 'square-webhook', etc.
 * @param {string}  [params.order_id]      - Order UUID if known
 * @param {string}  [params.payment_id]    - Square payment ID if applicable
 * @param {number}  [params.amount_cents]  - Dollar amount at risk
 * @param {string}  params.error_message   - Human-readable description
 * @param {object}  [params.context]       - Additional metadata
 */
async function logSystemError(supabase, params) {
  const {
    error_type,
    severity = 'critical',
    source_function,
    order_id = null,
    payment_id = null,
    amount_cents = null,
    error_message,
    context = {},
  } = params;

  // 1. Write to system_errors table
  try {
    await supabase.from('system_errors').insert({
      error_type,
      severity,
      source_function,
      order_id,
      payment_id,
      amount_cents,
      error_message: String(error_message).slice(0, 2000),
      context,
    });
  } catch (dbErr) {
    console.error('[SYSTEM-ERRORS] Failed to write to system_errors table:', dbErr?.message);
  }

  // 2. Fire Discord webhook for real-time alerting (non-blocking)
  if (DISCORD_WEBHOOK_URL) {
    try {
      const amountStr = amount_cents != null ? `$${(amount_cents / 100).toFixed(2)}` : 'N/A';
      const embed = {
        title: `🚨 ${severity.toUpperCase()}: ${error_type}`,
        description: error_message.slice(0, 1000),
        color: severity === 'critical' ? 0xFF0000 : severity === 'warning' ? 0xFFAA00 : 0x3498DB,
        fields: [
          { name: 'Source', value: source_function, inline: true },
          { name: 'Amount', value: amountStr, inline: true },
          { name: 'Order ID', value: order_id ? order_id.slice(0, 8) : 'N/A', inline: true },
          { name: 'Payment ID', value: payment_id || 'N/A', inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'BrewHub System Error Monitor' },
      };

      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch (webhookErr) {
      console.error('[SYSTEM-ERRORS] Discord webhook failed (non-fatal):', webhookErr?.message);
    }
  }

  console.error(`[SYSTEM-ERROR] ${severity.toUpperCase()} | ${error_type} | ${source_function} | ${error_message.slice(0, 200)}`);
}

module.exports = { logSystemError };
