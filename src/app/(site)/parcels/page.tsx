"use client";

/**
 * Parcel Departure Board — Vertical Lobby Monitor
 *
 * Optimised for a 35–40″ VERTICAL (portrait) TV in the building lobby.
 * 80s-airport split-flap aesthetic with Supabase Realtime subscription.
 *
 * DATA SOURCE:
 *   Queries the `parcel_departure_board` Postgres VIEW which pre-masks
 *   PII at the database level (schema-14). Anon key is safe here because
 *   the VIEW only exposes masked_name, masked_tracking, carrier, unit,
 *   and received_at — never raw emails, phones, or full tracking numbers.
 *
 * REAL-TIME:
 *   Subscribes to postgres_changes on the `parcels` table. On any
 *   INSERT/UPDATE/DELETE, re-fetches the VIEW (never trusts the
 *   Realtime payload directly — defense-in-depth PII protection).
 *   New rows animate in with a CSS split-flap "flip" effect.
 *
 * LAYOUT:
 *   Portrait-first. 20+ visible rows. Large mono font. High contrast
 *   black background with amber/green departure-board colours.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/* ─── Types ────────────────────────────────────────────────────── */
interface BoardRow {
  id: string;
  masked_name: string;
  masked_tracking: string;
  carrier: string | null;
  received_at: string;
  unit_number: string | null;
}

/* ─── Carrier colour map (amber/green CRT palette) ────────────── */
const CARRIER_COLOR: Record<string, string> = {
  UPS: "text-amber-400",
  FedEx: "text-purple-400",
  USPS: "text-blue-400",
  DHL: "text-yellow-300",
  Amazon: "text-cyan-400",
};

function carrierColor(carrier: string | null): string {
  if (!carrier) return "text-stone-500";
  return CARRIER_COLOR[carrier] || "text-stone-400";
}

/* ─── Relative time (lobby-friendly) ───────────────────────────── */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins}m AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h AGO`;
  const days = Math.floor(hrs / 24);
  return `${days}d AGO`;
}

/* ─── Format time for the header clock ─────────────────────────── */
function formatClock(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function LobbyBoardPage() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<Date>(new Date());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());

  /* ─── Fetch the PII-masked VIEW ──────────────────────────────── */
  const fetchBoard = useCallback(async () => {
    const { data, error } = await supabase
      .from("parcel_departure_board")
      .select("id, masked_name, masked_tracking, carrier, received_at, unit_number")
      .order("received_at", { ascending: false })
      .limit(40);

    if (error) {
      console.error("[LOBBY] Board fetch error:", error.message);
      return;
    }

    const fetched = (data || []) as BoardRow[];

    // Detect new arrivals for flap animation
    const currentIds = new Set(fetched.map((r) => r.id));
    const freshIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) {
        freshIds.add(id);
      }
    }
    prevIdsRef.current = currentIds;

    if (freshIds.size > 0) {
      setNewIds(freshIds);
      // Clear the "new" highlight after animation completes
      setTimeout(() => setNewIds(new Set()), 2000);
    }

    setRows(fetched);
    setLoading(false);
  }, []);

  /* ─── Initial load + Supabase Realtime subscription ──────────── */
  useEffect(() => {
    fetchBoard();

    // Subscribe to any change on the parcels table → re-fetch the VIEW
    const channel = supabase
      .channel("lobby_board_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parcels" },
        () => {
          // Don't trust the payload (PII) — re-fetch the masked VIEW
          fetchBoard();
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [fetchBoard]);

  /* ─── Clock tick ─────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ─── Auto-refresh timestamps every 30s ──────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setRows((r) => [...r]), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  /*  RENDER                                                        */
  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <>
      {/* Inline styles for the split-flap animation + CRT scanlines */}
      <style>{`
        @keyframes flipIn {
          0% {
            transform: perspective(400px) rotateX(-90deg);
            opacity: 0;
          }
          40% {
            transform: perspective(400px) rotateX(12deg);
            opacity: 1;
          }
          70% {
            transform: perspective(400px) rotateX(-5deg);
          }
          100% {
            transform: perspective(400px) rotateX(0deg);
          }
        }
        .flap-new {
          animation: flipIn 0.6s ease-out both;
        }
        /* CRT scanline overlay */
        .crt-overlay::after {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(
            to bottom,
            transparent,
            transparent 2px,
            rgba(0, 0, 0, 0.08) 2px,
            rgba(0, 0, 0, 0.08) 4px
          );
          z-index: 50;
        }
        /* Subtle phosphor glow */
        .glow-text {
          text-shadow: 0 0 8px rgba(245, 158, 11, 0.3),
                       0 0 20px rgba(245, 158, 11, 0.1);
        }
        .glow-green {
          text-shadow: 0 0 8px rgba(74, 222, 128, 0.4),
                       0 0 20px rgba(74, 222, 128, 0.15);
        }
      `}</style>

      <div className="crt-overlay flex h-screen w-screen flex-col overflow-hidden bg-black font-mono text-white">

        {/* ═══════════════════════════════════════════════════════ */}
        {/* HEADER — BREWHUB PHL DEPARTURE BOARD                  */}
        {/* ═══════════════════════════════════════════════════════ */}
        <header className="shrink-0 border-b-2 border-amber-600/60 bg-stone-950 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="glow-text text-3xl font-black uppercase tracking-[0.2em] text-amber-500">
                📦 BREWHUB PHL
              </h1>
              <p className="mt-0.5 text-sm uppercase tracking-[0.3em] text-amber-700">
                Parcel Departure Board
              </p>
            </div>
            <div className="text-right">
              <div className="glow-text text-4xl font-black tabular-nums text-amber-400">
                {formatClock(clock)}
              </div>
              <div className="mt-0.5 text-xs uppercase tracking-[0.2em] text-amber-700">
                {formatDate(clock)}
              </div>
            </div>
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* COLUMN HEADERS                                        */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="shrink-0 grid grid-cols-[80px_1fr_220px_100px_120px] gap-2 border-b border-amber-900/50 bg-stone-950 px-6 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Unit</span>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Resident</span>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Package</span>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Carrier</span>
          <span className="text-right text-xs font-bold uppercase tracking-wider text-amber-600">Arrived</span>
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ROWS                                                  */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-hidden px-6">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="glow-text text-2xl uppercase tracking-widest text-amber-600 animate-pulse">
                Loading Board…
              </div>
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="glow-green text-5xl font-black text-green-500">✓</div>
                <p className="mt-4 text-2xl font-bold uppercase tracking-widest text-green-600">
                  All Clear
                </p>
                <p className="mt-1 text-sm uppercase tracking-wider text-stone-600">
                  No packages awaiting pickup
                </p>
              </div>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="divide-y divide-stone-900">
              {rows.map((row, idx) => {
                const isNew = newIds.has(row.id);
                return (
                  <div
                    key={row.id}
                    className={`
                      grid grid-cols-[80px_1fr_220px_100px_120px] gap-2 items-center
                      py-3
                      ${isNew ? "flap-new bg-amber-950/30" : ""}
                      ${idx % 2 === 0 ? "bg-stone-950/50" : "bg-black"}
                      transition-colors duration-300
                    `}
                  >
                    {/* Unit */}
                    <span className="glow-green text-2xl font-black text-green-400">
                      {row.unit_number || "—"}
                    </span>

                    {/* Masked Name */}
                    <span className="glow-text truncate text-xl font-bold uppercase tracking-wide text-amber-300">
                      {row.masked_name}
                    </span>

                    {/* Masked Tracking */}
                    <span className="truncate text-lg font-mono text-stone-400">
                      {row.masked_tracking}
                    </span>

                    {/* Carrier */}
                    <span className={`text-lg font-bold uppercase ${carrierColor(row.carrier)}`}>
                      {row.carrier || "PKG"}
                    </span>

                    {/* Time Ago */}
                    <span className="text-right text-lg font-mono text-stone-500">
                      {timeAgo(row.received_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* FOOTER TICKER                                         */}
        {/* ═══════════════════════════════════════════════════════ */}
        <footer className="shrink-0 border-t-2 border-amber-600/40 bg-stone-950 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs uppercase tracking-[0.25em] text-stone-500">
                Live — {rows.length} package{rows.length !== 1 ? "s" : ""} awaiting pickup
              </span>
            </div>
            <span className="text-xs uppercase tracking-[0.2em] text-stone-600">
              ☕ Grab a coffee when you come down
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
