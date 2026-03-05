"use client";

/**
 * AuthModal — Unified Login / Register modal for BrewHub PHL.
 *
 * Architecture:
 *   - Dual-Lock Pattern: useRef lock + async state to prevent double-tap.
 *   - Supabase Error Handling: explicit `{ data, error }` destructure; never
 *     rely on try/catch alone for Supabase SDK calls.
 *   - React Memory Safety: all timers tracked via ref and cleared on unmount.
 *   - Unified CRM: signUp passes `full_name` and `unit_number` inside
 *     `options.data`. The backend `handle_new_user()` trigger merges into
 *     the `customers` table — no client-side writes to `customers`.
 */

import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

/* ── Types ── */
type AuthView = "login" | "register";

interface AuthModalProps {
  /** Whether the modal is currently visible */
  open: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Which view to show on open (default: "login") */
  initialView?: AuthView;
}

/* ── Component ── */
export default function AuthModal({ open, onClose, initialView = "login" }: AuthModalProps) {
  /* ─── View toggle ─── */
  const [view, setView] = useState<AuthView>(initialView);

  /* ─── Form fields ─── */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [unitNumber, setUnitNumber] = useState("");

  /* ─── UI state ─── */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  /* ─── Dual-Lock: synchronous ref + async state ─── */
  const submittingRef = useRef(false);

  /* ─── Timer tracking for memory safety ─── */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Reset view when `initialView` changes or modal opens */
  useEffect(() => {
    if (open) {
      setView(initialView);
      setError("");
      setSuccessMsg("");
    }
  }, [open, initialView]);

  /* Cleanup timers on unmount */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /* ─── Close helper ─── */
  const handleClose = useCallback(() => {
    setEmail("");
    setPassword("");
    setFullName("");
    setUnitNumber("");
    setError("");
    setSuccessMsg("");
    setLoading(false);
    submittingRef.current = false;
    onClose();
  }, [onClose]);

  /* ─── Backdrop click ─── */
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  /* ─── Escape key ─── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  /* ─── Auth handler ─── */
  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();

    // Dual-Lock guard — synchronous ref prevents double-tap
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      if (view === "login") {
        /* ── Login ── */
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        // Successful login — redirect to portal
        if (data.session) {
          handleClose();
          window.location.href = "/portal";
        }
      } else {
        /* ── Register ── */
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              unit_number: unitNumber.trim() || null,
            },
          },
        });
        if (error) throw error;

        // Show confirmation message
        setSuccessMsg(
          "Check your email for a confirmation link. Once verified you can log in!",
        );

        // Auto-clear success message after 8 seconds (tracked for cleanup)
        timerRef.current = setTimeout(() => {
          setSuccessMsg("");
          timerRef.current = null;
        }, 8000);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  /* ─── Toggle between views ─── */
  const switchView = () => {
    setView((v) => (v === "login" ? "register" : "login"));
    setError("");
    setSuccessMsg("");
  };

  /* ─── Don't render when closed ─── */
  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={view === "login" ? "Log in to BrewHub" : "Create a BrewHub account"}
    >
      {/* Modal card */}
      <div className="relative w-full max-w-md rounded-2xl border-2 border-[var(--hub-tan)] bg-white/95 shadow-2xl backdrop-blur-lg p-8">
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-2xl leading-none text-stone-400 hover:text-stone-700 transition-colors"
        >
          &times;
        </button>

        {/* Title */}
        <h2 className="text-center font-[var(--font-playfair)] text-3xl font-bold text-[var(--hub-espresso)] mb-1">
          {view === "login" ? "Welcome Back" : "Join BrewHub"}
        </h2>
        <p className="text-center text-sm text-stone-500 mb-6">
          {view === "login"
            ? "Sign in to your account"
            : "Create your free account"}
        </p>

        {/* Success banner */}
        {successMsg && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            {successMsg}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          {/* Register-only fields */}
          {view === "register" && (
            <>
              <div>
                <label htmlFor="auth-fullname" className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1">
                  Full Name
                </label>
                <input
                  id="auth-fullname"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full rounded-lg border-2 border-[var(--hub-tan)] bg-white px-4 py-3 text-base outline-none transition-colors focus:border-[var(--hub-espresso)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                />
              </div>

              <div>
                <label htmlFor="auth-unit" className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1">
                  Unit / Apt Number <span className="text-stone-400">(optional)</span>
                </label>
                <input
                  id="auth-unit"
                  type="text"
                  autoComplete="off"
                  value={unitNumber}
                  onChange={(e) => setUnitNumber(e.target.value)}
                  placeholder="e.g. 4B"
                  className="w-full rounded-lg border-2 border-[var(--hub-tan)] bg-white px-4 py-3 text-base outline-none transition-colors focus:border-[var(--hub-espresso)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                />
              </div>
            </>
          )}

          {/* Email */}
          <div>
            <label htmlFor="auth-email" className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border-2 border-[var(--hub-tan)] bg-white px-4 py-3 text-base outline-none transition-colors focus:border-[var(--hub-espresso)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              autoComplete={view === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              className="w-full rounded-lg border-2 border-[var(--hub-tan)] bg-white px-4 py-3 text-base outline-none transition-colors focus:border-[var(--hub-espresso)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-[var(--hub-espresso)] px-6 py-3 text-base font-bold uppercase tracking-widest text-[var(--hub-tan)] shadow-md transition-all duration-200 hover:bg-[var(--hub-tan)] hover:text-[var(--hub-espresso)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : view === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        {/* View toggle */}
        <p className="mt-6 text-center text-sm text-stone-500">
          {view === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={switchView}
                className="font-semibold text-[var(--hub-tan)] underline underline-offset-2 hover:text-[var(--hub-espresso)] transition-colors"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={switchView}
                className="font-semibold text-[var(--hub-tan)] underline underline-offset-2 hover:text-[var(--hub-espresso)] transition-colors"
              >
                Sign In
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
