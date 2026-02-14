import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function PayrollSection() {
  const [payroll, setPayroll] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPayroll() {
      setLoading(true);
      const { start, end } = getTodayRange();
      const { data: staffData } = await supabase.from("staff_directory").select("id, full_name, email, hourly_rate");
      const { data: logsData } = await supabase.from("time_logs").select("employee_email, action_type, clock_in, clock_out, created_at").gte("created_at", start).lt("created_at", end);
      if (!staffData || !logsData) {
        setPayroll([]);
        setGrandTotal(0);
        setLoading(false);
        return;
      }
      let total = 0;
      const rows = staffData.map((emp: any) => {
        let totalHours = 0;
        const empLogs = logsData.filter((l: any) => l.employee_email === emp.email);
        let startTime: Date | null = null;
        empLogs.forEach((log: any) => {
          const type = (log.action_type || '').toLowerCase();
          if (type === 'in') {
            startTime = new Date(log.clock_in || log.created_at);
          } else if (type === 'out' && startTime) {
            const endTime = new Date(log.clock_out || log.created_at);
            totalHours += (endTime.getTime() - startTime.getTime()) / 3600000;
            startTime = null;
          }
        });
        const rate = parseFloat(emp.hourly_rate) || 0;
        const earned = totalHours * rate;
        total += earned;
        const lastLog = empLogs[empLogs.length - 1];
        const status = (lastLog?.action_type || 'OFF').toUpperCase();
        return {
          name: emp.full_name || 'Staff',
          email: emp.email,
          rate,
          totalHours,
          earned,
          status,
        };
      });
      setPayroll(rows);
      setGrandTotal(total);
      setLoading(false);
    }
    fetchPayroll();
  }, []);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">💰 Payroll Tally</h2>
        <span className="text-green-400 text-xl font-bold">{loading ? '...' : `$${grandTotal.toFixed(2)}`}</span>
      </div>
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-[#333]">
        <div className="grid grid-cols-5 gap-2 px-6 py-3 text-xs text-gray-400 bg-[#222]">
          <span>Staff</span>
          <span>Rate</span>
          <span>Hours</span>
          <span>Earned</span>
          <span>Status</span>
        </div>
        {loading ? (
          <div className="px-6 py-4 text-gray-500">Loading...</div>
        ) : payroll.length === 0 ? (
          <div className="px-6 py-4 text-gray-500">No staff found</div>
        ) : (
          payroll.map((row, idx) => (
            <div key={idx} className="grid grid-cols-5 gap-2 px-6 py-3 border-t border-[#222] items-center">
              <div>
                <strong>{row.name}</strong>
                <div className="text-xs text-gray-500">{row.email}</div>
              </div>
              <div>${row.rate.toFixed(2)}/hr</div>
              <div>{row.totalHours.toFixed(2)} hrs</div>
              <div className="text-green-400 font-semibold">${row.earned.toFixed(2)}</div>
              <div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold text-white ${row.status === 'IN' ? 'bg-green-600' : 'bg-red-500'}`}>{row.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
