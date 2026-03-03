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

    // ── Phase 1: Send notifications concurrently ────────────────────
    // Each task resolves/rejects independently so one failure doesn't block others.
    const notificationResults = await Promise.allSettled(
      tasks.map(async (task) => {
        if (task.task_type === 'parcel_arrived') {
          await sendParcelNotification(task.payload);
        }
      })
    );

    // Partition tasks into succeeded vs failed based on notification outcome
    const succeededTasks = [];
    const failedTasks = [];
    for (let i = 0; i < tasks.length; i++) {
      if (notificationResults[i].status === 'fulfilled') {
        succeededTasks.push(tasks[i]);
      } else {
        failedTasks.push({ task: tasks[i], reason: notificationResults[i].reason });
      }
    }

    // ── Phase 2: Batch-update parcels in a single query ──────────
    // Run BEFORE completing notifications so we don't orphan parcels
    // if the update fails.
    const parcelIds = succeededTasks
      .filter((t) => t.source_table === 'parcels' && t.source_id)
      .map((t) => t.source_id);

    if (parcelIds.length > 0) {
      const { error: bulkUpdateError } = await withTimeout(
        supabase
          .from('parcels')
          .update({ status: 'arrived', notified_at: new Date().toISOString() })
          .in('id', parcelIds),
        10000,
        'parcels.bulk-update'
      );

      if (bulkUpdateError) {
        console.error(
          '[QUEUE-PROCESSOR] Bulk parcels.update failed:',
          bulkUpdateError.message || String(bulkUpdateError)
        );
      }
    }

    // ── Phase 3: Complete notifications via concurrent RPC calls ──
    if (succeededTasks.length > 0) {
      const completeResults = await Promise.allSettled(
        succeededTasks.map(async (task) => {
          const { error } = await withTimeout(
            supabase.rpc('complete_notification', { p_task_id: task.id }),
            10000,
            'complete_notification'
          );
          if (error) throw error;
        })
      );

      completeResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.error(
            '[QUEUE-PROCESSOR] complete_notification RPC failed for task:',
            String(succeededTasks[idx].id).slice(-8),
            String(result.reason?.message || result.reason)
          );
        }
      });
    }

    // ── Phase 4: Record failures so they can be retried ──────────
    if (failedTasks.length > 0) {
      await Promise.allSettled(
        failedTasks.map(({ task, reason }) => {
          const safeErr = sanitizeInput(
            String((reason && reason.message) || reason || 'Unknown error')
          ).slice(0, 1000);
          console.error(`[QUEUE-PROCESSOR] Task ${String(task.id).slice(-8)} failed:`, safeErr);
          return withTimeout(
            supabase.rpc('fail_notification', {
              p_task_id: task.id,
              p_error: safeErr,
            }),
            5000,
            'fail_notification'
          ).then(({ error: failErr }) => {
            if (failErr) {
              console.error(`[QUEUE-PROCESSOR] fail_notification RPC error for task ${String(task.id).slice(-8)}:`, failErr.message);
            }
          }).catch(() => null);
        })
      );
    }

    const processed = succeededTasks.length;
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
  const { recipient_name, recipient_email, recipient_phone, tracking_number, carrier, pickup_code, value_tier, is_guest, invite_url } = payload;

  if (!recipient_email && !recipient_phone) {
    throw new Error('No contact info');
  }

  // Build pickup code section for emails (HTML)
  const codeHtml = pickup_code
    ? `<div style="margin: 20px 0; padding: 15px; background: #f8f4e8; border: 2px solid #d4a843; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 5px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 2px;">Your Pickup Code</p>
        <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; font-family: monospace;">${escapeHtml(pickup_code)}</p>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #888;">Show this code to the barista when you pick up your package.</p>
        ${value_tier === 'high_value' || value_tier === 'premium' ? '<p style="margin: 8px 0 0 0; font-size: 11px; color: #c0392b; font-weight: bold;">⚠️ Government-issued photo ID required for high-value pickup.</p>' : ''}
      </div>`
    : '';

  // Guest onboarding invite section for emails
  const inviteHtml = (is_guest && invite_url)
    ? `<div style="margin: 20px 0; padding: 15px; background: #f0f9ff; border: 2px solid #60a5fa; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #1e3a5f; font-weight: bold;">📱 Track Your Future Deliveries</p>
        <p style="margin: 0 0 12px 0; font-size: 13px; color: #555;">Sign up once and you'll get live package tracking, coffee rewards, and more — right from your phone.</p>
        <a href="${escapeHtml(invite_url)}" style="display: inline-block; padding: 10px 24px; background: #1c1917; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Set Up My Account →</a>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #888;">Totally optional — no pressure!</p>
      </div>`
    : '';

    if (recipient_email) {
      if (!process.env.RESEND_API_KEY) {
        console.warn('[QUEUE-PROCESSOR] RESEND_API_KEY not set; skipping email delivery for', String(recipient_email).slice(0, 64));
      } else {
        const emailSubject = is_guest
          ? 'Your Package is at BrewHub! 📦 (+ Set Up Live Tracking)'
          : 'Your Parcel is Ready at the Hub! 📦☕';

        const greeting = is_guest
          ? `<p>Hi! A ${escapeHtml(carrier) || 'package'} (${escapeHtml(tracking_number) || 'pickup'}) just arrived for you at <strong>BrewHub PHL</strong>.</p>`
          : `<p>Hi ${escapeHtml(recipient_name) || 'Neighbor'},</p><p>Your ${escapeHtml(carrier) || 'package'} (${escapeHtml(tracking_number) || 'pickup'}) is at BrewHub PHL!</p>`;

        const res = await fetchWithTimeout('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'BrewHub PHL <info@brewhubphl.com>',
            to: [recipient_email],
            subject: emailSubject,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
                <h1>Package Arrived!</h1>
                ${greeting}
                ${codeHtml}
                ${inviteHtml}
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

  // ── SMS via TCPA-compliant gateway ──────────────────────
  // Fork the message template: registered residents get the warm "regular" message,
  // unregistered guests get the magic link invite copy.
  if (recipient_phone) {
    const codeSnippet = pickup_code ? ` Your pickup code: ${pickup_code}.` : '';
    const idWarning = (value_tier === 'high_value' || value_tier === 'premium') ? ' Photo ID required for pickup.' : '';

    let smsBody;
    if (is_guest && invite_url) {
      // Scenario B: Unregistered Guest — include magic link invite
      smsBody = `Hi! Your ${carrier || 'package'} is at the BrewHub lobby. 📦${codeSnippet}${idWarning} If you'd like, you can track all your future deliveries live right from your phone here: ${invite_url} Totally optional—see you soon! ☕`;
    } else {
      // Scenario A: Registered Resident — warm & familiar
      smsBody = `Hi ${recipient_name || 'neighbor'}! Your ${carrier || 'package'} is ready at the BrewHub lobby! 📦${codeSnippet}${idWarning} Grab a coffee when you're down here. ☕ ${process.env.SITE_URL || 'https://brewhubphl.com'}/portal`;
    }

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
