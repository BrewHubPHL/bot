"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function RecentActivity() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      setLoading(true);
      // Show recent orders and inventory changes (last 10)
      const { data: orders } = await supabase
        .from("orders")
        .select("id, customer_name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      const { data: inventory } = await supabase
        .from("inventory")
        .select("id, item_name, current_stock, updated_at")
        .order("updated_at", { ascending: false })
        .limit(5);
      const orderEvents = (orders || []).map((o: any) => ({
        type: "order",
        id: o.id,
        label: `Order: ${o.customer_name || 'Guest'} (${o.status})`,
        time: o.created_at,
      }));
      const inventoryEvents = (inventory || []).map((i: any) => ({
        type: "inventory",
        id: i.id,
        label: `Inventory: ${i.item_name} (${i.current_stock})`,
        time: i.updated_at,
      }));
      const all = [...orderEvents, ...inventoryEvents].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);
      setEvents(all);
      setLoading(false);
    }
    fetchActivity();
  }, []);

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
