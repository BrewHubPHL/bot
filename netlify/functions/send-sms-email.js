export default async (req, context) => {
  try {
    const { recipient_name, phone, carrier, tracking } = await req.json();

    if (!phone || !carrier) {
      return new Response(JSON.stringify({ error: 'Missing phone or carrier' }), { status: 400 });
    }

    const gateways = {
      'verizon': '@vtext.com',
      'xfinity': '@vtext.com',
      'att': '@txt.att.net',
      'tmobile': '@tmomail.net',
      'googlefi': '@msg.fi.google.com',
      'cricket': '@sms.cricketwireless.net'
    };

    const gateway = gateways[carrier.toLowerCase()];
    if (!gateway) {
      return new Response(JSON.stringify({ error: `Unknown carrier: ${carrier}` }), { status: 400 });
    }

    const smsAddress = `${phone.replace(/\D/g, '')}${gateway}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BrewHub Alerts <alerts@brewhubphl.com>',
        to: [smsAddress],
        subject: '', 
        text: `Yo ${recipient_name}! Your package (${tracking || 'Parcel'}) is at the Hub. 📦 Grab a coffee when you swing by! Reply STOP to opt out.`,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify({ success: res.ok, id: data.id }), { status: res.status });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};