export default async (req, context) => {
  const incomingSecret = req.headers.get('x-brewhub-secret');
  if (!incomingSecret || incomingSecret !== process.env.INTERNAL_SYNC_SECRET) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const allowlist = (process.env.STAFF_ALLOWLIST || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    const { data, error } = await supabase.auth.getUser(token);
    const email = (data?.user?.email || '').toLowerCase();
    if (error || !data?.user || (allowlist.length && !allowlist.includes(email))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

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