// ═══════════════════════════════════════════════════════════════════════════
// _sms.js — TCPA-Compliant Centralized SMS Gateway
// ═══════════════════════════════════════════════════════════════════════════
//
// EVERY outbound SMS in the system MUST go through this module.
// It enforces:
//   1. Opt-out check (DB-backed, checked before every send)
//   2. Quiet hours (no SMS 9 PM–9 AM Eastern, TCPA §227)
//   3. E.164 phone normalization
//   4. Delivery logging (every send attempt recorded)
//   5. Proper STOP footer on all messages
//
// Usage:
//   const { sendSMS } = require('./_sms');
//   const result = await sendSMS({
//     to: '+12675551234',
//     body: 'Your package is here!',
//     messageType: 'parcel_arrived',
//     sourceFunction: 'send-sms-email',
//   });
//   // result: { sent: true, sid: 'SMxxx' }
//   // result: { sent: false, blocked: true, reason: 'opted_out' }
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US).
 * Returns null if the number is invalid.
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

/**
 * Ensure the message ends with the required STOP opt-out footer.
 * TCPA requires every automated message to include opt-out instructions.
 */
function ensureStopFooter(body) {
  const stopPhrases = ['reply stop', 'text stop', 'opt out', 'opt-out', 'unsubscribe'];
  const lower = body.toLowerCase();
  if (stopPhrases.some(p => lower.includes(p))) return body;
  return `${body}\n\nReply STOP to opt out.`;
}

/**
 * Send an SMS via Twilio with full TCPA compliance.
 *
 * @param {object} opts
 * @param {string} opts.to           Phone number (any format, will be normalized)
 * @param {string} opts.body         Message body
 * @param {string} opts.messageType  Category: 'parcel_arrived', 'loyalty_qr', etc.
 * @param {string} opts.sourceFunction Which function is sending: 'send-sms-email', 'notification-worker', etc.
 * @param {string} [opts.staffEmail] Who triggered this (if staff-initiated)
 * @param {boolean} [opts.skipQuietHours] Override quiet hours (emergency only)
 * @returns {Promise<{sent: boolean, sid?: string, blocked?: boolean, reason?: string, error?: string}>}
 */
async function sendSMS(opts) {
  const { to, body, messageType, sourceFunction, staffEmail, skipQuietHours = false } = opts;

  // ── Step 1: Normalize phone ──────────────────────────────
  const phoneE164 = normalizePhone(to);
  if (!phoneE164) {
    return { sent: false, error: 'Invalid phone number', reason: 'invalid_phone' };
  }

  // ── Step 2: Check opt-out + quiet hours (atomic DB check) ─
  try {
    const { data: gateResult, error: gateErr } = await supabase.rpc('check_sms_allowed', {
      p_phone_e164: phoneE164,
      p_timezone: 'America/New_York',   // Philadelphia timezone
      p_quiet_start_hour: 21,            // 9 PM
      p_quiet_end_hour: 9,               // 9 AM
    });

    if (gateErr) {
      // FAIL CLOSED: If we can't verify opt-out status, DON'T SEND.
      // Better to miss a notification than get a $1,500 TCPA fine.
      console.error(`[SMS] Opt-out check failed for ${maskPhone(phoneE164)} — blocking send (fail-closed):`, gateErr.message);
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'failed', 'optout_check_failed');
      return { sent: false, blocked: true, reason: 'optout_check_failed', error: gateErr.message };
    }

    const gate = gateResult?.[0] || gateResult;

    if (gate?.opted_out) {
      console.warn(`[SMS] BLOCKED: ${maskPhone(phoneE164)} has opted out — TCPA compliance`);
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'blocked_optout', 'opted_out');
      return { sent: false, blocked: true, reason: 'opted_out' };
    }

    if (gate?.in_quiet_hours && !skipQuietHours) {
      console.warn(`[SMS] BLOCKED: quiet hours for ${maskPhone(phoneE164)} — deferring`);
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'blocked_quiet', 'quiet_hours');
      return { sent: false, blocked: true, reason: 'quiet_hours' };
    }

    if (gate?.in_quiet_hours && skipQuietHours) {
      // Log the quiet-hours override for compliance audit trail
      console.warn(`[SMS] QUIET HOURS OVERRIDE: ${maskPhone(phoneE164)} — sent by ${sourceFunction} (staff: ${staffEmail || 'system'})`);
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'sent_quiet_override', 'quiet_hours_overridden');
    }
  } catch (checkErr) {
    // FAIL CLOSED on any exception
    console.error(`[SMS] Opt-out check exception for ${maskPhone(phoneE164)} — blocking send:`, checkErr.message);
    await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'failed', 'optout_check_exception');
    return { sent: false, blocked: true, reason: 'optout_check_exception' };
  }

  // ── Step 3: Ensure STOP footer ───────────────────────────
  const finalBody = ensureStopFooter(body);

  // ── Step 4: Send via Twilio ──────────────────────────────
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!twilioSid || !twilioToken || !messagingServiceSid) {
    console.error('[SMS] Twilio credentials not configured');
    await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'failed', 'missing_twilio_creds');
    return { sent: false, error: 'Twilio not configured' };
  }

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        MessagingServiceSid: messagingServiceSid,
        To: phoneE164,
        Body: finalBody,
      }).toString(),
    });

    const data = await res.json();

    if (res.ok) {
      console.log(`[SMS] Sent to ${maskPhone(phoneE164)}: ${data.sid} via ${sourceFunction}`);
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'sent', null, data.sid);
      return { sent: true, sid: data.sid };
    }

    // Twilio error — check if it's an opt-out related error (21610 = blacklist)
    const errorCode = data.code;
    if (errorCode === 21610) {
      // Twilio says this number opted out at the carrier level
      // Record it in our DB so we never try again
      console.warn(`[SMS] Twilio 21610 (blacklisted): ${maskPhone(phoneE164)} — recording opt-out`);
      await supabase.rpc('record_sms_opt_out', {
        p_phone_e164: phoneE164,
        p_source: 'carrier_block',
        p_source_detail: `Twilio error 21610: ${data.message}`,
      });
      await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'blocked_optout', 'twilio_21610');
      return { sent: false, blocked: true, reason: 'carrier_block' };
    }

    console.error(`[SMS] Twilio error ${errorCode}: ${data.message}`);
    await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'failed', `twilio_${errorCode}`);
    return { sent: false, error: data.message };

  } catch (sendErr) {
    console.error('[SMS] Twilio request failed:', sendErr.message);
    await logDelivery(phoneE164, messageType, sourceFunction, staffEmail, 'failed', 'twilio_request_error');
    return { sent: false, error: sendErr.message };
  }
}

/**
 * Log every SMS attempt to sms_delivery_log for compliance tracking.
 */
async function logDelivery(phone, messageType, sourceFunction, staffEmail, status, blockedReason, twilioSid) {
  try {
    await supabase.from('sms_delivery_log').insert({
      phone_e164: phone,
      message_type: messageType || 'unknown',
      twilio_sid: twilioSid || null,
      status,
      blocked_reason: blockedReason || null,
      source_function: sourceFunction || 'unknown',
      staff_email: staffEmail || null,
    });
  } catch (logErr) {
    // Non-fatal — log attempt shouldn't block sending
    console.error('[SMS] Delivery log insert failed:', logErr.message);
  }
}

/**
 * Mask a phone number for safe logging: +1267***1234
 */
function maskPhone(phone) {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-4);
}

module.exports = { sendSMS, normalizePhone, ensureStopFooter, maskPhone };
