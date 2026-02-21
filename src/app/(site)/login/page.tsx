"use client";

import { useState, useEffect, type FormEvent } from "react";
import { createSupabaseClient } from "@/lib/supabase";

/* ─── Supabase client (browser-only, session persisted) ─── */
const sb = createSupabaseClient({
  auth: {
    persistSession: true,
    storageKey: "brewhub-staff-auth",
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/* ─── Redirect whitelist (clean URLs) ─── */
const ALLOWED_PATHS = [
  "/", "/shop", "/account", "/manager", "/staff-hub",
  "/cafe", "/kds", "/parcels", "/scanner", "/admin",
];

function getSafeRedirect(raw: string | null): string {
  if (!raw) return "/staff-hub";
  if (ALLOWED_PATHS.includes(raw)) return raw;
  return "/staff-hub";
}

/* ─── Page Component ─── */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in, redirect immediately
  useEffect(() => {
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const params = new URLSearchParams(window.location.search);
        window.location.href = getSafeRedirect(params.get("redirect"));
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: authError } = await sb.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Wait for session persistence
    await new Promise((r) => setTimeout(r, 200));
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
      setError("Session not persisted. Please try again.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    window.location.href = getSafeRedirect(params.get("redirect"));
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg-main, #f8f4f0)" }}>
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 p-12 w-full max-w-md text-center">
        {/* Logo */}
        <div className="text-3xl font-bold mb-1" style={{ color: "var(--hub-espresso, #3c2f2f)" }}>
          Brew<span style={{ color: "var(--hub-tan, #d4b59e)" }}>Hub</span>
        </div>
        <p className="text-stone-400 text-sm mb-8">Staff Portal</p>

        {/* Error */}
        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-sm text-left"
            role="alert"
            style={{
              background: "#fff0f0",
              border: "1px solid #e74c3c",
              color: "#e74c3c",
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} aria-label="Staff login">
          <div className="mb-3">
            <label htmlFor="email" className="sr-only">Email address</label>
            <input
              id="email"
              type="email"
              placeholder="Email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-stone-200 rounded-xl text-base outline-none
                         focus:border-[var(--hub-tan,#d4b59e)] transition-colors"
            />
          </div>
          <div className="mb-3">
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-stone-200 rounded-xl text-base outline-none
                         focus:border-[var(--hub-tan,#d4b59e)] transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-3 rounded-xl text-white font-semibold text-base
                       transition-all hover:opacity-90 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--brand-accent, #b08968)" }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <a
          href="/"
          className="block mt-6 text-stone-400 text-sm hover:text-stone-600 no-underline"
        >
          ← Back to BrewHub
        </a>
      </div>
    </div>
  );
}
