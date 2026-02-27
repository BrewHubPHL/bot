const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabaseUrl = process.env.SUPABASE_URL;
const siteUrl = process.env.SITE_URL || 'https://brewhubphl.com';
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Generate a cryptographically random 6-digit pickup code */
function generatePickupCode() {
  return String(crypto.randomInt(100000, 999999));
}

/** HMAC-SHA256 hash a pickup code (same algorithm as parcel-pickup.js) */
function hashPickupCode(code) {
  const secret = process.env.PICKUP_CODE_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error('PICKUP_CODE_SECRET or INTERNAL_SYNC_SECRET env var required');
  return crypto.createHmac('sha256', secret).update(String(code).trim()).digest('hex');
}

/**
 * Detect whether the recipient is a registered resident or a guest.
 * Returns { isGuest: boolean, resident: object|null }
 */
async function detectGuestStatus(residentId, recipientEmail, recipientPhone, unitNumber) {
  // If a resident_id was provided, look them up directly
  if (residentId) {
    const { data: res } = await supabase
      .from('residents')
      .select('id, name, unit_number, phone, email')
      .eq('id', residentId)
      .single();
    if (res && res.email) return { isGuest: false, resident: res };
  }

  // Try matching by email
  if (recipientEmail) {
    const { data: res } = await supabase
      .from('residents')
      .select('id, name, unit_number, phone, email')
      .eq('email', recipientEmail)
      .limit(1)
      .maybeSingle();
    if (res) return { isGuest: false, resident: res };
  }

  // Try matching by phone + unit combo
  if (recipientPhone && unitNumber) {
    const { data: res } = await supabase
      .from('residents')
      .select('id, name, unit_number, phone, email')
      .eq('phone', recipientPhone)
      .eq('unit_number', unitNumber)
      .limit(1)
      .maybeSingle();
    if (res) return { isGuest: false, resident: res };
  }

  return { isGuest: true, resident: null };
}

/** Invite link TTL: 24 hours */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize a phone string to digits-only so formatting differences
 * ('+1 (555) 123-4567' vs '15551234567') produce identical HMAC signatures.
 * @param {string|null|undefined} phone
 * @returns {string}
 */
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Sign guest invite parameters with HMAC-SHA256.
 * Signature covers unit + phone + expires to prevent tampering.
 * Phone is normalized to digits-only before signing.
 * @param {string} unit
 * @param {string} phone
 * @param {number} expires  Unix-ms timestamp
 * @returns {string} hex signature
 */
function signInviteParams(unit, phone, expires) {
  const secret = process.env.INVITE_LINK_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error('INVITE_LINK_SECRET or INTERNAL_SYNC_SECRET env var required');
  const payload = `invite:${unit || ''}:${normalizePhone(phone)}:${expires}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Generate a guest onboarding invite URL.
 * Uses Supabase auth.admin.generateLink (magic link / signup) when an email is
 * available, otherwise falls back to an HMAC-signed invite URL with unit + phone
 * pre-populated so the registration page auto-fills.
 *
 * The signed fallback URL includes an expiry timestamp and HMAC signature so the
 * registration page can verify the link server-side before accepting the prefill.
 */
async function generateGuestInviteUrl(recipientEmail, recipientPhone, unitNumber) {
  // If guest has an email, generate a proper Supabase Magic Link
  if (recipientEmail) {
    try {
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: recipientEmail,
        options: {
          redirectTo: `${siteUrl}/resident?unit=${encodeURIComponent(unitNumber || '')}&phone=${encodeURIComponent(recipientPhone || '')}`,
        },
      });
      if (!error && data?.properties?.action_link) {
        return data.properties.action_link;
      }
      console.warn('[GUEST-ONBOARD] Magic link generation failed:', error?.message);
    } catch (err) {
      console.warn('[GUEST-ONBOARD] Magic link exception:', err?.message);
    }
  }

  // Fallback: HMAC-signed invite URL with 24-hour expiry
  const expires = Date.now() + INVITE_TTL_MS;
  const sig = signInviteParams(unitNumber, recipientPhone, expires);

  const params = new URLSearchParams();
  if (unitNumber) params.set('unit', unitNumber);
  if (recipientPhone) params.set('phone', recipientPhone);
  params.set('expires', String(expires));
  params.set('sig', sig);
  return `${siteUrl}/resident?${params.toString()}`;
}

// Fire-and-forget trigger for notification worker (best-effort, cron is backup)
function triggerWorker() {
  fetch(`${supabaseUrl}/functions/v1/notification-worker`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WORKER_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trigger: 'parcel-checkin' })
  }).catch(() => {}); // Swallow errors - cron is backup
}

// Fire-and-forget: bust Next.js cache so portal shows updated parcels
function triggerCacheRevalidation() {
  const siteUrl = process.env.SITE_URL || 'https://brewhubphl.com';
  fetch(`${siteUrl}/api/revalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET || '',
    },
    body: JSON.stringify({ paths: ['/portal', '/parcels'] }),
  }).catch(() => {}); // Best-effort; cron is backup
}

// Auto-detect carrier from tracking number format
function identifyCarrier(tracking) {
  if (/^1Z[A-Z0-9]{16}$/i.test(tracking)) return 'UPS';
  if (/^\d{12}$|^\d{15}$/i.test(tracking)) return 'FedEx';
  if (/^94\d{20}$/i.test(tracking)) return 'USPS';
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(tracking)) return 'DHL';
  if (/^TBA\d+$/i.test(tracking)) return 'Amazon';
  return 'Unknown';
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const ALLOWED_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await authorize(event, { requirePin: true });
  if (auth.ok) {
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;
  }
  if (!auth.ok) {
    return {
      statusCode: auth.response.statusCode,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: auth.response.body,
    };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    const tracking_number = (body.tracking_number || '').trim().slice(0, 100);
    const carrier = body.carrier ? String(body.carrier).trim().slice(0, 50) : null;
    const recipient_name = sanitizeInput(body.recipient_name);
    const resident_id = body.resident_id ? String(body.resident_id).slice(0, 36) : undefined;
    // Ghost / Quick-Add: manual phone + unit from iPad POS
    const manual_phone = body.phone_number ? sanitizeInput(String(body.phone_number).replace(/\D/g, '').slice(0, 15)) : null;
    const manual_unit = body.unit_number ? sanitizeInput(String(body.unit_number).trim().slice(0, 10)) : null;
    const scan_only = body.scan_only;
    const skip_notification = body.skip_notification;
    const value_tier = ['standard', 'high_value', 'premium'].includes(body.value_tier)
      ? body.value_tier : 'standard';

    if (!tracking_number) {
      return { 
        statusCode: 400, 
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'tracking_number required' }) 
      };
    }

    // Auto-detect carrier
    const detectedCarrier = carrier || identifyCarrier(tracking_number);

    // ===== SCAN ONLY MODE: Just detect carrier, no DB write =====
    if (scan_only) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({
          success: true,
          match_type: 'none',
          tracking: tracking_number,
          carrier: detectedCarrier,
          message: `${detectedCarrier} package scanned. Select recipient below.`
        })
      };
    }

    // ===== GUEST DETECTION: Resolve resident or flag as guest =====
    // Runs before the atomic RPC so we can pass resolved recipient info.
    // If a pre-registered expected_parcel exists, the RPC will use its
    // data instead -- this work is harmless overhead in that case.
    let finalRecipient = recipient_name;
    let unitNumber = manual_unit || null;
    let recipientPhone = manual_phone || null;
    let recipientEmail = null;
    let isGuest = true;
    let guestInviteUrl = null;

    if (recipient_name || resident_id) {
      const guestCheck = await detectGuestStatus(resident_id, null, manual_phone, manual_unit);
      isGuest = guestCheck.isGuest;

      if (!isGuest && guestCheck.resident) {
        finalRecipient = sanitizeInput(guestCheck.resident.name) || finalRecipient;
        unitNumber = sanitizeInput(guestCheck.resident.unit_number) || unitNumber;
        recipientPhone = sanitizeInput(guestCheck.resident.phone) || recipientPhone;
        recipientEmail = sanitizeInput(guestCheck.resident.email);
      } else if (resident_id) {
        const { data: resident } = await supabase
          .from('residents')
          .select('name, unit_number, phone, email')
          .eq('id', resident_id)
          .single();

        if (resident) {
          finalRecipient = sanitizeInput(resident.name);
          unitNumber = sanitizeInput(resident.unit_number) || unitNumber;
          recipientPhone = sanitizeInput(resident.phone) || recipientPhone;
          recipientEmail = sanitizeInput(resident.email);
          isGuest = false;
        }
      }

      if (isGuest && (recipientPhone || manual_phone)) {
        guestInviteUrl = await generateGuestInviteUrl(
          recipientEmail,
          recipientPhone || manual_phone,
          unitNumber || manual_unit
        );
      }
    }

    // Generate pickup code
    const pickupCode = generatePickupCode();
    const pickupCodeHash = hashPickupCode(pickupCode);

    // =================================================================
    // ATOMIC CHECK-IN via safe_parcel_checkin (schema-72)
    //
    // Single RPC call in ONE Postgres transaction:
    //   1. SELECT ... FOR UPDATE on parcels -> blocks concurrent
    //      check-ins, raises if duplicate already exists.
    //   2. SELECT ... FOR UPDATE on expected_parcels -> prevents
    //      "Double Flip" notification glitch.
    //   3. Flips expected_parcels to 'arrived' if found.
    //   4. INSERT parcel + notification queue atomically.
    //
    // If a pre-registered expected_parcel exists, the RPC uses its
    // recipient data (customer_name/phone/email/unit). Otherwise it
    // falls back to the p_recipient_* values we pass in.
    // =================================================================
    const { data, error } = await supabase.rpc('safe_parcel_checkin', {
      p_tracking_number: tracking_number,
      p_carrier: detectedCarrier,
      p_recipient_name: sanitizeInput(finalRecipient),
      p_recipient_phone: sanitizeInput(recipientPhone),
      p_recipient_email: sanitizeInput(recipientEmail),
      p_unit_number: sanitizeInput(unitNumber),
      p_match_type: 'manual',
      p_pickup_code_hash: pickupCodeHash,
      p_value_tier: value_tier,
      p_skip_notification: !!skip_notification,
    });

    if (error) {
      // Duplicate parcel (FOR UPDATE lock or unique index)
      if (error.message?.includes('Parcel already checked in') || error.code === '23505') {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({ error: 'Parcel already checked in.' })
        };
      }
      // No expected_parcel AND no recipient provided
      if (error.message?.includes('no recipient name provided')) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({
            error: 'No pre-registration found. Please provide recipient_name or resident_id',
            tracking: tracking_number,
            carrier: detectedCarrier,
          })
        };
      }
      throw error;
    }

    const result = data[0];
    const matchType = result?.resolved_match_type || 'manual';
    const wasPreRegistered = matchType === 'pre-registered';

    // Determine response values based on whether RPC found an expected_parcel
    const responseRecipient = wasPreRegistered ? result.expected_customer_name : finalRecipient;
    const responseUnit = wasPreRegistered ? result.expected_unit_number : unitNumber;
    const responsePhone = wasPreRegistered ? result.expected_customer_phone : recipientPhone;
    const responseEmail = wasPreRegistered ? result.expected_customer_email : recipientEmail;

    if (wasPreRegistered) {
      console.log(`[PRO-MATCH] ${tracking_number} auto-matched pre-registration`);
    } else {
      console.log(`[PHILLY] ${detectedCarrier} package ${tracking_number} checked in`);
    }

    // Patch notification payload with pickup code + guest onboarding info
    if (result?.queue_task_id) {
      console.log(`[QUEUE] Notification queued: ${result.queue_task_id}`);
      await supabase.from('notification_queue')
        .update({
          payload: {
            recipient_name: sanitizeInput(responseRecipient),
            recipient_phone: sanitizeInput(responsePhone),
            recipient_email: sanitizeInput(responseEmail),
            tracking_number,
            carrier: detectedCarrier,
            unit_number: sanitizeInput(responseUnit),
            value_tier,
            pickup_code: pickupCode,
            is_guest: wasPreRegistered ? false : isGuest,
            invite_url: wasPreRegistered ? null : guestInviteUrl,
          }
        })
        .eq('id', result.queue_task_id)
        .catch(() => {}); // Best-effort
    }

    // Fire-and-forget: Immediately trigger worker (cron is backup)
    if (!skip_notification) {
      triggerWorker();
    }
    triggerCacheRevalidation();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({
        success: true,
        match_type: matchType,
        tracking: tracking_number,
        carrier: detectedCarrier,
        recipient: responseRecipient,
        unit: responseUnit,
        queue_task_id: result?.queue_task_id || null,
        pickup_code: pickupCode,
        value_tier,
        notified: !skip_notification,
        is_guest: wasPreRegistered ? false : isGuest,
        invite_url: wasPreRegistered ? null : guestInviteUrl,
        message: wasPreRegistered
          ? `Auto-matched! Package for ${responseRecipient} (Unit ${responseUnit || 'N/A'}). Pickup code: ${pickupCode}`
          : skip_notification
            ? `Shop package checked in (no notification). Pickup code: ${pickupCode}`
            : `Checked in for ${responseRecipient}. Pickup code: ${pickupCode}`
      })
    };

  } catch (err) {

    console.error('[PARCEL-CHECK-IN ERROR]', err?.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'Check-in failed' })
    };
  }
};