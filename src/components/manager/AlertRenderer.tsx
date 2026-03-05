"use client";

/**
 * AlertRenderer.tsx — Orchestrates the alert UI layer.
 *
 * Renders:
 *   1. AlertModal (blocking overlay) when any P0 alert is active.
 *   2. AlertBannerStack (stacking banners) for P1 and P2 alerts,
 *      suppressed while any P0 alert is active to avoid competing urgency.
 *
 * Drop this component once inside the manager page layout, below the
 * header and above the main content area.
 */

import AlertModal from "@/components/manager/AlertModal";
import AlertBannerStack from "@/components/manager/AlertBannerStack";
import { useAlertManager } from "@/context/AlertManager";

export default function AlertRenderer() {
  const { hasBlockingAlert } = useAlertManager();

  return (
    <>
      {/* P0 — full-screen blocking modal (absolute visual priority) */}
      <AlertModal />
      {/* P1 + P2 — suppressed while a P0 blocking alert is active */}
      {!hasBlockingAlert && <AlertBannerStack />}
    </>
  );
}
