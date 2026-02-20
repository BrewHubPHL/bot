"use client";
import React, { useEffect, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

export default function StatsGrid() {
  const token = useOpsSessionOptional()?.token;
  const [revenue, setRevenue] = useState<number>(0);
  const [orders, setOrders] = useState<number>(0);
  const [staffCount, setStaffCount] = useState<number>(0);
  const [labor, setLabor] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    async function fetchStats() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/get-manager-stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Stats fetch failed");
        const data = await res.json();
        setRevenue(data.revenue ?? 0);
        setOrders(data.orders ?? 0);
        setStaffCount(data.staffCount ?? 0);
        setLabor(data.labor ?? 0);
      } catch (err) {
        console.error("Stats fetch failed:", err);
      }
      setLoading(false);
    }
    fetchStats();
  }, [token]);

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
