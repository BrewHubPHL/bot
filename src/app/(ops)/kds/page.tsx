"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOpsSession } from '@/components/OpsGate';

/* ── API helpers ─────────────────────────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token ?? null;
  } catch { return null; }
}

/* ── Status workflow ─────────────────────────────────────────── */
const STATUS_FLOW: Record<string, string> = {
  pending:   'preparing',
  paid:      'preparing',
  preparing: 'ready',
  ready:     'completed',
};

const BUTTON_LABEL: Record<string, string> = {
  pending:   'Start Preparing',
  paid:      'Start Preparing',
  preparing: 'Mark Ready',
  ready:     'Complete / Picked Up',
};

const BORDER_COLOR: Record<string, string> = {
  pending:   'border-rose-500',
  paid:      'border-emerald-500',
  preparing: 'border-amber-400',
  ready:     'border-sky-400',
};

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-rose-800 text-rose-200',
  paid:      'bg-emerald-800 text-emerald-200',
  preparing: 'bg-amber-800 text-amber-200',
  ready:     'bg-sky-800 text-sky-200',
};

export default function KDS() {
  const session = useOpsSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [clock, setClock] = useState<string>("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Fetch orders via authenticated server function ──────── */
  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const token = getAccessToken();
      if (!token) { console.warn("KDS: No PIN token"); return; }
      const res = await fetch(`${API_BASE}/get-kds-orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { orders: data } = await res.json();
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

  /* ── Status update via authenticated server function ───── */
  async function updateStatus(id: string, nextStatus: string) {
    setUpdating(id);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) throw new Error("No PIN session");

      const res = await fetch(`${API_BASE}/update-order-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId: id, status: nextStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Status update failed");
      }

      // Optimistic: remove completed orders from local state immediately
      if (nextStatus === 'completed') {
        setOrders(prev => prev.filter(o => o.id !== id));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Status update failed';
      console.error('KDS: Update Error:', msg);
      setError(`Update failed: ${msg}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setUpdating(null);
    }
  }

  /* ── Elapsed time helper ──────────────────────────────────── */
  function elapsed(createdAt: string): string {
    const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (diff < 1) return 'just now';
    return `${diff}m ago`;
  }

  return (
    <div className="min-h-screen bg-stone-950 p-10 text-white">
      <header className="flex justify-between items-end mb-12 border-b-2 border-stone-800 pb-8">
        <div>
          <h1 className="text-6xl font-black font-playfair tracking-tighter uppercase italic">BrewHub <span className="text-stone-500">KDS</span></h1>
          <p className="text-sm font-mono text-stone-600 mt-2">SYSTEM ONLINE // {clock || "—"}</p>
        </div>
        {error && (
          <p className="text-red-400 font-mono text-sm bg-red-950 px-4 py-2 rounded">{error}</p>
        )}
      </header>

      {orders.length === 0 && (
        <p className="text-stone-600 text-center text-lg font-mono mt-20">No active orders</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {orders.map(order => {
          const nextStatus = STATUS_FLOW[order.status];
          const items = order.coffee_orders || [];

          return (
            <div key={order.id} className={`bg-stone-900 border-t-8 rounded-sm flex flex-col h-full shadow-2xl ${BORDER_COLOR[order.status] || 'border-stone-600'}`}>
              {/* Header */}
              <div className="p-6 border-b border-stone-800 flex justify-between items-start">
                <div>
                  <h3 className="text-3xl font-playfair">{order.customer_name || 'Guest'}</h3>
                  <p className="text-stone-500 font-mono text-xs mt-1">{elapsed(order.created_at)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${STATUS_BADGE[order.status] || 'bg-stone-700 text-stone-300'}`}>
                  {order.status}
                </span>
              </div>

              {/* Order items */}
              <div className="p-6 flex-grow space-y-4">
                {items.length === 0 && (
                  <p className="text-stone-600 italic text-sm">No items found</p>
                )}
                {items.map((item: any) => (
                  <div key={item.id} className="border-l-2 border-stone-700 pl-4">
                    <p className="text-xl font-bold">{item.drink_name}</p>
                    {item.customizations && (
                      <p className="text-stone-400 text-sm italic">
                        {typeof item.customizations === 'object'
                          ? Object.entries(item.customizations).map(([k, v]) => `${k}: ${v}`).join(', ')
                          : String(item.customizations)}
                      </p>
                    )}
                    {item.price != null && (
                      <p className="text-stone-500 text-xs font-mono">${Number(item.price).toFixed(2)}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="p-4 bg-black/20 space-y-2">
                {nextStatus && (
                  <button
                    disabled={updating === order.id}
                    onClick={() => updateStatus(order.id, nextStatus)}
                    className="w-full py-4 text-xs font-bold tracking-[0.3em] uppercase bg-stone-100 text-stone-900 hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    {updating === order.id ? 'Updating…' : BUTTON_LABEL[order.status] || 'Next'}
                  </button>
                )}
                {order.status !== 'cancelled' && (
                  <button
                    disabled={updating === order.id}
                    onClick={() => updateStatus(order.id, 'cancelled')}
                    className="w-full py-2 text-xs font-bold tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-950/50 transition-colors rounded disabled:opacity-50"
                  >
                    Cancel Order
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
