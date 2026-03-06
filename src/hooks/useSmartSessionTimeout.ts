"use client";

/**
 * useSmartSessionTimeout — visibility-based session expiry
 *
 * Listens for `document.visibilitychange`:
 *  - On hidden: stamps `Date.now()` into localStorage (`brewhub_last_active`)
 *  - On visible: checks elapsed time against the caller's threshold.
 *    If exceeded, fires the provided `onExpire` callback.
 *    If under threshold, clears the stamp and resumes silently.
 *
 * Two presets are exported:
 *  - useCustomerSessionTimeout  → 15-min threshold → Supabase signOut + redirect
 *  - useStaffSessionTimeout     → 12-hour threshold → forceOpsLogout
 *    Staff hook also monitors clock-out status; if the staff member clocks
 *    out in another tab (broadcast channel), the session is terminated.
 */

import { useEffect, useRef } from "react";

/* ─── Constants ──────────────────────────────────────── */
const LS_KEY = "brewhub_last_active";
const CUSTOMER_TIMEOUT_MS = 15 * 60 * 1_000;      // 15 minutes
const STAFF_TIMEOUT_MS = 12 * 60 * 60 * 1_000;    // 12 hours

/* ─── Core hook ──────────────────────────────────────── */
interface SmartTimeoutOptions {
  /** Maximum allowed background time in milliseconds */
  thresholdMs: number;
  /** Fired when the background duration exceeds the threshold */
  onExpire: () => void;
  /** Set false to disable (e.g. while auth state is loading) */
  enabled?: boolean;
}

export function useSmartSessionTimeout({
  thresholdMs,
  onExpire,
  enabled = true,
}: SmartTimeoutOptions): void {
  // Stable ref so the listener always sees the latest callback
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    function handleVisibilityChange() {
      try {
        if (document.visibilityState === "hidden") {
          // Going to background → stamp the time
          localStorage.setItem(LS_KEY, String(Date.now()));
        } else {
          // Returning to foreground → check elapsed
          const raw = localStorage.getItem(LS_KEY);
          if (!raw) return; // no stamp — nothing to check

          const elapsed = Date.now() - Number(raw);
          localStorage.removeItem(LS_KEY);

          if (elapsed > thresholdMs) {
            onExpireRef.current();
          }
        }
      } catch {
        // localStorage unavailable (private browsing quota, etc.) — degrade silently
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [thresholdMs, enabled]);
}

/* ─── Customer preset ────────────────────────────────── */
/**
 * Mount once under the (site) layout tree.
 * Signs out the Supabase customer session and navigates to /login
 * when the tab has been backgrounded for > 15 minutes.
 */
export function useCustomerSessionTimeout(enabled = true): void {
  useSmartSessionTimeout({
    thresholdMs: CUSTOMER_TIMEOUT_MS,
    enabled,
    onExpire: async () => {
      // Dynamic imports keep the bundle lean when not triggered
      const { supabase } = await import("@/lib/supabase");
      await supabase.auth.signOut();
      window.location.href = "/login";
    },
  });
}

/* ─── Staff preset ───────────────────────────────────── */
/**
 * Mount once inside the OpsGate/StaffShiftProvider tree.
 * Bounces the staffer to the PIN screen when:
 *   1. The tab has been backgrounded for > 12 hours, OR
 *   2. The staff member clocked out (isClockedIn went false in another tab).
 */
export function useStaffSessionTimeout(
  isClockedIn: boolean,
  enabled = true,
): void {
  const clockedOutRef = useRef(false);

  // Track clock-out across tabs — if they clock out while backgrounded,
  // force logout on next foreground even if under 12 hours.
  useEffect(() => {
    if (!enabled) return;
    if (!isClockedIn && clockedOutRef.current) {
      // Was clocked in, now clocked out → force logout
      import("@/lib/authz").then(({ forceOpsLogout }) => forceOpsLogout());
    }
    clockedOutRef.current = isClockedIn;
  }, [isClockedIn, enabled]);

  useSmartSessionTimeout({
    thresholdMs: STAFF_TIMEOUT_MS,
    enabled,
    onExpire: async () => {
      const { forceOpsLogout } = await import("@/lib/authz");
      forceOpsLogout();
    },
  });
}
