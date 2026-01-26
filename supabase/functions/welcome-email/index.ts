import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  try {
    // Webhook data from Supabase
    const { record } = await req.json()
    const userEmail = record.email

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'BrewHub PHL <info@brewhubphl.com>',
        to: [userEmail],
        subject: 'Welcome to the Hub! ☕📦',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h1 style="color: #333;">Welcome to the Hub! ☕📦</h1>
            <p>Hi there,</p>
            <p>Thanks for joining <strong>BrewHub PHL</strong>. Whether you're here for a perfect coffee or a secure spot for your packages, we're glad to have you in the neighborhood.</p>
            
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">What we offer:</h3>
              <ul style="line-height: 1.6;">
                <li><strong>Cafe:</strong> Fresh brews and local vibes.</li>
                <li><strong>Parcel Service:</strong> Secure package receiving and pickup.</li>
                <li><strong>Community:</strong> Your local spot for neighborhood news.</li>
              </ul>
            </div>

            <p>Need help with a delivery or have a question about our menu? Just reply to this email—it goes straight to our inbox.</p>
            
            <p>See you at the Hub,<br><strong>The BrewHub PHL Team</strong></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">BrewHub PHL | Philadelphia, PA</p>
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