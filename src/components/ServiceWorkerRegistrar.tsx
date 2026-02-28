"use client";

/**
 * ServiceWorkerRegistrar — registers the BrewHub service worker
 * on mount. Silent no-op if SW is not supported (server render, etc.).
 */

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Listen for stale-chunk signals from the SW and hard-reload
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "CHUNK_STALE") {
        console.warn("[SW] Build changed — reloading for fresh chunks");
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] Registered, scope:", reg.scope);

        // Auto-update: if a new SW is waiting, activate it
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version ready — activate immediately
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", (err as Error)?.message);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
