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

/* ─── Safe status allowlist ─── */
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
  { filter: "completed", label: "✅ Order Complete — Pick Up!", color: "text-emerald-400", heading: "text-emerald-400" },
  { filter: "ready",     label: "🔔 Ready for Pickup",          color: "text-blue-300",   heading: "text-blue-300" },
  { filter: "preparing", label: "🔥 Now Making",                color: "text-amber-400",  heading: "text-amber-400" },
  { filter: "waiting",   label: "⏳ In Queue",                  color: "text-gray-500",   heading: "text-gray-500" },
] as const;

/* ─────────────────────────────────────────────
   ORDER CARD
───────────────────────────────────────────── */
function OrderCard({ order, prominent }: { order: QueueOrder; prominent?: boolean }) {
  const status = safeStatus(order.status);
  const isComplete = status === "completed";
  const cardType = isComplete && !order.isPaid ? "completed-unpaid" : status;
  const badgeStatus = isComplete && !order.isPaid ? "unpaid" : status;
  const badgeLabel = isComplete && !order.isPaid
    ? "⚠️ UNPAID"
    : STATUS_LABELS[status] || status;

  const pulseClass =
    status === "ready"             ? "animate-[readyPulse_2s_infinite]" :
    cardType === "completed-unpaid"? "animate-[unpaidBlink_1.5s_infinite]" :
    status === "completed"         ? "animate-[completedGlow_2.5s_infinite]" : "";

  const bgOverride =
    cardType === "completed-unpaid" ? "bg-[#1f0d0d]" :
    status === "completed" && order.isPaid ? "bg-[#0d1f12]" : "bg-[#1a1a1a]";

  return (
    <article
      aria-label={`Order for ${order.name}, status: ${badgeLabel}`}
      className={`${bgOverride} rounded-2xl border-2 border-[#333] border-t-[6px] overflow-hidden
                  animate-[slideIn_0.4s_ease-out] ${BORDER_COLORS[cardType]} ${pulseClass}`}
    >
      {/* Header */}
      <div className="flex justify-between items-start p-4 border-b border-[#2a2a2a]">
        <div>
          <div className="text-xs font-bold text-gray-600 uppercase tracking-wide">
            {isComplete ? "✅ Ready — grab it!" : `#${order.position} in queue`}
          </div>
          <div className={`font-black text-white leading-tight ${prominent ? "text-3xl" : "text-2xl"}`}>
            {order.name}
          </div>
          <div className="text-xs font-mono text-gray-500 mt-0.5">{order.tag}</div>
          {!order.isPaid && (
            <div className="text-xs font-bold text-red-500 animate-[blink_1.5s_infinite] mt-1">
              ⚠️ COLLECT PAYMENT
            </div>
          )}
        </div>
        <span
          role="status"
          className={`text-[0.65rem] font-bold uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${BADGE_COLORS[badgeStatus]}`}
        >
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
              <span className={`font-semibold text-gray-200 ${prominent ? "text-xl" : "text-[1.1rem]"}`}>
                {item.name}
              </span>
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
    </article>
  );
}

/* ─────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────── */
export default function QueuePage() {
  const [queue, setQueue]           = useState<QueueOrder[]>([]);
  const [count, setCount]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSync, setLastSync]     = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  /* ── Clock ─────────────────────────────────── */
  useEffect(() => {
    setCurrentTime(new Date());
    const tick = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  /* ── Fetch ─────────────────────────────────── */
  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/get-queue");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: QueueOrder[] = Array.isArray(data.queue) ? data.queue : [];
      setQueue(items);
      setCount(typeof data.count === "number" ? data.count : items.length);
      setFetchError(null);
      setLastSync(new Date());
    } catch (err) {
      setFetchError((err as Error)?.message ?? "Connection error");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Poll every 10 s ────────────────────────── */
  useEffect(() => {
    void refreshQueue();
    const interval = setInterval(() => void refreshQueue(), 10_000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  /* ── Group by status ─────────────────────────── */
  const completed  = queue.filter((o) => o.status === "completed");
  const ready      = queue.filter((o) => o.status === "ready");
  const inProgress = queue.filter((o) => o.status === "preparing");
  const waiting    = queue.filter((o) => ["pending", "unpaid", "paid"].includes(o.status));
  const groups = [
    { items: completed,  ...SECTION_CFG[0] },
    { items: ready,      ...SECTION_CFG[1] },
    { items: inProgress, ...SECTION_CFG[2] },
    { items: waiting,    ...SECTION_CFG[3] },
  ];

  const hasAny = groups.some((g) => g.items.length > 0);

  return (
    <>
      {/* ── Keyframes ───────────────────────────── */}
      <style>{`
        @keyframes slideIn      { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes readyPulse   { 0%,100%{ box-shadow:0 0 0 0 rgba(52,152,219,.4); } 50%{ box-shadow:0 0 20px 8px rgba(52,152,219,.2); } }
        @keyframes completedGlow{ 0%,100%{ box-shadow:0 0 0 0 rgba(46,204,113,.4); } 50%{ box-shadow:0 0 20px 8px rgba(46,204,113,.2); } }
        @keyframes unpaidBlink  { 0%,100%{ box-shadow:0 0 0 0 rgba(231,76,60,.5); }  50%{ box-shadow:0 0 24px 10px rgba(231,76,60,.3); } }
        @keyframes blink        { 0%,100%{ opacity:1; } 50%{ opacity:.3; } }
      `}</style>

      <div className="h-screen flex flex-col bg-[#0a0a0a] text-white font-sans overflow-hidden">

        {/* ── Error banner ────────────────────────── */}
        {fetchError && (
          <div role="alert" className="shrink-0 bg-red-900/80 text-red-200 text-center py-2 text-sm font-semibold tracking-wide">
            ⚠ Connection issue — retrying… ({fetchError})
          </div>
        )}

        {/* ── Header ──────────────────────────────── */}
        <header className="shrink-0 flex justify-between items-center px-8 py-4 bg-[#111] border-b-2 border-[#222]">
          <div className="text-3xl font-black">
            Brew<span className="text-amber-400">Hub</span>{" "}
            <span className="text-sm font-normal text-gray-500">Order Queue</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-gray-500">
            {/* Live dot */}
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                {fetchError ? (
                  <span className="inline-flex rounded-full h-2 w-2 bg-red-500" />
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </>
                )}
              </span>
              <span className="text-[11px] uppercase tracking-wider">
                {fetchError ? "Offline" : "Live"}
              </span>
            </span>

            <span className="font-semibold tabular-nums text-gray-400">
              {currentTime?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) ?? ""}
            </span>
            <span className="bg-amber-400 text-black font-bold px-3 py-1 rounded-lg">
              {count} order{count !== 1 ? "s" : ""}
            </span>
          </div>
        </header>

        {/* ── Queue ───────────────────────────────── */}
        <main
          className="flex-1 overflow-y-auto p-6"
          aria-live="polite"
          aria-label="Live order queue"
        >
          {loading ? (
            /* Loading state */
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
              <div className="h-10 w-10 border-2 border-[#333] border-t-amber-400 rounded-full animate-spin" />
              <span className="text-lg">Loading queue…</span>
            </div>
          ) : !hasAny ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
              <div className="text-6xl">☕</div>
              <p className="text-xl font-semibold">Queue is clear!</p>
              <p className="text-sm text-gray-700">New orders will appear here automatically.</p>
            </div>
          ) : (
            /* Sections */
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {groups.map((section) => {
                if (section.items.length === 0) return null;
                const isReady = section.filter === "ready" || section.filter === "completed";
                return (
                  <div key={section.filter} className="col-span-full contents">
                    {/* Section header */}
                    <div
                      role="heading"
                      aria-level={2}
                      className={`col-span-full flex items-center gap-3 pb-2 border-b-2 border-[#2a2a2a] mb-1
                                  ${isReady ? "text-2xl" : "text-lg"} font-black uppercase tracking-widest ${section.color}`}
                    >
                      {section.label}
                      <span className="text-sm font-bold bg-white/5 rounded px-2 py-0.5">
                        {section.items.length}
                      </span>
                    </div>

                    {/* Cards */}
                    {section.items.map((order) => (
                      <OrderCard
                        key={order.id || order.tag}
                        order={order}
                        prominent={isReady}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* ── Footer ──────────────────────────────── */}
        <footer className="shrink-0 border-t border-[#1a1a1a] bg-[#0d0d0d] px-8 py-2 flex items-center justify-between text-xs text-gray-700">
          <span>Ask a barista for help</span>
          <span className="tabular-nums">
            {lastSync
              ? `Updated ${lastSync.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}`
              : "Waiting for first sync…"}
          </span>
        </footer>
      </div>
    </>
  );
}
