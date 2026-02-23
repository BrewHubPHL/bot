// update-application-status.js — Server-side proxy for job_applications status updates.
// Same auth gap as get-applications.js: PIN-auth ≠ Supabase Auth, so the
// browser client cannot write through RLS.  This function verifies the
// PIN session and uses service_role.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = ['pending', 'reviewed', 'interview', 'hired', 'rejected'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'PATCH') {
    return json(405, { error: 'Method not allowed' });
  }

  // Require manager-level auth — only managers should change hiring decisions (API-H2 fix).
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  // CSRF protection (was missing — HIRE-3 fix)
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { id, status } = body;

  if (!id || typeof id !== 'string') {
    return json(422, { error: 'Missing or invalid application id' });
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    return json(422, { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const { data, error } = await supabase
      .from('job_applications')
      .update({ status })
      .eq('id', id)
      .select('id, status')
      .single();

    if (error) throw error;

    return json(200, { application: data });
  } catch (err) {
    return sanitizedError(err, 'update-application-status');
  }
};
