const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  const auth = await authorize(event);
  if (!auth.ok) {
    return {
      statusCode: auth.response.statusCode,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: auth.response.body,
    };
  }

  try {
    const { tracking_number, carrier, recipient_name, resident_id, scan_only, skip_notification } = JSON.parse(event.body);

    if (!tracking_number) {
      return { 
        statusCode: 400, 
        headers: { 'Access-Control-Allow-Origin': '*' },
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
            recipient_name: expected.customer_name,
            recipient_phone: expected.customer_phone,
            unit_number: expected.unit_number,
            status: 'arrived',
            received_at: new Date().toISOString(),
            match_type: 'pre-registered'
          })
          .select()
          .single();

        if (error) throw error;

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            success: true,
            match_type: 'pre-registered',
            tracking: tracking_number,
            carrier: detectedCarrier,
            recipient: expected.customer_name,
            unit: expected.unit_number,
            notified: false,
            message: `✅ Shop package checked in (no notification)`
          })
        };
      }

      // ═══════════════════════════════════════════════════════════
      // ATOMIC CHECK-IN: Parcel + Notification Queue in ONE transaction
      // If either fails, both roll back. No limbo state.
      // ═══════════════════════════════════════════════════════════
      const { data, error } = await supabase.rpc('atomic_parcel_checkin', {
        p_tracking_number: tracking_number,
        p_carrier: detectedCarrier,
        p_recipient_name: expected.customer_name,
        p_recipient_phone: expected.customer_phone,
        p_recipient_email: expected.customer_email,
        p_unit_number: expected.unit_number,
        p_match_type: 'pre-registered'
      });

      if (error) throw error;

      console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

      // Fire-and-forget: Immediately trigger worker (cron is backup)
      triggerWorker();

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          match_type: 'pre-registered',
          tracking: tracking_number,
          carrier: detectedCarrier,
          recipient: expected.customer_name,
          unit: expected.unit_number,
          queue_task_id: data[0]?.queue_task_id,
          message: `✅ Auto-matched! Package for ${expected.customer_name} (Unit ${expected.unit_number || 'N/A'})`
        })
      };
    }

    // ===== SCAN ONLY MODE: Just detect carrier, return for Philly Way flow =====
    if (scan_only) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          match_type: 'none',
          tracking: tracking_number,
          carrier: detectedCarrier,
          message: `📦 ${detectedCarrier} package scanned. Select recipient below.`
        })
      };
    }

    // ===== PHILLY WAY: Manual recipient selection =====
    if (!recipient_name && !resident_id) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
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
        finalRecipient = resident.name;
        unitNumber = resident.unit_number;
        recipientPhone = resident.phone;
        recipientEmail = resident.email;
      }
    }

    // Skip notification for shop packages
    if (skip_notification) {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          tracking_number,
          carrier: detectedCarrier,
          recipient_name: finalRecipient,
          unit_number: unitNumber,
          status: 'arrived',
          received_at: new Date().toISOString(),
          match_type: 'manual'
        })
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          match_type: 'manual',
          tracking: tracking_number,
          carrier: detectedCarrier,
          recipient: finalRecipient,
          notified: false,
          message: `📦 Shop package checked in (no notification)`
        })
      };
    }

    // ═══════════════════════════════════════════════════════════
    // ATOMIC CHECK-IN: Parcel + Notification Queue in ONE transaction
    // If either fails, both roll back. No limbo state.
    // ═══════════════════════════════════════════════════════════
    const { data, error } = await supabase.rpc('atomic_parcel_checkin', {
      p_tracking_number: tracking_number,
      p_carrier: detectedCarrier,
      p_recipient_name: finalRecipient,
      p_recipient_phone: recipientPhone,
      p_recipient_email: recipientEmail,
      p_unit_number: unitNumber,
      p_match_type: 'manual'
    });

    if (error) throw error;

    console.log(`[PHILLY] ${detectedCarrier} package ${tracking_number} checked in for ${finalRecipient}`);
    console.log(`[QUEUE] Notification queued: ${data[0]?.queue_task_id}`);

    // Fire-and-forget: Immediately trigger worker (cron is backup)
    triggerWorker();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        match_type: 'manual',
        tracking: tracking_number,
        carrier: detectedCarrier,
        recipient: finalRecipient,
        unit: unitNumber,
        queue_task_id: data[0]?.queue_task_id,
        message: `📦 Checked in for ${finalRecipient}`
      })
    };

  } catch (err) {
    console.error('[PARCEL-CHECK-IN ERROR]', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Check-in failed' })
    };
  }
};