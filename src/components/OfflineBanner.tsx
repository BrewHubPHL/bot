"use client";

/**
 * OfflineBanner.tsx — Full-width alert bar shown on ops screens when
 * the internet is down. Displays duration, pending order count, cash
 * exposure cap, and an explicit "DO NOT USE SQUARE TERMINAL OFFLINE MODE"
 * warning to prevent Ghost Revenue losses.
 */

import { useState, useEffect } from "react";
import { WifiOff, RefreshCw, CheckCircle2, ShieldAlert, DollarSign } from "lucide-react";
import { getUnsyncedOrders } from "@/lib/offlineStore";

interface OfflineExposure {
  sessionId: string | null;
  cashTotalCents: number;
  capCents: number;
  pctUsed: number;
  remainingCents: number;
}

interface Props {
  isOnline: boolean;
  wasOffline: boolean;
  offlineSince: Date | null;
  /** Current offline session exposure data (from POS page state) */
  exposure?: OfflineExposure | null;
}

function formatDuration(since: Date): string {
  const sec = Math.floor((Date.now() - since.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function cents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

export default function OfflineBanner({ isOnline, wasOffline, offlineSince, exposure }: Props) {
  const [elapsed, setElapsed] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [showRecovery, setShowRecovery] = useState(false);

  // Tick the elapsed time every second while offline
  useEffect(() => {
    if (!offlineSince || isOnline) return;
    const tick = () => setElapsed(formatDuration(offlineSince));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [offlineSince, isOnline]);

  // Count pending offline orders
  useEffect(() => {
    if (!isOnline) {
      const check = async () => {
        try {
          const orders = await getUnsyncedOrders();
          setPendingCount(orders.length);
        } catch { /* IDB fail — ignore */ }
      };
      check();
      const t = setInterval(check, 5000);
      return () => clearInterval(t);
    }
  }, [isOnline]);

  // Flash recovery message for 4 seconds
  useEffect(() => {
    if (wasOffline) {
      setShowRecovery(true);
      const t = setTimeout(() => setShowRecovery(false), 4000);
      return () => clearTimeout(t);
    }
  }, [wasOffline]);

  // ── Recovery banner (connection restored) ──────────────────
  if (showRecovery) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-emerald-600 text-white px-4 py-3 flex items-center justify-center gap-3 shadow-lg animate-pulse">
        <CheckCircle2 size={20} />
        <span className="font-bold text-sm tracking-wide uppercase">
          Connection Restored — Syncing offline orders…
        </span>
        <RefreshCw size={16} className="animate-spin" />
      </div>
    );
  }

  // ── Offline banner ─────────────────────────────────────────
  if (!isOnline) {
    const pctUsed = exposure?.pctUsed ?? 0;
    const capWarning = pctUsed >= 90;
    const capHit = pctUsed >= 100;

    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-700 text-white shadow-lg">
        {/* ── Primary status bar ── */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-center gap-3">
            <WifiOff size={22} className="animate-pulse" />
            <div className="text-center">
              <div className="font-black text-sm tracking-[0.2em] uppercase">
                OFFLINE — CASH ONLY MODE
              </div>
              <div className="text-xs text-red-200 mt-0.5">
                No internet for {elapsed}
                {pendingCount > 0 && (
                  <> · <span className="font-bold text-white">{pendingCount} order{pendingCount !== 1 ? "s" : ""} queued</span></>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Cash exposure meter ── */}
        {exposure && exposure.sessionId && (
          <div className="px-4 pb-2">
            <div className="max-w-md mx-auto">
              {/* Progress bar */}
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={12} className="text-red-300 shrink-0" />
                <div className="flex-1 h-2 bg-red-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      capHit ? "bg-yellow-400 animate-pulse" :
                      capWarning ? "bg-orange-400" :
                      "bg-red-300"
                    }`}
                    style={{ width: `${Math.min(100, pctUsed)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-red-200 shrink-0 w-12 text-right">
                  {pctUsed}%
                </span>
              </div>
              {/* Amounts */}
              <div className="flex justify-between text-[10px] text-red-300">
                <span>Cash: <strong className="text-white">{cents(exposure.cashTotalCents)}</strong></span>
                <span>Cap: {cents(exposure.capCents)}</span>
                <span>
                  {capHit ? (
                    <strong className="text-yellow-300 uppercase animate-pulse">CAP REACHED</strong>
                  ) : (
                    <>Left: <strong className="text-white">{cents(exposure.remainingCents)}</strong></>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Terminal lockout warning ── */}
        <div className="bg-red-900/80 border-t border-red-600 px-4 py-2.5">
          <div className="flex items-center justify-center gap-2">
            <ShieldAlert size={16} className="text-yellow-400 shrink-0" />
            <p className="text-[11px] text-center font-bold tracking-wide text-yellow-200 uppercase">
              ⚠️ Do NOT use Square Terminal Offline Mode — Cards will decline later. Cash only!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
