// export-csv.js — One-click payroll CSV export for managers.
// Queries v_payroll_summary and streams a downloadable CSV.
// No terminal commands, no scripts — just tap the button.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Escape a value for CSV (RFC 4180). */
function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  try {
    const params = event.queryStringParameters || {};
    const startDate = params.start;
    const endDate = params.end;

    let query = supabase
      .from('v_payroll_summary')
      .select('*')
      .order('pay_period_start', { ascending: false })
      .order('employee_email', { ascending: true });

    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      query = query.gte('pay_period_start', startDate);
    }
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      query = query.lte('pay_period_end', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];

    // Build CSV
    const header = [
      'Employee Name',
      'Email',
      'Hourly Rate',
      'Pay Period Start',
      'Pay Period End',
      'Clocked Minutes',
      'Adjustment Minutes',
      'Total Minutes',
      'Total Hours',
      'Gross Pay',
      'Active Shifts',
    ].join(',');

    const csvRows = rows.map((r) =>
      [
        csvEscape(r.employee_name || 'Unknown'),
        csvEscape(r.employee_email),
        r.hourly_rate != null ? Number(r.hourly_rate).toFixed(2) : '0.00',
        csvEscape(r.pay_period_start),
        csvEscape(r.pay_period_end),
        Number(r.clocked_minutes || 0).toFixed(2),
        Number(r.adjustment_minutes || 0).toFixed(2),
        Number(r.total_minutes || 0).toFixed(2),
        Number(r.total_hours || 0).toFixed(2),
        Number(r.gross_pay || 0).toFixed(2),
        r.active_shifts || 0,
      ].join(',')
    );

    const csv = [header, ...csvRows].join('\r\n');

    const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
    const filename = `brewhub-payroll-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: csv,
    };
  } catch (err) {
    return sanitizedError(err, 'export-csv');
  }
};
