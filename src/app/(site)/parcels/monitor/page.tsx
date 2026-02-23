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
 * UI:    Airport departure-board aesthetic — pitch-black background
 *        to prevent burn-in, high-contrast oversized type, and a
 *        warm amber pulse on parcels that arrived within 5 minutes.
 */

import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/* Types — exact columns from the parcel_departure_board VIEW          */
/* ------------------------------------------------------------------ */

interface ParcelRow {
  id: string;
  masked_name: string;
  masked_tracking: string;
  carrier: string | null;
  received_at: string | null;
  unit_number: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const POLL_MS = 10_000; // 10-second polling interval
const MAX_POLL_MS = 60_000; // max backoff: 60 seconds
const STALE_MS = 30_000; // show "stale" indicator after 30s without success
const NEW_THRESHOLD_MS = 5 * 60 * 1000; // 5-minute "new" window

/** Human-friendly waiting duration */
function waitingSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

/** True if the parcel arrived within the last 5 minutes */
function isNew(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < NEW_THRESHOLD_MS;
}

/** Carrier → colored dot class */
function carrierColor(carrier: string | null): string {
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("ups")) return "bg-amber-700";
  if (c.includes("fedex") || c.includes("fed")) return "bg-purple-500";
  if (c.includes("usps") || c.includes("postal")) return "bg-blue-500";
  if (c.includes("amazon") || c.includes("amzl")) return "bg-cyan-500";
  if (c.includes("dhl")) return "bg-yellow-400";
  return "bg-gray-500";
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function ParcelMonitor() {
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number>(Date.now());

  /* ---- Backoff ref (doubles on consecutive errors, resets on success) */
  const backoffRef = React.useRef(POLL_MS);

  /* ---- Fetch from the secure VIEW ------------------------------- */
  const fetchParcels = useCallback(async () => {
    const { data, error } = await supabase
      .from("parcel_departure_board")
      .select("*")
      .order("received_at", { ascending: false });

    if (error) {
      setFetchError(error.message ?? "Connection lost");
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_POLL_MS);
    } else {
      setParcels(data as ParcelRow[]);
      setFetchError(null);
      setLastSuccess(Date.now());
      backoffRef.current = POLL_MS; // reset backoff on success
    }
    setLoading(false);
  }, []);

  /* ---- Polling: fetch with adaptive backoff + pause when hidden -- */
  useEffect(() => {
    fetchParcels();

    let pollId: ReturnType<typeof setTimeout>;
    const schedulePoll = () => {
      pollId = setTimeout(() => {
        void fetchParcels().then(schedulePoll);
      }, backoffRef.current);
    };
    schedulePoll();

    const clockId = setInterval(() => setTick(Date.now()), 1_000);

    // Pause polling when the tab/kiosk is hidden (saves resources)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Immediately fetch when returning to view, then resume schedule
        void fetchParcels().then(() => {
          clearTimeout(pollId);
          schedulePoll();
        });
      } else {
        clearTimeout(pollId);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(pollId);
      clearInterval(clockId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchParcels]);

  /* ---- Clock string --------------------------------------------- */
  const clockStr = new Date(tick).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const isStale = tick - lastSuccess > STALE_MS;

  /* ---- Render --------------------------------------------------- */
  return (
    <div className="fixed inset-0 z-[9999] w-screen h-screen bg-black text-white overflow-hidden flex flex-col select-none cursor-default antiburn-shift monitor-4k-scale">

      {/* ═══════════ ERROR / STALE BANNER ═══════════ */}
      {fetchError && (
        <div role="alert" className="shrink-0 bg-red-900/80 text-red-200 text-center py-2 text-sm font-semibold tracking-wide">
          ⚠ Connection issue — retrying&hellip; ({fetchError})
        </div>
      )}
      {!fetchError && isStale && (
        <div role="status" className="shrink-0 bg-amber-900/60 text-amber-200 text-center py-2 text-sm font-semibold tracking-wide">
          ⏳ Data may be stale — last updated {Math.round((tick - lastSuccess) / 1000)}s ago
        </div>
      )}

      {/* ═══════════ HEADER ═══════════ */}
      <header className="shrink-0 flex items-center justify-between px-10 py-6 border-b border-white/5">
        <div className="flex items-center gap-5">
          <span className="text-4xl leading-none">📦</span>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase">
            Ready for Pickup
          </h1>
        </div>

        <div className="flex items-center gap-8">
          {/* Live indicator — switches to amber when stale */}
          <span className="flex items-center gap-2 text-sm text-gray-500">
            <span className="relative flex h-2.5 w-2.5">
              {isStale ? (
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </>
              )}
            </span>
            {isStale ? "Reconnecting" : "Live"}
          </span>

          {/* Package count */}
          <span className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-xl font-bold tabular-nums">
            {parcels.length}
          </span>

          {/* Clock */}
          <span className="font-mono text-2xl tabular-nums text-gray-400 tracking-wide">
            {clockStr}
          </span>
        </div>
      </header>

      {/* ═══════════ COLUMN HEADERS ═══════════ */}
      {!loading && parcels.length > 0 && (
        <div className="shrink-0 grid grid-cols-[2.5fr_1fr_2fr_1fr] gap-6 px-10 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-600 border-b border-white/5">
          <span>Name</span>
          <span>Unit</span>
          <span>Carrier / Tracking</span>
          <span className="text-right">Waiting</span>
        </div>
      )}

      {/* ═══════════ PARCEL LIST ═══════════ */}
      <div className="flex-1 overflow-y-auto" aria-live="polite" aria-label="Parcels awaiting pickup">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4 text-gray-600">
              <div className="h-10 w-10 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
              <span className="text-lg">Loading parcels&hellip;</span>
            </div>
          </div>
        ) : parcels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            <span className="text-8xl opacity-30">✅</span>
            <p className="text-3xl font-bold text-gray-500">All Clear</p>
            <p className="text-base text-gray-700">
              New arrivals will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {parcels.map((p, i) => {
              const fresh = isNew(p.received_at);
              return (
                <div
                  key={p.id}
                  className={[
                    "grid grid-cols-[2.5fr_1fr_2fr_1fr] gap-6 items-center px-10 transition-colors duration-700",
                    fresh
                      ? "py-6 bg-amber-500/[0.04] animate-[rowPulse_3s_ease-in-out_infinite]"
                      : i % 2 === 0
                        ? "py-5 bg-transparent"
                        : "py-5 bg-white/[0.015]",
                  ].join(" ")}
                >
                  {/* ── Name ── */}
                  <div className="min-w-0 flex items-center gap-3">
                    {fresh && (
                      <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-widest text-amber-400 bg-amber-400/10 rounded px-2 py-0.5">
                        New
                      </span>
                    )}
                    <span className="text-2xl md:text-3xl font-bold truncate">
                      {p.masked_name}
                    </span>
                  </div>

                  {/* ── Unit ── */}
                  <span className="text-xl md:text-2xl font-semibold text-gray-400 truncate">
                    {p.unit_number || "—"}
                  </span>

                  {/* ── Carrier + Tracking ── */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-label={p.carrier ?? "Unknown carrier"} className={`shrink-0 h-3 w-3 rounded-full ${carrierColor(p.carrier)}`} />
                    <span className="text-lg md:text-xl text-gray-300 truncate">
                      {p.carrier || "Other"}
                    </span>
                    <span className="text-base font-mono text-gray-600 truncate">
                      {p.masked_tracking}
                    </span>
                  </div>

                  {/* ── Waiting ── */}
                  <span className="text-right text-lg md:text-xl font-semibold text-gray-400 tabular-nums whitespace-nowrap">
                    {waitingSince(p.received_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="shrink-0 border-t border-white/5 bg-black px-10 py-4 flex items-center justify-between text-sm text-gray-700">
        <span>Please bring your ID for pickup &bull; Ask a barista for help</span>
        <span className="font-medium text-gray-600">BrewHub PHL</span>
      </footer>

      {/* Keyframe for the amber pulse on new arrivals + burn-in prevention */}
      <style>{`
        @keyframes rowPulse {
          0%, 100% { box-shadow: inset 0 0 0 0 rgba(245, 158, 11, 0); }
          50%      { box-shadow: inset 0 0 40px 0 rgba(245, 158, 11, 0.03); }
        }
        /* Burn-in prevention: subtle pixel-shift every 4 minutes.
           Moves the entire layout 1-2px in a random-looking pattern
           so no single pixel stays lit permanently on OLED/plasma TVs. */
        @keyframes antiburn {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(1px, -1px); }
          50%  { transform: translate(-1px, 1px); }
          75%  { transform: translate(1px, 1px); }
          100% { transform: translate(0, 0); }
        }
        .antiburn-shift {
          animation: antiburn 240s linear infinite;
        }
        /* 4K scaling: when viewport width exceeds 2560px, scale up text */
        @media (min-width: 2560px) {
          .monitor-4k-scale { font-size: 125%; }
        }
        @media (min-width: 3840px) {
          .monitor-4k-scale { font-size: 150%; }
        }
      `}</style>
    </div>
  );
}
