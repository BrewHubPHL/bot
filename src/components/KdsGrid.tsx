"use client";

/**
 * KdsGrid — shared Kitchen Display System grid
 *
 * Owns all data-fetching, realtime, optimistic updates, offline cache,
 * urgency rings, haptic feedback, and toast notifications.
 *
 * Consumed by two surfaces:
 *   - (ops)/kds/page.tsx          → full-screen barista KDS
 *   - (site)/components/manager/KdsSection.tsx → embedded manager dashboard section
 *
 * The parent is responsible for its own chrome (header, back button, etc.)
 * and can subscribe to state changes via `onStateChange`.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { saveKDSSnapshot, getKDSSnapshot } from "@/lib/offlineStore";
import { KdsOrderCard } from "@/components/KdsOrderCard";
import type { KdsOrder } from "@/components/KdsOrderCard";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

/** Raw shape returned by get-kds-orders */
export interface APIOrder {
  id: string;
  status: string;
  first_name: string | null;
  created_at: string;
  is_guest_order?: boolean;
  total_amount_cents?: number;
  claimed_by?: string | null;
  coffee_orders?: {
    id: string;
    drink_name: string;
    customizations?: string;
    price?: number | null;
    completed_at?: string | null;
    completed_by?: string | null;
  }[];
}

export interface KdsGridState {
  orders: KdsOrder[];
  source: "live" | "cached";
  error: string | null;
}

export interface KdsGridProps {
  /** Authorization token — from useOpsSession or useOpsSessionOptional */
  token: string | null;
  /**
   * Called whenever orders, source, or error changes.
   * Lets parent pages update their own chrome (header count, error banner, etc.)
   */
  onStateChange?: (state: KdsGridState) => void;
  /**
   * If provided, KdsGrid populates this ref with the fetchOrders function so
   * parent can trigger a manual refresh (e.g. a "↻ Refresh" button).
   */
  fetchRef?: React.MutableRefObject<(() => void) | null>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch { return null; }
}

function haptic(pattern: "tap" | "success" | "error") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const p: Record<string, number | number[]> = {
    tap: 15, success: [15, 80, 15], error: [50, 30, 50, 30, 50],
  };
  try { navigator.vibrate(p[pattern]); } catch { /* silent */ }
}

/** Normalize status string to lowercase */
function ns(status: string | null | undefined): string {
  return (status || "").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Status workflow                                                      */
/* ------------------------------------------------------------------ */

const STATUS_FLOW: Record<string, string> = {
  unpaid:    "preparing",
  pending:   "preparing",
  paid:      "preparing",
  preparing: "ready",
  ready:     "completed",
};

const BUTTON_LABEL: Record<string, string> = {
  unpaid:    "Prepare (Collect on Pickup)",
  pending:   "Start Preparing",
  paid:      "Start Preparing",
  preparing: "Mark Ready",
  ready:     "Complete / Picked Up",
};

/** Status-coloured top-border Tailwind classes, passed as `className` to KdsOrderCard */
const STATUS_BORDER_TOP: Record<string, string> = {
  unpaid:    "border-t-8 border-t-orange-500",
  pending:   "border-t-8 border-t-rose-500",
  paid:      "border-t-8 border-t-emerald-500",
  preparing: "border-t-8 border-t-amber-400",
  ready:     "border-t-8 border-t-sky-400",
  cancelled: "border-t-8 border-t-stone-600",
};

function mapOrder(o: APIOrder): KdsOrder {
  return {
    id: o.id,
    status: o.status,
    customer_name: o.first_name ?? null,
    created_at: o.created_at,
    is_guest_order: o.is_guest_order ?? false,
    total_amount_cents: o.total_amount_cents ?? 0,
    claimed_by: o.claimed_by ?? null,
    items: (o.coffee_orders || []).map((ci) => ({
      id: ci.id,
      name: ci.drink_name,
      quantity: 1,
      completed_at: ci.completed_at ?? null,
      completed_by: ci.completed_by ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export function KdsGrid({ token, onStateChange, fetchRef }: KdsGridProps) {
  const [orders, setOrders]       = useState<KdsOrder[]>([]);
  const [kdsSource, setKdsSource] = useState<"live" | "cached">("live");
  const [updating, setUpdating]   = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  const fetchingRef  = useRef(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ordersRef    = useRef(orders);
  ordersRef.current  = orders;

  // Bubble state up to parent whenever any of the three values change
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.({ orders, source: kdsSource, error });
  }, [orders, kdsSource, error]);

  /* ── Toast ──────────────────────────────────────────────────── */
  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, []);

  /* ── Fetch orders ───────────────────────────────────────────── */
  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const t = token ?? getAccessToken();
      if (!t) { console.warn("KdsGrid: No auth token"); return; }
      const res = await fetch(`${API_BASE}/get-kds-orders`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Failed to load orders");
        setAuthzState(info.authz);
        setError(info.message);
        if (info.authz) setOrders([]);
        return;
      }
      const { orders: data } = await res.json() as { orders: APIOrder[] };
      const live = (data || []).map(mapOrder);
      setOrders(live);
      setKdsSource("live");
      setAuthzState(null);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      saveKDSSnapshot(live as any).catch(() => {});
    } catch (err) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to load active orders right now.");
      console.error("KdsGrid: Fetch error");
      setError(msg);
      // Fall back to IndexedDB cache if we have no live orders
      if (ordersRef.current.length === 0) {
        try {
          const cached = await getKDSSnapshot();
          if (cached.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setOrders(cached.map((c: any) => ({
              id: c.id,
              status: c.status,
              customer_name: c.first_name ?? c.customer_name ?? null,
              created_at: c.created_at,
              is_guest_order: c.is_guest_order ?? false,
              total_amount_cents: c.total_amount_cents ?? 0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              items: (c.items || c.coffee_orders || []).map((ci: any) => ({
                name: ci.name || ci.drink_name,
                quantity: ci.quantity ?? 1,
              })),
            })));
            setKdsSource("cached");
          }
        } catch { /* IDB unavailable */ }
      }
    } finally {
      fetchingRef.current = false;
    }
  }, [token]);

  // Expose fetchOrders to parent via ref (for manual refresh buttons)
  useEffect(() => {
    if (fetchRef) fetchRef.current = fetchOrders;
  }, [fetchRef, fetchOrders]);

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchOrders, 500);
  }, [fetchOrders]);

  /* ── Initial fetch + Realtime ───────────────────────────────── */
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 8));
  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel(`kds-grid-realtime-${channelIdRef.current}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" },       () => debouncedFetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "coffee_orders" }, () => debouncedFetch())
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, debouncedFetch]);

  /* ── Urgency ring: >10m = pulsing red, >5m = amber ─────────── */
  function urgencyRing(createdAt: string, status: string): string {
    const s = ns(status);
    if (s === "ready" || s === "completed" || s === "cancelled") return "";
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return "";
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins >= 10) return "ring-2 ring-red-500/60 animate-pulse";
    if (mins >= 5)  return "ring-2 ring-amber-500/40";
    return "";
  }

  /* ── Optimistic status update with rollback ─────────────────── */
  async function updateStatus(id: string, nextStatus: string) {
    setUpdating(id);
    setError(null);

    const snapshot = orders.map((o) => ({ ...o }));
    const orderName = orders.find((o) => o.id === id)?.customer_name || "Order";

    const isTerminal = nextStatus === "completed" || nextStatus === "cancelled";
    if (isTerminal) {
      setExitingIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setOrders((prev) => prev.filter((o) => o.id !== id));
        setExitingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 350);
    } else {
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: nextStatus } : o)),
      );
    }

    try {
      const t = token ?? getAccessToken();
      if (!t) throw new Error("No PIN session");
      const res = await fetch(`${API_BASE}/update-order-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId: id, status: nextStatus }),
      });
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Status update failed");
        if (info.authz) setAuthzState(info.authz);
        throw new Error(info.message);
      }
      setAuthzState(null);
      haptic("success");
      if (nextStatus === "cancelled") showToast(`${orderName} cancelled`, "success");
    } catch (err: unknown) {
      // Rollback
      setOrders(snapshot);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const msg = toUserSafeMessageFromUnknown(err, "Unable to update this order right now.");
      console.error("KdsGrid: Update error");
      setError(msg);
      showToast(msg, "error");
      haptic("error");
      setTimeout(() => setError(null), 5000);
    } finally {
      setUpdating(null);
    }
  }

  /* ── Item toggle handler (passed to KdsOrderCard) ────────── */
  const handleItemToggle = useCallback(async (itemId: string) => {
    try {
      const t = token ?? getAccessToken();
      if (!t) throw new Error("No PIN session");
      const res = await fetch(`${API_BASE}/update-item-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Item update failed");
        throw new Error(info.message);
      }
      haptic("tap");
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to update item.");
      showToast(msg, "error");
      haptic("error");
    }
  }, [token, showToast]);

  /* ── Render ─────────────────────────────────────────────────── */
  if (authzState) {
    return (
      <AuthzErrorStateCard
        state={authzState}
        onAction={() => {
          if (authzState.status === 401) {
            sessionStorage.removeItem("ops_session");
            window.location.reload();
            return;
          }
          window.location.href = "/staff-hub";
        }}
      />
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center mt-20 gap-4">
        <span className="text-6xl opacity-20">☕</span>
        <p className="text-stone-600 text-center text-lg font-mono">No active orders</p>
        <p className="text-stone-700 text-center text-xs font-mono">
          New orders will appear automatically
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8"
        aria-live="polite"
        aria-label="Active orders"
      >
        {orders.map((order) => {
          const status       = ns(order.status);
          const nextStatus   = STATUS_FLOW[status];
          const isExiting    = exitingIds.has(order.id);
          const borderTop    = STATUS_BORDER_TOP[status] || "border-t-8 border-t-stone-600";
          const isAwaitingPayment = status === "unpaid" || status === "pending";

          return (
            <KdsOrderCard
              key={order.id}
              order={order}
              createdAt={new Date(order.created_at)}
              isExiting={isExiting}
              isAwaitingPayment={isAwaitingPayment}
              urgencyRing={urgencyRing(order.created_at, status)}
              className={borderTop}
              onItemToggle={handleItemToggle}
              actionSlot={
                <div
                  className="space-y-2"
                  role="group"
                  aria-label={`Actions for ${order.customer_name || "Guest"}`}
                >
                  {nextStatus && (
                    <button
                      disabled={updating === order.id || isExiting}
                      onClick={() => updateStatus(order.id, nextStatus)}
                      className="w-full min-h-[48px] py-3 text-xs font-bold tracking-[0.3em] uppercase bg-stone-100 text-stone-900 hover:bg-white active:bg-stone-200 transition-colors disabled:opacity-50 disabled:cursor-wait rounded-lg"
                    >
                      {updating === order.id ? "Updating…" : BUTTON_LABEL[status] || "Next"}
                    </button>
                  )}
                  {status !== "cancelled" && (
                    <button
                      disabled={updating === order.id || isExiting}
                      onClick={() => updateStatus(order.id, "cancelled")}
                      className="w-full min-h-[44px] py-2.5 text-xs font-bold tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-950/50 active:bg-red-950/70 transition-colors rounded-lg disabled:opacity-50"
                    >
                      Cancel Order
                    </button>
                  )}
                </div>
              }
            />
          );
        })}
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={[
            "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-semibold transition-all duration-300",
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
          ].join(" ")}
        >
          {toast.type === "success" ? "✓" : "✗"} {toast.msg}
        </div>
      )}
    </>
  );
}
