"use client";
import Link from "next/link";;
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ScanPage() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchInventory() {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.from("inventory").select("id, name, category, current, threshold, unit");
    if (!error && data) setInventory(data);
    else setError(error?.message || "Failed to load inventory.");
    setLoading(false);
  }

  async function adjustStock(id: string, delta: number) {
    const item = inventory.find(i => i.id === id);
    if (!item) return;
    setError("");
    try {
      const resp = await fetch("/.netlify/functions/adjust-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: id, delta, itemName: item.name })
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Failed to adjust inventory");
      fetchInventory();
    } catch (err: any) {
      setError(err.message || "Failed to adjust inventory");
    }
  }

  useEffect(() => {
    fetchInventory();
  }, []);

  return (
    <main className="max-w-lg mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <header className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-3 font-bold text-lg">
          <img src="/logo.png" alt="BrewHub PHL logo" className="h-9 w-9 rounded-full" />
          Inventory Scanner
        </div>
        <Link href="/" className="text-stone-500 hover:text-stone-900">Home</Link>
      </header>
      <h1 className="font-playfair text-2xl mb-4">Inventory Scanner</h1>
      <p className="mb-6 text-stone-600">Scan and manage inventory at BrewHub PHL.</p>
      <div className="mb-6">
        <h2 className="font-bold mb-2">Inventory</h2>
        {loading ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">Loading inventory...</div>
        ) : error ? (
          <div className="bg-red-100 text-red-800 p-4 rounded text-center">{error}</div>
        ) : inventory.length === 0 ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">No inventory items found.</div>
        ) : (
          <div className="grid gap-3">
            {inventory.map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded p-3">
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-xs text-stone-500">{item.category}</div>
                  <div className="text-xs text-stone-400">Stock: {item.current} {item.unit} (Threshold: {item.threshold})</div>
                </div>
                <div className="flex gap-2">
                  <button className="bg-[#333] text-white rounded px-2 py-1" onClick={() => adjustStock(item.id, -1)}>-</button>
                  <button className="bg-[#333] text-white rounded px-2 py-1" onClick={() => adjustStock(item.id, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
