const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action' }, body: '' };
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
    const body = JSON.parse(event.body);
    const tracking_number = (body.tracking_number || '').trim();
    const carrier = body.carrier;
    const recipient_name = sanitizeInput(body.recipient_name);
    const resident_id = body.resident_id;
    const scan_only = body.scan_only;
    const skip_notification = body.skip_notification;

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
      console.log(`[PRO-MATCH] ${tracking_number} matches pre-registration for ${expected.customer_name}`);

      // Mark expected parcel as arrived
      await supabase
        .from('expected_parcels')
        .update({ status: 'arrived', arrived_at: new Date().toISOString() })
        .eq('id', expected.id);

      // Skip notification for shop packages
      if (skip_notification) {
        const { data: parcel, error } = await supabase
          .from('parcels')
          .insert({
            tracking_number,
            carrier: detectedCarrier,
            recipient_name: sanitizeInput(expected.customer_name),
            recipient_phone: sanitizeInput(expected.customer_phone),
            unit_number: sanitizeInput(expected.unit_number),
            status: 'arrived',
            received_at: new Date().toISOString(),
            match_type: 'pre-registered'
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
            message: `âœ… Shop package checked in (no notification)`
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
        p_match_type: 'pre-registered'
      });

      if (error) throw error;

      console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

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
          message: `âœ… Auto-matched! Package for ${expected.customer_name} (Unit ${expected.unit_number || 'N/A'})`
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

    // Skip notification for shop packages
    if (skip_notification) {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          tracking_number,
          carrier: detectedCarrier,
          recipient_name: sanitizeInput(finalRecipient),
          unit_number: sanitizeInput(unitNumber),
          status: 'arrived',
          received_at: new Date().toISOString(),
          match_type: 'manual'
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
          message: `ðŸ“¦ Shop package checked in (no notification)`
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
      p_match_type: 'manual'
    });

    if (error) throw error;

    console.log(`[PHILLY] ${detectedCarrier} package ${tracking_number} checked in for ${finalRecipient}`);
    console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

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
        message: `ðŸ“¦ Checked in for ${finalRecipient}`
      })
    };

  } catch (err) {
    console.error('[PARCEL-CHECK-IN ERROR]', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'Check-in failed' })
    };
  }
};
