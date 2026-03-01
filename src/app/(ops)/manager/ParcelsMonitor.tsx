"use client";
/**
 * Parcel Departure Board — Smart TV Digital Signage
 *
 * Full-screen (100vw × 100vh), read-only kiosk display for packages
 * awaiting pickup. Designed for a wall-mounted Smart TV in the café
 * lobby — no interactive controls, no navigation chrome.
 *
 * DATA:  Queries the `parcel_departure_board` Postgres VIEW which
 *        pre-masks all PII at the database level. Raw names and
 *        tracking numbers never reach the browser.
 *
 * POLL:  Smart TVs have unreliable WebSocket support, so we poll
 *        every 10 seconds instead of using Supabase Realtime.
 *        The interval is cleared on unmount.
 *
 * UI:    Airport / Solari split-flap departure-board aesthetic — deep
 *        warm-black background, amber monospace type, individual
 *        character cells with the horizontal hinge line, and a
 *        mechanical flip animation that cycles through random chars
 *        before settling — just like the real Solari boards at
 *        airports in the 70s–80s.
 */

import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { toUserSafeMessage } from "@/lib/errorCatalog";

/* ------------------------------------------------------------------ */
/* Types — exact columns from the parcel_departure_board VIEW          */
/* ------------------------------------------------------------------ */

interface ParcelRow {
  id: string;
  masked_name: string;
  masked_tracking: string;
  carrier: string | null;
  received_at: string | null;
  direction: "inbound" | "outbound";
  board_status: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const STALE_MS    = 30_000;
const NEW_MS      = 5 * 60 * 1000;
const DELAYED_MS  = 48 * 60 * 60 * 1000;
const FLAP_CHAR_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.:";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function waitingSince(dateStr: string | null, now = Date.now()): string {
  if (!dateStr) return "—";
  const ms = now - new Date(dateStr).getTime();
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function arrivalTime(dateStr: string | null): string {
  if (!dateStr) return "—:——";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function isNew(dateStr: string | null, now = Date.now()): boolean {
  if (!dateStr) return false;
  return now - new Date(dateStr).getTime() < NEW_MS;
}

function isDelayed(dateStr: string | null, now = Date.now()): boolean {
  if (!dateStr) return false;
  return now - new Date(dateStr).getTime() > DELAYED_MS;
}

function carrierTag(carrier: string | null): string {
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("ups")) return "UPS";
  if (c.includes("fedex") || c.includes("fed")) return "FDX";
  if (c.includes("usps") || c.includes("postal")) return "USP";
  if (c.includes("amazon") || c.includes("amzl")) return "AMZ";
  if (c.includes("dhl")) return "DHL";
  if (c.includes("ontrac")) return "ONT";
  return (carrier ?? "PKG").slice(0, 3).toUpperCase();
}

function randomChar(): string {
  return FLAP_CHAR_POOL[Math.floor(Math.random() * FLAP_CHAR_POOL.length)];
}

/* ------------------------------------------------------------------ */
/* SplitFlapChar — single mechanical character cell                     */
/* ------------------------------------------------------------------ */

function SplitFlapChar({
  char,
  flapping,
  delay = 0,
  color = "#ffcc00",
}: {
  char: string;
  flapping: boolean;
  delay?: number;
  color?: string;
}) {
  const [display, setDisplay] = useState(char);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!flapping) {
      setDisplay(char);
      return;
    }
    // Start flipping after staggered delay
    const startTimer = setTimeout(() => {
      let cycles = 0;
      const maxCycles = 6 + Math.floor(Math.random() * 4); // 6–9 flips
      intervalRef.current = setInterval(() => {
        cycles++;
        if (cycles >= maxCycles) {
          setDisplay(char);
          if (intervalRef.current) clearInterval(intervalRef.current);
        } else {
          setDisplay(randomChar());
        }
      }, 60);
    }, delay);

    return () => {
      clearTimeout(startTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [char, flapping, delay]);

  // When char changes without flapping, just update
  useEffect(() => {
    if (!flapping) setDisplay(char);
  }, [char, flapping]);

  return (
    <span
      className="flap-char"
      style={{ color }}
      data-flapping={flapping ? "" : undefined}
    >
      {/* The horizontal hinge line */}
      <span className="flap-hinge" />
      {display}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* SplitFlapText — row of character cells                              */
/* ------------------------------------------------------------------ */

function SplitFlapText({
  text,
  length,
  flapping,
  color,
  align = "left",
}: {
  text: string;
  length: number;
  flapping: boolean;
  color?: string;
  align?: "left" | "right";
}) {
  const padded = align === "right"
    ? text.toUpperCase().padStart(length).slice(-length)
    : text.toUpperCase().padEnd(length).slice(0, length);

  return (
    <span className="flap-text">
      {padded.split("").map((ch, i) => (
        <SplitFlapChar
          key={i}
          char={ch}
          flapping={flapping}
          delay={i * 30}
          color={color}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* MechanicalClock — ticking clock with flap characters                */
/* ------------------------------------------------------------------ */

function MechanicalClock({ tick }: { tick: number }) {
  const colonOn = Math.floor(tick / 1000) % 2 === 0;
  const d = new Date(tick);
  const str = `${d.getHours().toString().padStart(2, "0")}${colonOn ? ":" : " "}${d.getMinutes().toString().padStart(2, "0")}${colonOn ? ":" : " "}${d.getSeconds().toString().padStart(2, "0")}`;

  return (
    <span className="flap-text">
      {str.split("").map((ch, i) => (
        <SplitFlapChar key={i} char={ch} flapping={false} color="#ffcc00" />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* SystemStatus — pulsing live/stale indicator                         */
/* ------------------------------------------------------------------ */

function SystemStatus({ isStale }: { isStale: boolean }) {
  const colour = isStale ? "#cc8800" : "#ff6622";
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {!isStale && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: colour }}
          />
        )}
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: colour }}
        />
      </span>
      <span
        className={cn(
          "font-mono text-xs font-semibold uppercase tracking-[0.2em]",
          isStale && "solari-blink-text",
        )}
        style={{ color: colour }}
      >
        {isStale ? "Reconnecting" : "System Active"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

interface ParcelMonitorProps { onBack?: () => void; }

export default function ParcelMonitor({ onBack }: ParcelMonitorProps) {
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number>(Date.now());
  const [flappingRowId, setFlappingRowId] = useState<string | null>(null);
  const flipIndexRef = useRef(0);
  const prevParcelIdsRef = useRef<Set<string>>(new Set());
  // Schema 78: unified cafe order count for cross-reference badge
  const [cafeReadyCount, setCafeReadyCount] = useState<number>(0);

  /* ---- Auto-fullscreen on mount --------------------------------- */
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);

  /* ---- Fetch from the secure VIEW ------------------------------- */
  const fetchParcels = useCallback(async () => {
    // source: parcels-monitor-board
    const { data, error } = await supabase
      .from("parcel_departure_board")
      .select("id, masked_name, masked_tracking, carrier, received_at, direction, board_status")
      .order("received_at", { ascending: false })
      .limit(100);

    if (error) {
      setFetchError(toUserSafeMessage(error.message, "Connection lost — retrying."));
    } else {
      const incoming = data as ParcelRow[];
      // Detect changed rows to trigger the split-flap animation
      const incomingIds = new Set(incoming.map(p => p.id));
      const changed = incoming.find(p => !prevParcelIdsRef.current.has(p.id));
      prevParcelIdsRef.current = incomingIds;
      if (changed) {
        setFlappingRowId(changed.id);
        setTimeout(() => setFlappingRowId(null), 800);
      }
      setParcels(incoming);
      setFetchError(null);
      setLastSuccess(Date.now());
    }
    setLoading(false);

    // Schema 78: fetch cafe order count from unified view
    try {
      // source: parcels-monitor-cafe-count
      const { count, error: countErr } = await supabase
        .from("v_items_to_pickup")
        .select("item_id", { count: "exact", head: true })
        .eq("item_type", "cafe_order");
      if (!countErr) setCafeReadyCount(count ?? 0);
    } catch { /* non-critical */ }
  }, []);

  // Fetch once on mount + keep the clock ticking for the MechanicalClock display
  useEffect(() => {
    fetchParcels();
    const clockId = setInterval(() => setTick(Date.now()), 1_000);
    return () => { clearInterval(clockId); };
  }, [fetchParcels]);

  // Realtime subscriptions — sole data-refresh mechanism (no polling).
  // Subscribe to both underlying tables that feed the parcel_departure_board VIEW.
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 8));
  useEffect(() => {
    const channel = supabase
      .channel(`parcel-monitor-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parcels" },
        () => { fetchParcels(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outbound_parcels" },
        () => { fetchParcels(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchParcels]);

  const isStale = tick - lastSuccess > STALE_MS;

  function handleBack() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onBack?.();
  }

  /* Direction counts for the header */
  const inboundCount  = parcels.filter(p => p.direction !== "outbound").length;
  const outboundCount = parcels.filter(p => p.direction === "outbound").length;

  /* Number of chars per column — adjusted for the board aesthetic */
  const COL = { dir: 1, time: 5, name: 16, carrier: 3, tracking: 10, wait: 8, status: 11 };

  /* ---- Render --------------------------------------------------- */
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden select-none cursor-none antiburn-shift monitor-4k-scale monitor-portrait-zoom"
      style={{ background: "#1a1510", fontFamily: "ui-monospace, 'Courier New', monospace" }}
    >
      {/* ── Back button ── */}
      <button
        onClick={handleBack}
        title="Back to dashboard"
        className="absolute top-3 left-3 z-[99999] flex items-center gap-1.5 px-2.5 py-1.5 rounded opacity-20 hover:opacity-80 transition-opacity"
        style={{ color: "#cc8800", fontSize: 11, fontFamily: "inherit", letterSpacing: "0.1em" }}
        aria-label="Back to dashboard"
      >
        ← DASH
      </button>

      {/* ══════════ STALE / ERROR BANNERS ══════════ */}
      {fetchError && (
        <div role="alert" className="shrink-0 text-center py-2 text-sm font-semibold tracking-widest uppercase" style={{ background: "#2a1a0a", color: "#ff8844" }}>
          ⚠ {fetchError}
        </div>
      )}
      {!fetchError && isStale && (
        <div role="status" className="shrink-0 text-center py-2 text-sm font-semibold tracking-widest uppercase solari-blink-text" style={{ background: "#221a0a", color: "#cc8800" }}>
          ⏳ Data may be stale — last updated {Math.round((tick - lastSuccess) / 1000)}s ago
        </div>
      )}

      {/* ══════════ HEADER ══════════ */}
      <header
        className="shrink-0 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5"
        style={{ borderBottom: "2px solid #332a1a" }}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "#221a0a", boxShadow: "0 0 0 1px #332a1a" }}>
            <Package className="h-5 w-5" style={{ color: "#cc8800" }} />
          </div>
          <div>
            <h1 className="text-sm font-bold uppercase tracking-[0.2em] sm:text-base" style={{ color: "#ffcc00" }}>
              BrewHub Parcel Hub
            </h1>
            <p className="text-[10px] uppercase tracking-widest sm:text-xs" style={{ color: "#665530" }}>
              Point Breeze &bull; Philadelphia
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 sm:gap-6">
          <div className="flex items-center gap-3 rounded-lg px-3 py-1.5" style={{ background: "#221a0a", boxShadow: "0 0 0 1px #332a1a" }}>
            <span className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "#665530" }}>▼</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: "#ffcc00" }}>{inboundCount}</span>
            </span>
            <span className="text-xs uppercase tracking-widest" style={{ color: "#665530" }}>|</span>
            <span className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "#448899" }}>▲</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: "#44ddee" }}>{outboundCount}</span>
            </span>
            {/* Schema 78: cafe orders ready badge from unified view */}
            {cafeReadyCount > 0 && (<>
              <span className="text-xs uppercase tracking-widest" style={{ color: "#665530" }}>|</span>
              <span className="flex items-center gap-1" title="Cafe orders ready for pickup">
                <span className="text-xs" style={{ color: "#66cc66" }}>☕</span>
                <span className="text-lg font-bold tabular-nums" style={{ color: "#88ee88" }}>{cafeReadyCount}</span>
              </span>
            </>)}
          </div>
          <MechanicalClock tick={tick} />
          <SystemStatus isStale={isStale} />
        </div>
      </header>

      {/* ══════════ COLUMN HEADERS ══════════ */}
      {!loading && parcels.length > 0 && (
        <div className="shrink-0 solari-header" style={{ borderBottom: "1px solid #332a1a" }}>
          <span style={{ width: COL.dir * 16 }}></span>
          <span style={{ width: COL.time * 16 }}>Time</span>
          <span className="flex-1">Resident</span>
          <span className="hidden sm:block" style={{ width: (COL.carrier + COL.tracking + 1) * 16 }}>Carrier / Tracking</span>
          <span style={{ width: COL.wait * 16, textAlign: "right" }}>Waiting</span>
          <span style={{ width: COL.status * 16, textAlign: "right" }}>Status</span>
        </div>
      )}

      {/* ══════════ PARCEL ROWS ══════════ */}
      <div className="flex-1 overflow-y-auto" aria-live="polite" aria-label="Parcels awaiting pickup">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-8 w-8 rounded-full border-2 animate-spin" style={{ borderColor: "#332a1a", borderTopColor: "#ff6622" }} />
          </div>
        ) : parcels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <span className="text-6xl opacity-20">📭</span>
            <p className="text-2xl font-bold uppercase tracking-widest" style={{ color: "#332a1a" }}>
              No Parcels
            </p>
            <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "#281f10" }}>
              Inbound deliveries and outbound drop-offs appear automatically
            </p>
          </div>
        ) : (
          <div>
            {parcels.map((p, i) => {
              const isOutbound = p.direction === "outbound";
              const delayed = !isOutbound && isDelayed(p.received_at, tick);
              const fresh = !isOutbound && !delayed && isNew(p.received_at, tick);
              const tag = carrierTag(p.carrier);

              // Status: outbound uses board_status from VIEW; inbound uses time-based heuristics
              const statusLabel = isOutbound
                ? (p.board_status || "PROCESSING")
                : delayed ? "DELAYED" : fresh ? "NEW" : "IN LOCKER";
              const statusColor = isOutbound
                ? (p.board_status === "PICKED UP" ? "#44cc66" : p.board_status === "AWAITING PICKUP" ? "#44ddee" : "#77aacc")
                : delayed ? "#ff4422" : fresh ? "#ffaa00" : "#44cc66";

              // Color palette: outbound = cool cyan, inbound = warm amber
              const nameColor   = isOutbound ? "#44ddee" : "#ffdd44";
              const timeColor   = isOutbound ? "#44bbcc" : "#ffcc00";
              const tagColor    = isOutbound ? "#2299aa" : "#cc8800";
              const trkColor    = isOutbound ? "#447788" : "#776640";
              const waitColor   = isOutbound ? "#55aaaa" : "#cc9944";
              const dirArrow    = isOutbound ? "▲" : "▼";
              const dirColor    = isOutbound ? "#44ddee" : "#cc8800";
              const isFlapping = flappingRowId === p.id;

              return (
                <div
                  key={p.id}
                  className={cn(
                    "solari-row",
                    fresh && "solari-row--new",
                    delayed && "solari-row--delayed",
                    isOutbound && "solari-row--outbound",
                  )}
                  style={{
                    borderBottom: "1px solid #221a0a",
                    background: isOutbound
                      ? (i % 2 === 0 ? "#0f1a1e" : "#0d1618")
                      : (i % 2 === 0 ? "#1e1810" : "#1a1510"),
                  }}
                >
                  {/* DIRECTION ARROW */}
                  <SplitFlapText
                    text={dirArrow}
                    length={COL.dir}
                    flapping={isFlapping}
                    color={dirColor}
                  />

                  {/* TIME */}
                  <SplitFlapText
                    text={arrivalTime(p.received_at)}
                    length={COL.time}
                    flapping={isFlapping}
                    color={timeColor}
                  />

                  {/* RESIDENT */}
                  <span className="flex-1 min-w-0">
                    <SplitFlapText
                      text={p.masked_name}
                      length={COL.name}
                      flapping={isFlapping}
                      color={nameColor}
                    />
                  </span>

                  {/* CARRIER + TRACKING — desktop */}
                  <span className="hidden sm:inline-flex gap-0">
                    <SplitFlapText
                      text={tag}
                      length={COL.carrier}
                      flapping={isFlapping}
                      color={tagColor}
                    />
                    <SplitFlapChar char=" " flapping={false} color="transparent" />
                    <SplitFlapText
                      text={p.masked_tracking}
                      length={COL.tracking}
                      flapping={isFlapping}
                      color={trkColor}
                    />
                  </span>

                  {/* WAITING */}
                  <SplitFlapText
                    text={waitingSince(p.received_at, tick)}
                    length={COL.wait}
                    flapping={isFlapping}
                    align="right"
                    color={waitColor}
                  />

                  {/* STATUS */}
                  <span className={cn(delayed && "solari-blink-text")}>
                    <SplitFlapText
                      text={statusLabel}
                      length={COL.status}
                      flapping={isFlapping}
                      align="right"
                      color={statusColor}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <footer
        className="shrink-0 flex items-center justify-between px-5 py-3 sm:px-8"
        style={{ borderTop: "1px solid #332a1a", color: "#443820", fontSize: "11px" }}
      >
        <span className="uppercase tracking-widest">
          <span style={{ color: "#cc8800" }}>▼ Pickup: bring ID</span> &bull; <span style={{ color: "#448899" }}>▲ Drop-off: see barista</span>
        </span>
        <span className="uppercase tracking-widest">BrewHub PHL</span>
      </footer>

      {/* ══════════ KEYFRAMES + SOLARI STYLES ══════════ */}
      <style>{`
        /* ── Burn-in prevention ── */
        @keyframes antiburn {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(1px, -1px); }
          50%  { transform: translate(-1px, 1px); }
          75%  { transform: translate(1px, 1px); }
          100% { transform: translate(0, 0); }
        }
        .antiburn-shift { animation: antiburn 240s linear infinite; }

        /* ── Individual flap character cell ── */
        .flap-char {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          position: relative;
          width: 15px;
          height: 24px;
          background: #0d0b08;
          border: 1px solid #2a2218;
          border-radius: 2px;
          margin: 0 0.5px;
          font-family: ui-monospace, 'Courier New', monospace;
          font-size: 14px;
          font-weight: 700;
          line-height: 1;
          text-align: center;
          overflow: hidden;
          box-shadow: inset 0 1px 0 rgba(255,200,0,0.04), inset 0 -1px 0 rgba(0,0,0,0.3);
        }
        /* The horizontal hinge line across the middle */
        .flap-hinge {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: rgba(0,0,0,0.6);
          pointer-events: none;
          z-index: 1;
        }
        /* Flapping state: brief vertical blur + scale pulse */
        .flap-char[data-flapping] {
          animation: flapPulse 0.08s ease-in-out;
        }
        @keyframes flapPulse {
          0%   { transform: scaleY(1); filter: blur(0); }
          40%  { transform: scaleY(0.7); filter: blur(1px); }
          100% { transform: scaleY(1); filter: blur(0); }
        }

        /* Row of flap chars */
        .flap-text {
          display: inline-flex;
          align-items: center;
          gap: 0;
          flex-shrink: 0;
        }

        /* ── Row layout ── */
        .solari-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 20px;
        }
        @media (min-width: 640px) {
          .solari-row { padding: 10px 32px; gap: 16px; }
        }

        /* ── Column header layout ── */
        .solari-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 20px;
          color: #665530;
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          font-weight: 600;
        }
        @media (min-width: 640px) {
          .solari-header { padding: 8px 32px; gap: 16px; }
        }

        /* ── Warm glow for fresh arrivals ── */
        @keyframes solari-new-glow {
          0%, 100% { box-shadow: inset 0 0 0 0 rgba(255,170,0,0); }
          50%      { box-shadow: inset 0 0 40px 0 rgba(255,170,0,0.04); }
        }
        .solari-row--new {
          animation: solari-new-glow 3s ease-in-out infinite;
        }

        /* ── Delayed: red pulse ── */
        @keyframes solari-delayed-pulse {
          0%, 100% { box-shadow: inset 0 0 0 0 rgba(255,68,34,0); }
          50%      { box-shadow: inset 0 0 40px 0 rgba(255,68,34,0.04); }
        }
        .solari-row--delayed {
          animation: solari-delayed-pulse 2s ease-in-out infinite;
        }

        /* ── Outbound: cool cyan pulse ── */
        @keyframes solari-outbound-glow {
          0%, 100% { box-shadow: inset 0 0 0 0 rgba(68,187,204,0); }
          50%      { box-shadow: inset 0 0 30px 0 rgba(68,187,204,0.03); }
        }
        .solari-row--outbound {
          animation: solari-outbound-glow 4s ease-in-out infinite;
        }

        /* ── Text blink ── */
        @keyframes solari-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.25; }
        }
        .solari-blink-text { animation: solari-blink 1.6s step-start infinite; }

        /* ── Responsive scaling ── */
        @media (min-width: 2560px) { .monitor-4k-scale { font-size: 125%; } }
        @media (min-width: 3840px) { .monitor-4k-scale { font-size: 150%; } }
        @media (orientation: portrait) and (min-width: 800px) {
          .monitor-portrait-zoom { zoom: 1.35; }
        }
        @media (orientation: portrait) and (min-width: 2000px) {
          .monitor-portrait-zoom { zoom: 2.1; }
        }
      `}</style>
    </div>
  );
}
