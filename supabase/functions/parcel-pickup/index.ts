import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  try {
    // This catches the data sent from your Supabase 'parcels' table
    const { record } = await req.json()
    
    // Using your exact column names from the screenshot
    const userEmail = record.email
    const recipientName = record.recipient_nam || 'Neighbor'
    const trackingNum = record.tracking_num || 'Available for pickup'
    const carrier = record.carrier || 'Standard'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'BrewHub PHL <info@brewhubphl.com>',
        to: [userEmail],
        subject: 'Your Parcel is Ready at the Hub! 📦☕',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h1 style="color: #333;">Package Arrived!</h1>
            <p>Hi ${recipientName},</p>
            <p>Your package from <strong>${carrier}</strong> is officially here and secured at <strong>BrewHub PHL</strong>.</p>
            
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 5px solid #000;">
              <p style="margin: 0;"><strong>Tracking #:</strong> ${trackingNum}</p>
              <p style="margin: 5px 0 0 0;"><strong>Pickup Location:</strong> BrewHub PHL Cafe & Hub</p>
            </div>

            <p>Feel free to stop by during our normal cafe hours to pick it up. We have fresh coffee waiting if you need a boost!</p>
            
            <p>See you soon,<br><strong>Thomas & The BrewHub PHL Team</strong></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">BrewHub PHL | ☕ Cafe & 📦 Parcel Services</p>
          </div>
        `,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify(data), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
})