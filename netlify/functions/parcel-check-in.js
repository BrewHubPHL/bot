const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabaseUrl = process.env.SUPABASE_URL;
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

    // ===== PRO WAY: Check if this tracking was pre-registered =====
    const { data: expected } = await supabase
      .from('expected_parcels')
      .select('*')
      .eq('tracking_number', tracking_number)
      .eq('status', 'pending')
      .single();

    if (expected) {
      // Found a pre-registered parcel! Auto-match it
      console.log(`[PRO-MATCH] ${tracking_number} matches pre-registration`);

      // Mark expected parcel as arrived
      await supabase
        .from('expected_parcels')
        .update({ status: 'arrived', arrived_at: new Date().toISOString() })
        .eq('id', expected.id);

      // ── Generate pickup code for this parcel ──
      const pickupCode = generatePickupCode();
      const pickupCodeHash = hashPickupCode(pickupCode);

      // Skip notification for shop packages
      if (skip_notification) {
        const { data: parcel, error } = await supabase
          .from('parcels')
          .insert({
            tracking_number,
            carrier: detectedCarrier,
            recipient_name: sanitizeInput(expected.customer_name),
            recipient_phone: sanitizeInput(expected.customer_phone),
            recipient_email: sanitizeInput(expected.customer_email),
            unit_number: sanitizeInput(expected.unit_number),
            status: 'arrived',
            received_at: new Date().toISOString(),
            match_type: 'pre-registered',
            pickup_code_hash: pickupCodeHash,
            estimated_value_tier: value_tier,
          })
          .select()
          .single();

        if (error) throw error;

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({
            success: true,
            match_type: 'pre-registered',
            tracking: tracking_number,
            carrier: detectedCarrier,
            recipient: expected.customer_name,
            unit: expected.unit_number,
            notified: false,
            pickup_code: pickupCode,
            value_tier,
            message: `Shop package checked in (no notification). Pickup code: ${pickupCode}`
          })
        };
      }

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // ATOMIC CHECK-IN: Parcel + Notification Queue in ONE transaction
      // If either fails, both roll back. No limbo state.
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      const { data, error } = await supabase.rpc('atomic_parcel_checkin', {
        p_tracking_number: tracking_number,
        p_carrier: detectedCarrier,
        p_recipient_name: sanitizeInput(expected.customer_name),
        p_recipient_phone: sanitizeInput(expected.customer_phone),
        p_recipient_email: sanitizeInput(expected.customer_email),
        p_unit_number: sanitizeInput(expected.unit_number),
        p_match_type: 'pre-registered',
        p_pickup_code_hash: pickupCodeHash,
        p_value_tier: value_tier,
      });

      if (error) throw error;

      console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

      // Patch notification payload with pickup code so worker can include it in SMS/email
      if (data[0]?.queue_task_id) {
        await supabase.from('notification_queue')
          .update({
            payload: {
              recipient_name: sanitizeInput(expected.customer_name),
              recipient_phone: sanitizeInput(expected.customer_phone),
              recipient_email: sanitizeInput(expected.customer_email),
              tracking_number,
              carrier: detectedCarrier,
              unit_number: sanitizeInput(expected.unit_number),
              value_tier,
              pickup_code: pickupCode,
            }
          })
          .eq('id', data[0].queue_task_id)
          .catch(() => {}); // Best-effort
      }

      // Fire-and-forget: Immediately trigger worker (cron is backup)
      triggerWorker();
      triggerCacheRevalidation();

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({
          success: true,
          match_type: 'pre-registered',
          tracking: tracking_number,
          carrier: detectedCarrier,
          recipient: expected.customer_name,
          unit: expected.unit_number,
          queue_task_id: data[0]?.queue_task_id,
          pickup_code: pickupCode,
          value_tier,
          message: `Auto-matched! Package for ${expected.customer_name} (Unit ${expected.unit_number || 'N/A'}). Pickup code: ${pickupCode}`
        })
      };
    }

    // ===== SCAN ONLY MODE: Just detect carrier, return for Philly Way flow =====
    if (scan_only) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({
          success: true,
          match_type: 'none',
          tracking: tracking_number,
          carrier: detectedCarrier,
          message: `ðŸ“¦ ${detectedCarrier} package scanned. Select recipient below.`
        })
      };
    }

    // ===== PHILLY WAY: Manual recipient selection =====
    if (!recipient_name && !resident_id) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ 
          error: 'No pre-registration found. Please provide recipient_name or resident_id',
          tracking: tracking_number,
          carrier: detectedCarrier
        })
      };
    }

    // If resident_id provided, look up their info
    let finalRecipient = recipient_name;
    let unitNumber = null;
    let recipientPhone = null;
    let recipientEmail = null;

    if (resident_id) {
      const { data: resident } = await supabase
        .from('residents')
        .select('name, unit_number, phone, email')
        .eq('id', resident_id)
        .single();

      if (resident) {
        finalRecipient = sanitizeInput(resident.name);
        unitNumber = sanitizeInput(resident.unit_number);
        recipientPhone = sanitizeInput(resident.phone);
        recipientEmail = sanitizeInput(resident.email);
      }
    }

    // ── Generate pickup code for this parcel ──
    const phillyPickupCode = generatePickupCode();
    const phillyPickupCodeHash = hashPickupCode(phillyPickupCode);

    // Skip notification for shop packages
    if (skip_notification) {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          tracking_number,
          carrier: detectedCarrier,
          recipient_name: sanitizeInput(finalRecipient),
          recipient_email: sanitizeInput(recipientEmail),
          unit_number: sanitizeInput(unitNumber),
          status: 'arrived',
          received_at: new Date().toISOString(),
          match_type: 'manual',
          pickup_code_hash: phillyPickupCodeHash,
          estimated_value_tier: value_tier,
        })
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({
          success: true,
          match_type: 'manual',
          tracking: tracking_number,
          carrier: detectedCarrier,
          recipient: finalRecipient,
          notified: false,
          pickup_code: phillyPickupCode,
          value_tier,
          message: `Shop package checked in (no notification). Pickup code: ${phillyPickupCode}`
        })
      };
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ATOMIC CHECK-IN: Parcel + Notification Queue in ONE transaction
    // If either fails, both roll back. No limbo state.
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const { data, error } = await supabase.rpc('atomic_parcel_checkin', {
      p_tracking_number: tracking_number,
      p_carrier: detectedCarrier,
      p_recipient_name: sanitizeInput(finalRecipient),
      p_recipient_phone: sanitizeInput(recipientPhone),
      p_recipient_email: sanitizeInput(recipientEmail),
      p_unit_number: sanitizeInput(unitNumber),
      p_match_type: 'manual',
      p_pickup_code_hash: phillyPickupCodeHash,
      p_value_tier: value_tier,
    });

    if (error) throw error;

    console.log(`[PHILLY] ${detectedCarrier} package ${tracking_number} checked in`);
    console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

    // Patch notification payload with pickup code so worker includes it in SMS/email
    if (data[0]?.queue_task_id) {
      await supabase.from('notification_queue')
        .update({
          payload: {
            recipient_name: sanitizeInput(finalRecipient),
            recipient_phone: sanitizeInput(recipientPhone),
            recipient_email: sanitizeInput(recipientEmail),
            tracking_number,
            carrier: detectedCarrier,
            unit_number: sanitizeInput(unitNumber),
            value_tier,
            pickup_code: phillyPickupCode,
          }
        })
        .eq('id', data[0].queue_task_id)
        .catch(() => {}); // Best-effort
    }

    // Fire-and-forget: Immediately trigger worker (cron is backup)
    triggerWorker();
    triggerCacheRevalidation();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({
        success: true,
        match_type: 'manual',
        tracking: tracking_number,
        carrier: detectedCarrier,
        recipient: finalRecipient,
        unit: unitNumber,
        queue_task_id: data[0]?.queue_task_id,
        pickup_code: phillyPickupCode,
        value_tier,
        message: `Checked in for ${finalRecipient}. Pickup code: ${phillyPickupCode}`
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
