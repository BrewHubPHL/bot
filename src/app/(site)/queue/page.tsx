"use client";

import { useState, useEffect, useCallback } from "react";

/* ─── Types ─── */
interface OrderItem {
  name: string;
  mods?: string;
}

interface QueueOrder {
  id: string;
  name: string;
  tag: string;
  status: string;
  position: number;
  minutesAgo: number;
  isPaid: boolean;
  items: OrderItem[];
}

/* ─── Safe status class map ─── */
const SAFE_STATUSES = new Set(["pending", "unpaid", "paid", "preparing", "ready", "completed"]);
function safeStatus(raw: string): string {
  return SAFE_STATUSES.has(raw) ? raw : "pending";
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting",
  unpaid: "Collect Payment",
  paid: "Paid",
  preparing: "Making It",
  ready: "Pick Up!",
  completed: "Order Complete",
};

/* ─── Status colors ─── */
const BORDER_COLORS: Record<string, string> = {
  pending: "border-t-red-500",
  unpaid: "border-t-red-500",
  paid: "border-t-emerald-500",
  preparing: "border-t-amber-400",
  ready: "border-t-blue-400",
  completed: "border-t-emerald-400",
  "completed-unpaid": "border-t-red-500",
};
const BADGE_COLORS: Record<string, string> = {
  pending: "bg-red-500/20 text-red-400",
  unpaid: "bg-red-500/20 text-red-400",
  paid: "bg-emerald-500/20 text-emerald-400",
  preparing: "bg-amber-400/20 text-amber-400",
  ready: "bg-blue-400/20 text-blue-400",
  completed: "bg-emerald-400/20 text-emerald-400",
};
const SECTION_CFG = [
  { filter: "completed", label: "✅ Order Complete — Pick Up!", color: "text-emerald-400" },
  { filter: "ready", label: "🔔 Ready for Pickup", color: "text-blue-400" },
  { filter: "preparing", label: "🔥 Now Making", color: "text-amber-400" },
  { filter: "waiting", label: "⏳ In Queue", color: "text-gray-500" },
];

/* ─── Components ─── */
function OrderCard({ order }: { order: QueueOrder }) {
  const status = safeStatus(order.status);
  const isComplete = status === "completed";
  const cardType = isComplete && !order.isPaid ? "completed-unpaid" : status;
  const badgeStatus = isComplete && !order.isPaid ? "unpaid" : status;
  const badgeLabel = isComplete && !order.isPaid
    ? "⚠️ UNPAID"
    : STATUS_LABELS[status] || status;

  const pulseClass =
    status === "ready" ? "animate-[readyPulse_2s_infinite]" :
    cardType === "completed-unpaid" ? "animate-[unpaidBlink_1.5s_infinite]" :
    status === "completed" ? "animate-[completedGlow_2.5s_infinite]" : "";

  return (
    <div className={`bg-[#1a1a1a] rounded-2xl border-2 border-[#333] border-t-[6px] overflow-hidden
                     animate-[slideIn_0.4s_ease-out] ${BORDER_COLORS[cardType]} ${pulseClass}
                     ${cardType === "completed-unpaid" ? "bg-[#1f0d0d]" : ""}
                     ${status === "completed" && order.isPaid ? "bg-[#0d1f12]" : ""}`}>
      {/* Header */}
      <div className="flex justify-between items-start p-4 border-b border-[#2a2a2a]">
        <div>
          <div className="text-xs font-bold text-gray-600 uppercase tracking-wide">
            {isComplete ? "✅ Ready — grab it!" : `#${order.position} in queue`}
          </div>
          <div className="text-2xl font-black text-white leading-tight">{order.name}</div>
          <div className="text-xs font-mono text-gray-500 mt-0.5">{order.tag}</div>
          {!order.isPaid && (
            <div className="text-xs font-bold text-red-500 animate-[blink_1.5s_infinite] mt-1">
              ⚠️ COLLECT PAYMENT
            </div>
          )}
        </div>
        <span className={`text-[0.65rem] font-bold uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${BADGE_COLORS[badgeStatus]}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Items */}
      <div className="px-4 py-3">
        {order.items.length === 0 ? (
          <span className="text-gray-600 text-sm">No items</span>
        ) : (
          order.items.map((item, i) => (
            <div key={i} className="flex items-baseline gap-2 py-0.5">
              <span className="text-[1.1rem] font-semibold text-gray-200">{item.name}</span>
              {item.mods && <span className="text-sm text-gray-500 italic">{item.mods}</span>}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between px-4 py-2 bg-[#111] text-xs text-gray-600">
        <span>{order.minutesAgo}m ago</span>
        <span>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

/* ─── Main Queue Page ─── */
export default function QueuePage() {
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [count, setCount] = useState(0);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  // Clock
  useEffect(() => {
    setCurrentTime(new Date());
    const tick = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Fetch queue
  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/get-queue");
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const items: QueueOrder[] = Array.isArray(data.queue) ? data.queue : [];
      setQueue(items);
      setCount(typeof data.count === "number" ? data.count : items.length);
    } catch (err) {
      console.error("Queue refresh error:", err);
    }
  }, []);

  // Initial load + 10s polling
  useEffect(() => {
    refreshQueue();
    const interval = setInterval(refreshQueue, 10000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  // Group orders by status
  const completed = queue.filter((o) => o.status === "completed");
  const ready = queue.filter((o) => o.status === "ready");
  const inProgress = queue.filter((o) => o.status === "preparing");
  const waiting = queue.filter((o) => ["pending", "unpaid", "paid"].includes(o.status));
  const groups = [
    { items: completed, ...SECTION_CFG[0] },
    { items: ready, ...SECTION_CFG[1] },
    { items: inProgress, ...SECTION_CFG[2] },
    { items: waiting, ...SECTION_CFG[3] },
  ];

  return (
    <>
      {/* Keyframe animations injected via style tag */}
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes readyPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(52,152,219,0.4); } 50% { box-shadow: 0 0 20px 8px rgba(52,152,219,0.2); } }
        @keyframes completedGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(46,204,113,0.4); } 50% { box-shadow: 0 0 20px 8px rgba(46,204,113,0.2); } }
        @keyframes unpaidBlink { 0%,100% { box-shadow: 0 0 0 0 rgba(231,76,60,0.5); } 50% { box-shadow: 0 0 24px 10px rgba(231,76,60,0.3); } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>

      <div className="min-h-screen bg-[#0a0a0a] text-white overflow-hidden"
        style={{ fontFamily: "'Inter', sans-serif" }}>
        {/* Header */}
        <header className="flex justify-between items-center px-8 py-4 bg-[#111] border-b-2 border-[#222]">
          <div className="text-3xl font-black">
            Brew<span className="text-amber-400">Hub</span>{" "}
            <span className="text-sm font-normal text-gray-500">Order Queue</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <span className="font-semibold tabular-nums text-gray-400">
              {currentTime?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) ?? ""}
            </span>
            <span className="bg-amber-400 text-black font-bold px-3 py-1 rounded-lg">
              {count} order{count !== 1 ? "s" : ""}
            </span>
          </div>
        </header>

        {/* Queue Grid */}
        <div className="p-6 grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            maxHeight: "calc(100vh - 80px)",
            overflowY: "auto",
          }}>
          {count === 0 ? (
            <div className="col-span-full text-center py-16 text-gray-600">
              <div className="text-5xl mb-2">☕</div>
              <p className="text-xl">No active orders — queue is clear!</p>
            </div>
          ) : (
            groups.map((section) =>
              section.items.length > 0 ? (
                <div key={section.filter} className="col-span-full contents">
                  <div className={`col-span-full text-xl font-black uppercase tracking-widest py-2
                                   border-b-2 border-[#333] mb-2 ${section.color}`}>
                    {section.label}
                  </div>
                  {section.items.map((order) => (
                    <OrderCard key={order.id || order.tag} order={order} />
                  ))}
                </div>
              ) : null
            )
          )}
        </div>
      </div>
    </>
  );
}
