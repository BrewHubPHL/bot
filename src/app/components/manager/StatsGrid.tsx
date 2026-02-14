import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function StatsGrid() {
  const [revenue, setRevenue] = useState<number>(0);
  const [orders, setOrders] = useState<number>(0);
  const [staffCount, setStaffCount] = useState<number>(0);
  const [labor, setLabor] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      // Orders: revenue and count for today
      const { start, end } = getTodayRange();
      const { data: orderData, error: orderErr } = await supabase
        .from("orders")
        .select("total_amount_cents, created_at")
        .gte("created_at", start)
        .lt("created_at", end);
      let totalRevenue = 0;
      let orderCount = 0;
      if (orderData && !orderErr) {
        orderCount = orderData.length;
        totalRevenue = orderData.reduce((sum: number, o: any) => sum + (o.total_amount_cents || 0), 0) / 100;
      }

      // Staff clocked in and labor
      const { data: staffData, error: staffErr } = await supabase
        .from("staff_directory")
        .select("email, full_name, hourly_rate, role");
      const { data: logsData, error: logsErr } = await supabase
        .from("time_logs")
        .select("employee_email, action_type, clock_in, clock_out")
        .gte("created_at", start)
        .lt("created_at", end);

      let activeStaff = 0;
      let totalLabor = 0;
      if (staffData && logsData && !staffErr && !logsErr) {
        // Find staff with an IN but no OUT today
        const working = staffData.filter((staff: any) => {
          const logs = logsData.filter((l: any) => l.employee_email === staff.email);
          const lastLog = logs[logs.length - 1];
          return lastLog && (lastLog.action_type || '').toLowerCase() === 'in' && !lastLog.clock_out;
        });
        activeStaff = working.length;
        totalLabor = working.reduce((sum: number, s: any) => sum + (parseFloat(s.hourly_rate) || 0), 0);
      }

      setRevenue(totalRevenue);
      setOrders(orderCount);
      setStaffCount(activeStaff);
      setLabor(totalLabor);
      setLoading(false);
    }
    fetchStats();
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="text-xs text-gray-400 mb-1 flex items-center justify-between">
          Today's Revenue <span className="ml-2 text-xs">🔄</span>
        </div>
        <div className="text-2xl font-bold text-green-400">{loading ? '...' : `$${revenue.toFixed(2)}`}</div>
        <div className="text-xs text-gray-500">{loading ? 'Syncing...' : 'Live'}</div>
      </div>
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="text-xs text-gray-400 mb-1">Orders Today</div>
        <div className="text-2xl font-bold text-blue-400">{loading ? '...' : orders}</div>
        <div className="text-xs text-gray-500">Live</div>
      </div>
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="text-xs text-gray-400 mb-1">Staff Clocked In</div>
        <div className="text-2xl font-bold">{loading ? '...' : staffCount}</div>
        <div className="text-xs text-gray-500">{loading ? '...' : staffCount === 0 ? 'No active shifts' : 'Active'}</div>
      </div>
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="text-xs text-gray-400 mb-1">Est. Daily Labor</div>
        <div className="text-2xl font-bold">{loading ? '...' : `$${labor.toFixed(2)}`}</div>
        <div className="text-xs text-gray-500">Total Shift Cost</div>
      </div>
    </div>
  );
}
