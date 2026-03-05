"use client";

/**
 * AlertRenderer.tsx — Orchestrates the alert UI layer.
 *
 * Renders:
 *   1. AlertModal (blocking overlay) when any P0 alert is active.
 *   2. AlertBannerStack (stacking banners) for P1 and P2 alerts.
 *
 * Drop this component once inside the manager page layout, below the
 * header and above the main content area.
 */

import AlertModal from "@/components/manager/AlertModal";
import AlertBannerStack from "@/components/manager/AlertBannerStack";

export default function AlertRenderer() {
  return (
    <>
      {/* P0 — full-screen blocking modal */}
      <AlertModal />
      {/* P1 + P2 — stacking banner list */}
      <AlertBannerStack />
    </>
  );
}
