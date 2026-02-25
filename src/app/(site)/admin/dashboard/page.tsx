"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useOpsSession } from '@/components/OpsGate';
import { BarChart3, Users, DollarSign, Package, RefreshCw } from 'lucide-react';
import KdsSection from '@/app/(site)/components/manager/KdsSection';

export default function ManagerDashboard() {
  const { token } = useOpsSession();
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
    try {
      const res = await fetch('/.netlify/functions/sales-report', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-BrewHub-Action': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setStats(prev => ({ ...prev, revenue: data.gross_revenue, orders: data.total_orders }));
      }
    } catch (err) {
      console.error('[ADMIN] Sales report load failed');
    }
  }

  async function loadStaffStats() {
    try {
      const res = await fetch('/.netlify/functions/get-manager-stats', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-BrewHub-Action': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setStats(prev => ({
          ...prev,
          activeStaff: data.activeStaff ?? prev.activeStaff,
          labor: data.estimatedLabor ?? prev.labor
        }));
      }
    } catch (err) {
      console.error('[ADMIN] Staff stats load failed');
    }
  }

  async function loadInventory() {
    try {
      const res = await fetch('/.netlify/functions/get-inventory', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-BrewHub-Action': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setInventory(Array.isArray(data) ? data.slice(0, 5) : []);
      }
    } catch (err) {
      console.error('[ADMIN] Inventory load failed');
    }
  }

  async function loadPayroll() {
    try {
      const res = await fetch('/.netlify/functions/get-payroll', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-BrewHub-Action': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setPayroll(Array.isArray(data) ? data : (data.payroll || []));
      }
    } catch (err) {
      console.error('[ADMIN] Payroll load failed');
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

      {/* Live KDS — manager sees the same interactive order cards as the baristas */}
      <KdsSection />

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
                    <td className="px-6 py-2 font-bold">{item.item_name}</td>
                    <td className="px-6 py-2">{item.current_stock}</td>
                    <td className="px-6 py-2">{item.min_threshold}</td>
                    <td className="px-6 py-2">
                      {item.current_stock <= item.min_threshold ? (
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