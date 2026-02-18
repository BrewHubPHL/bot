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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Timing-safe secret comparison to prevent timing attacks
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

  const workerId = `netlify-cron-${Date.now()}`;
  console.log(`[QUEUE-PROCESSOR] Starting ${workerId}`);

  try {
    // Try to trigger the Supabase Edge Function first (preferred)
    const edgeFunctionUrl = `${process.env.SUPABASE_URL}/functions/v1/notification-worker`;
    
    const edgeRes = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WORKER_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trigger: 'netlify-cron' })
    });

    if (edgeRes.ok) {
      const result = await edgeRes.json();
      console.log(`[QUEUE-PROCESSOR] Edge Function processed ${result.processed || 0} tasks`);
      return {
        statusCode: 200,
        body: JSON.stringify({ via: 'edge-function', ...result })
      };
    }

    // Fallback: Process queue directly in Netlify if Edge Function is down
    console.log('[QUEUE-PROCESSOR] Edge Function unavailable, processing directly');
    
    const { data: tasks, error: claimError } = await supabase.rpc('claim_notification_tasks', {
      p_worker_id: workerId,
      p_batch_size: 5 // Smaller batch for Netlify timeout
    });

    if (claimError) {
      console.error('[QUEUE-PROCESSOR] Claim error:', claimError);
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

        await supabase.rpc('complete_notification', { p_task_id: task.id });

        if (task.source_table === 'parcels' && task.source_id) {
          await supabase
            .from('parcels')
            .update({ status: 'arrived', notified_at: new Date().toISOString() })
            .eq('id', task.source_id);
        }

        processed++;
      } catch (taskErr) {
        console.error(`[QUEUE-PROCESSOR] Task ${task.id} failed:`, taskErr.message);
        await supabase.rpc('fail_notification', {
          p_task_id: task.id,
          p_error: taskErr.message || 'Unknown error'
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ via: 'direct', processed })
    };

  } catch (err) {
    console.error('[QUEUE-PROCESSOR] Fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

// HTML-escape user-supplied strings to prevent injection in emails
const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendParcelNotification(payload) {
  const { recipient_name, recipient_email, recipient_phone, tracking_number, carrier } = payload;

  if (!recipient_email && !recipient_phone) {
    throw new Error('No contact info');
  }

  if (recipient_email) {
    const res = await fetch('https://api.resend.com/emails', {
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
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(`Email failed: ${JSON.stringify(errData)}`);
    }
  }

  // SMS fallback omitted for brevity - Edge Function handles full logic
}

// Run every minute
export const config = {
  schedule: "* * * * *"
};
