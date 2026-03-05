"use client";

/**
 * AlertBannerStack.tsx — Stacking banner list for P1 (High) and P2 (Medium) alerts.
 *
 * Rendered below the sticky header. Sorted by priority (P1 first) then age.
 * Each banner is color-coded:
 *   P1 → Amber/warning
 *   P2 → Blue/informational
 */

import React from "react";
import {
  AlertTriangle,
  Info,
  X,
  ChevronRight,
} from "lucide-react";
import {
  AlertPriority,
  useAlertManager,
  type SystemAlert,
} from "@/context/AlertManager";

/* ── Color & icon map ──────────────────────────────────────── */
const TIER_STYLES: Record<
  number,
  {
    border: string;
    bg: string;
    icon: string;
    title: string;
    text: string;
    dismiss: string;
    action: string;
    dot: string;
  }
> = {
  [AlertPriority.P1]: {
    border: "border-amber-700/50",
    bg: "bg-amber-950/70",
    icon: "text-amber-400",
    title: "text-amber-300",
    text: "text-amber-200/90",
    dismiss: "hover:bg-amber-800 text-amber-400 hover:text-amber-200",
    action:
      "bg-amber-800 hover:bg-amber-700 text-amber-100",
    dot: "bg-amber-400",
  },
  [AlertPriority.P2]: {
    border: "border-blue-700/50",
    bg: "bg-blue-950/70",
    icon: "text-blue-400",
    title: "text-blue-300",
    text: "text-blue-200/90",
    dismiss: "hover:bg-blue-800 text-blue-400 hover:text-blue-200",
    action:
      "bg-blue-800 hover:bg-blue-700 text-blue-100",
    dot: "bg-blue-400",
  },
};

/* ── Single banner row ─────────────────────────────────────── */
function BannerRow({ alert }: { alert: SystemAlert }) {
  const { dismissAlert } = useAlertManager();
  const styles = TIER_STYLES[alert.priority] ?? TIER_STYLES[AlertPriority.P2];
  const IconComponent = alert.priority === AlertPriority.P1 ? AlertTriangle : Info;

  return (
    <div
      role="alert"
      className={`rounded-xl border ${styles.border} ${styles.bg} px-4 py-3 shadow-lg
                  transition-all duration-300 animate-in fade-in slide-in-from-top-2`}
    >
      <div className="flex items-start gap-3">
        <IconComponent size={18} className={`mt-0.5 shrink-0 ${styles.icon}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${styles.dot}`}
            />
            <h4 className={`text-xs font-bold uppercase tracking-wide ${styles.title}`}>
              {alert.title}
            </h4>
          </div>
          <p className={`text-sm mt-0.5 ${styles.text}`}>{alert.message}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {alert.actionLabel && alert.onAction && (
            <button
              type="button"
              onClick={alert.onAction}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${styles.action}`}
            >
              {alert.actionLabel}
              <ChevronRight size={12} />
            </button>
          )}
          {(alert.dismissible ?? true) && (
            <button
              type="button"
              onClick={() => dismissAlert(alert.id)}
              className={`p-1 rounded transition-colors ${styles.dismiss}`}
              aria-label={`Dismiss: ${alert.title}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Stack container ───────────────────────────────────────── */
export default function AlertBannerStack() {
  const { alerts } = useAlertManager();
  const bannerAlerts = alerts.filter(
    (a) => a.priority === AlertPriority.P1 || a.priority === AlertPriority.P2,
  );

  if (bannerAlerts.length === 0) return null;

  return (
    <div
      id="alert-stack"
      className="mx-auto max-w-7xl px-4 sm:px-6 mt-2 space-y-2"
      aria-label="System alerts"
    >
      {bannerAlerts.map((alert) => (
        <BannerRow key={alert.id} alert={alert} />
      ))}
    </div>
  );
}
