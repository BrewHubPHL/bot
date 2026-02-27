"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { useStaffOptional } from "@/context/StaffContext";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import { fetchOps } from "@/utils/ops-api";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  Monitor,
  Package,
  AlertTriangle,
  Smartphone,
  Tablet,
} from "lucide-react";

const POLL_MS = 60_000; // auto-refresh every 60 s
const MAX_BACKOFF_MS = 300_000; // max 5-minute backoff on 429
const SHOP_TZ = "America/New_York";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
interface SyncStatus {
  ok: boolean;
  lastSync: Date | null;
  message: string;
}

interface ActiveShift {
  name: string;
  email: string;
  clock_in: string;
}

interface LowStockItem {
  id: string;
  name: string;
  stock_quantity: number;
  min_threshold: number;
}

interface NoShow {
  shiftId: string;
  userId: string;
  startTime: string;
  employeeName: string;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function DashboardOverhaul() {
  const session = useOpsSessionOptional();
  const token = session?.token;

  /* ── Global shift context (schema-69 sync) ───────────── */
  const staffCtx = useStaffOptional();

  /* ── Connection / sync status ────────────────────────── */
  const [sync, setSync] = useState<SyncStatus>({
    ok: true,
    lastSync: null,
    message: "Connecting…",
  });
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);

  const pollBackoffRef = useRef<number>(POLL_MS);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Quick stats ─────────────────────────────────────── */
  const [stats, setStats] = useState<{
    revenue: number;
    orders: number;
    staffCount: number;
    labor: number;
    activeShifts: ActiveShift[];
    lowStockItems: LowStockItem[];
    noShows: NoShow[];
  }>({
    revenue: 0,
    orders: 0,
    staffCount: 0,
    labor: 0,
    activeShifts: [],
    lowStockItems: [],
    noShows: [],
  });
  const [statsLoading, setStatsLoading] = useState(true);

  /* ── Toast messages ──────────────────────────────────── */
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // ──────────────────────────────────────────────────────
  //  Auto-dismissing toast
  // ──────────────────────────────────────────────────────
  const showToast = useCallback(
    (type: "success" | "error" | "info", message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 5000);
    },
    []
  );

  // ──────────────────────────────────────────────────────
  //  DATA: Fetch stats
  // ──────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchOps("/get-manager-stats");
      if (res.status === 401) return; // fetchOps already triggers forceOpsLogout
      if (res.status === 429) {
        pollBackoffRef.current = Math.min(pollBackoffRef.current * 2, MAX_BACKOFF_MS);
        setSync((prev) => ({ ...prev, ok: false, message: "Rate limited — backing off" }));
        return;
      }
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Unable to load dashboard stats");
        setAuthzState(info.authz);
        setSync((prev) => ({
          ok: false,
          lastSync: prev.lastSync,
          message: info.message,
        }));
        return;
      }
      const d = await res.json();
      setStats({
        revenue: d.revenue ?? 0,
        orders: d.orders ?? 0,
        staffCount: d.staffCount ?? 0,
        labor: d.labor ?? 0,
        activeShifts: d.activeShifts ?? [],
        lowStockItems: d.lowStockItems ?? [],
        noShows: d.noShows ?? [],
      });
      setAuthzState(null);
      setStatsLoading(false);
      pollBackoffRef.current = POLL_MS; // reset on success
      setSync({ ok: true, lastSync: new Date(), message: "Live" });

      // Schema 69: keep global shift context in sync
      staffCtx?.refreshShiftStatus();
    } catch {
      setSync((prev) => ({
        ok: false,
        lastSync: prev.lastSync,
        message: "Connection Glitch",
      }));
      setStatsLoading(false);
    }
  }, [token]);

  const handleAuthzAction = useCallback(() => {
    if (!authzState) return;
    if (authzState.status === 401) {
      sessionStorage.removeItem("ops_session");
      window.location.reload();
      return;
    }
    window.location.href = "/staff-hub";
  }, [authzState]);

  // ──────────────────────────────────────────────────────
  //  AUTO-REFRESH — adaptive setTimeout (backs off on 429)
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      pollTimerRef.current = setTimeout(async () => {
        if (!cancelled) {
          await fetchStats();
          schedule();
        }
      }, pollBackoffRef.current);
    };
    fetchStats();
    schedule();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [token, fetchStats]);

  // ──────────────────────────────────────────────────────
  //  RENDER
  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════
          TRAFFIC-LIGHT CONNECTION BANNER
          ═══════════════════════════════════════════════════ */}
      {authzState && (
        <AuthzErrorStateCard state={authzState} onAction={handleAuthzAction} />
      )}

      {!sync.ok && !authzState && (
        <button
          type="button"
          onClick={() => fetchStats()}
          className="w-full flex items-center justify-center gap-3 min-h-[56px]
                     bg-red-500/10 border border-red-500/30 rounded-xl px-6 py-4
                     text-red-400 text-base font-semibold
                     active:scale-[0.98] transition-all"
        >
          <WifiOff size={22} />
          <span>⚠️ Connection Glitch — Tap to Retry</span>
        </button>
      )}

      {sync.ok && sync.lastSync && (
        <div className="flex items-center gap-2 text-xs text-green-400/80 px-1">
          <Wifi size={14} />
          <span>
            Live · Last sync{" "}
            {sync.lastSync.toLocaleTimeString("en-US", {
              timeZone: SHOP_TZ,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
          </span>
          <span className="ml-auto text-stone-600">Auto-refreshes every 60s</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          TOAST — floating notification
          ═══════════════════════════════════════════════════ */}
      {toast && (
        <div
          className={`flex items-center gap-3 min-h-[56px] rounded-xl px-5 py-3
                     text-sm font-semibold transition-all animate-in fade-in
                     ${
                       toast.type === "success"
                         ? "bg-green-500/10 border border-green-500/30 text-green-400"
                         : toast.type === "error"
                           ? "bg-red-500/10 border border-red-500/30 text-red-400"
                           : "bg-blue-500/10 border border-blue-500/30 text-blue-400"
                     }`}
        >
          {toast.type === "success" && <CheckCircle size={20} />}
          {toast.type === "error" && <XCircle size={20} />}
          {toast.type === "info" && <RefreshCw size={20} />}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto p-1 hover:opacity-70"
          >
            ✕
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          QUICK STATS — touch-friendly cards
          ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Today's Revenue",
            value: statsLoading ? "…" : `$${stats.revenue.toFixed(2)}`,
            color: "text-green-400",
            icon: "💰",
          },
          {
            label: "Orders Today",
            value: statsLoading ? "…" : String(stats.orders),
            color: "text-blue-400",
            icon: "🧾",
          },
          {
            label: "Staff On Shift",
            value: statsLoading ? "…" : String(stats.staffCount),
            color:
              stats.staffCount > 0 ? "text-green-400" : "text-stone-400",
            icon: "👥",
          },
          {
            label: "Est. Labor Cost",
            value: statsLoading ? "…" : `$${stats.labor.toFixed(2)}`,
            color: "text-amber-400",
            icon: "⏱",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-stone-900 border border-stone-800 rounded-xl
                       px-4 py-4 min-h-[80px] flex flex-col justify-center"
          >
            <div className="text-xs text-stone-500 mb-1 flex items-center gap-1.5">
              <span>{card.icon}</span> {card.label}
            </div>
            <div className={`text-2xl font-bold ${card.color}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════
          LOW STOCK ALERTS
          ═══════════════════════════════════════════════════ */}
      {!statsLoading && stats.lowStockItems.length > 0 && (
        <div className="bg-stone-900 border border-red-500/30 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 min-h-[56px] border-b border-red-500/20 bg-red-500/5">
            <span className="font-semibold text-base text-red-400 flex items-center gap-2">
              <AlertTriangle size={18} />
              Low Stock Alerts
            </span>
            <span className="text-sm font-bold rounded-full px-3 py-1 bg-red-500/20 text-red-400">
              {stats.lowStockItems.length} items
            </span>
          </div>
          <div className="divide-y divide-stone-800">
            {stats.lowStockItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-5 min-h-[56px] py-3 gap-3">
                <div className="font-semibold text-sm text-white truncate flex-1">{item.name}</div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-sm font-bold text-red-400 tabular-nums">
                    {item.stock_quantity}&nbsp;/&nbsp;{item.min_threshold}
                  </div>
                  <button
                    type="button"
                    onClick={() => setToast({ type: 'info', message: `Restock for "${item.name}" — order logic coming soon.` })}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                  >
                    Quick&nbsp;Restock
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          ON THE CLOCK — active staff roster
          ═══════════════════════════════════════════════════ */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 min-h-[56px] border-b border-stone-800">
          <span className="font-semibold text-base">👥 On the Clock</span>
          {!statsLoading && (
            <span
              className={`text-sm font-bold rounded-full px-3 py-1 ${
                stats.activeShifts.length > 0
                  ? "bg-green-500/10 text-green-400"
                  : "bg-stone-700 text-stone-500"
              }`}
            >
              {stats.activeShifts.length} active
            </span>
          )}
        </div>

        {statsLoading ? (
          <div className="space-y-2 px-5 py-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-stone-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : stats.activeShifts.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-4 text-green-400 text-sm">
            <CheckCircle size={18} />
            All shifts closed — nobody clocked in.
          </div>
        ) : (
          <div className="divide-y divide-stone-800">
            {stats.activeShifts.map((s) => {
              const elapsedMs = Date.now() - new Date(s.clock_in).getTime();
              const hrs = Math.floor(elapsedMs / 3_600_000);
              const mins = Math.floor((elapsedMs % 3_600_000) / 60_000);
              const isAlert = hrs >= 16;
              const isWarn = hrs >= 8 && !isAlert;
              return (
                <div key={s.email} className="flex items-center gap-4 px-5 min-h-[56px] py-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      isAlert
                        ? "bg-red-500 animate-pulse"
                        : isWarn
                          ? "bg-amber-400"
                          : "bg-green-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-white truncate">{s.name}</div>
                    <div className="text-xs text-stone-500 truncate">{s.email}</div>
                  </div>
                  <div
                    className={`text-sm font-bold flex-shrink-0 ${
                      isAlert ? "text-red-400" : isWarn ? "text-amber-400" : "text-green-400"
                    }`}
                  >
                    {hrs}h {mins}m
                    {isAlert && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wide
                                       bg-red-500/20 text-red-400 border border-red-500/30
                                       rounded-full px-2 py-0.5">
                        Check in?
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          🚨 LATE / NO-SHOW ALERTS
          ═══════════════════════════════════════════════════ */}
      {!statsLoading && stats.noShows.length > 0 && (
        <div className="bg-stone-900 border border-red-500/30 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 min-h-[56px] border-b border-red-500/20 bg-red-500/5">
            <span className="font-semibold text-base text-red-400 flex items-center gap-2">
              <AlertTriangle size={18} />
              🚨 Late / No-Show
            </span>
            <span className="text-sm font-bold rounded-full px-3 py-1 bg-red-500/20 text-red-400">
              {stats.noShows.length} alert{stats.noShows.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="divide-y divide-stone-800">
            {stats.noShows.map((ns) => {
              const shiftTime = new Date(ns.startTime).toLocaleTimeString(
                "en-US",
                { timeZone: SHOP_TZ, hour: "numeric", minute: "2-digit", hour12: true }
              );
              return (
                <div
                  key={ns.shiftId}
                  className="flex items-center gap-4 px-5 min-h-[56px] py-3"
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-red-500 animate-pulse" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-white truncate">
                      {ns.employeeName}
                    </div>
                    <div className="text-xs text-stone-500">
                      Shift started {shiftTime}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const reason = prompt("Reason for excusing this no-show:");
                      if (!reason) return;
                      try {
                        const res = await fetchOps("/resolve-no-show", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            shiftId: ns.shiftId,
                            reason,
                          }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          showToast("error", err.error || "Failed to resolve no-show");
                          return;
                        }
                        showToast("success", `${ns.employeeName} no-show excused`);
                        fetchStats();
                      } catch {
                        showToast("error", "Network error resolving no-show");
                      }
                    }}
                    className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg
                               bg-amber-500/10 border border-amber-500/30 text-amber-300
                               hover:bg-amber-500/20 active:scale-[0.96] transition-all"
                  >
                    Resolve (Excuse)
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          LAUNCH DISPLAY SCREENS
          ═══════════════════════════════════════════════════ */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 min-h-[48px] border-b border-stone-800">
          <Monitor size={15} className="text-stone-500" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-widest text-stone-500">
            Launch Display Screens
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
          <a
            href="/manager?tab=queue"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 min-h-[56px] rounded-xl px-5
                       bg-amber-500/10 border border-amber-500/30
                       hover:bg-amber-500/20 hover:border-amber-500/50
                       text-amber-300 text-sm font-semibold
                       active:scale-[0.98] transition-all"
          >
            <Monitor size={20} aria-hidden="true" />
            <div>
              <div>Cafe Order Queue</div>
              <div className="text-xs font-normal text-amber-400/60">Customer-facing monitor · drink status board</div>
            </div>
          </a>
          <a
            href="/manager/parcels/monitor"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 min-h-[56px] rounded-xl px-5
                       bg-purple-500/10 border border-purple-500/30
                       hover:bg-purple-500/20 hover:border-purple-500/50
                       text-purple-300 text-sm font-semibold
                       active:scale-[0.98] transition-all"
          >
            <Package size={20} aria-hidden="true" />
            <div>
              <div>Parcel Departure Board</div>
              <div className="text-xs font-normal text-purple-400/60">35–40″ lobby monitor · airport-style display</div>
            </div>
          </a>
          <a
            href="/parcels/mobile-scan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 min-h-[56px] rounded-xl px-5
                       bg-blue-500/10 border border-blue-500/30
                       hover:bg-blue-500/20 hover:border-blue-500/50
                       text-blue-300 text-sm font-semibold
                       active:scale-[0.98] transition-all"
          >
            <Smartphone size={20} aria-hidden="true" />
            <div>
              <div>iPhone Parcel Scanner</div>
              <div className="text-xs font-normal text-blue-400/60">Camera-based tracking &amp; unit scan</div>
            </div>
          </a>
          <a
            href="/parcels/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 min-h-[56px] rounded-xl px-5
                       bg-emerald-500/10 border border-emerald-500/30
                       hover:bg-emerald-500/20 hover:border-emerald-500/50
                       text-emerald-300 text-sm font-semibold
                       active:scale-[0.98] transition-all"
          >
            <Tablet size={20} aria-hidden="true" />
            <div>
              <div>iPad Parcel POS</div>
              <div className="text-xs font-normal text-emerald-400/60">Intake dashboard with resident lookup</div>
            </div>
          </a>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          BIG ACTION BUTTONS
          ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-3">
        {/* Manual refresh */}
        <button
          type="button"
          onClick={() => {
            fetchStats();
            showToast("info", "Refreshing dashboard…");
          }}
          className="flex items-center justify-center gap-3 min-h-[56px]
                     bg-stone-900 border border-stone-700
                     hover:bg-stone-800 hover:border-amber-500/40
                     text-white text-base font-semibold rounded-xl px-6
                     active:scale-[0.98] transition-all"
        >
          <RefreshCw size={20} />
          Refresh Now
        </button>
      </div>
    </div>
  );
}

