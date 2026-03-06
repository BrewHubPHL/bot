"use client";

/**
 * AlertManager.tsx — Centralized alert state for the Manager Dashboard.
 *
 * Defines a prioritized alert hierarchy:
 *   P0 (Critical / Red)  → Schema mismatches, DB connection failures
 *                           Rendered as a blocking modal overlay.
 *   P1 (High / Amber)    → Maintenance overdue, Staff exhaustion (>16h)
 *   P2 (Medium / Blue)   → Low stock warnings, Pending agreement signatures
 *                           P1/P2 rendered as stacking banners below the header.
 *
 * Components push alerts via `pushAlert()` and the renderer decides
 * modal vs. banner based on priority.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";

/* ── Priority enum ─────────────────────────────────────────── */
export enum AlertPriority {
  P0 = 0, // Critical — blocks interaction
  P1 = 1, // High — prominent banner
  P2 = 2, // Medium — informational banner
}

/* ── Alert type interface ──────────────────────────────────── */
export interface SystemAlert {
  /** Unique identifier (de-duplication key). */
  id: string;
  /** Severity / render tier. */
  priority: AlertPriority;
  /** Short heading shown in the alert UI. */
  title: string;
  /** Longer description / body text. */
  message: string;
  /** Optional category tag for grouping (e.g. "schema", "asset", "stock"). */
  category?: string;
  /** Arbitrary metadata the rendering component may use. */
  meta?: Record<string, unknown>;
  /** Whether the user can dismiss this alert. P0 defaults to true (must acknowledge). */
  dismissible?: boolean;
  /** Optional CTA label (e.g. "View Assets", "Copy Migration SQL"). */
  actionLabel?: string;
  /** Callback fired when the user clicks the CTA. */
  onAction?: () => void;
  /** ISO timestamp of when the alert was pushed. */
  pushedAt: string;
}

/* ── Reducer ───────────────────────────────────────────────── */
type AlertAction =
  | { type: "PUSH"; alert: SystemAlert }
  | { type: "DISMISS"; id: string }
  | { type: "DISMISS_ALL" }
  | { type: "CLEAR_PRIORITY"; priority: AlertPriority };

function alertReducer(state: SystemAlert[], action: AlertAction): SystemAlert[] {
  switch (action.type) {
    case "PUSH": {
      // Upsert — replace if same id exists, otherwise append
      const exists = state.findIndex((a) => a.id === action.alert.id);
      const next = exists >= 0
        ? state.map((a, i) => (i === exists ? action.alert : a))
        : [...state, action.alert];
      // Sort: P0 first, then P1, then P2. Within same priority, oldest first.
      return next.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(a.pushedAt).getTime() - new Date(b.pushedAt).getTime();
      });
    }
    case "DISMISS": {
      const exists = state.some((a) => a.id === action.id);
      return exists ? state.filter((a) => a.id !== action.id) : state;
    }
    case "DISMISS_ALL":
      return [];
    case "CLEAR_PRIORITY":
      return state.filter((a) => a.priority !== action.priority);
    default:
      return state;
  }
}

/* ── Context shape ─────────────────────────────────────────── */
interface AlertContextValue {
  /** All active alerts, sorted by priority then age. */
  alerts: SystemAlert[];
  /** Push (or upsert) an alert into the queue. */
  pushAlert: (alert: Omit<SystemAlert, "pushedAt">) => void;
  /** Dismiss a single alert by id. */
  dismissAlert: (id: string) => void;
  /** Dismiss every alert. */
  dismissAll: () => void;
  /** Remove all alerts of a given priority tier. */
  clearPriority: (priority: AlertPriority) => void;

  /* ── Derived convenience selectors ────────────────────── */
  /** True when at least one P0 alert is active. */
  hasBlockingAlert: boolean;
  /** Count of P0 alerts. */
  p0Count: number;
  /** Count of P1 alerts. */
  p1Count: number;
  /** Count of P2 alerts. */
  p2Count: number;
  /** Total active alert count. */
  totalCount: number;
}

const AlertContext = createContext<AlertContextValue | null>(null);

/**
 * Exported so components that may live outside the provider tree
 * can do a safe `useContext(AlertContext)` check before calling pushAlert.
 */
export { AlertContext };

/* ── Provider ──────────────────────────────────────────────── */
export function AlertManagerProvider({ children }: { children: React.ReactNode }) {
  const [alerts, dispatch] = useReducer(alertReducer, []);

  const pushAlert = useCallback(
    (alert: Omit<SystemAlert, "pushedAt">) => {
      dispatch({
        type: "PUSH",
        alert: { ...alert, pushedAt: new Date().toISOString() },
      });
    },
    [],
  );

  const dismissAlert = useCallback((id: string) => {
    dispatch({ type: "DISMISS", id });
  }, []);

  const dismissAll = useCallback(() => {
    dispatch({ type: "DISMISS_ALL" });
  }, []);

  const clearPriority = useCallback((priority: AlertPriority) => {
    dispatch({ type: "CLEAR_PRIORITY", priority });
  }, []);

  const value = useMemo<AlertContextValue>(() => {
    const p0Count = alerts.filter((a) => a.priority === AlertPriority.P0).length;
    const p1Count = alerts.filter((a) => a.priority === AlertPriority.P1).length;
    const p2Count = alerts.filter((a) => a.priority === AlertPriority.P2).length;
    return {
      alerts,
      pushAlert,
      dismissAlert,
      dismissAll,
      clearPriority,
      hasBlockingAlert: p0Count > 0,
      p0Count,
      p1Count,
      p2Count,
      totalCount: alerts.length,
    };
  }, [alerts, pushAlert, dismissAlert, dismissAll, clearPriority]);

  return (
    <AlertContext.Provider value={value}>{children}</AlertContext.Provider>
  );
}

/* ── Hook ──────────────────────────────────────────────────── */
export function useAlertManager(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlertManager must be used inside <AlertManagerProvider>");
  }
  return ctx;
}
