"use client";

import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from "react";
import {
  Lock, LogIn, LogOut, Loader2, Clock, AlertCircle, User, CheckCircle2, Delete, Shield, ScanFace, Fingerprint
} from "lucide-react";
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import PinRotationModal from "./PinRotationModal";
import ManagerChallengeModal from "./ManagerChallengeModal";
import { supabase } from "@/lib/supabase";

/* ─── Types ────────────────────────────────────────────── */
interface StaffInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  is_working: boolean;
}

interface OpsSession {
  staff: StaffInfo;
  token: string;
  needsPinRotation?: boolean;
}

/**
 * Manager challenge hook result.
 * Components use this to gate sensitive actions behind TOTP verification.
 */
export interface ManagerChallenge {
  /** Call to start a manager challenge flow. Returns the nonce on success, null on cancel. */
  requestChallenge: (actionType: string, description: string) => Promise<string | null>;
}

const OpsSessionContext = createContext<OpsSession | null>(null);
const ManagerChallengeContext = createContext<ManagerChallenge | null>(null);

/** Hook for child pages to access the authenticated staff member & token */
export function useOpsSession(): OpsSession {
  const ctx = useContext(OpsSessionContext);
  if (!ctx) throw new Error("useOpsSession must be used within <OpsGate>");
  return ctx;
}

/** Safe variant – returns null when rendered outside <OpsGate> (e.g. (site) route) */
export function useOpsSessionOptional(): OpsSession | null {
  return useContext(OpsSessionContext);
}

/**
 * Hook for child pages to gate manager actions behind a TOTP challenge.
 * Usage:
 *   const { requestChallenge } = useManagerChallenge();
 *   const nonce = await requestChallenge('fix_clock', 'Fix missing clock-out');
 *   if (!nonce) return; // user cancelled
 *   // include nonce in the API call body as _challenge_nonce
 */
export function useManagerChallenge(): ManagerChallenge {
  const ctx = useContext(ManagerChallengeContext);
  if (!ctx) throw new Error("useManagerChallenge must be used within <OpsGate>");
  return ctx;
}

/* ─── Helpers ──────────────────────────────────────────── */
const API_BASE = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
  ? 'http://localhost:8888/.netlify/functions'
  : '/.netlify/functions';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/* ─── OpsGate Component ──────────────────────────────── */
export default function OpsGate({ children, requireManager = false }: { children: ReactNode; requireManager?: boolean }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<OpsSession | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockMsg, setClockMsg] = useState("");

  // Schema 47: PIN rotation + manager challenge state
  const [showPinRotation, setShowPinRotation] = useState(false);
  const [pinRotationDeferred, setPinRotationDeferred] = useState(false);
  const [challengeState, setChallengeState] = useState<{
    actionType: string;
    description: string;
    resolve: (nonce: string | null) => void;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  // WebAuthn / Passkey state
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState("");
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const [passkeySetupLoading, setPasskeySetupLoading] = useState(false);

  // Terminal Mode: shared POS iPads use ?mode=pos or localStorage flag.
  // In POS mode, WebAuthn/Face ID is hidden — PIN only for per-barista tracking.
  const [terminalMode, setTerminalMode] = useState(false);

  // Hydration-safe mount — defer client-only rendering
  useEffect(() => {
    setCurrentTime(new Date());
    setMounted(true);

    // Detect Terminal / POS mode:
    //   1. URL param ?mode=pos sets the flag + persists to localStorage
    //   2. localStorage flag persists across page loads on iPad
    //   3. Remove with ?mode=personal (for testing / resetting)
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'pos') {
      setTerminalMode(true);
      try { localStorage.setItem('brewhub_terminal_mode', 'pos'); } catch { /* */ }
    } else if (modeParam === 'personal') {
      setTerminalMode(false);
      try { localStorage.removeItem('brewhub_terminal_mode'); } catch { /* */ }
    } else {
      try {
        const stored = localStorage.getItem('brewhub_terminal_mode');
        if (stored === 'pos') setTerminalMode(true);
      } catch { /* */ }
    }

    // Only offer WebAuthn on non-POS devices that support it
    setPasskeyAvailable(browserSupportsWebAuthn());
  }, []);

  // Clock display
  useEffect(() => {
    if (!mounted) return;
    const tick = setInterval(() => setCurrentTime(new Date()), 15_000);
    return () => clearInterval(tick);
  }, [mounted]);

  // Verify existing session with backend on mount
  const verifySession = useCallback(async (savedSession: OpsSession) => {
    setVerifying(true);
    try {
      // Call a lightweight endpoint to verify token & sync is_working status
      const res = await fetch(`${API_BASE}/pin-verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedSession.token}`,
          "X-BrewHub-Action": "true",
        },
      });

      if (!res.ok) {
        const data = await res.json();
        // Handle token version mismatch or other auth failures
        if (data.code === "TOKEN_VERSION_MISMATCH") {
          console.warn("[OpsGate] Session invalidated by backend");
        }
        sessionStorage.removeItem("ops_session");
        setSession(null);
        return;
      }

      const data = await res.json();
      // Sync is_working status from backend
      const syncedSession: OpsSession = {
        ...savedSession,
        staff: { ...savedSession.staff, is_working: data.is_working ?? savedSession.staff.is_working },
      };
      setSession(syncedSession);
      sessionStorage.setItem("ops_session", JSON.stringify(syncedSession));
    } catch (err) {
      console.error("[OpsGate] Session verification failed:", (err as Error)?.message);
      sessionStorage.removeItem("ops_session");
      setSession(null);
    } finally {
      setVerifying(false);
    }
  }, []);

  // Check for existing session in sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("ops_session");
      if (saved) {
        const parsed = JSON.parse(saved) as OpsSession;
        // Check if token hasn't expired (parse the base64 payload)
        const [payloadB64] = parsed.token.split(".");
        const payload = JSON.parse(atob(payloadB64));
        if (payload.exp && Date.now() < payload.exp) {
          // Verify with backend to ensure token is still valid
          verifySession(parsed);
        } else {
          sessionStorage.removeItem("ops_session");
        }
      }
    } catch {
      sessionStorage.removeItem("ops_session");
    }
  }, [verifySession]);

  // Keyboard input handler
  useEffect(() => {
    if (session) return; // don't capture when authenticated

    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        setPin(prev => {
          if (prev.length >= 6) return prev;
          return prev + e.key;
        });
        setError("");
      } else if (e.key === "Backspace") {
        setPin(prev => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        // Trigger submit via the form
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session]);

  const handleDigit = useCallback((digit: string) => {
    setPin(prev => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
    setError("");
  }, []);

  const handleDelete = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setError("");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length !== 6) {
      setError("Enter your 6-digit PIN");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/pin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BrewHub-Action": "true" },
        credentials: "include",
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setPin("");
        return;
      }

      const newSession: OpsSession = {
        staff: data.staff,
        token: data.token,
        needsPinRotation: data.needsPinRotation || false,
      };
      setSession(newSession);
      sessionStorage.setItem("ops_session", JSON.stringify(newSession));
      setPin("");

      // Schema 47: Prompt PIN rotation if needed
      if (data.needsPinRotation) {
        setShowPinRotation(true);
      }
    } catch {
      setError("Connection error — try again");
      setPin("");
    } finally {
      setLoading(false);
    }
  }, [pin]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6 && !loading) {
      handleSubmit();
    }
  }, [pin, loading, handleSubmit]);

  const handleClock = useCallback(async (action: "in" | "out") => {
    if (!session) return;
    setClockLoading(true);
    setClockMsg("");

    try {
      const res = await fetch(`${API_BASE}/pin-clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        setClockMsg(data.error || "Clock operation failed");
        return;
      }

      const timeStr = formatTime(new Date(data.time));
      setClockMsg(`Clocked ${action === "in" ? "IN" : "OUT"} at ${timeStr}`);

      // Update session state
      setSession(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          staff: { ...prev.staff, is_working: action === "in" },
        };
        sessionStorage.setItem("ops_session", JSON.stringify(updated));
        return updated;
      });
    } catch {
      setClockMsg("Connection error — try again");
    } finally {
      setClockLoading(false);
    }
  }, [session]);

  const handleLogout = useCallback(() => {
    setSession(null);
    setPin("");
    setError("");
    setClockMsg("");
    sessionStorage.removeItem("ops_session");

    // Scenario 8 defense: wipe any session-sensitive localStorage that
    // could bleed into the next operator's session on a shared iPad.
    try {
      localStorage.removeItem("brewhub_cart");
      localStorage.removeItem("brewhub_cafe_cart");
      localStorage.removeItem("brewhub_email");
    } catch { /* storage unavailable */ }

    // Clear the HttpOnly session cookie via a logout endpoint
    fetch(`${API_BASE}/pin-logout`, { method: "POST", headers: { "X-BrewHub-Action": "true" }, credentials: "include" }).catch(() => {});
  }, []);

  const handleFullSignOut = useCallback(async () => {
    // 1. Clear OpsGate PIN session
    handleLogout();
    // 2. Sign out of Supabase (clears JWT from localStorage)
    await supabase.auth.signOut();
    // 3. Redirect to login page
    window.location.href = "/login";
  }, [handleLogout]);

  // ═══════════════════════════════════════════════════════════════
  // WebAuthn: Passkey Login (Face ID / Touch ID / Windows Hello)
  // ═══════════════════════════════════════════════════════════════
  const handlePasskeyLogin = useCallback(async () => {
    setPasskeyLoading(true);
    setPasskeyMsg("");
    setError("");

    try {
      // Phase 1: Get authentication options from server
      const optRes = await fetch(`${API_BASE}/webauthn-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BrewHub-Action": "true" },
        body: JSON.stringify({ action: "options" }),
      });
      if (!optRes.ok) {
        const errData = await optRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get passkey options");
      }

      const { options } = await optRes.json();

      // Phase 2: Browser prompts biometric (Face ID / Touch ID / Windows Hello)
      const credential = await startAuthentication({ optionsJSON: options });

      // Phase 3: Verify with server
      const verifyRes = await fetch(`${API_BASE}/webauthn-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BrewHub-Action": "true" },
        credentials: "include",
        body: JSON.stringify({ action: "verify", credential }),
      });

      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error || "Passkey login failed");

      // Success — create session (same format as PIN login)
      const newSession: OpsSession = {
        staff: data.staff,
        token: data.token,
        needsPinRotation: false,
      };
      setSession(newSession);
      sessionStorage.setItem("ops_session", JSON.stringify(newSession));
      setPin("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Passkey login failed";
      // Don't show error for user cancellation
      if (!msg.includes("AbortError") && !msg.includes("cancelled") && !msg.includes("not allowed")) {
        setError(msg);
      }
    } finally {
      setPasskeyLoading(false);
    }
  }, []);

  // WebAuthn: Register a new passkey (while logged in via PIN)
  const handlePasskeySetup = useCallback(async () => {
    if (!session) return;
    setPasskeySetupLoading(true);
    setPasskeyMsg("");

    try {
      // Phase 1: Get registration options
      const optRes = await fetch(`${API_BASE}/webauthn-register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ action: "options" }),
      });
      if (!optRes.ok) {
        const errData = await optRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get registration options");
      }

      const { options } = await optRes.json();

      // Phase 2: Browser prompts biometric enrollment
      const credential = await startRegistration({ optionsJSON: options });

      // Phase 3: Verify & store
      const verifyRes = await fetch(`${API_BASE}/webauthn-register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          action: "verify",
          credential,
          deviceName: navigator.platform || "Unknown device",
        }),
      });

      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error || "Registration failed");

      setPasskeyMsg("Passkey registered! You can now use Face ID / Touch ID to log in.");
      setShowPasskeySetup(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Passkey setup failed";
      if (!msg.includes("AbortError") && !msg.includes("cancelled") && !msg.includes("not allowed")) {
        setPasskeyMsg(`Setup failed: ${msg}`);
      }
    } finally {
      setPasskeySetupLoading(false);
    }
  }, [session]);

  // ═══════════════════════════════════════════════════════════════
  // Schema 47: Manager Challenge — prompts TOTP verification
  // for sensitive actions. Returns a Promise that resolves with
  // the nonce (or null if cancelled).
  // ═══════════════════════════════════════════════════════════════
  const requestChallenge = useCallback(
    (actionType: string, description: string): Promise<string | null> => {
      return new Promise((resolve) => {
        setChallengeState({ actionType, description, resolve });
      });
    },
    []
  );

  const managerChallengeValue: ManagerChallenge = { requestChallenge };

  /* ─── SSR / pre-mount: show blank black screen to avoid hydration mismatch ─── */
  if (!mounted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  /* ─── Verifying existing session ─── */
  if (verifying) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-4" />
        <p className="text-zinc-500 text-sm">Verifying session…</p>
      </div>
    );
  }

  /* ─── Authenticated: show page content ─── */
  if (session) {
    // Manager gate: block non-managers from manager-only pages
    const isManager = session.staff.role === "manager" || session.staff.role === "admin";
    if (requireManager && !isManager) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 text-center">
          <Lock className="w-12 h-12 text-red-400 mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Manager Access Required</h1>
          <p className="text-zinc-400 text-sm mb-6">This page is restricted to managers and administrators.</p>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg transition-colors"
          >
            Switch Account
          </button>
        </div>
      );
    }

    return (
      <OpsSessionContext.Provider value={session}>
        <ManagerChallengeContext.Provider value={managerChallengeValue}>
          {/* Schema 47: PIN Rotation Modal */}
          {showPinRotation && !pinRotationDeferred && (
            <PinRotationModal
              email={session.staff.email}
              token={session.token}
              onSuccess={() => {
                setShowPinRotation(false);
                // PIN changed → session invalidated → force re-login
                handleLogout();
              }}
              onDefer={() => {
                setShowPinRotation(false);
                setPinRotationDeferred(true);
              }}
              canDefer
            />
          )}

          {/* Schema 47: Manager Challenge Modal */}
          {challengeState && (
            <ManagerChallengeModal
              actionType={challengeState.actionType}
              actionDescription={challengeState.description}
              token={session.token}
              onSuccess={(nonce) => {
                challengeState.resolve(nonce);
                setChallengeState(null);
              }}
              onCancel={() => {
                challengeState.resolve(null);
                setChallengeState(null);
              }}
            />
          )}

          {/* Persistent header bar */}
          <div className="fixed top-0 left-0 right-0 z-40 bg-zinc-900 border-b border-zinc-700 px-4 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-white">{session.staff.name}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                session.staff.is_working
                  ? "bg-green-900/50 text-green-400"
                  : "bg-zinc-700 text-zinc-400"
              }`}>
                {session.staff.is_working ? "On Shift" : "Off Shift"}
              </span>
              {/* Schema 47: PIN rotation reminder badge */}
              {session.needsPinRotation && pinRotationDeferred && (
                <button
                  onClick={() => setShowPinRotation(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/50 text-amber-400 hover:bg-amber-800/50 transition-colors"
                  title="Your PIN needs to be rotated"
                >
                  <Shield className="w-3 h-3" /> Change PIN
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Clock In/Out buttons */}
              {clockLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              ) : (
                <>
                  {!session.staff.is_working ? (
                    <button
                      onClick={() => handleClock("in")}
                      className="flex items-center gap-1.5 px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" /> Clock In
                    </button>
                  ) : (
                    <button
                      onClick={() => handleClock("out")}
                      className="flex items-center gap-1.5 px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Clock Out
                    </button>
                  )}
                </>
              )}

              {clockMsg && (
                <span className="text-xs text-amber-300 max-w-48 truncate">{clockMsg}</span>
              )}

              {passkeyMsg && (
                <span className="text-xs text-green-400 max-w-48 truncate">{passkeyMsg}</span>
              )}

              <div className="w-px h-5 bg-zinc-700 mx-1" />

              {/* Passkey setup — hidden in POS/terminal mode */}
              {passkeyAvailable && !terminalMode && (
                <button
                  onClick={handlePasskeySetup}
                  disabled={passkeySetupLoading}
                  className="flex items-center gap-1 px-2 py-1 text-zinc-400 hover:text-amber-400 text-xs transition-colors disabled:opacity-50"
                  title="Set up Face ID / Touch ID"
                >
                  {passkeySetupLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Fingerprint className="w-3.5 h-3.5" />
                  )}
                  {passkeySetupLoading ? "Setting up…" : "Set up Face ID"}
                </button>
              )}

              <button
                onClick={handleLogout}
                className="flex items-center gap-1 px-2 py-1 text-zinc-400 hover:text-white text-xs transition-colors"
                title="Lock screen"
              >
                <Lock className="w-3.5 h-3.5" /> Lock
              </button>

              <button
                onClick={handleFullSignOut}
                className="flex items-center gap-1 px-2 py-1 text-red-400 hover:text-red-300 text-xs transition-colors"
                title="Sign out completely"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          </div>

          {/* Main content offset below header */}
          <div className="pt-10">{children}</div>
        </ManagerChallengeContext.Provider>
      </OpsSessionContext.Provider>
    );
  }

  /* ─── PIN Entry Screen ─── */
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 select-none">
      {/* Logo / Header */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-600/20 flex items-center justify-center">
          <Lock className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">BrewHub POS</h1>
        <p className="text-zinc-500 text-sm">
          <Clock className="inline w-3.5 h-3.5 mr-1" />
          {currentTime?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) ?? ""}
        </p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-3 mb-6">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              i < pin.length
                ? "bg-amber-400 border-amber-400 scale-110"
                : "border-zinc-600 bg-transparent"
            }`}
          />
        ))}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 mb-4 text-amber-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
        </div>
      )}

      {/* Error message */}
      {error && !loading && (
        <div className="flex items-center gap-2 mb-4 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Numeric keypad */}
      <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
          <button
            key={d}
            onClick={() => handleDigit(d)}
            disabled={loading}
            className="h-16 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-2xl font-medium transition-colors disabled:opacity-50 touch-manipulation"
          >
            {d}
          </button>
        ))}
        <button
          onClick={handleClear}
          disabled={loading}
          className="h-16 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-500 text-sm font-medium transition-colors disabled:opacity-50 touch-manipulation"
        >
          Clear
        </button>
        <button
          onClick={() => handleDigit("0")}
          disabled={loading}
          className="h-16 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-2xl font-medium transition-colors disabled:opacity-50 touch-manipulation"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="h-16 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-50 flex items-center justify-center touch-manipulation"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>

      <p className="mt-8 text-zinc-600 text-xs">Enter your 6-digit staff PIN</p>

      {/* Passkey / Face ID login — hidden in POS/terminal mode */}
      {passkeyAvailable && !terminalMode && (
        <button
          onClick={handlePasskeyLogin}
          disabled={passkeyLoading || loading}
          className="mt-6 flex items-center gap-2 px-6 py-3 rounded-xl
                     bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600
                     text-white text-sm font-medium transition-all
                     disabled:opacity-50 touch-manipulation
                     border border-zinc-700 hover:border-amber-500/40"
        >
          {passkeyLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ScanFace className="w-5 h-5 text-amber-400" />
          )}
          {passkeyLoading ? "Verifying…" : "Use Face ID / Touch ID"}
        </button>
      )}

      {/* Terminal mode indicator */}
      {terminalMode && (
        <p className="mt-6 text-zinc-700 text-xs flex items-center gap-1">
          <Lock className="w-3 h-3" /> POS Terminal Mode
        </p>
      )}
    </div>
  );
}
