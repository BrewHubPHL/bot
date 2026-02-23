"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOpsSession } from '@/components/OpsGate';
import { useConnection } from '@/lib/useConnection';
import OfflineBanner from '@/components/OfflineBanner';
import { saveKDSSnapshot, getKDSSnapshot } from '@/lib/offlineStore';

/* ── Types ───────────────────────────────────────────────── */

interface CoffeeOrderItem {
  id: string;
  drink_name: string;
  customizations?: Record<string, string> | string | null;
  price?: number | null;
}

interface KDSOrder {
  id: string;
  status: string;
  customer_name: string | null;
  created_at: string;
  coffee_orders?: CoffeeOrderItem[];
}

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

/* ── Haptic helper ──────────────────────────────────────── */
function haptic(pattern: "tap" | "success" | "error") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const p: Record<string, number | number[]> = {
    tap: 15, success: [15, 80, 15], error: [50, 30, 50, 30, 50],
  };
  try { navigator.vibrate(p[pattern]); } catch { /* silent */ }
}

/* ── Status normalizer ────────────────────────────────────────── */
/** Normalize status from DB to lowercase — guards against mixed-case data */
function ns(status: string | null | undefined): string {
  return (status || '').toLowerCase();
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
  cancelled: 'border-stone-600',
};

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-rose-800 text-rose-200',
  paid:      'bg-emerald-800 text-emerald-200',
  preparing: 'bg-amber-800 text-amber-200',
  ready:     'bg-sky-800 text-sky-200',
  cancelled: 'bg-stone-700 text-stone-400',
};

export default function KDS() {
  const session = useOpsSession();
  const { isOnline, wasOffline, offlineSince } = useConnection();
  const [orders, setOrders] = useState<KDSOrder[]>([]);
  const [kdsSource, setKdsSource] = useState<"live" | "cached">("live");
  const [clock, setClock] = useState<string>("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const fetchingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // KDS-4: Track orders.length via ref to avoid stale closure in fetchOrders
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  // Track cards that are animating out (for CSS exit transition)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  /* ── Toast helper ────────────────────────────────────────── */
  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, []);

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
      const live = (data as KDSOrder[]) || [];
      setOrders(live);
      setKdsSource("live");
      // Cache to IndexedDB for offline display
      saveKDSSnapshot(live).catch(() => {});
    } catch (err) {
      console.error("KDS: Fetch Error:", err instanceof Error ? err.message : 'Unknown error');
      // If we have no orders yet, try loading from cache
      if (ordersRef.current.length === 0) {
        try {
          const cached = await getKDSSnapshot();
          if (cached.length > 0) {
            setOrders(cached as KDSOrder[]);
            setKdsSource("cached");
          }
        } catch { /* IDB fail */ }
      }
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

  /* ── Optimistic status update with rollback ───────────── */
  async function updateStatus(id: string, nextStatus: string) {
    setUpdating(id);
    setError(null);

    // Snapshot current state for rollback
    const snapshot = orders.map(o => ({ ...o }));
    const orderName = orders.find(o => o.id === id)?.customer_name || "Order";

    // Optimistic update: move card to new status or remove if terminal
    const isTerminal = nextStatus === "completed" || nextStatus === "cancelled";
    if (isTerminal) {
      // Animate exit, then remove after transition
      setExitingIds(prev => new Set(prev).add(id));
      // After animation, remove from DOM
      setTimeout(() => {
        setOrders(prev => prev.filter(o => o.id !== id));
        setExitingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 350);
    } else {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: nextStatus } : o));
    }

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

      haptic("success");
      if (nextStatus === "cancelled") {
        showToast(`${orderName} cancelled`, "success");
      }
    } catch (err: unknown) {
      // ── ROLLBACK: restore the snapshot ──
      setOrders(snapshot);
      setExitingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      const msg = err instanceof Error ? err.message : "Status update failed";
      console.error("KDS: Update Error:", msg);
      setError(`Update failed: ${msg}`);
      showToast(`Failed: ${msg}`, "error");
      haptic("error");
      setTimeout(() => setError(null), 5000);
    } finally {
      setUpdating(null);
    }
  }

  /* ── Elapsed time helper ──────────────────────────────────── */
  function elapsed(createdAt: string): string {
    if (!createdAt) return '';
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return '';
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'just now';
    return `${diff}m ago`;
  }

  /* ── Urgency helper: orders waiting too long get highlighted ── */
  function urgencyClass(createdAt: string, status: string): string {
    const s = ns(status);
    if (s === "ready" || s === "completed" || s === "cancelled") return "";
    if (!createdAt) return "";
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return "";
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins >= 10) return "ring-2 ring-red-500/60 animate-pulse";
    if (mins >= 5) return "ring-2 ring-amber-500/40";
    return "";
  }

  return (
    <main className="min-h-screen bg-stone-950 p-6 md:p-10 text-white" aria-label="Kitchen Display System">
      {/* Offline Banner */}
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} offlineSince={offlineSince} />

      <header className="flex flex-wrap justify-between items-end mb-8 md:mb-12 border-b-2 border-stone-800 pb-6 md:pb-8 gap-4">
        <div>
          <h1 className="text-4xl md:text-6xl font-black font-playfair tracking-tighter uppercase italic">BrewHub <span className="text-stone-500">KDS</span></h1>
          <p className="text-sm font-mono text-stone-600 mt-2">
            {isOnline ? 'SYSTEM ONLINE' : '⚠ OFFLINE — SHOWING LAST KNOWN ORDERS'}
            {kdsSource === 'cached' && isOnline ? ' (cached)' : ''}
            {' // '}{clock || '—'} // {orders.length} active
          </p>
        </div>
        {error && (
          <p role="alert" className="text-red-400 font-mono text-sm bg-red-950 px-4 py-2 rounded">{error}</p>
        )}
      </header>

      {orders.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-20 gap-4">
          <span className="text-6xl opacity-20">☕</span>
          <p className="text-stone-600 text-center text-lg font-mono">No active orders</p>
          <p className="text-stone-700 text-center text-xs font-mono">New orders will appear automatically</p>
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8"
        aria-live="polite"
        aria-label="Active orders"
      >
        {orders.map(order => {
          const status = ns(order.status);
          const nextStatus = STATUS_FLOW[status];
          const items = order.coffee_orders || [];
          const isExiting = exitingIds.has(order.id);

          return (
            <div
              key={order.id}
              role="article"
              aria-label={`Order for ${order.customer_name || 'Guest'}, status ${status}`}
              className={[
                "bg-stone-900 border-t-8 rounded-sm flex flex-col h-full shadow-2xl transition-all duration-300",
                BORDER_COLOR[status] || "border-stone-600",
                urgencyClass(order.created_at, status),
                isExiting ? "opacity-0 scale-95 translate-y-4" : "opacity-100 scale-100 translate-y-0",
              ].join(" ")}
            >
              {/* Header */}
              <div className="p-4 md:p-6 border-b border-stone-800 flex justify-between items-start relative">
                {status === 'pending' && (
                  <span className="absolute top-3 right-3 w-3 h-3 rounded-full bg-rose-500 animate-ping" aria-hidden="true" />
                )}
                <div>
                  <h3 className="text-2xl md:text-3xl font-playfair">{order.customer_name || 'Guest'}</h3>
                  <p className="text-stone-500 font-mono text-xs mt-1">{elapsed(order.created_at)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest transition-colors duration-300 ${STATUS_BADGE[status] || 'bg-stone-700 text-stone-300'}`}>
                  {status}
                </span>
              </div>

              {/* Order items */}
              <div className="p-4 md:p-6 flex-grow space-y-3 md:space-y-4">
                {items.length === 0 && (
                  <p className="text-stone-600 italic text-sm">No items found</p>
                )}
                {items.map((item: CoffeeOrderItem) => (
                  <div key={item.id} className="border-l-2 border-stone-700 pl-4">
                    <p className="text-xl md:text-2xl font-bold tracking-wide">{item.drink_name}</p>
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

              {/* Action buttons — 48px min touch targets for iPad */}
              <div className="p-4 bg-black/20 space-y-2">
                {nextStatus && (
                  <button
                    disabled={updating === order.id || isExiting}
                    onClick={() => updateStatus(order.id, nextStatus)}
                    className="w-full min-h-[48px] py-4 text-xs font-bold tracking-[0.3em] uppercase bg-stone-100 text-stone-900 hover:bg-white active:bg-stone-200 transition-colors disabled:opacity-50 disabled:cursor-wait rounded-sm"
                  >
                    {updating === order.id ? 'Updating…' : BUTTON_LABEL[status] || 'Next'}
                  </button>
                )}
                {status !== 'cancelled' && (
                  <button
                    disabled={updating === order.id || isExiting}
                    onClick={() => updateStatus(order.id, 'cancelled')}
                    className="w-full min-h-[48px] py-3 text-xs font-bold tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-950/50 active:bg-red-950/70 transition-colors rounded disabled:opacity-50"
                  >
                    Cancel Order
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══════ Toast notification ═══════ */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={[
          "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-semibold transition-all animate-in slide-in-from-bottom duration-300",
          toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
        ].join(" ")}>
          {toast.type === "success" ? "✓" : "✗"} {toast.msg}
        </div>
      )}
    </main>
  );
}
