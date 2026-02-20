"use client";

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Barcode, Package, Save, Trash2 } from 'lucide-react';

export default function InventoryScanner() {
  const [item, setItem] = useState<any>(null);
  const [pendingStock, setPendingStock] = useState(0);
  const [status, setStatus] = useState("Open the Scanner page to scan items");

  /* Hardware scanner support removed — use /scanner camera page (Feb 2026) */

  async function lookupBarcode(barcode: string) {
    setStatus(`Looking up ${barcode}...`);
    const { data } = await supabase.from('inventory').select('*').eq('barcode', barcode).maybeSingle();
    
    if (data) {
      setItem(data);
      setPendingStock(data.current_stock);
      setStatus("Adjust stock and save.");
    } else {
      setStatus(`Barcode ${barcode} not found in database.`);
    }
  }

  async function handleSave() {
    const delta = pendingStock - item.current_stock;
    const { data: { session } } = await supabase.auth.getSession();

    const resp = await fetch('/.netlify/functions/adjust-inventory', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({ itemId: item.id, delta })
    });

    if (resp.ok) {
      setStatus(`✅ Saved ${item.item_name}`);
      setItem(null);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 pt-32 px-6 flex flex-col items-center">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Package size={48} className="mx-auto mb-4 text-stone-300" />
          <h1 className="font-playfair text-3xl mb-2 text-stone-900">Inventory Hub</h1>
          <p className="text-stone-400 text-xs uppercase tracking-widest">{status}</p>
        </div>

        {item && (
          <div className="bg-white border border-stone-200 p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-playfair text-2xl mb-1 text-stone-900">{item.item_name}</h2>
            <p className="font-mono text-[10px] text-stone-400 uppercase mb-8 flex items-center gap-2">
              <Barcode size={12} /> {item.barcode}
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
              <button onClick={handleSave} className="flex-grow flex items-center justify-center gap-2 bg-emerald-600 text-white py-4 font-bold text-[10px] uppercase tracking-widest">
                <Save size={14} /> Save Stock
              </button>
              <button onClick={() => setItem(null)} className="px-6 border border-stone-200 text-stone-400 hover:text-red-500">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}