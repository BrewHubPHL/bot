"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function KdsSection() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchKdsOrders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("id, customer_name, status, created_at, coffee_orders(drink_name)")
      .in("status", ["paid", "preparing", "ready"])
      .order("created_at", { ascending: true });
    if (!error && data) setOrders(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchKdsOrders();
  }, []);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">☕ Active Orders (KDS)</h2>
        <button className="text-gray-400 border border-[#333] px-3 py-1 rounded hover:bg-[#222]" onClick={fetchKdsOrders}>↻ Refresh</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="bg-[#1a1a1a] rounded-lg p-4 border border-[#333] text-gray-500">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="bg-[#1a1a1a] rounded-lg p-4 border border-[#333] text-gray-500">No active orders ✓</div>
        ) : (
          orders.map((order) => {
            const items = order.coffee_orders || [];
            const created = new Date(order.created_at);
            const timeAgo = Math.floor((Date.now() - created.getTime()) / 60000);
            return (
              <div key={order.id} className={`bg-[#1a1a1a] rounded-lg border border-[#333] overflow-hidden`}>
                <div className="flex items-center justify-between px-4 py-2 bg-[#222]">
                  <strong>{order.customer_name || 'Guest'}</strong>
                  <span className="text-xs text-gray-400">{timeAgo}m ago</span>
                </div>
                <div className="px-4 py-2">
                  {items.length > 0 ? (
                    items.map((i: any, idx: number) => (
                      <div key={idx} className="text-sm py-1 border-b border-[#2a2a2a] last:border-b-0">☕ {i.drink_name}</div>
                    ))
                  ) : (
                    <div className="text-xs text-gray-500">No items</div>
                  )}
                </div>
                <div className="px-4 py-2 bg-[#1a1a1a] flex gap-2">
                  {/* TODO: Add status update buttons */}
                  <button className="flex-1 py-1 rounded bg-[#333] text-xs text-white" disabled>Update</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
