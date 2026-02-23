"use client";
import React, { useEffect, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

export default function RecentActivity() {
  const token = useOpsSessionOptional()?.token;
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    async function fetchActivity() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/get-recent-activity`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Activity fetch failed");
        const data = await res.json();

        const orderEvents = (data.orders || []).map((o: any) => ({
          type: "order",
          id: o.id,
          label: `Order: ${o.customer_name || 'Guest'} (${o.status})`,
          time: o.created_at,
        }));
        const inventoryEvents = (data.inventory || []).map((i: any) => ({
          type: "inventory",
          id: i.id,
          label: `Inventory: ${i.item_name} (${i.current_stock})`,
          time: i.updated_at,
        }));
        const all = [...orderEvents, ...inventoryEvents]
          .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
          .slice(0, 10);
        setEvents(all);
      } catch (err) {
        console.error("Activity fetch failed:", (err as Error)?.message);
      }
      setLoading(false);
    }
    fetchActivity();
  }, [token]);

  return (
    <div className="bg-[#1a1a1a] rounded-lg p-6 border border-[#333] mb-8">
      <h3 className="font-semibold mb-3">⚡ Recent Activity</h3>
      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-gray-500 text-sm">No recent events.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e, idx) => (
            <li key={e.type + e.id + idx} className="text-sm text-gray-300">
              <span className="font-semibold">{e.type === 'order' ? '🧾' : '📦'}</span> {e.label}
              <span className="ml-2 text-xs text-gray-500">{new Date(e.time).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
