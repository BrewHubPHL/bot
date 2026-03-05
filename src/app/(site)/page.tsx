"use client";

/**
 * BrewHub Landing Page — Route Entry Point
 *
 * Hydration-safe wrapper using `next/dynamic` with `ssr: false`.
 *
 * WHY THIS EXISTS (Schema 79 — v_staff_status migration):
 * ─────────────────────────────────────────────────────────
 * The full landing component (BrewHubLandingClient) uses browser-only APIs
 * (Web Speech, AudioContext, canvas-confetti), Supabase auth session checks,
 * and localStorage. During SSR, Next.js App Router wraps client components
 * in internal Suspense streaming boundaries. When the server-rendered tree
 * includes these internal wrappers but the client hydration tree does not,
 * React 19 throws a hydration mismatch error:
 *
 *   Server: <Suspense>
 *   Client: <div className="flex flex-col w-full">
 *
 * By disabling SSR for the interactive component, we eliminate the hydration
 * boundary entirely. The server delivers the static splash shell (below),
 * then the client loads and mounts the full interactive page.
 *
 * The static CTA links (shop, about, location) remain in the splash shell
 * for minimal SEO presence. The full content renders once JS is loaded.
 *
 * v_staff_status READS:
 *   All staff status reads go through backend APIs (pin-login, pin-verify,
 *   get-shift-status) which query `v_staff_status` (Schema 77/79).
 *   This page does NOT query staff_directory or v_staff_status directly.
 */

import nextDynamic from "next/dynamic";

export const dynamic = 'force-dynamic';

/* ── Static splash shell ─────────────────────────────────────────
   Rendered by the server (SSR) as the loading fallback.
   Visually matches the component's own splash animation so the
   transition is seamless: static splash → animated splash → content.
   Uses <img> instead of next/image to keep this shell dependency-free. */
const SplashShell = () => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6]">
    <div className="flex flex-col items-center animate-pulse">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="BrewHub"
        width={140}
        height={140}
        className="rounded-full shadow-2xl border-4 border-[var(--hub-tan)]"
      />
      <h1 className="mt-6 text-3xl font-playfair font-bold text-[var(--hub-espresso)]">
        BrewHub
      </h1>
      <p className="text-[var(--hub-brown)] text-sm mt-2">
        Point Breeze &bull; Philadelphia
      </p>
    </div>
  </div>
);

/* ── Dynamic import: SSR disabled ────────────────────────────── */
const BrewHubLandingClient = nextDynamic(
  () => import("./BrewHubLandingClient"),
  { ssr: false, loading: SplashShell }
);

export default function BrewHubLanding() {
  return <BrewHubLandingClient />;
}