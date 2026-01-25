import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  try {
    const { record } = await req.json()
    const userEmail = record.email

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'BrewHub PHL <hello@brewhubphl.com>',
        to: [userEmail],
        subject: 'Welcome to the Hub!',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
            <h2 style="color: #333;">Cheers, Brewer! 🍻</h2>
            <p>Thanks for joining <strong>BrewHub PHL</strong>. We're building the ultimate community for Philly brewers, and we're glad to have you on board.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://brewhubphl.com" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Explore the Hub</a>
            </div>
            <p style="font-size: 0.9em; color: #666;">Need help? Just reply to this email.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 0.8em; color: #999;">BrewHub PHL | Philadelphia, PA</p>
          </div>
        `,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify(data), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})