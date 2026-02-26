"use client"

import { useEffect, useRef, useState } from "react"
import type { KdsOrder } from "@/components/KdsOrderCard"

/* ─────────────────────────────────────────────────────────────────── */
/*  Pixel-art SVGs                                                      */
/* ─────────────────────────────────────────────────────────────────── */

/** Classic AIM Running Man from /aol.png */
function RunningMan({ bounce }: { bounce?: boolean }) {
  return (
    <img
      src="/aol.png"
      alt="Running Man"
      width={16}
      height={16}
      style={{
        imageRendering: "pixelated",
        animation: bounce ? "aimBounce 0.6s ease-in-out 3" : undefined,
      }}
    />
  )
}

/** Hourglass icon for in-progress orders */
function HourglassIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      style={{ imageRendering: "pixelated", animation: "spin 4s linear infinite" }}
      aria-hidden="true"
    >
      <polygon points="3,1 13,1 13,3 9,8 13,13 13,15 3,15 3,13 7,8 3,3" fill="#808080" />
      <polygon points="4,2 12,2 10,7 6,7" fill="#ffff00" />
      <polygon points="4,14 12,14 10,9 6,9" fill="#0000c0" />
    </svg>
  )
}

/** Win95 pixel-art coffee mug with flapping wings */
function FlyingCoffeeMug() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 32"
      width="40"
      height="32"
      style={{ imageRendering: "pixelated" }}
      aria-hidden="true"
    >
      {/* Left wing */}
      <g style={{ transformOrigin: "14px 12px", animation: "wingFlap 0.3s ease-in-out infinite alternate" }}>
        <polygon points="14,12 6,6 4,10 8,14" fill="#c0c0c0" stroke="#808080" strokeWidth="0.5" />
        <polygon points="12,14 4,10 2,14 6,16" fill="#dfdfdf" stroke="#808080" strokeWidth="0.5" />
      </g>
      {/* Right wing */}
      <g style={{ transformOrigin: "26px 12px", animation: "wingFlap 0.3s ease-in-out infinite alternate-reverse" }}>
        <polygon points="26,12 34,6 36,10 32,14" fill="#c0c0c0" stroke="#808080" strokeWidth="0.5" />
        <polygon points="28,14 36,10 38,14 34,16" fill="#dfdfdf" stroke="#808080" strokeWidth="0.5" />
      </g>
      {/* Steam wisps */}
      <rect x="17" y="4" width="2" height="3" rx="1" fill="#808080" opacity="0.5" style={{ animation: "steamRise 0.8s ease-in-out infinite" }} />
      <rect x="21" y="5" width="2" height="2" rx="1" fill="#808080" opacity="0.4" style={{ animation: "steamRise 0.8s ease-in-out infinite 0.3s" }} />
      {/* Mug body */}
      <rect x="13" y="12" width="14" height="14" rx="1" fill="#8B4513" />
      <rect x="14" y="13" width="12" height="12" rx="1" fill="#A0522D" />
      {/* Coffee surface */}
      <rect x="14" y="13" width="12" height="4" rx="1" fill="#3E1C00" />
      {/* Highlight on mug */}
      <rect x="15" y="19" width="2" height="4" fill="#C9773D" opacity="0.6" />
      {/* Handle */}
      <rect x="27" y="15" width="3" height="2" fill="#8B4513" />
      <rect x="29" y="15" width="2" height="7" fill="#8B4513" />
      <rect x="27" y="21" width="3" height="2" fill="#8B4513" />
      {/* Smiley face on mug :-) */}
      <rect x="17" y="20" width="1" height="1" fill="#FFD700" />
      <rect x="22" y="20" width="1" height="1" fill="#FFD700" />
      <rect x="18" y="23" width="4" height="1" fill="#FFD700" />
      <rect x="17" y="22" width="1" height="1" fill="#FFD700" />
      <rect x="22" y="22" width="1" height="1" fill="#FFD700" />
    </svg>
  )
}

/** Warning triangle for guest / unpaid orders */
function WarningIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      style={{ imageRendering: "pixelated", animation: "warnBlink 1s steps(2,start) infinite" }}
      aria-hidden="true"
    >
      <polygon points="8,1 15,14 1,14" fill="#ffff00" stroke="#000" strokeWidth="1" />
      <rect x="7" y="6" width="2" height="4" fill="#000" />
      <rect x="7" y="11" width="2" height="2" fill="#000" />
    </svg>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */

function aimHandle(order: KdsOrder): string {
  const raw = order.customer_name ?? `GUEST_${order.id.slice(-4).toUpperCase()}`
  return raw.toUpperCase().replace(/\s+/g, "_").slice(0, 20)
}

function waitTime(createdAt: string): string {
  const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m`
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Props                                                               */
/* ─────────────────────────────────────────────────────────────────── */

interface AolBuddyQueueProps {
  orders: KdsOrder[]
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Component                                                           */
/* ─────────────────────────────────────────────────────────────────── */

const DIALUP_PHASES = [
  "Dialing BrewHub...",
  "Verifying username...",
  "Checking password...",
  "Connecting at 28800 bps...",
  "Checking for new orders...",
  "Connected!",
  "Brewing connection...",
  "Resolving espresso.hub...",
  "Authenticating barista...",
  "Connection established!",
]

export default function AolBuddyQueue({ orders }: AolBuddyQueueProps) {
  // Track which order IDs have newly entered the Ready state so we can bounce
  const prevReadyIds = useRef<Set<string>>(new Set())
  const [freshReadyIds, setFreshReadyIds] = useState<Set<string>>(new Set())
    const [popups, setPopups] = useState<{ id: string; handle: string; when: number; status: string }[]>([])
    const prevStatuses = useRef<Record<string, string>>({})
  const [mugVisible, setMugVisible] = useState(false)
  const mugKey = useRef(0)
  const [dialupPhase, setDialupPhase] = useState(0)

  // Cycle through dial-up modem status text
  useEffect(() => {
    const interval = setInterval(() => {
      setDialupPhase((p) => (p + 1) % DIALUP_PHASES.length)
    }, 2400)
    return () => clearInterval(interval)
  }, [])

  // Flying mug timer — launches every ~10s, visible for 3s during flight
  useEffect(() => {
    const launch = () => {
      mugKey.current += 1
      setMugVisible(true)
      setTimeout(() => setMugVisible(false), 3200)
    }
    // First launch after 5s, then every 10s
    const initial = setTimeout(launch, 5000)
    const interval = setInterval(launch, 10000)
    return () => { clearTimeout(initial); clearInterval(interval) }
  }, [])

  // "Ready for pickup" = KDS completed (barista brought drink to counter)
  const readyOrders = orders.filter((o) => o.status === "completed")
  const inProgressOrders = orders.filter(
    (o) => o.status !== "completed" && !o.is_guest_order,
  )
  // Exclude completed guests — they already appear in "Orders Signed On" above
  const guestOrders = orders.filter((o) => o.is_guest_order && o.status !== "completed")
  const activeCount = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled",
  ).length

  useEffect(() => {
    const currentIds = new Set(readyOrders.map((o) => o.id))
    const newlyReady = new Set(
      [...currentIds].filter((id) => !prevReadyIds.current.has(id)),
    )
    if (newlyReady.size > 0) {
      setFreshReadyIds(newlyReady)
      // Add popup notifications for each new ready order
      const now = Date.now()
        const additions = [...newlyReady].map((id) => {
          const ord = readyOrders.find((o) => o.id === id)
          return { id, handle: ord ? aimHandle(ord) : id, when: now, status: "ready" }
        })
        setPopups((p) => {
          // avoid duplicates by id+status
          const existing = new Set(p.map((x) => `${x.id}:${x.status}`))
          const merged = [...p, ...additions.filter((a) => !existing.has(`${a.id}:${a.status}`))]
          return merged.slice(-10)
        })
        // Clear fresh-ready markers after animation completes (≈2s)
        setTimeout(() => setFreshReadyIds(new Set()), 2000)
    }
    prevReadyIds.current = currentIds
  }, [readyOrders])

  // Track status transitions — popup fires when KDS marks "completed" (drink at counter)
  useEffect(() => {
    const nextStatuses: Record<string, string> = { ...prevStatuses.current }
    orders.forEach((o) => {
      const prev = prevStatuses.current[o.id]
      if (prev !== o.status) {
        // Fire "ready" popup only when barista completes order on KDS
        if (o.status === "completed") {
          setPopups((p) => {
            const key = `${o.id}:ready`
            if (p.some((x) => `${x.id}:${x.status}` === key)) return p
            const merged = [...p, { id: o.id, handle: aimHandle(o), when: Date.now(), status: "ready" }]
            return merged.slice(-10)
          })
        }
      }
      nextStatuses[o.id] = o.status
    })
    prevStatuses.current = nextStatuses
  }, [orders])

  // Auto-dismiss popups after 3 minutes
  useEffect(() => {
    if (popups.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setPopups((p) => p.filter((x) => now - x.when < 180_000))
    }, 5_000)
    return () => clearInterval(timer)
  }, [popups.length])

  return (
    <>
      {/* ── Keyframe animations injected once ── */}
      <style>{`
        @keyframes aimBounce {
          0%,100% { transform: translateY(0); }
          25%      { transform: translateY(-4px); }
          75%      { transform: translateY(2px); }
        }
        @keyframes warnBlink {
          to { opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        /* ── Flying coffee mug (delivers AIM mail to popup corner) ── */
        @keyframes mugFly {
          0%   { top: 2%; left: 10%; opacity: 0; transform: scale(0.6) rotate(-10deg); }
          8%   { opacity: 1; transform: scale(1) rotate(0deg); }
          25%  { top: 20%; left: 30%; transform: scale(1) rotate(8deg); }
          50%  { top: 45%; left: 55%; transform: scale(1.1) rotate(-5deg); }
          75%  { top: 65%; left: 75%; transform: scale(1) rotate(5deg); }
          92%  { opacity: 1; transform: scale(0.9) rotate(0deg); }
          100% { top: 82%; left: 92%; opacity: 0; transform: scale(0.6) rotate(10deg); }
        }
        @keyframes wingFlap {
          0%   { transform: rotateX(0deg) scaleY(1); }
          100% { transform: rotateX(50deg) scaleY(0.6); }
        }
        @keyframes steamRise {
          0%   { opacity: 0.5; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        .flying-mug {
          position: absolute;
          z-index: 50;
          pointer-events: none;
          animation: mugFly 3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          filter: drop-shadow(1px 2px 0 rgba(0,0,0,0.3));
        }

        /* ── Dial-up runner ── */
        @keyframes aolRun {
          0%   { left: -24px; }
          100% { left: calc(100% + 24px); }
        }
        @keyframes aolRunnerBob {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-2px); }
        }
        @keyframes dialProgress {
          0%   { width: 0%; }
          90%  { width: 100%; }
          100% { width: 0%; }
        }
        @keyframes dialPhaseIn {
          0%   { opacity: 0; transform: translateY(3px); }
          15%  { opacity: 1; transform: translateY(0); }
          85%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-3px); }
        }
        .dialup-runner {
          position: absolute;
          top: 0;
          animation: aolRun 4s linear infinite, aolRunnerBob 0.35s ease-in-out infinite;
          filter: drop-shadow(0 1px 0 rgba(0,0,0,0.2));
          z-index: 2;
        }
        .dial-progress-fill {
          animation: dialProgress 4s linear infinite;
          background: linear-gradient(90deg, #000080 0%, #0066cc 50%, #000080 100%);
        }
        .dial-phase-text {
          animation: dialPhaseIn 2.4s ease-in-out;
        }
        .aim-window    { font-family: "Geist Mono", "Courier New", monospace; }
        .win-inset     { border: 2px solid; border-color: #808080 #fff #fff #808080; }
        .win-raised    { border: 2px solid; border-color: #fff #808080 #808080 #fff; }
        .aim-row:hover { background: #000080; color: #fff !important; }
        .aim-row:hover span { color: #fff !important; }

        /* ── Burn-in prevention (permanent display) ── */
        @keyframes aimAntiburn {
          0%   { transform: translate(0,0); }
          25%  { transform: translate(1px,-1px); }
          50%  { transform: translate(-1px,1px); }
          75%  { transform: translate(1px,1px); }
          100% { transform: translate(0,0); }
        }
        .aim-antiburn { animation: aimAntiburn 240s linear infinite; cursor: none; }

        /* TV scale no longer needed — window is full-viewport */
      `}</style>

      {/* ── Page background ── */}
      <div
        style={{ background: "oklch(0.12 0.02 20)", minHeight: "100vh" }}
        className="aim-antiburn flex flex-col"
      >
        {/* ── Buddy List window (full-screen Win95) ── */}
        <div
          className="aim-window flex flex-col"
          style={{
            width: "100vw",
            height: "100vh",
            background: "#c0c0c0",
            border: "none",
            boxShadow: "none",
          }}
        >
          {/* ── Title bar ── */}
          <div
            style={{ background: "#000080", padding: "6px 12px" }}
            className="flex items-center justify-between select-none"
          >
            <div className="flex items-center gap-3">
              {/* AIM flame logo approximation */}
              <svg width="24" height="24" viewBox="0 0 14 14" aria-hidden="true">
                <ellipse cx="7" cy="10" rx="5" ry="4" fill="#ffff00" />
                <ellipse cx="7" cy="7"  rx="3" ry="5" fill="#ffa500" />
                <ellipse cx="7" cy="5"  rx="2" ry="3" fill="#ff4400" />
              </svg>
              <span style={{ color: "#fff", fontSize: 20, fontWeight: "bold" }}>
                BrewHub Buddy List
              </span>
            </div>

            {/* Window controls */}
            <div className="flex gap-1">
              {["_", "□", "✕"].map((label) => (
                <button
                  key={label}
                  aria-label={label}
                  style={{
                    background: "#c0c0c0",
                    border: "2px solid",
                    borderColor: "#fff #808080 #808080 #fff",
                    width: 28,
                    height: 24,
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: "default",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "inherit",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Menu bar ── */}
          <div
            className="flex gap-4 px-3 py-2 select-none"
            style={{ fontSize: 16, borderBottom: "1px solid #808080" }}
          >
            {["People", "View", "Help"].map((m) => (
              <span
                key={m}
                className="cursor-default hover:underline"
                style={{ textDecoration: "none" }}
              >
                <u>{m[0]}</u>
                {m.slice(1)}
              </span>
            ))}
          </div>

          {/* ── Buddy list body ── */}
          <div className="win-inset m-2" style={{ background: "#fff", flex: 1, position: "relative", overflow: "hidden" }}>
            {/* ── Flying coffee mug (Win95 nostalgia) ── */}
            {mugVisible && (
              <div key={mugKey.current} className="flying-mug">
                <FlyingCoffeeMug />
              </div>
            )}

            {/* ── SECTION: Orders Signed On (Ready) ── */}
            <CategoryHeader
              label="Orders Signed On"
              count={readyOrders.length}
              color="#000080"
            />
            {readyOrders.length === 0 ? (
              <EmptyRow label="(none signed on)" />
            ) : (
              readyOrders.map((order) => (
                <BuddyRow
                  key={order.id}
                  icon={<RunningMan bounce={freshReadyIds.has(order.id)} />}
                  handle={aimHandle(order)}
                  meta={
                    <span style={{ color: "#008000", fontWeight: "bold", fontSize: 16 }}>
                      READY ✓
                    </span>
                  }
                  bold
                  wait={waitTime(order.created_at)}
                />
              ))
            )}

            {/* ── SECTION: Orders Away (In Progress) ── */}
            <CategoryHeader
              label="Orders Away"
              count={inProgressOrders.length}
              color="#404040"
            />
            {inProgressOrders.length === 0 ? (
              <EmptyRow label="(all caught up)" />
            ) : (
              inProgressOrders.map((order) => (
                <BuddyRow
                  key={order.id}
                  icon={<HourglassIcon />}
                  handle={aimHandle(order)}
                  meta={
                    <span style={{ color: "#808080", fontSize: 16 }}>
                      {order.status.replace("_", " ").toUpperCase()}
                    </span>
                  }
                  faded
                  wait={waitTime(order.created_at)}
                />
              ))
            )}

            {/* ── SECTION: Blocked / Unpaid ── */}
            <CategoryHeader
              label="Blocked / Unpaid"
              count={guestOrders.length}
              color="#800000"
            />
            {guestOrders.length === 0 ? (
              <EmptyRow label="(no alerts)" />
            ) : (
              guestOrders.map((order) => (
                <BuddyRow
                  key={order.id}
                  icon={<WarningIcon />}
                  handle={aimHandle(order)}
                  meta={
                    <span
                      style={{
                        color: "#cc0000",
                        fontWeight: "bold",
                        fontSize: 16,
                        animation: "warnBlink 1.2s steps(2,start) infinite",
                      }}
                    >
                      ⚠ UNPAID
                    </span>
                  }
                  danger
                  wait={waitTime(order.created_at)}
                />
              ))
            )}
          </div>

          {/* ── Dial-up connection runner ── */}
          <div
            className="mx-1 select-none"
            style={{
              background: "#c0c0c0",
              borderTop: "1px solid #808080",
              borderBottom: "1px solid #fff",
              padding: "6px 10px 8px",
              overflow: "hidden",
            }}
          >
            {/* Runner track */}
            <div
              style={{
                position: "relative",
                height: 24,
                overflow: "hidden",
              }}
            >
              {/* The running character */}
              <div className="dialup-runner">
                <img
                  src="/aol.png"
                  alt=""
                  width={22}
                  height={22}
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
              {/* Track line the runner jogs along */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: "#808080",
                }}
              />
            </div>

            {/* Progress bar (Win95-style recessed) */}
            <div
              className="win-inset"
              style={{
                height: 14,
                marginTop: 4,
                background: "#fff",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                className="dial-progress-fill"
                style={{ height: "100%", position: "absolute", left: 0, top: 0 }}
              />
            </div>

            {/* Dial-up status text */}
            <div
              key={dialupPhase}
              className="dial-phase-text"
              style={{
                fontSize: 14,
                color: "#000080",
                marginTop: 4,
                fontFamily: "inherit",
                textAlign: "center",
                height: 18,
                lineHeight: "18px",
              }}
            >
              {DIALUP_PHASES[dialupPhase]}
            </div>
          </div>

          {/* ── "Add Buddy" / Active Neighbors bar ── */}
          <div className="flex items-center gap-3 px-3 py-2">
            <div
              className="win-inset flex-1 flex items-center gap-2 px-3"
              style={{ background: "#fff", height: 32 }}
            >
              <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
                <circle cx="5" cy="5" r="4" fill="none" stroke="#808080" strokeWidth="1.5" />
                <line x1="8" y1="8" x2="11" y2="11" stroke="#808080" strokeWidth="1.5" />
              </svg>
              <span style={{ fontSize: 15, color: "#808080" }}>
                {activeCount} Active Neighbor{activeCount !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Setup button */}
            <button
              className="win-raised"
              style={{
                background: "#c0c0c0",
                fontSize: 15,
                padding: "4px 12px",
                cursor: "default",
                border: "2px solid",
                borderColor: "#fff #808080 #808080 #fff",
              }}
            >
              Setup…
            </button>
          </div>

          {/* ── Status strip ── */}
          <div
            className="win-inset mx-2 mb-2 px-3 py-2 flex items-center gap-3"
            style={{ background: "#c0c0c0", fontSize: 15 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: orders.length > 0 ? "#00aa00" : "#808080",
                display: "inline-block",
                boxShadow: orders.length > 0 ? "0 0 4px #00ff00" : "none",
              }}
            />
            <span>
              {orders.length > 0
                ? `Connected — ${orders.length} order${orders.length !== 1 ? "s" : ""} on queue`
                : "Idle — no active orders"}
            </span>
          </div>
        </div>
      </div>
      {/* ── Ready/Completed popups (AIM Instant Message windows) ── */}
      <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 99999, display: "flex", flexDirection: "column-reverse", gap: 10, maxHeight: "40vh", overflow: "hidden", width: "20vw", minWidth: 280 }}>
        {popups.map((pb, i) => (
          <div
            key={pb.id + "-popup-" + pb.status + "-" + i}
            className="aim-window"
            style={{
              width: "100%",
              background: "#c0c0c0",
              border: "2px solid",
              borderColor: "#fff #808080 #808080 #fff",
              boxShadow: "2px 2px 0 1px #000",
              animation: "aimBounce 0.4s ease-out",
            }}
            aria-live="polite"
          >
            {/* IM title bar */}
            <div style={{ background: pb.status === "completed" ? "#800080" : "#000080", padding: "5px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="flex items-center gap-2">
                <img src="/aol.png" alt="" width={16} height={16} style={{ imageRendering: "pixelated" }} />
                <span style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>
                  {pb.handle} - Instant Message
                </span>
              </div>
              <button
                onClick={() => setPopups((p) => p.filter((_, idx) => idx !== i))}
                style={{
                  background: "#c0c0c0",
                  border: "2px solid",
                  borderColor: "#fff #808080 #808080 #fff",
                  width: 22, height: 20, fontSize: 12, lineHeight: 1,
                  cursor: "default", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {/* IM body */}
            <div className="win-inset" style={{ margin: 6, background: "#fff", padding: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <img src="/aol.png" alt="AIM" width={28} height={28} style={{ imageRendering: "pixelated", flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 15, color: pb.status === "completed" ? "#800080" : "#000080" }}>
                    {pb.handle}:
                  </div>
                  <div style={{ fontSize: 15, marginTop: 3 }}>
                    {pb.status === "completed"
                      ? "Order picked up! 🎉 Goodbye!"
                      : "Your order is READY! Come grab it! ☕"}
                  </div>
                  <div style={{ fontSize: 12, color: "#808080", marginTop: 4 }}>
                    {new Date(pb.when).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
            {/* IM status bar */}
            <div style={{ padding: "4px 10px 6px", fontSize: 12, color: "#404040", borderTop: "1px solid #808080" }}>
              {pb.status === "completed" ? "☑ Buddy has signed off" : "☕ Buddy is ready for pickup"}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Sub-components                                                      */
/* ─────────────────────────────────────────────────────────────────── */

function CategoryHeader({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1 select-none"
      style={{
        background: "#c0c0c0",
        fontSize: 16,
        fontWeight: "bold",
        color,
        borderBottom: "1px solid #808080",
        userSelect: "none",
      }}
    >
      <span>▼ {label}</span>
      <span style={{ fontWeight: "normal", color: "#404040" }}>({count})</span>
    </div>
  )
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="px-6 py-1" style={{ fontSize: 15, color: "#808080", fontStyle: "italic" }}>
      {label}
    </div>
  )
}

function BuddyRow({
  icon,
  handle,
  meta,
  bold,
  faded,
  danger,
  wait,
}: {
  icon: React.ReactNode
  handle: string
  meta: React.ReactNode
  bold?: boolean
  faded?: boolean
  danger?: boolean
  wait: string
}) {
  return (
    <div
      className="aim-row flex items-center justify-between px-4 py-1 cursor-default"
      style={{ fontSize: 18 }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span
          style={{
            fontWeight: bold ? "bold" : "normal",
            color: danger ? "#cc0000" : faded ? "#808080" : "#000",
            textDecoration: danger ? "underline" : "none",
          }}
        >
          {handle}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {meta}
        <span style={{ fontSize: 14, color: "#808080", minWidth: 40, textAlign: "right" }}>
          {wait}
        </span>
      </div>
    </div>
  )
}
