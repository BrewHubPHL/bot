"use client";

/**
 * BrewHubLandingClient — the full interactive landing page.
 *
 * This component is loaded via `next/dynamic` with `ssr: false` in page.tsx.
 * It is NEVER server-rendered, so there is no hydration boundary to mismatch.
 * The static splash shell in page.tsx serves as the loading fallback until
 * the JS bundle downloads and this component mounts.
 *
 * Refactored (March 2026):
 *   - Waitlist form replaced by Login/Register CTA via <Hero /> + <AuthModal />.
 *   - Inline concierge chat replaced by fixed bottom-right <EliseChat /> widget.
 */

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Hero from '@/components/Hero';
import EliseChat from '@/components/chat/EliseChat';

export default function BrewHubLandingClient() {
  const [isLoading, setIsLoading] = useState(true);

  // Splash screen timer and scroll to top
  useEffect(() => {
    window.scrollTo(0, 0);
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Splash Screen — fades out after 1.5s */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6]">
          <div className="flex flex-col items-center animate-pulse">
            <Image src="/logo.png" alt="BrewHub" width={140} height={140} className="rounded-full shadow-2xl border-4 border-[var(--hub-tan)]" priority />
            <h1 className="mt-6 text-3xl font-playfair font-bold text-[var(--hub-espresso)]">BrewHub</h1>
            <p className="text-[var(--hub-brown)] text-sm mt-2">Point Breeze • Philadelphia</p>
          </div>
        </div>
      )}

      <div className="flex flex-col w-full">
        {/* HERO — Login / Register CTA (replaces old waitlist form) */}
        <Hero />
      </div>

      {/* Elise Chatbot — fixed bottom-right widget */}
      <EliseChat />
    </>
  );
}
