// get-manager-stats.js — Server-side proxy for StatsGrid.
// Returns today's revenue, order count, staff clocked in, and est. labor.
// Uses service_role to bypass RLS on orders / staff_directory / time_logs.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [ordersRes, staffRes, logsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total_amount_cents, created_at')
        .gte('created_at', start)
        .lt('created_at', end),
      supabase
        .from('staff_directory')
        .select('email, full_name, hourly_rate, role'),
      supabase
        .from('time_logs')
        .select('employee_email, action_type, clock_in, clock_out, created_at')
        .gte('created_at', start)
        .lt('created_at', end),
    ]);

    const orderData = ordersRes.data || [];
    const staffData = staffRes.data || [];
    const logsData = logsRes.data || [];

    const orderCount = orderData.length;
    const totalRevenue = orderData.reduce((sum, o) => sum + (o.total_amount_cents || 0), 0) / 100;

    // Staff currently clocked in: last log today is 'in' with no clock_out
    let activeStaff = 0;
    let totalLabor = 0;
    for (const staff of staffData) {
      const logs = logsData.filter(l => l.employee_email === staff.email);
      const lastLog = logs[logs.length - 1];
      if (lastLog && (lastLog.action_type || '').toLowerCase() === 'in' && !lastLog.clock_out) {
        activeStaff++;
        totalLabor += parseFloat(staff.hourly_rate) || 0;
      }
    }

    return json(200, {
      revenue: totalRevenue,
      orders: orderCount,
      staffCount: activeStaff,
      labor: totalLabor,
    });
  } catch (err) {
    return sanitizedError(err, 'get-manager-stats');
  }
};
