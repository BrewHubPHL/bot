"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export default function KDS() {
  const [orders, setOrders] = useState<any[]>([]);
  const [clock, setClock] = useState<string>("");
  const fetchingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, coffee_orders!order_id (*)')
        .in('status', ['pending', 'unpaid', 'paid', 'preparing', 'ready'])
        .order('created_at', { ascending: true });
      setOrders(data || []);
    } catch (err) {
      console.error("KDS: Fetch Error:", err);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchOrders, 500);
  }, [fetchOrders]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const t = setInterval(tick, 1000);
    fetchOrders();
    const channel = supabase.channel('kds-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => debouncedFetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coffee_orders' }, () => debouncedFetch())
      .subscribe();
    return () => {
      clearInterval(t);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, debouncedFetch]);

  async function updateStatus(id: string, status: string) {
    await supabase.from('orders').update({ status }).eq('id', id);
  }

  return (
    <div className="min-h-screen bg-stone-950 p-10 text-white">
      <header className="flex justify-between items-end mb-12 border-b-2 border-stone-800 pb-8">
        <div>
          <h1 className="text-6xl font-black font-playfair tracking-tighter uppercase italic">BrewHub <span className="text-stone-500">KDS</span></h1>
          <p className="text-sm font-mono text-stone-600 mt-2">SYSTEM ONLINE // {clock || "—"}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {orders.map(order => (
          <div key={order.id} className={`bg-stone-900 border-t-8 rounded-sm flex flex-col h-full shadow-2xl ${order.status === 'paid' ? 'border-emerald-500' : 'border-amber-500'}`}>
            <div className="p-6 border-b border-stone-800">
              <h3 className="text-3xl font-playfair">{order.customer_name || 'Guest'}</h3>
              <p className="text-stone-500 font-mono text-xs mt-1 uppercase tracking-widest">{order.status}</p>
            </div>
            <div className="p-6 flex-grow space-y-4">
              {order.coffee_orders?.map((item: any) => (
                <div key={item.id} className="border-l-2 border-stone-700 pl-4">
                  <p className="text-xl font-bold">{item.drink_name}</p>
                  <p className="text-stone-400 text-sm italic">{item.customizations}</p>
                </div>
              ))}
            </div>
            <div className="p-4 bg-black/20">
              <button 
                onClick={() => updateStatus(order.id, order.status === 'paid' ? 'preparing' : 'ready')}
                className="w-full py-4 text-xs font-bold tracking-[0.3em] uppercase bg-stone-100 text-stone-900 hover:bg-white transition-colors"
              >
                {order.status === 'paid' ? 'Start Order' : 'Order Ready'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
