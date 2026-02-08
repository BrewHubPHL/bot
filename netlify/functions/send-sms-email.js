export default async (req, context) => {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Check internal service secret first
  const incomingSecret = req.headers.get('x-brewhub-secret');
  if (!incomingSecret || incomingSecret !== process.env.INTERNAL_SYNC_SECRET) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    // Validate JWT
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const email = (data.user.email || '').toLowerCase();

    // ═══════════════════════════════════════════════════════════
    // LIVE REVOCATION CHECK (prevents 1-hour JWT window exploit)
    // ═══════════════════════════════════════════════════════════
    const { data: revoked } = await supabase
      .from('revoked_users')
      .select('revoked_at')
      .eq('user_id', data.user.id)
      .single();

    if (revoked?.revoked_at) {
      // Compare revoked_at against JWT issued-at time
      const payloadPart = token.split('.')[1];
      const payload = JSON.parse(atob(payloadPart));
      const iat = payload.iat ? payload.iat * 1000 : 0;
      const revokedAt = new Date(revoked.revoked_at).getTime();
      
      if (revokedAt >= iat) {
        console.error(`[SMS-EMAIL] Blocked revoked user: ${email}`);
        return new Response(JSON.stringify({ error: 'Access revoked' }), { status: 403 });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // SSoT CHECK: Query staff_directory table (replaces env var)
    // ═══════════════════════════════════════════════════════════
    const { data: staffRecord, error: staffError } = await supabase
      .from('staff_directory')
      .select('role')
      .eq('email', email)
      .single();

    if (staffError || !staffRecord) {
      console.error(`[SMS-EMAIL] Blocked non-staff: ${email}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
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
    console.error(error);
    return new Response(JSON.stringify({ error: 'Send failed' }), { status: 500 });
  }
};