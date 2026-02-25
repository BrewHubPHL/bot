"use client";
/**
 * Outbound Fulfillment Dashboard — Merch Shipping Orders
 *
 * Protected manager page for viewing and managing merch orders with
 * fulfillment_type = 'shipping'. Staff can mark orders as shipped,
 * review shipping addresses, and view order history.
 *
 * Lives at /manager/fulfillment and inherits the (ops) layout + OpsGate.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  User,
  Mail,
  RefreshCw,
  History,
  PackageCheck,
  AlertTriangle,
  ChevronLeft,
  Loader2,
  XCircle,
} from "lucide-react";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import { supabase } from "@/lib/supabase";

/* ── Types ─────────────────────────────────────────────────── */
interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  price_cents: number;
}

interface FulfillmentOrder {
  id: string;
  customer_name: string;
  customer_email: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  updated_at: string | null;
  total_amount_cents: number;
  shipping_address: ShippingAddress | null;
  items: OrderItem[];
}

type ViewTab = "pending" | "history";

/* ── Helpers ───────────────────────────────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch {
    return null;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortId(uuid: string): string {
  return `SHP-${uuid.slice(-4).toUpperCase()}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const POLL_MS = 30_000; // fallback poll interval (visibility change only)

/* ── Toast type ────────────────────────────────────────── */
interface Toast {
  id: number;
  message: string;
  type: "error" | "success";
}

/* ═══════════════════════════════════════════════════════════
   FULFILLMENT DASHBOARD
   ═══════════════════════════════════════════════════════════ */
export default function FulfillmentDashboard() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("pending");
  const [shippingIds, setShippingIds] = useState<Set<string>>(new Set());
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  /* ── Fetch orders ──────────────────────────────────────── */
  const fetchOrders = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      setError(null);
      setAuthzState(null);

      const token = getAccessToken();
      try {
        const qs = activeTab === "history" ? "?include_shipped=true" : "";
        const res = await fetch(`${API_BASE}/get-fulfillment-orders${qs}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          const info = await getErrorInfoFromResponse(res, "Failed to load fulfillment orders");
          if (info.authz) {
            setAuthzState(info.authz);
          } else {
            setError(info.message);
          }
          return;
        }

        const json = await res.json();
        setOrders(json.orders || []);
        setLastFetch(new Date());
      } catch (err) {
        setError(toUserSafeMessageFromUnknown(err, "Network error"));
      } finally {
        setLoading(false);
      }
    },
    [activeTab],
  );

  /* ── Helper: show a toast ───────────────────────────── */
  const showToast = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  /* ── Initial fetch + Supabase Realtime ─────────────── */
  useEffect(() => {
    fetchOrders(true);

    // Subscribe to real-time changes on merch orders
    const channel = supabase
      .channel('custom-fulfillment-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: 'type=eq.merch',
        },
        () => {
          // Re-fetch the full list to stay in sync
          fetchOrders(false);
        },
      )
      .subscribe();

    // Fallback: refresh on visibility change (tab re-focus)
    const handleVis = () => {
      if (document.visibilityState === "visible") {
        fetchOrders(false);
      }
    };
    document.addEventListener("visibilitychange", handleVis);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, [fetchOrders]);

  /* ── Mark as Shipped ───────────────────────────────────── */
  const markAsShipped = async (orderId: string) => {
    const token = getAccessToken();
    if (!token) {
      setError("Session expired — please re-authenticate.");
      return;
    }

    // Optimistic removal from pending list
    setShippingIds((prev) => new Set([...prev, orderId]));
    setOrders((prev) => prev.filter((o) => o.id !== orderId));

    try {
      const res = await fetch(`${API_BASE}/update-order-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId, status: "shipped" }),
      });

      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Failed to mark order as shipped");
        if (info.authz) {
          setAuthzState(info.authz);
        } else {
          showToast(info.message);
        }
        // Revert optimistic removal
        await fetchOrders(false);
      }
    } catch (err) {
      showToast(toUserSafeMessageFromUnknown(err, "Network error — ship action rolled back"));
      // Revert optimistic removal
      await fetchOrders(false);
    } finally {
      setShippingIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  /* ── Authz error handler ───────────────────────────────── */
  const handleAuthzAction = () => {
    // Clear session and reload to trigger PIN re-entry
    sessionStorage.removeItem("ops_session");
    window.location.reload();
  };

  /* ── Derived data ──────────────────────────────────────── */
  const pendingOrders = orders.filter((o) => o.status === "paid" || o.status === "pending");
  const shippedOrders = orders.filter((o) => o.status === "shipped");
  const displayOrders = activeTab === "pending" ? pendingOrders : shippedOrders;

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* ── Header ───────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-stone-950/90 backdrop-blur-md border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a
                href="/manager"
                className="p-2 -ml-2 rounded-lg text-stone-400 hover:text-amber-400 hover:bg-stone-800/50 transition-colors"
                aria-label="Back to Manager Dashboard"
              >
                <ChevronLeft size={20} />
              </a>
              <div>
                <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                  <Truck size={20} className="text-amber-400" />
                  Outbound Fulfillment
                </h1>
                <p className="text-stone-400 text-xs tracking-wider uppercase">
                  Merch Shipping Queue
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastFetch && (
                <span className="text-xs text-stone-500 hidden sm:block">
                  Updated {timeAgo(lastFetch.toISOString())}
                </span>
              )}
              <button
                onClick={() => fetchOrders(true)}
                className="p-2 rounded-lg text-stone-400 hover:text-amber-400 hover:bg-stone-800/50 transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* ── Tab toggle ─────────────────────────────────── */}
          <div className="flex gap-1 mt-3">
            <button
              onClick={() => setActiveTab("pending")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === "pending"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/50"
              }`}
            >
              <Package size={15} />
              To Pack
              {pendingOrders.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-300 font-bold tabular-nums">
                  {pendingOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === "history"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/50"
              }`}
            >
              <History size={15} />
              History
              {shippedOrders.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-stone-700 text-stone-300 font-bold tabular-nums">
                  {shippedOrders.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── Toast notifications ─────────────────────────── */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in-up ${
                t.type === "error"
                  ? "bg-red-600 text-white"
                  : "bg-emerald-600 text-white"
              }`}
            >
              {t.type === "error" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Main content ─────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-28 md:pb-8">
        {/* Authz error */}
        {authzState && (
          <div className="flex justify-center py-12">
            <AuthzErrorStateCard
              state={authzState}
              onAction={handleAuthzAction}
              className="max-w-md w-full"
            />
          </div>
        )}

        {/* Loading state */}
        {loading && !authzState && orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 size={32} className="animate-spin text-amber-400" />
            <p className="text-stone-400 text-sm">Loading shipping orders&hellip;</p>
          </div>
        )}

        {/* Error state */}
        {error && !authzState && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="rounded-xl border border-red-500/30 bg-red-950/25 px-5 py-4 max-w-md w-full text-center">
              <AlertTriangle size={24} className="mx-auto mb-2 text-red-400" />
              <p className="text-red-300 text-sm">{error}</p>
              <button
                onClick={() => fetchOrders(true)}
                className="mt-3 px-4 py-2 text-xs font-medium rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !authzState && displayOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <PackageCheck size={48} className="text-emerald-400/60" />
            <h2 className="text-lg font-semibold text-stone-300">
              {activeTab === "pending"
                ? "No pending shipments!"
                : "No shipping history yet"}
            </h2>
            <p className="text-stone-500 text-sm max-w-xs">
              {activeTab === "pending"
                ? "All merch orders have been shipped. New orders will appear here automatically."
                : "Shipped orders will appear here once you start fulfilling."}
            </p>
          </div>
        )}

        {/* Order grid */}
        {!authzState && displayOrders.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onMarkShipped={markAsShipped}
                isShipping={shippingIds.has(order.id)}
                isPending={activeTab === "pending"}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ORDER CARD
   ═══════════════════════════════════════════════════════════ */
interface OrderCardProps {
  order: FulfillmentOrder;
  onMarkShipped: (id: string) => void;
  isShipping: boolean;
  isPending: boolean;
}

function OrderCard({ order, onMarkShipped, isShipping, isPending }: OrderCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const addr = order.shipping_address;

  return (
    <div
      className={`rounded-xl border bg-stone-900 overflow-hidden transition-all ${
        isPending
          ? "border-stone-700/60 hover:border-amber-500/40"
          : "border-stone-800/40 opacity-80"
      }`}
    >
      {/* Card header */}
      <div className="px-4 py-3 border-b border-stone-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
            {shortId(order.id)}
          </span>
          <StatusBadge status={order.status} />
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-stone-200">
            {formatCents(order.total_amount_cents)}
          </span>
          <p className="text-[10px] text-stone-500">
            {timeAgo(order.created_at)}
          </p>
        </div>
      </div>

      {/* Customer info */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <User size={14} className="text-stone-500 shrink-0" />
          <span className="font-medium text-stone-200 truncate">
            {order.customer_name}
          </span>
        </div>
        {order.customer_email && (
          <div className="flex items-center gap-2 text-xs">
            <Mail size={13} className="text-stone-500 shrink-0" />
            <span className="text-stone-400 truncate">{order.customer_email}</span>
          </div>
        )}
      </div>

      {/* Shipping address */}
      {addr && (
        <div className="px-4 py-3 border-t border-stone-800/40">
          <div className="flex items-start gap-2">
            <MapPin size={14} className="text-amber-400/70 shrink-0 mt-0.5" />
            <div className="text-xs text-stone-300 leading-relaxed">
              <p>{addr.line1}</p>
              {addr.line2 && <p>{addr.line2}</p>}
              <p>
                {addr.city}, {addr.state} {addr.zip}
              </p>
              {addr.phone && (
                <div className="flex items-center gap-1 mt-1 text-stone-400">
                  <Phone size={11} className="shrink-0" />
                  <span>{addr.phone}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Items list */}
      {order.items.length > 0 && (
        <div className="px-4 py-3 border-t border-stone-800/40">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1.5">
            Items
          </p>
          <ul className="space-y-1">
            {order.items.map((item, i) => (
              <li
                key={`${order.id}-item-${i}`}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-stone-300 truncate mr-2">
                  {item.quantity > 1 && (
                    <span className="font-bold text-amber-400 mr-1">
                      {item.quantity}×
                    </span>
                  )}
                  {item.name}
                </span>
                <span className="text-stone-500 tabular-nums shrink-0">
                  {formatCents(item.price_cents * item.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action button — only for pending orders */}
      {isPending && (
        <div className="px-4 py-3 border-t border-stone-800/40">
          {!confirmOpen ? (
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={isShipping}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg
                         bg-emerald-600/90 hover:bg-emerald-500 text-white transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              {isShipping ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Truck size={16} />
              )}
              Mark as Shipped
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-stone-400 text-center">
                Confirm this order has been packed &amp; shipped?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmOpen(false);
                    onMarkShipped(order.id);
                  }}
                  disabled={isShipping}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg
                             bg-emerald-600 hover:bg-emerald-500 text-white transition-colors
                             disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  Confirm Ship
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shipped indicator for history view */}
      {!isPending && order.status === "shipped" && (
        <div className="px-4 py-2.5 border-t border-stone-800/40 flex items-center gap-2 justify-center">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">
            Shipped
            {order.updated_at && (
              <span className="text-stone-500 ml-1">
                {timeAgo(order.updated_at)}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    paid: {
      bg: "bg-sky-500/15",
      text: "text-sky-400",
      icon: <Clock size={11} />,
    },
    pending: {
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      icon: <Clock size={11} />,
    },
    shipped: {
      bg: "bg-emerald-500/15",
      text: "text-emerald-400",
      icon: <CheckCircle2 size={11} />,
    },
  };

  const c = cfg[status] || {
    bg: "bg-stone-700/30",
    text: "text-stone-400",
    icon: null,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.text}`}
    >
      {c.icon}
      {status}
    </span>
  );
}
