// submit-application.js — Careers form handler with 3-layer bot defense
// No external captcha dependency. All validation is local.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    name,
    email,
    phone,
    availability,
    scenario_answer,
    vibe_check,
    resume_url,
    user_zip_verification,
    loadTime,
  } = body;

  // ── Bot Defense #1: Honeypot ──────────────────────────────
  // The hidden field should always be empty. If a bot fills it, reject.
  if (user_zip_verification) {
    // Return 200 with a fake success so bots don't retry
    console.warn('[BOT] Honeypot triggered');
    return respond(200, { ok: true });
  }

  // ── Bot Defense #2: Timing ────────────────────────────────
  // A human takes at least 4 seconds to fill a multi-field form.
  const elapsed = Date.now() - Number(loadTime);
  if (!loadTime || elapsed < 4000) {
    console.warn(`[BOT] Timing check failed: ${elapsed}ms`);
    return respond(200, { ok: true });
  }

  // ── Bot Defense #3: Vibe Check ────────────────────────────
  // Must mention "philadelphia" or "philly" (case-insensitive).
  const vibeNorm = (vibe_check || '').toLowerCase().trim();
  if (!vibeNorm.includes('philadelphia') && !vibeNorm.includes('philly')) {
    return respond(422, { error: 'Incorrect answer to the quick check question. Hint: Think about where we are!' });
  }

  // ── Validate required fields ──────────────────────────────
  if (!name || !name.trim()) {
    return respond(422, { error: 'Name is required' });
  }
  if (!email || !email.trim()) {
    return respond(422, { error: 'Email is required' });
  }
  if (!scenario_answer || !scenario_answer.trim()) {
    return respond(422, { error: 'Please answer the experience question' });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return respond(422, { error: 'Please provide a valid email address' });
  }

  // ── Insert into Supabase ──────────────────────────────────
  const { error: insertError } = await supabase
    .from('job_applications')
    .insert({
      name: name.trim(),
      email: email.trim(),
      phone: phone ? String(phone).trim() : null,
      availability: availability || null,
      scenario_answer: scenario_answer.trim(),
      resume_url: resume_url || null,
      status: 'pending',
    });

  if (insertError) {
    console.error('[submit-application] Insert failed:', insertError.message);
    return respond(500, { error: 'Unable to submit application. Please try again.' });
  }

  return respond(200, { ok: true, message: 'Application submitted successfully' });
};
