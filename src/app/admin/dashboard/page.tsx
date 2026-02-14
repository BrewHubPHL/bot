"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { BarChart3, Users, DollarSign, Package, RefreshCw } from 'lucide-react';

export default function ManagerDashboard() {
  const [stats, setStats] = useState({ revenue: 0, orders: 0, labor: 0, activeStaff: 0 });
  const [inventory, setInventory] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
    // Real-time subscription to refresh sales when orders are updated
    const channel = supabase.channel('manager-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadSalesReport())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadDashboardData() {
    await Promise.all([
      loadSalesReport(),
      loadStaffStats(),
      loadInventory(),
      loadPayroll()
    ]);
  }

  async function loadSalesReport() {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/.netlify/functions/sales-report', {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setStats(prev => ({ ...prev, revenue: data.gross_revenue, orders: data.total_orders }));
    }
  }

  async function loadStaffStats() {
    const { data } = await supabase.from('staff_directory').select('*');
    if (data) {
      const active = data.filter(s => s.is_working);
      const labor = active.reduce((acc, s) => acc + (parseFloat(s.hourly_rate) || 0), 0);
      setStats(prev => ({ ...prev, activeStaff: active.length, labor }));
    }
  }

  async function loadInventory() {
    // Logic from inventory-check.js
    const { data } = await supabase.from('inventory').select('*').limit(5);
    if (data) setInventory(data);
  }

  async function loadPayroll() {
    // Logic pairs 'in' and 'out' action_types from time_logs
    const { data: staff } = await supabase.from('staff_directory').select('*');
    const { data: logs } = await supabase.from('time_logs').select('*').order('created_at', { ascending: true });
    
    if (staff && logs) {
      const tally = staff.map(emp => {
        let totalHours = 0;
        let startTime: any = null;
        const empLogs = logs.filter(l => l.employee_email === emp.email);
        
        empLogs.forEach(log => {
          if (log.action_type?.toLowerCase() === 'in') startTime = new Date(log.created_at);
          else if (log.action_type?.toLowerCase() === 'out' && startTime) {
            totalHours += (new Date(log.created_at).getTime() - startTime.getTime()) / 3600000;
            startTime = null;
          }
        });
        return { ...emp, totalHours, earned: totalHours * (emp.hourly_rate || 0) };
      });
      setPayroll(tally);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 pt-24 pb-12 px-6 max-w-7xl mx-auto space-y-10">
      <div className="flex justify-between items-end">
        <h1 className="font-playfair text-5xl">Dashboard</h1>
        <button onClick={loadDashboardData} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 hover:text-stone-900 transition-colors">
          <RefreshCw size={14} /> Refresh Data
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Today's Revenue", value: `$${parseFloat(stats.revenue.toString()).toFixed(2)}`, icon: <DollarSign className="text-emerald-500" /> },
          { label: "Orders Today", value: stats.orders, icon: <BarChart3 className="text-blue-500" /> },
          { label: "Staff Active", value: stats.activeStaff, icon: <Users className="text-stone-400" /> },
          { label: "Est. Daily Labor", value: `$${stats.labor.toFixed(2)}`, icon: <DollarSign className="text-amber-500" /> }
        ].map((s, i) => (
          <div key={i} className="bg-white border border-stone-200 p-6 rounded-sm shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{s.label}</span>
              {s.icon}
            </div>
            <div className="text-3xl font-playfair">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Inventory View */}
        <section className="lg:col-span-2 space-y-6">
          <h2 className="font-playfair text-2xl flex items-center gap-3"><Package size={20} className="text-stone-300"/> Inventory Alerts</h2>
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 border-b border-stone-100 text-[10px] uppercase tracking-widest text-stone-400">
                <tr>
                  <th className="px-6 py-3">Item</th>
                  <th className="px-6 py-3">Stock</th>
                  <th className="px-6 py-3">Threshold</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-2 font-bold">{item.name}</td>
                    <td className="px-6 py-2">{item.stock}</td>
                    <td className="px-6 py-2">{item.threshold}</td>
                    <td className="px-6 py-2">
                      {item.stock <= item.threshold ? (
                        <span className="text-red-500 font-bold">Low</span>
                      ) : (
                        <span className="text-green-600">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {/* Payroll View */}
        <section className="space-y-6">
          <h2 className="font-playfair text-2xl flex items-center gap-3"><Users size={20} className="text-stone-300"/> Payroll</h2>
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 border-b border-stone-100 text-[10px] uppercase tracking-widest text-stone-400">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Total Hours</th>
                  <th className="px-6 py-3">Earned</th>
                </tr>
              </thead>
              <tbody>
                {payroll.map((emp, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-2 font-bold">{emp.name}</td>
                    <td className="px-6 py-2">{emp.totalHours.toFixed(2)}</td>
                    <td className="px-6 py-2">${emp.earned.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}