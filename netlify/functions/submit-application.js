// submit-application.js — Careers form handler with 3-layer bot defense
// No external captcha dependency. All validation is local.

const { createClient } = require('@supabase/supabase-js');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
  'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action',
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

  // ── CSRF protection ───────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

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

  // ── SSRF Guard: Validate resume_url ───────────────────────
  // Only allow URLs pointing to our own Supabase Storage resumes bucket.
  // This prevents attackers from injecting internal/private network URLs
  // (e.g. http://169.254.169.254/...) that the server might later fetch.
  let safeResumeUrl = null;
  if (resume_url) {
    const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const allowedPrefix = `${supabaseUrl}/storage/v1/object/public/resumes/`;

    let parsed;
    try {
      parsed = new URL(resume_url);
    } catch {
      return respond(422, { error: 'Invalid resume URL format.' });
    }

    // Enforce HTTPS only
    if (parsed.protocol !== 'https:') {
      return respond(422, { error: 'Resume URL must use HTTPS.' });
    }

    // Block credentials in URL (user:pass@host)
    if (parsed.username || parsed.password) {
      return respond(422, { error: 'Resume URL must not contain credentials.' });
    }

    // Strict prefix match against our Supabase storage bucket
    if (!resume_url.startsWith(allowedPrefix)) {
      console.warn(`[SSRF] Blocked resume_url: ${resume_url}`);
      return respond(422, { error: 'Resume URL must point to the BrewHub Supabase resumes bucket.' });
    }

    // Reject path traversal attempts
    if (resume_url.includes('..') || resume_url.includes('%2e%2e') || resume_url.includes('%2E%2E')) {
      return respond(422, { error: 'Invalid resume URL path.' });
    }

    // ── File Upload Guard: Validate file extension ─────────────
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    const fileName = parsed.pathname.split('/').pop();
    const fileExtension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      return respond(422, { error: 'Resume must be a PDF or Word document.' });
    }

    // Ensure filename does not contain path traversal patterns
    if (fileName.includes('..') || /[\\/:*?"<>|]/.test(fileName)) {
      return respond(422, { error: 'Invalid characters in resume filename.' });
    }

    safeResumeUrl = resume_url;
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
      resume_url: safeResumeUrl,
      status: 'pending',
    });

  if (insertError) {
    console.error('[submit-application] Insert failed:', insertError.message);
    return respond(500, { error: 'Unable to submit application. Please try again.' });
  }

  return respond(200, { ok: true, message: 'Application submitted successfully' });
};
