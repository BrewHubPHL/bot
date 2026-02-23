"use client";

import { useEffect } from "react";

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Safe logging — message only, no full stack or Supabase internals
    console.error("[site error boundary]", error?.message);
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-8 text-center space-y-5 shadow-lg">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-stone-800">Something went wrong</h2>
        <p className="text-sm text-stone-500">
          We hit an unexpected snag. Please try again — if the issue persists, our team has been notified.
        </p>

        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm rounded-xl transition-all active:scale-[0.97]"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-600 font-semibold text-sm rounded-xl transition-all inline-flex items-center"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  );
}
