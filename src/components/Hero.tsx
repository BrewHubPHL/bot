"use client";

/**
 * Hero — Landing-page hero section for BrewHub PHL.
 *
 * Replaces the old waitlist form with a "Get Started" CTA that opens
 * the unified AuthModal (Login / Register).
 *
 * This component is imported by BrewHubLandingClient.tsx and rendered
 * inside the client-only dynamic boundary — it is NEVER SSR'd.
 */

import { useState, useCallback } from "react";
import Image from "next/image";
import AuthModal from "@/components/auth/AuthModal";

export default function Hero() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authView, setAuthView] = useState<"login" | "register">("register");

  const openRegister = useCallback(() => {
    setAuthView("register");
    setAuthOpen(true);
  }, []);

  const openLogin = useCallback(() => {
    setAuthView("login");
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => setAuthOpen(false), []);

  return (
    <>
      {/* Auth Modal (portal-level z-index, renders only when open) */}
      <AuthModal open={authOpen} onClose={closeAuth} initialView={authView} />

      <section className="hero-section">
        <div className="hero-bg" />
        <div className="hero-card">
          <Image
            src="/logo.png"
            alt="BrewHub PHL logo"
            width={120}
            height={120}
            className="hero-logo"
            priority
          />
          <h2 className="hero-location">Point Breeze • Philadelphia 19146</h2>
          <h1 className="hero-title">
            BrewHub<span className="hero-title-accent">PHL</span>
          </h1>
          <p className="hero-desc">
            &ldquo;Your neighborhood sanctuary for artisanal espresso, secure
            parcel hub, and dedicated workspace.&rdquo;
          </p>

          {/* ── Primary CTA — replaces old waitlist form ── */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full mt-2">
            <button
              type="button"
              onClick={openRegister}
              className="hero-btn w-full sm:flex-1"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={openLogin}
              className="w-full sm:flex-1 rounded-lg border-2 border-[var(--hub-tan)] bg-transparent px-6 py-[0.9rem] text-base font-bold uppercase tracking-widest text-[var(--hub-espresso)] transition-all duration-200 hover:bg-[var(--hub-tan)] hover:text-white"
            >
              Sign In
            </button>
          </div>

          {/* Quick-nav CTAs — static links only */}
          <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 sm:gap-4 mt-8 w-full">
            <a
              href="/shop"
              className="inline-flex items-center justify-center px-5 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-[0.12em] text-stone-800 border-2 border-[#b8860b] rounded-lg hover:bg-[#b8860b] hover:text-white hover:border-stone-900 transition-all duration-200 ease-in-out min-w-[160px] text-center"
            >
              Browse the Shop
            </a>
            <a
              href="/about"
              className="inline-flex items-center justify-center px-5 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-[0.12em] text-stone-800 border-2 border-[#b8860b] rounded-lg hover:bg-[#b8860b] hover:text-white hover:border-stone-900 transition-all duration-200 ease-in-out min-w-[160px] text-center"
            >
              Our Story
            </a>
            <a
              href="/location"
              className="inline-flex items-center justify-center px-5 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-[0.12em] text-stone-800 border-2 border-[#b8860b] rounded-lg hover:bg-[#b8860b] hover:text-white hover:border-stone-900 transition-all duration-200 ease-in-out min-w-[160px] text-center"
            >
              Find Us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
