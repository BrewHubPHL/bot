const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async () => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Supabase connectivity
  try {
    const start = Date.now();
    const { error } = await supabase.from('site_settings').select('key').limit(1);
    checks.services.supabase = {
      status: error ? 'error' : 'ok',
      latency_ms: Date.now() - start
    };
    if (error) checks.status = 'degraded';
  } catch (e) {
    checks.services.supabase = { status: 'error', message: e.message };
    checks.status = 'degraded';
  }

  // Check env vars are set (without exposing values)
  checks.services.config = {
    supabase: !!process.env.SUPABASE_URL,
    square: !!process.env.SQUARE_SANDBOX_TOKEN || !!process.env.SQUARE_ACCESS_TOKEN,
    twilio: !!process.env.TWILIO_ACCOUNT_SID,
    resend: !!process.env.RESEND_API_KEY,
    claude: !!process.env.CLAUDE_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY
  };

  return {
    statusCode: checks.status === 'ok' ? 200 : 503,
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify(checks, null, 2)
  };
};
