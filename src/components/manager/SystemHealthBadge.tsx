"use client";

/**
 * SystemHealthBadge.tsx — Segmented header badge showing alert counts by severity.
 *
 * Displays per-severity segment pills (e.g. "1 Critical | 2 Warning | 3 Info")
 * instead of a single aggregate number. Each segment is color-coded:
 *   P0 (Critical) → red, P1 (Warning) → amber, P2 (Info) → blue.
 *
 * Clicking the badge smooth-scrolls to the `#alert-stack` anchor where
 * the P1/P2 banner list lives. The outer border color reflects the
 * highest active severity.
 */

import React from "react";
import { Bell } from "lucide-react";
import { useAlertManager } from "@/context/AlertManager";

/* ── Segment config ────────────────────────────────────────── */
interface Segment {
  label: string;
  count: number;
  text: string;
  dot: string;
  bg: string;
}

export default function SystemHealthBadge() {
  const { totalCount, p0Count, p1Count, p2Count } = useAlertManager();

  if (totalCount === 0) return null;

  // Build segment list — only include tiers that have active alerts
  const segments: Segment[] = [];
  if (p0Count > 0) {
    segments.push({
      label: "Critical",
      count: p0Count,
      text: "text-red-400",
      dot: "bg-red-500",
      bg: "bg-red-500/10",
    });
  }
  if (p1Count > 0) {
    segments.push({
      label: "Warning",
      count: p1Count,
      text: "text-amber-400",
      dot: "bg-amber-400",
      bg: "bg-amber-500/10",
    });
  }
  if (p2Count > 0) {
    segments.push({
      label: "Info",
      count: p2Count,
      text: "text-blue-400",
      dot: "bg-blue-400",
      bg: "bg-blue-500/10",
    });
  }

  // Outer border color reflects highest active severity
  const borderColor =
    p0Count > 0
      ? "border-red-500/40 hover:bg-red-500/20"
      : p1Count > 0
        ? "border-amber-500/40 hover:bg-amber-500/20"
        : "border-blue-500/40 hover:bg-blue-500/20";

  // Pulsing dot color mirrors highest severity
  const dotColor =
    p0Count > 0
      ? "bg-red-500"
      : p1Count > 0
        ? "bg-amber-400"
        : "bg-blue-400";

  // Build accessible label enumerating every tier
  const ariaSegments = segments
    .map((s) => `${s.count} ${s.label}`)
    .join(", ");

  const handleClick = () => {
    const target = document.getElementById("alert-stack");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                   transition-colors border ${borderColor}`}
      aria-label={`System alerts: ${ariaSegments}`}
    >
      <Bell size={14} className="shrink-0" />

      {/* Segmented severity pills */}
      <span className="flex items-center gap-1.5">
        {segments.map((seg, idx) => (
          <React.Fragment key={seg.label}>
            {idx > 0 && (
              <span className="text-zinc-600 select-none" aria-hidden>
                |
              </span>
            )}
            <span
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${seg.bg} ${seg.text}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${seg.dot}`} />
              <span className="font-bold tabular-nums">{seg.count}</span>
              <span className="font-medium">{seg.label}</span>
            </span>
          </React.Fragment>
        ))}
      </span>

      {/* Global pulse dot */}
      <span
        className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${dotColor}`}
      />
    </button>
  );
}
