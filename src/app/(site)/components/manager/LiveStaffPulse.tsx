"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { Users, RefreshCw } from "lucide-react";

/* ── Optional AlertManager integration ─────────────────────── */
import { AlertPriority, AlertContext } from "@/context/AlertManager";
/* We use useContext(AlertContext) directly because LiveStaffPulse may render
   outside of the AlertManagerProvider (e.g. admin dashboard). */
import { useContext } from "react";

/* ================================================================== */
/*  LiveStaffPulse — persistent header badge showing who's on-site    */
/*                                                                     */
/*  Polls get-manager-stats every 30s to show currently clocked-in    */
/*  staff with a live duration timer that ticks every minute.         */
/*  Visible across ALL manager dashboard tabs.                         */
/*                                                                     */
/*  Doomsday Scenario 6: THE LATE NIGHT BAKER                         */
/* ================================================================== */

interface ActiveStaff {
  name: string;
  email: string;
  clock_in: string;
}

export default function LiveStaffPulse() {
  const session = useOpsSessionOptional();
  const token = session?.token;
  const [staff, setStaff] = useState<ActiveStaff[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0); // forces timer re-render
  const [refreshing, setRefreshing] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Safe AlertManager access (may be null outside provider) ── */
  const alertCtx = useContext(AlertContext);
  // Destructure stable function refs (useCallback with []) so that the
  // exhaustion useEffect does not depend on the whole context object —
  // which changes identity whenever `alerts` state updates, causing an
  // infinite re-render loop (React Error #185).
  const pushAlert = alertCtx?.pushAlert ?? null;
  const dismissAlert = alertCtx?.dismissAlert ?? null;

  const fetchActiveStaff = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchOps("/get-manager-stats", {}, token);
      if (res.status === 401) return; // fetchOps already triggers forceOpsLogout
      if (!res.ok) return;
      const data = await res.json();
      setStaff(data.activeShifts ?? []);
    } catch {
      // Silent — don't break the header for a failed poll
    }
  }, [token]);

  // Fetch once on mount — subsequent refreshes are manual
  useEffect(() => {
    fetchActiveStaff();
  }, [fetchActiveStaff]);

  /* ── Push P1 alert for staff working > 16h ────────────────── */
  useEffect(() => {
    if (!pushAlert || !dismissAlert) return; // Not inside AlertManagerProvider
    const exhausted = staff.filter((s) => {
      const hrs = (Date.now() - new Date(s.clock_in).getTime()) / 3_600_000;
      return hrs >= 16;
    });
    if (exhausted.length > 0) {
      const names = exhausted.map((s) => s.name).join(", ");
      pushAlert({
        id: "staff-exhaustion",
        priority: AlertPriority.P1,
        title: "Staff Exhaustion Alert",
        message: `${exhausted.length} staff member${exhausted.length !== 1 ? "s" : ""} on-site >16 hours: ${names}`,
        category: "staff",
        dismissible: true,
      });
    } else {
      // Clear the alert if no one is exhausted anymore
      dismissAlert("staff-exhaustion");
    }
  }, [staff, pushAlert, dismissAlert, tick]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActiveStaff();
    setRefreshing(false);
  }, [fetchActiveStaff]);

  // Tick every 60s to update duration timers
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Close expanded panel on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-live-staff]")) setExpanded(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [expanded]);

  const formatDuration = (clockIn: string): string => {
    // Reference tick to force re-render
    void tick;
    const ms = Date.now() - new Date(clockIn).getTime();
    const hrs = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return `${hrs}h ${mins}m`;
  };

  const getSeverity = (clockIn: string): "normal" | "warn" | "alert" => {
    const hrs = (Date.now() - new Date(clockIn).getTime()) / 3_600_000;
    if (hrs >= 16) return "alert";
    if (hrs >= 8) return "warn";
    return "normal";
  };

  const count = staff.length;
  const hasAlert = staff.some((s) => getSeverity(s.clock_in) === "alert");

  return (
    <div className="relative" data-live-staff>
      {/* Badge button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                     transition-colors border ${
                       count === 0
                         ? "border-stone-700 text-stone-500 hover:border-stone-600"
                         : hasAlert
                           ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                           : "border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                     }`}
        aria-label={`${count} staff currently on-site`}
      >
        <Users size={14} className={refreshing ? "animate-spin" : ""} />
        <span className="hidden sm:inline">On-Site:</span>
        <span className="font-bold">{count}</span>
        {count > 0 && (
          <span
            className={`w-2 h-2 rounded-full ${
              hasAlert ? "bg-red-500 animate-pulse" : "bg-green-500 animate-pulse"
            }`}
          />
        )}
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <div
          className="absolute right-0 top-full mt-2 w-72 bg-stone-950 border border-stone-800
                      rounded-xl shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
            <span className="text-sm font-bold text-stone-200">
              👥 Currently On-Site
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 transition-colors"
              aria-label="Refresh staff data"
            >
              <RefreshCw size={10} className={refreshing ? "animate-spin" : ""} />
              {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </button>
          </div>

          {count === 0 ? (
            <div className="px-4 py-6 text-center text-stone-500 text-sm">
              No staff clocked in right now.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-stone-800/50">
              {staff.map((s) => {
                const severity = getSeverity(s.clock_in);
                return (
                  <div key={s.email} className="flex items-center gap-3 px-4 py-2.5">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        severity === "alert"
                          ? "bg-red-500 animate-pulse"
                          : severity === "warn"
                            ? "bg-amber-400"
                            : "bg-green-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-200 truncate">
                        {s.name}
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">
                        Since {new Date(s.clock_in).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <div
                      className={`text-xs font-bold flex-shrink-0 ${
                        severity === "alert"
                          ? "text-red-400"
                          : severity === "warn"
                            ? "text-amber-400"
                            : "text-green-400"
                      }`}
                    >
                      {formatDuration(s.clock_in)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-4 py-2 border-t border-stone-800 text-[10px] text-stone-600 text-center">
            Powered by time_logs • Manual refresh
          </div>
        </div>
      )}
    </div>
  );
}
