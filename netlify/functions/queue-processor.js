/**
 * NOTIFICATION QUEUE PROCESSOR (Scheduled Cron Trigger)
 * 
 * Runs every minute to ensure no notifications are ever lost.
 * This is the "belt" to the Edge Function's "suspenders".
 * 
 * Flow:
 * 1. Triggers the notification-worker Edge Function
 * 2. If Edge Function is down, processes queue directly (fallback)
 * 
 * Schedule: Every minute via Netlify Scheduled Functions
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { sendSMS } = require('./_sms');
const { sanitizeInput } = require('./_sanitize');

// Config
const QUEUE_BATCH_SIZE = Math.min(Math.max(Number(process.env.QUEUE_BATCH_SIZE) || 3, 1), 50);

// Note: Supabase service client will be created inside the handler to avoid long-lived service-role objects at module scope.

// Timing-safe secret comparison to prevent timing attacks
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

// Abort-capable fetch with timeout to cancel network requests where supported
function fetchWithTimeout(url, options = {}, ms = 15000, label = 'fetch') {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return fetch(url, { ...options, signal }).finally(() => clearTimeout(timer));
  } catch (e) {
    clearTimeout(timer);
    return Promise.reject(e);
  }
}
function maskPhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length <= 4 ? '****' + digits : '****' + digits.slice(-4);
}

exports.handler = async (event, context) => {
  // Only allow scheduled/cron invocations — reject direct HTTP calls
  const isScheduled = context?.clientContext?.custom?.scheduled === true
    || event.headers?.['x-netlify-event'] === 'schedule';
  const hasCronSecret = safeCompare(
    event.headers?.['x-cron-secret'],
    process.env.CRON_SECRET
  );

  if (!isScheduled && !hasCronSecret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }


  // Fail-closed if required server config missing
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.WORKER_SECRET || !process.env.CRON_SECRET) {
    console.error('[QUEUE-PROCESSOR] Missing required server configuration (SUPABASE_URL/SERVICE_ROLE/WORKER_SECRET/CRON_SECRET)');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  // Create Supabase service-role client per-request
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const workerId = `netlify-cron-${Date.now()}`;
  console.log(`[QUEUE-PROCESSOR] Starting ${workerId}`);

  try {
    // Try to trigger the Supabase Edge Function first (preferred)
    const edgeFunctionUrl = `${process.env.SUPABASE_URL}/functions/v1/notification-worker`;
    
    // Call edge function with timeout to avoid hanging Netlify execution
    let edgeRes;
    try {
      edgeRes = await fetchWithTimeout(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WORKER_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trigger: 'netlify-cron' })
      }, 30000, 'edge-function fetch');
    } catch (fErr) {
      console.warn('[QUEUE-PROCESSOR] Edge Function fetch failed or timed out:', fErr?.message || String(fErr));
      edgeRes = null;
    }

    if (edgeRes && edgeRes.ok) {
      const result = await edgeRes.json().catch(() => ({}));
      console.log(`[QUEUE-PROCESSOR] Edge Function processed ${result.processed || 0} tasks`);
      return {
        statusCode: 200,
        body: JSON.stringify({ via: 'edge-function', ...result })
      };
    }

    // Fallback: Process queue directly in Netlify if Edge Function is down
    console.log('[QUEUE-PROCESSOR] Edge Function unavailable, processing directly');
    
    const { data: tasks, error: claimError } = await withTimeout(
      supabase.rpc('claim_notification_tasks', {
        p_worker_id: workerId,
        p_batch_size: QUEUE_BATCH_SIZE
      }),
      30000,
      'claim_notification_tasks'
    ).catch((e) => ({ data: null, error: e }));

    if (claimError) {
      console.error('[QUEUE-PROCESSOR] Claim error:', claimError?.message || String(claimError));
      return { statusCode: 500, body: JSON.stringify({ error: 'Claim failed' }) };
    }

    if (!tasks || tasks.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No pending tasks' }) };
    }

    let processed = 0;
    for (const task of tasks) {
      try {
        if (task.task_type === 'parcel_arrived') {
          await sendParcelNotification(task.payload);
        }

        await withTimeout(
          supabase.rpc('complete_notification', { p_task_id: task.id }),
          10000,
          'complete_notification'
        ).catch((e) => {
          console.error('[QUEUE-PROCESSOR] complete_notification RPC failed:', String((e && e.message) || e));
          return null;
        });

        if (task.source_table === 'parcels' && task.source_id) {
          await withTimeout(
            supabase
              .from('parcels')
              .update({ status: 'arrived', notified_at: new Date().toISOString() })
              .eq('id', task.source_id),
            10000,
            'parcels.update'
          ).catch((e) => {
            console.error('[QUEUE-PROCESSOR] parcels.update failed for id:', String(task.source_id).slice(-8), String((e && e.message) || e));
            return null;
          });
        }

        processed++;
      } catch (taskErr) {
              const safeErr = sanitizeInput(String((taskErr && taskErr.message) || taskErr || 'Unknown error')).slice(0, 1000);
              console.error(`[QUEUE-PROCESSOR] Task ${String(task.id).slice(-8)} failed:`, safeErr);
              await withTimeout(
                supabase.rpc('fail_notification', {
                  p_task_id: task.id,
                  p_error: safeErr
                }),
                5000,
                'fail_notification'
              ).catch(() => null);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ via: 'direct', processed })
    };

  } catch (err) {
    console.error('[QUEUE-PROCESSOR] Fatal error:', err?.message || String(err));
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

// HTML-escape user-supplied strings to prevent injection in emails
const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendParcelNotification(payload) {
  const { recipient_name, recipient_email, recipient_phone, tracking_number, carrier, pickup_code, value_tier } = payload;

  if (!recipient_email && !recipient_phone) {
    throw new Error('No contact info');
  }

  // Build pickup code section for notifications
  const codeHtml = pickup_code
    ? `<div style="margin: 20px 0; padding: 15px; background: #f8f4e8; border: 2px solid #d4a843; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 5px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 2px;">Your Pickup Code</p>
        <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; font-family: monospace;">${escapeHtml(pickup_code)}</p>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #888;">Show this code to the barista when you pick up your package.</p>
        ${value_tier === 'high_value' || value_tier === 'premium' ? '<p style="margin: 8px 0 0 0; font-size: 11px; color: #c0392b; font-weight: bold;">⚠️ Government-issued photo ID required for high-value pickup.</p>' : ''}
      </div>`
    : '';

    if (recipient_email) {
      if (!process.env.RESEND_API_KEY) {
        console.warn('[QUEUE-PROCESSOR] RESEND_API_KEY not set; skipping email delivery for', String(recipient_email).slice(0, 64));
      } else {
        const res = await fetchWithTimeout('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'BrewHub PHL <info@brewhubphl.com>',
            to: [recipient_email],
            subject: 'Your Parcel is Ready at the Hub! 📦☕',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
                <h1>Package Arrived!</h1>
                <p>Hi ${escapeHtml(recipient_name) || 'Neighbor'},</p>
                <p>Your ${escapeHtml(carrier) || 'package'} (${escapeHtml(tracking_number) || 'pickup'}) is at BrewHub PHL!</p>
                ${codeHtml}
                <p>Stop by during cafe hours to pick it up. Fresh coffee waiting!</p>
                <p>— Thomas & The BrewHub PHL Team</p>
              </div>
            `,
          }),
        }, 15000, 'resend-email');

        if (!res || !res.ok) {
          const errData = await (res ? res.json().catch(() => null) : null);
          console.error('[QUEUE-PROCESSOR] Resend email error:', errData?.message || errData || 'unknown');
          throw new Error('Email failed');
        }
      }
    }

  // SMS via TCPA-compliant gateway (replaces omitted inline Twilio code)
  if (recipient_phone) {
    const codeSnippet = pickup_code ? ` Your pickup code: ${pickup_code}.` : '';
    const idWarning = (value_tier === 'high_value' || value_tier === 'premium') ? ' Photo ID required for pickup.' : '';
    const smsBody = `Yo ${recipient_name || 'neighbor'}! Your package (${tracking_number || 'Parcel'}) is at the Hub.${codeSnippet}${idWarning} 📦 Grab a coffee when you swing by!`;

    const smsResult = await sendSMS({
      to: recipient_phone,
      body: smsBody,
      messageType: 'parcel_arrived',
      sourceFunction: 'queue-processor',
    });

    if (smsResult.blocked) {
      console.warn(`[QUEUE-PROCESSOR] SMS blocked for ${maskPhone(recipient_phone)}: ${smsResult.reason}`);
    } else if (!smsResult.sent && !recipient_email) {
      console.error(`[QUEUE-PROCESSOR] SMS failed for ${maskPhone(recipient_phone)}`);
      throw new Error('SMS failed');
    }
  }
}

// Run every minute
module.exports.config = {
  schedule: "* * * * *"
};
