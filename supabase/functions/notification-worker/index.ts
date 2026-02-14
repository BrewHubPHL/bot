import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * NOTIFICATION WORKER (Background Queue Processor)
 * 
 * This Edge Function processes the notification_queue table to ensure
 * no notifications are ever lost, even if the primary function crashes.
 * 
 * Trigger Options:
 * 1. Supabase Cron (recommended): Run every minute via pg_cron
 * 2. External Cron: Hit this endpoint from Netlify scheduled function
 * 3. Webhook: Called after parcel-check-in completes (fire-and-forget)
 * 
 * Flow:
 * 1. Claim pending tasks (atomic, prevents duplicate processing)
 * 2. Send notification (email/SMS via Resend)
 * 3. Mark complete or schedule retry with exponential backoff
 * 4. Update parcel status to 'arrived' only after notification sent
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const WORKER_SECRET = Deno.env.get('WORKER_SECRET') // For authenticated cron calls

// Twilio credentials
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')

serve(async (req) => {
  // Auth check for external triggers
  const authHeader = req.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  
  // Allow internal Supabase calls or authenticated external calls
  const isInternalCall = req.headers.get('x-supabase-webhook') === 'true'
  const isAuthedExternal = providedSecret && providedSecret === WORKER_SECRET
  
  if (!isInternalCall && !isAuthedExternal) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`
  
  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: CLAIM PENDING TASKS (atomic, prevents race conditions)
    // ═══════════════════════════════════════════════════════════
    const { data: tasks, error: claimError } = await supabase.rpc('claim_notification_tasks', {
      p_worker_id: workerId,
      p_batch_size: 10
    })

    if (claimError) {
      console.error('[WORKER] Claim error:', claimError)
      return new Response(JSON.stringify({ error: 'Claim failed', details: claimError }), { status: 500 })
    }

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: 'No pending tasks', worker: workerId }), { status: 200 })
    }

    console.log(`[WORKER ${workerId}] Processing ${tasks.length} tasks`)

    const results = []

    for (const task of tasks) {
      try {
        // ═══════════════════════════════════════════════════════════
        // STEP 2: SEND NOTIFICATION BASED ON TASK TYPE
        // ═══════════════════════════════════════════════════════════
        if (task.task_type === 'parcel_arrived') {
          await sendParcelNotification(task.payload)
        } else {
          throw new Error(`Unknown task type: ${task.task_type}`)
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 3: MARK COMPLETE & UPDATE PARCEL STATUS
        // ═══════════════════════════════════════════════════════════
        await supabase.rpc('complete_notification', { p_task_id: task.id })

        // Update parcel status to 'arrived' (notification confirmed sent)
        if (task.source_table === 'parcels' && task.source_id) {
          await supabase
            .from('parcels')
            .update({ status: 'arrived', notified_at: new Date().toISOString() })
            .eq('id', task.source_id)
        }

        results.push({ id: task.id, status: 'completed' })
        console.log(`[WORKER] ✅ Task ${task.id} completed`)

      } catch (taskError: any) {
        // ═══════════════════════════════════════════════════════════
        // STEP 4: MARK FAILED (will retry with exponential backoff)
        // ═══════════════════════════════════════════════════════════
        console.error(`[WORKER] ❌ Task ${task.id} failed:`, taskError.message)
        
        await supabase.rpc('fail_notification', {
          p_task_id: task.id,
          p_error: taskError.message || 'Unknown error'
        })
        
        results.push({ id: task.id, status: 'failed', error: taskError.message })
      }
    }

    return new Response(JSON.stringify({ 
      worker: workerId,
      processed: results.length,
      results 
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    })

  } catch (error: any) {
    console.error('[WORKER] Fatal error:', error)
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

/**
 * Send parcel arrival notification via email (and SMS if phone provided)
 */
async function sendParcelNotification(payload: any) {
  const { recipient_name, recipient_email, recipient_phone, tracking_number, carrier } = payload

  if (!recipient_email && !recipient_phone) {
    throw new Error('No contact info: need email or phone')
  }

  // Send email if we have one
  if (recipient_email) {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'BrewHub PHL <info@brewhubphl.com>',
        to: [recipient_email],
        subject: 'Your Parcel is Ready at the Hub! 📦☕',
        html: buildEmailHtml(recipient_name, carrier, tracking_number),
      }),
    })

    if (!emailRes.ok) {
      const errData = await emailRes.json()
      throw new Error(`Resend email failed: ${JSON.stringify(errData)}`)
    }
  }

  // Send SMS via Twilio if phone provided
  if (recipient_phone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_MESSAGING_SERVICE_SID) {
    // Format phone to E.164
    const cleanPhone = recipient_phone.replace(/\D/g, '')
    const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`
    
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
    const authHeader = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
    const message = `Yo ${recipient_name || 'neighbor'}! Your package (${tracking_number || 'Parcel'}) is at the Hub. 📦 Grab a coffee when you swing by! Reply STOP to opt out.`
    
    const smsRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
        To: formattedPhone,
        Body: message
      }).toString()
    })

    // SMS failures are logged but don't fail the whole task if email was sent
    if (!smsRes.ok && !recipient_email) {
      const errData = await smsRes.json()
      throw new Error(`Twilio SMS failed: ${JSON.stringify(errData)}`)
    } else if (smsRes.ok) {
      console.log(`[WORKER] SMS sent to ${formattedPhone}`)
    }
  }
}

function buildEmailHtml(name: string, carrier: string, tracking: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
      <h1 style="color: #333;">Package Arrived!</h1>
      <p>Hi ${name || 'Neighbor'},</p>
      <p>Your package from <strong>${carrier || 'a carrier'}</strong> is officially here and secured at <strong>BrewHub PHL</strong>.</p>
      
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 5px solid #000;">
        <p style="margin: 0;"><strong>Tracking #:</strong> ${tracking || 'Available for pickup'}</p>
        <p style="margin: 5px 0 0 0;"><strong>Pickup Location:</strong> BrewHub PHL Cafe & Hub</p>
      </div>

      <p>Feel free to stop by during our normal cafe hours to pick it up. We have fresh coffee waiting if you need a boost!</p>
      
      <p>See you soon,<br><strong>Thomas & The BrewHub PHL Team</strong></p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">BrewHub PHL | ☕ Cafe & 📦 Parcel Services</p>
    </div>
  `
}
