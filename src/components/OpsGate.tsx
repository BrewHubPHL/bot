"use client";

import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from "react";
import {
  Lock, LogIn, LogOut, Loader2, Clock, AlertCircle, User, CheckCircle2, Delete
} from "lucide-react";

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
}

const OpsSessionContext = createContext<OpsSession | null>(null);

/** Hook for child pages to access the authenticated staff member & token */
export function useOpsSession(): OpsSession {
  const ctx = useContext(OpsSessionContext);
  if (!ctx) throw new Error("useOpsSession must be used within <OpsGate>");
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
export default function OpsGate({ children }: { children: ReactNode }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<OpsSession | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockMsg, setClockMsg] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

  // Clock display
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(new Date()), 15_000);
    return () => clearInterval(tick);
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
          setSession(parsed);
        } else {
          sessionStorage.removeItem("ops_session");
        }
      }
    } catch {
      sessionStorage.removeItem("ops_session");
    }
  }, []);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setPin("");
        return;
      }

      const newSession: OpsSession = { staff: data.staff, token: data.token };
      setSession(newSession);
      sessionStorage.setItem("ops_session", JSON.stringify(newSession));
      setPin("");
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
  }, []);

  /* ─── Authenticated: show page content ─── */
  if (session) {
    return (
      <OpsSessionContext.Provider value={session}>
        {/* Persistent header bar */}
        <div className="fixed top-0 left-0 right-0 z-50 bg-zinc-900 border-b border-zinc-700 px-4 py-2 flex items-center justify-between text-sm">
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

            <div className="w-px h-5 bg-zinc-700 mx-1" />

            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-2 py-1 text-zinc-400 hover:text-white text-xs transition-colors"
              title="Lock screen"
            >
              <Lock className="w-3.5 h-3.5" /> Lock
            </button>
          </div>
        </div>

        {/* Main content offset below header */}
        <div className="pt-10">{children}</div>
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
          {currentTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
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
    </div>
  );
}
