"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function InventoryTable() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchInventory() {
    setLoading(true);
    const { data, error } = await supabase.from("inventory").select("id, name, category, current, threshold, unit");
    if (!error && data) setInventory(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchInventory();
  }, []);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">📦 Inventory Status</h2>
        <button className="text-gray-400 border border-[#333] px-3 py-1 rounded hover:bg-[#222]" onClick={fetchInventory}>↻ Refresh</button>
      </div>
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-[#333]">
        <div className="grid grid-cols-4 gap-2 px-6 py-3 text-xs text-gray-400 bg-[#222]">
          <span>Item</span>
          <span>Current Stock</span>
          <span>Threshold</span>
          <span>Adjust</span>
        </div>
        {loading ? (
          <div className="px-6 py-4 text-gray-500">Loading...</div>
        ) : inventory.length === 0 ? (
          <div className="px-6 py-4 text-gray-500">No inventory data.</div>
        ) : (
          inventory.map((item) => (
            <div key={item.id} className="grid grid-cols-4 gap-2 px-6 py-3 border-t border-[#222] items-center">
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="text-xs text-gray-500">{item.category}</div>
              </div>
              <div>{item.current} {item.unit}</div>
              <div>{item.threshold} {item.unit}</div>
              <div className="flex gap-2">
                {/* TODO: Add adjust stock buttons */}
                <button className="bg-[#333] text-white rounded px-2 py-1" disabled>-</button>
                <button className="bg-[#333] text-white rounded px-2 py-1" disabled>+</button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
