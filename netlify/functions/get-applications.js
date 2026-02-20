// get-applications.js — Server-side proxy for job_applications reads.
// The Next.js manager dashboard uses PIN-based auth (not Supabase Auth),
// so the browser Supabase client runs as `anon` and cannot read
// job_applications (RLS requires is_brewhub_staff() → authenticated role).
// This function verifies the PIN session token and uses service_role.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  // Require staff-level auth (manager or staff — both can view applicants)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabase
      .from('job_applications')
      .select('id, created_at, name, email, phone, availability, scenario_answer, resume_url, status')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return json(200, { applications: data || [] });
  } catch (err) {
    return sanitizedError(err, 'get-applications');
  }
};
