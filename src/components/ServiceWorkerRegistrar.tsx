"use client";

/**
 * ServiceWorkerRegistrar — Production-only SW lifecycle manager.
 *
 * RULES:
 *   1. PRODUCTION: Register /sw.js, listen for stale-chunk signals,
 *      and auto-activate new versions via SKIP_WAITING.
 *   2. DEVELOPMENT: Actively find and UNREGISTER every existing SW so
 *      stale RSC / chunk caches can never poison local dev.
 *   3. All SW promises are guarded with try/catch so an unhandled
 *      rejection never leaks from this component.
 */

import { useEffect } from "react";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // ── Abort flag for React Strict-Mode double-mount safety ────
    let cancelled = false;

    /* ═══════════════════════════════════════════════════════════
       DEV MODE — nuke every registered SW so stale caches die
       ═══════════════════════════════════════════════════════════ */
    if (!IS_PRODUCTION) {
      (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          if (registrations.length === 0) return;
          console.warn(
            `[SW-DEV] Found ${registrations.length} service worker(s) — unregistering all…`
          );
          await Promise.all(
            registrations.map((r) =>
              r.unregister().catch((err) =>
                console.warn("[SW-DEV] Unregister failed:", (err as Error)?.message)
              )
            )
          );
          console.info("[SW-DEV] All service workers removed. Caches cleared for dev.");
        } catch (err) {
          console.warn("[SW-DEV] Cleanup error:", (err as Error)?.message);
        }
      })();

      // Nothing else to do in dev — no listener, no registration
      return;
    }

    /* ═══════════════════════════════════════════════════════════
       PRODUCTION — register + manage the SW
       ═══════════════════════════════════════════════════════════ */

    // Listen for stale-chunk signals from the SW and hard-reload
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "CHUNK_STALE") {
        console.warn("[SW] Build changed — reloading for fresh chunks");
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return; // component unmounted before promise settled
        console.log("[SW] Registered, scope:", reg.scope);

        // Auto-update: if a new SW is waiting, activate it
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch (err) {
        if (!cancelled) {
          console.warn("[SW] Registration failed:", (err as Error)?.message);
        }
      }
    })();

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
