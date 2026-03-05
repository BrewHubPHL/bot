"use client";

/**
 * AlertModal.tsx — Full-screen blocking overlay for P0 (Critical) alerts.
 *
 * Renders when `useAlertManager().hasBlockingAlert` is true.
 * The user MUST acknowledge each P0 alert before the dashboard becomes
 * interactive again. Focus is trapped inside the modal.
 */

import React, { useEffect, useRef } from "react";
import {
  ShieldAlert,
  Database,
  X,
  Copy,
  AlertOctagon,
} from "lucide-react";
import { AlertPriority, useAlertManager, type SystemAlert } from "@/context/AlertManager";

/* ── Single P0 card ────────────────────────────────────────── */
function P0Card({ alert }: { alert: SystemAlert }) {
  const { dismissAlert } = useAlertManager();
  const [copied, setCopied] = React.useState(false);

  const handleAction = () => {
    if (alert.onAction) alert.onAction();
    setCopied(true);
    setTimeout(() => setCopied(false), 6000);
  };

  const handleDismiss = () => {
    dismissAlert(alert.id);
  };

  // Extract typed metadata for safe rendering
  const missingCols = (alert.meta?.missingColumns ?? []) as { column: string; expectedType: string }[];
  const typeMismatches = (alert.meta?.typeMismatches ?? []) as { column: string; expectedType: string; actualType: string }[];

  return (
    <div className="rounded-2xl border border-red-700/60 bg-red-950/90 p-6 shadow-2xl max-w-xl w-full">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-red-900/80 p-2 shrink-0">
          {alert.category === "schema" ? (
            <Database size={24} className="text-red-400" />
          ) : (
            <AlertOctagon size={24} className="text-red-400" />
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wide text-red-300 flex items-center gap-2">
              <ShieldAlert size={14} />
              {alert.title}
            </h3>
          </div>

          <p className="text-sm text-red-200 leading-relaxed">
            {alert.message}
          </p>

          {/* Render missing-columns / type-mismatches from meta */}
          {missingCols.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-300 mb-1">Missing columns:</p>
                <ul className="list-disc list-inside text-xs text-red-200/80 space-y-0.5">
                  {missingCols.map((col) => (
                    <li key={col.column}>
                      <code className="bg-red-900/50 px-1 rounded">{col.column}</code>
                      <span className="text-red-400 ml-1">({col.expectedType})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {typeMismatches.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-300 mb-1">Type mismatches:</p>
                <ul className="list-disc list-inside text-xs text-red-200/80 space-y-0.5">
                  {typeMismatches.map((m) => (
                    <li key={m.column}>
                      <code className="bg-red-900/50 px-1 rounded">{m.column}</code>
                      <span className="text-red-400 ml-1">
                        expected <code>{m.expectedType}</code>, got <code>{m.actualType}</code>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center gap-3">
              {alert.actionLabel && (
                <button
                  type="button"
                  onClick={handleAction}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-800 hover:bg-red-700
                             px-4 py-2 text-xs font-semibold text-red-100 transition-colors"
                >
                  <Copy size={13} />
                  {copied ? "Copied!" : alert.actionLabel}
                </button>
              )}
              <button
                type="button"
                onClick={handleDismiss}
                className="inline-flex items-center gap-2 rounded-lg border border-red-700 hover:bg-red-900
                           px-4 py-2 text-xs font-semibold text-red-300 transition-colors"
              >
                <X size={13} />
                Acknowledge
              </button>
            </div>
            {copied && (
              <p className="text-[11px] text-amber-400/90 leading-snug">
                Generated SQL includes explicit type casting. Ensure no invalid data exists in affected columns before executing.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Modal overlay ─────────────────────────────────────────── */
export default function AlertModal() {
  const { alerts } = useAlertManager();
  const p0Alerts = alerts.filter((a) => a.priority === AlertPriority.P0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Trap focus inside the modal
  useEffect(() => {
    if (p0Alerts.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return; // don't allow escape — must acknowledge
      if (e.key !== "Tab" || !overlayRef.current) return;

      const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    // Auto-focus first button
    const firstBtn = overlayRef.current?.querySelector<HTMLElement>("button");
    firstBtn?.focus();

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [p0Alerts.length]);

  if (p0Alerts.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      role="alertdialog"
      aria-modal="true"
      aria-label="Critical system alerts require acknowledgement"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-2">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-900/60 border border-red-700/50 text-xs font-bold uppercase tracking-widest text-red-300">
            <AlertOctagon size={14} className="animate-pulse" />
            {p0Alerts.length} Critical Alert{p0Alerts.length !== 1 ? "s" : ""} — Action Required
          </span>
        </div>
        {p0Alerts.map((alert) => (
          <P0Card key={alert.id} alert={alert} />
        ))}
      </div>
    </div>
  );
}
