"use client";

import { useState, useEffect, useCallback } from 'react';
import { useOpsSession } from '@/components/OpsGate';
import { Barcode, Package, Save, Trash2, Search, RefreshCw, Loader2 } from 'lucide-react';

/* ─── Types ────────────────────────────────────────────── */
interface InventoryItem {
  id: string;
  item_name: string;
  category: string | null;
  current_stock: number;
  min_threshold: number;
  unit: string | null;
}

export default function InventoryScanner() {
  const { token } = useOpsSession();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [pendingStock, setPendingStock] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading inventory…");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  /* ─── Load inventory via authenticated Netlify function ─── */
  const loadInventory = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch('/.netlify/functions/get-inventory', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-BrewHub-Action': 'true' },
      });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const items: InventoryItem[] = Array.isArray(data) ? data : (data.inventory ?? []);
      setInventory(items);
      setStatus(items.length ? `${items.length} items loaded. Search or select below.` : "No inventory items found.");
    } catch {
      setStatus("Failed to load inventory.");
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  /* ─── Select item for adjustment ─── */
  function selectItem(inv: InventoryItem) {
    setItem(inv);
    setPendingStock(inv.current_stock);
    setSearch("");
    setStatus("Adjust stock and save.");
  }

  /* ─── Save adjustment via authenticated Netlify function ─── */
  async function handleSave() {
    if (!item) return;
    const delta = pendingStock - item.current_stock;
    if (delta === 0) { setStatus("No change to save."); return; }

    setSaving(true);
    setStatus("Saving…");

    try {
      const res = await fetch('/.netlify/functions/adjust-inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-BrewHub-Action': 'true',
        },
        body: JSON.stringify({ itemId: item.id, delta, itemName: item.item_name }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        setStatus(`Error: ${err.error || 'Save failed'}`);
        return;
      }

      setStatus(`✅ Saved ${item.item_name} (${delta > 0 ? '+' : ''}${delta})`);
      // Update local state to reflect the change without a full reload
      setInventory(prev => prev.map(i =>
        i.id === item.id ? { ...i, current_stock: Math.max(0, i.current_stock + delta) } : i
      ));
      setItem(null);
    } catch {
      setStatus("Connection error — try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ─── Filtered list ─── */
  const filtered = search.trim()
    ? inventory.filter(i =>
        i.item_name.toLowerCase().includes(search.toLowerCase()) ||
        (i.category?.toLowerCase().includes(search.toLowerCase()))
      )
    : inventory;

  return (
    <div className="min-h-screen bg-stone-50 pt-24 pb-12 px-6 flex flex-col items-center">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <Package size={48} className="mx-auto mb-4 text-stone-300" />
          <h1 className="font-playfair text-3xl mb-2 text-stone-900">Inventory Hub</h1>
          <p className="text-stone-400 text-xs uppercase tracking-widest">{status}</p>
        </div>

        {/* Adjustment Panel */}
        {item && (
          <div className="bg-white border border-stone-200 p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-playfair text-2xl mb-1 text-stone-900">{item.item_name}</h2>
            <p className="font-mono text-[10px] text-stone-400 uppercase mb-8 flex items-center gap-2">
              <Barcode size={12} /> {item.category || 'uncategorized'}
            </p>

            <div className="flex items-center justify-between mb-10">
              <button onClick={() => setPendingStock(Math.max(0, pendingStock - 1))} className="w-14 h-14 rounded-full border border-stone-200 text-2xl hover:bg-stone-50">-</button>
              <div className="text-center">
                <span className="text-6xl font-playfair font-bold">{pendingStock}</span>
                <p className="text-[10px] uppercase text-stone-400 tracking-widest mt-2">{item.unit || 'units'}</p>
              </div>
              <button onClick={() => setPendingStock(pendingStock + 1)} className="w-14 h-14 rounded-full bg-stone-900 text-white text-2xl hover:bg-stone-800">+</button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || pendingStock === item.current_stock}
                className="flex-grow flex items-center justify-center gap-2 bg-emerald-600 text-white py-4 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save Stock'}
              </button>
              <button onClick={() => { setItem(null); setStatus("Select an item."); }} className="px-6 border border-stone-200 text-stone-400 hover:text-red-500">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Search + item list */}
        {!item && (
          <>
            <div className="flex gap-2">
              <div className="flex-grow relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search items…"
                  className="w-full pl-9 pr-4 py-3 border border-stone-200 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </div>
              <button
                onClick={loadInventory}
                className="px-4 border border-stone-200 text-stone-400 hover:text-stone-900 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            {loadError && (
              <p className="text-center text-red-500 text-sm">Failed to load inventory. <button onClick={loadInventory} className="underline">Retry</button></p>
            )}

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
                  {filtered.map(inv => (
                    <tr
                      key={inv.id}
                      onClick={() => selectItem(inv)}
                      className="cursor-pointer hover:bg-stone-50 transition-colors border-b border-stone-100 last:border-0"
                    >
                      <td className="px-6 py-3 font-bold">{inv.item_name}</td>
                      <td className="px-6 py-3">{inv.current_stock} {inv.unit || ''}</td>
                      <td className="px-6 py-3">{inv.min_threshold}</td>
                      <td className="px-6 py-3">
                        {inv.current_stock <= inv.min_threshold
                          ? <span className="text-red-500 font-bold">Low</span>
                          : <span className="text-green-600">OK</span>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400 text-sm">No items found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}