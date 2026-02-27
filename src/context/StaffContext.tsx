"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ================================================================== */
/*  StaffContext — Global shift-status source of truth                 */
/*                                                                     */
/*  Solves the "double clock-in" desync where OpsGate header,          */
/*  DashboardOverhaul, and LiveStaffPulse each maintained separate     */
/*  local state. Now every component reads from one context.           */
/*                                                                     */
/*  Usage:                                                             */
/*    const { isClockedIn, activeShiftId, refreshShiftStatus } =      */
/*      useStaff();                                                    */
/* ================================================================== */

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Types ────────────────────────────────────────────── */
interface ActiveShift {
  id: string;
  clock_in: string;
}

interface StaffShiftState {
  /** Whether the current staff member has an open shift */
  isClockedIn: boolean;
  /** UUID of the open time_logs row (null if not clocked in) */
  activeShiftId: string | null;
  /** ISO timestamp of the current shift start (null if off-shift) */
  shiftStart: string | null;
  /** True while the initial fetch is in-flight */
  loading: boolean;
  /** Call after any clock-in/out action to re-sync global state */
  refreshShiftStatus: () => Promise<void>;
}

const StaffShiftContext = createContext<StaffShiftState | null>(null);

/* ─── Hook ─────────────────────────────────────────────── */
/**
 * Access global shift status from any component within the OpsGate tree.
 * Throws if used outside of `<StaffShiftProvider>`.
 */
export function useStaff(): StaffShiftState {
  const ctx = useContext(StaffShiftContext);
  if (!ctx) {
    throw new Error("useStaff() must be used within <StaffShiftProvider>");
  }
  return ctx;
}

/**
 * Safe variant — returns null when outside the provider tree.
 * Useful for components that may render in both (ops) and (site) layouts.
 */
export function useStaffOptional(): StaffShiftState | null {
  return useContext(StaffShiftContext);
}

/* ─── Provider ─────────────────────────────────────────── */
interface StaffShiftProviderProps {
  /** Staff member email (from OpsSession) */
  staffEmail: string;
  /** Auth token for API calls */
  token: string;
  /** Initial is_working flag from PIN-login response */
  initialIsWorking: boolean;
  children: ReactNode;
}

/** Interval between automatic background refreshes (ms) */
const POLL_INTERVAL_MS = 30_000;

export function StaffShiftProvider({
  staffEmail,
  token,
  initialIsWorking,
  children,
}: StaffShiftProviderProps) {
  const [isClockedIn, setIsClockedIn] = useState(initialIsWorking);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [shiftStart, setShiftStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Prevent concurrent fetches from racing */
  const fetchingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ──────────────────────────────────────────────────────
  //  Core: fetch the current shift status from the backend
  // ──────────────────────────────────────────────────────
  const refreshShiftStatus = useCallback(async () => {
    if (!token || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const res = await fetch(`${API_BASE}/get-shift-status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
      });

      if (!res.ok) {
        // Non-fatal: keep last known state; the header buttons
        // still work even if the poll fails.
        return;
      }

      const data: { isClockedIn: boolean; shiftId: string | null; clockIn: string | null } =
        await res.json();

      setIsClockedIn(data.isClockedIn);
      setActiveShiftId(data.shiftId);
      setShiftStart(data.clockIn);
    } catch {
      // Silent — don't disrupt the UI for a failed poll
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [token]);

  // ──────────────────────────────────────────────────────
  //  Optimistic update: called by OpsGate after a
  //  successful clock-in/out so the UI snaps immediately
  //  before the next poll confirms it.
  // ──────────────────────────────────────────────────────
  // (exposed via refreshShiftStatus which re-fetches truth)

  // ──────────────────────────────────────────────────────
  //  Lifecycle: initial fetch + polling
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    refreshShiftStatus();

    pollTimerRef.current = setInterval(refreshShiftStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [refreshShiftStatus]);

  // ──────────────────────────────────────────────────────
  //  Cross-tab synchronization via BroadcastChannel
  //  When a clock event happens in another tab, all tabs
  //  refresh their state so the header buttons stay in sync.
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel("brewhub_shift_sync");

    channel.onmessage = (event) => {
      const msg = event.data;
      if (msg?.type === "shift_changed" && msg?.email === staffEmail) {
        refreshShiftStatus();
      }
    };

    return () => channel.close();
  }, [staffEmail, refreshShiftStatus]);

  const value: StaffShiftState = {
    isClockedIn,
    activeShiftId,
    shiftStart,
    loading,
    refreshShiftStatus,
  };

  return (
    <StaffShiftContext.Provider value={value}>
      {children}
    </StaffShiftContext.Provider>
  );
}

/* ─── Helper: broadcast shift change to other tabs ─────── */
/**
 * Call this after a successful clock-in/out to notify other
 * browser tabs so they refresh their shift state.
 */
export function broadcastShiftChange(email: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel("brewhub_shift_sync");
    channel.postMessage({ type: "shift_changed", email });
    channel.close();
  } catch {
    // BroadcastChannel not supported or blocked — noop
  }
}
