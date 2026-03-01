"use client";

import { useState, useEffect, memo } from "react";

/* ------------------------------------------------------------------ */
/* LiveClock — self-contained timer micro-component                     */
/*                                                                      */
/* Owns its own useState + setInterval so only THIS component           */
/* re-renders on tick, not the entire page tree it sits inside.         */
/* ------------------------------------------------------------------ */

interface LiveClockProps {
  /**
   * Tick interval in milliseconds.
   * - POS uses 60_000 (display is HH:MM only)
   * - KDS uses 1_000  (display includes seconds)
   */
  intervalMs?: number;
  /** Render function — receives the current Date and returns JSX */
  children: (now: Date) => React.ReactNode;
}

function LiveClockInner({ intervalMs = 1_000, children }: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Immediately sync on mount
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return <>{children(now)}</>;
}

/**
 * Memoised so parent re-renders never propagate inward
 * (the render-prop `children` should be a stable reference or inline arrow —
 *  React.memo compares props by reference, and because `children` is always a
 *  new arrow the memo mainly protects against *other* prop changes; the real
 *  win is that the setInterval state lives here, not in the parent).
 */
const LiveClock = memo(LiveClockInner);
LiveClock.displayName = "LiveClock";

export default LiveClock;
