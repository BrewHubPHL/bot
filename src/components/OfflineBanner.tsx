"use client";

/**
 * OfflineBanner.tsx — Full-width alert bar shown on ops screens when
 * the internet is down. Displays duration, pending order count, and
 * sync status on recovery.
 */

import { useState, useEffect } from "react";
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { getUnsyncedOrders } from "@/lib/offlineStore";

interface Props {
  isOnline: boolean;
  wasOffline: boolean;
  offlineSince: Date | null;
}

function formatDuration(since: Date): string {
  const sec = Math.floor((Date.now() - since.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function OfflineBanner({ isOnline, wasOffline, offlineSince }: Props) {
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
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-700 text-white px-4 py-3 shadow-lg">
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
    );
  }

  return null;
}
