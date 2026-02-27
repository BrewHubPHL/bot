"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOpsSession } from '@/components/OpsGate';
import { useConnection } from '@/lib/useConnection';
import OfflineBanner from '@/components/OfflineBanner';
import { KdsGrid } from '@/components/KdsGrid';
import type { KdsGridState } from '@/components/KdsGrid';

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch { return null; }
}

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Types ────────────────────────────────────────────────────────── */
interface HistoryOrder {
  id: string;
  first_name: string | null;
  status: string;
  updated_at: string;
  coffee_orders: { drink_name: string }[];
}

/* ─── Page ─────────────────────────────────────────────────────────── */
export default function KDS() {
  const session = useOpsSession();
  const { isOnline, wasOffline, offlineSince } = useConnection();

  const [clock, setClock]           = useState<string>("");
  const [ordersLen, setOrdersLen]   = useState(0);
  const [kdsSource, setKdsSource]   = useState<"live" | "cached">("live");
  const [error, setError]           = useState<string | null>(null);

  /* ── History / Undo state ─────────────────────────────────── */
  const [showHistory, setShowHistory]         = useState(false);
  const [recentHistory, setRecentHistory]     = useState<HistoryOrder[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [undoingId, setUndoingId]             = useState<string | null>(null);
  const undoLockRef = useRef(false);

  // Tick the clock every second
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  function handleStateChange({ orders, source, error: err }: KdsGridState) {
    setOrdersLen(orders.length);
    setKdsSource(source);
    setError(err);
  }

  /* ── Fetch recent history ─────────────────────────────────── */
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const t = getAccessToken();
      if (!t) throw new Error("No PIN session");
      const res = await fetch(`${API_BASE}/get-kds-orders?history=true`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error("Failed to fetch history");
      const { orders } = await res.json() as { orders: HistoryOrder[] };
      setRecentHistory(orders || []);
    } catch (err) {
      console.error("[KDS] History fetch error:", (err as Error)?.message);
      setRecentHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Fetch history when panel opens
  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  /* ── Undo: revert order to preparing ──────────────────────── */
  const handleUndo = useCallback(async (orderId: string) => {
    if (undoLockRef.current) return;
    undoLockRef.current = true;
    setUndoingId(orderId);
    try {
      const t = getAccessToken();
      if (!t) throw new Error("No PIN session");
      const res = await fetch(`${API_BASE}/update-order-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId, status: "preparing", completed_at: null, ready_at: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error || "Undo failed");
      }
      // Remove from history list, close panel
      setRecentHistory((prev) => prev.filter((o) => o.id !== orderId));
      setShowHistory(false);
    } catch (err) {
      console.error("[KDS] Undo error:", (err as Error)?.message);
      setError(`Undo failed: ${(err as Error)?.message || "Unknown error"}`);
    } finally {
      setUndoingId(null);
      undoLockRef.current = false;
    }
  }, []);

  /* ── Time helper ──────────────────────────────────────────── */
  function timeAgo(iso: string): string {
    const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (diff === 0) return "just now";
    return `${diff}m ago`;
  }

  return (
    <main className="min-h-screen bg-stone-950 p-6 md:p-10" aria-label="Kitchen Display System">
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} offlineSince={offlineSince} />

      <header className="flex flex-wrap justify-between items-end mb-8 md:mb-12 border-b-2 border-stone-800 pb-6 md:pb-8 gap-4">
        <div>
          <h1 className="text-4xl md:text-6xl font-black font-playfair tracking-tighter uppercase italic text-white">
            BrewHub <span className="text-stone-500">KDS</span>
          </h1>
          <p className="text-sm font-mono text-stone-600 mt-2">
            {isOnline ? 'SYSTEM ONLINE' : '\u26A0 OFFLINE \u2014 SHOWING LAST KNOWN ORDERS'}
            {kdsSource === 'cached' && isOnline ? ' (cached)' : ''}
            {' // '}{clock || '\u2014'} // {ordersLen} active
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* History toggle button */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm font-semibold transition-colors ${
              showHistory
                ? "bg-amber-600 text-white"
                : "bg-stone-800 text-stone-300 hover:bg-stone-700"
            }`}
            aria-label="Toggle order history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            History
          </button>

          {error && (
            <p role="alert" className="text-red-400 font-mono text-sm bg-red-950 px-4 py-2 rounded">
              {error}
            </p>
          )}
        </div>
      </header>

      {/* ── History slide-over panel ─────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-end" aria-label="Order history panel">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowHistory(false)}
          />

          {/* Panel */}
          <div className="relative w-full max-w-md bg-stone-900 border-l border-stone-700 shadow-2xl flex flex-col animate-in slide-in-from-right">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-700">
              <h2 className="text-lg font-bold text-white font-playfair tracking-tight uppercase">
                Recent Orders
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-stone-400 hover:text-white transition-colors p-1"
                aria-label="Close history"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {historyLoading ? (
                <p className="text-stone-500 font-mono text-sm text-center py-8">Loading&hellip;</p>
              ) : recentHistory.length === 0 ? (
                <p className="text-stone-500 font-mono text-sm text-center py-8">No recent orders in the last 30 minutes.</p>
              ) : (
                recentHistory.map((order) => (
                  <div
                    key={order.id}
                    className="bg-stone-800 rounded-lg p-4 border border-stone-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold truncate">
                          {order.first_name || "Guest"}
                        </p>
                        <p className="text-stone-400 text-xs font-mono mt-0.5">
                          {order.coffee_orders?.length || 0} item{order.coffee_orders?.length === 1 ? "" : "s"}
                          {" \u00B7 "}
                          <span className={order.status === "completed" ? "text-blue-400" : "text-green-400"}>
                            {order.status}
                          </span>
                          {" \u00B7 "}
                          {timeAgo(order.updated_at)}
                        </p>
                        {order.coffee_orders?.length > 0 && (
                          <p className="text-stone-500 text-xs mt-1 truncate">
                            {order.coffee_orders.map((ci) => ci.drink_name).join(", ")}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleUndo(order.id)}
                        disabled={undoingId === order.id}
                        className="shrink-0 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-colors"
                      >
                        {undoingId === order.id ? "\u2026" : "UNDO"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Panel footer */}
            <div className="px-5 py-3 border-t border-stone-700">
              <p className="text-stone-600 text-xs font-mono text-center">
                Undo returns order to PREPARING
              </p>
            </div>
          </div>
        </div>
      )}

      <KdsGrid token={getAccessToken()} staffId={session.staff.id} onStateChange={handleStateChange} />
    </main>
  );
}


