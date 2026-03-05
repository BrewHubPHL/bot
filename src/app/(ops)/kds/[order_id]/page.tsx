"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { ArrowLeft, Clock, Coffee, User ,CreditCard } from "lucide-react";

interface OrderItem {
  id: string;
  drink_name: string;
  customizations?: string;
  price?: number | null;
  completed_at?: string | null;
  completed_by?: string | null;
}

interface OrderDetail {
  id: string;
  first_name: string | null;
  status: string;
  created_at: string;
  is_guest_order?: boolean;
  total_amount_cents?: number;
  claimed_by?: string | null;
  coffee_orders: OrderItem[];
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const STATUS_COLORS: Record<string, string> = {
  unpaid: "text-amber-400 bg-amber-950/50",
  pending: "text-amber-400 bg-amber-950/50",
  paid: "text-blue-400 bg-blue-950/50",
  preparing: "text-yellow-400 bg-yellow-950/50",
  ready: "text-green-400 bg-green-950/50",
  completed: "text-stone-400 bg-stone-800",
  cancelled: "text-red-400 bg-red-950/50",
};

export default function KdsOrderDetail() {
  const { order_id } = useParams<{ order_id: string }>();
  const session = useOpsSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.token || !order_id) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetchOps("/get-kds-orders", {}, session.token!);
        if (!res.ok) throw new Error("Failed to fetch orders");
        const { orders } = (await res.json()) as { orders: OrderDetail[] };
        const match = orders.find((o) => o.id === order_id);
        if (!match) {
          // Also check history
          const histRes = await fetchOps("/get-kds-orders?history=true", {}, session.token!);
          if (histRes.ok) {
            const { orders: histOrders } = (await histRes.json()) as { orders: OrderDetail[] };
            const histMatch = histOrders.find((o) => o.id === order_id);
            if (histMatch && !cancelled) {
              setOrder(histMatch);
              setLoading(false);
              return;
            }
          }
          if (!cancelled) setError("Order not found");
        } else if (!cancelled) {
          setOrder(match);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [session.token, order_id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-950 p-6 md:p-10 flex items-center justify-center">
        <p className="text-stone-500 font-mono text-sm">Loading order…</p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="min-h-screen bg-stone-950 p-6 md:p-10">
        <Link href="/kds" className="inline-flex items-center gap-2 text-stone-400 hover:text-white transition-colors mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to KDS
        </Link>
        <p className="text-red-400 font-mono text-sm">{error || "Order not found"}</p>
      </main>
    );
  }

  const completedCount = order.coffee_orders.filter((i) => i.completed_at).length;
  const statusStyle = STATUS_COLORS[order.status] || "text-stone-400 bg-stone-800";

  return (
    <main className="min-h-screen bg-stone-950 p-6 md:p-10">
      <Link href="/kds" className="inline-flex items-center gap-2 text-stone-400 hover:text-white transition-colors mb-8">
        <ArrowLeft className="h-4 w-4" /> Back to KDS
      </Link>

      {/* Main card — viewTransitionName must match KdsOrderCard for morphing */}
      <div
        style={{ viewTransitionName: `order-card-${order.id}` }}
        className="max-w-2xl mx-auto rounded-xl border border-stone-700 bg-card text-card-foreground shadow-lg overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-stone-700">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <User className="h-5 w-5 text-stone-400 shrink-0" />
              <h1 className="text-2xl font-bold text-white truncate">
                {order.first_name || "Guest"}
              </h1>
              {order.is_guest_order && (
                <span className="text-xs font-mono text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded">GUEST</span>
              )}
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusStyle}`}>
              {order.status}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs font-mono text-stone-500">
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatRelativeTime(order.created_at)}</span>
            {typeof order.total_amount_cents === "number" && (
              <span className="flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> {formatCents(order.total_amount_cents)}</span>
            )}
            <span>{completedCount}/{order.coffee_orders.length} items done</span>
          </div>
        </div>

        {/* Items */}
        <div className="divide-y divide-stone-800">
          {order.coffee_orders.map((item) => (
            <div
              key={item.id}
              className={`px-6 py-4 flex items-start gap-4 ${item.completed_at ? "opacity-50" : ""}`}
            >
              <Coffee className="h-4 w-4 mt-0.5 text-stone-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`font-semibold ${item.completed_at ? "line-through text-stone-500" : "text-white"}`}>
                  {item.drink_name}
                </p>
                {item.customizations && (
                  <p className="text-xs text-stone-500 mt-1">{item.customizations}</p>
                )}
              </div>
              {item.price != null && (
                <span className="text-xs font-mono text-stone-500 shrink-0">
                  {formatCents(item.price)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
