// get-payroll.js — Server-side proxy for PayrollSection.
// Returns staff directory + time logs for a given date range.
// All payroll calculation (shifts, OT, gross pay) stays on the client.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  // Payroll is manager-only
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  try {
    const params = event.queryStringParameters || {};

    // ── view=summary: return aggregated data from v_payroll_summary ──
    if (params.view === 'summary') {
      const startDate = params.start;
      const endDate = params.end;

      // Build query — optionally filtered by pay period range
      let query = supabase
        .from('v_payroll_summary')
        .select('*')
        .order('pay_period_start', { ascending: false });

      if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        query = query.gte('pay_period_start', startDate);
      }
      if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        query = query.lte('pay_period_end', endDate);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Also fetch open shifts for the "Open Shifts" card
      const { data: openShifts, error: openErr } = await supabase
        .from('time_logs')
        .select('id, employee_email, clock_in, created_at')
        .eq('action_type', 'in')
        .is('clock_out', null)
        .order('clock_in', { ascending: false });

      if (openErr) throw openErr;

      return json(200, {
        summary: data || [],
        openShifts: openShifts || [],
      });
    }

    // ── Default: raw staff + logs for client-side calculation ──
    const startDate = params.start;
    const endDate = params.end;

    if (!startDate || !endDate) {
      return json(422, { error: 'start and end query parameters are required (YYYY-MM-DD)' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return json(422, { error: 'Dates must be in YYYY-MM-DD format' });
    }

    const startIso = new Date(startDate + 'T00:00:00').toISOString();
    const endIso = new Date(endDate + 'T23:59:59').toISOString();

    const [staffRes, logsRes] = await Promise.all([
      supabase
        .from('staff_directory')
        .select('id, full_name, email, hourly_rate')
        .order('full_name'),
      supabase
        .from('time_logs')
        .select('employee_email, action_type, clock_in, clock_out, created_at')
        .gte('created_at', startIso)
        .lte('created_at', endIso),
    ]);

    if (staffRes.error) throw staffRes.error;
    if (logsRes.error) throw logsRes.error;

    return json(200, {
      staff: staffRes.data || [],
      logs: logsRes.data || [],
    });
  } catch (err) {
    return sanitizedError(err, 'get-payroll');
  }
};
