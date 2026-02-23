"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Shield, Loader2, AlertCircle, CheckCircle2, X, KeyRound } from "lucide-react";

/* ─── Types ────────────────────────────────────────────── */
interface ChallengeResult {
  nonce: string;
  action_type: string;
}

interface ManagerChallengeModalProps {
  /** The action type this challenge is for (e.g. 'fix_clock', 'adjust_hours') */
  actionType: string;
  /** Human-readable description of the action being authorized */
  actionDescription: string;
  /** Called with the verified nonce when challenge succeeds */
  onSuccess: (nonce: string) => void;
  /** Called when the user cancels or the modal closes */
  onCancel: () => void;
  /** Bearer token for the current session */
  token: string;
}

/* ─── Helpers ──────────────────────────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Component ──────────────────────────────────────── */
export default function ManagerChallengeModal({
  actionType,
  actionDescription,
  onSuccess,
  onCancel,
  token,
}: ManagerChallengeModalProps) {
  const [step, setStep] = useState<"loading" | "display" | "verify" | "success" | "error">("loading");
  const [challengeCode, setChallengeCode] = useState("");
  const [nonce, setNonce] = useState("");
  const [expiresIn, setExpiresIn] = useState(90);
  const [userCode, setUserCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Issue challenge on mount
  useEffect(() => {
    let cancelled = false;

    async function issueChallenge() {
      try {
        const res = await fetch(`${API_BASE}/manager-challenge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          credentials: "include",
          body: JSON.stringify({ action_type: actionType, mode: "issue" }),
        });

        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setError(data.error || "Failed to generate challenge");
          setStep("error");
          return;
        }

        setChallengeCode(data.challenge_code);
        setNonce(data.nonce);
        setExpiresIn(data.expires_in);
        setStep("display");
      } catch {
        if (!cancelled) {
          setError("Connection error — try again");
          setStep("error");
        }
      }
    }

    issueChallenge();
    return () => { cancelled = true; };
  }, [actionType, token]);

  // Countdown timer
  useEffect(() => {
    if (step !== "display" && step !== "verify") return;

    timerRef.current = setInterval(() => {
      setExpiresIn((prev) => {
        if (prev <= 1) {
          setError("Challenge expired. Please try again.");
          setStep("error");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  // Focus input when entering verify step
  useEffect(() => {
    if (step === "verify") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleProceedToVerify = useCallback(() => {
    setStep("verify");
  }, []);

  const handleVerify = useCallback(async () => {
    if (userCode.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }

    setVerifying(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/manager-challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        credentials: "include",
        body: JSON.stringify({ mode: "verify", code: userCode, nonce }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verification failed");
        setUserCode("");
        setVerifying(false);
        return;
      }

      setStep("success");
      // Brief success flash, then callback
      setTimeout(() => onSuccess(nonce), 600);
    } catch {
      setError("Connection error — try again");
      setUserCode("");
    } finally {
      setVerifying(false);
    }
  }, [userCode, nonce, token, onSuccess]);

  // Auto-submit on 6 digits
  useEffect(() => {
    if (userCode.length === 6 && !verifying && step === "verify") {
      handleVerify();
    }
  }, [userCode, verifying, step, handleVerify]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 relative">
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Manager Verification</h2>
            <p className="text-zinc-400 text-sm">{actionDescription}</p>
          </div>
        </div>

        {/* ── Loading ── */}
        {step === "loading" && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-3" />
            <p className="text-zinc-400 text-sm">Generating challenge code…</p>
          </div>
        )}

        {/* ── Display challenge code ── */}
        {step === "display" && (
          <div className="text-center py-4">
            <p className="text-zinc-400 text-sm mb-4">
              Your one-time verification code:
            </p>
            <div className="flex justify-center gap-2 mb-4">
              {challengeCode.split("").map((digit, i) => (
                <div
                  key={i}
                  className="w-12 h-14 bg-zinc-800 border border-zinc-600 rounded-lg flex items-center justify-center text-2xl font-mono font-bold text-amber-400"
                >
                  {digit}
                </div>
              ))}
            </div>
            <p className="text-zinc-500 text-xs mb-6">
              <KeyRound className="inline w-3.5 h-3.5 mr-1" />
              Expires in {expiresIn}s — memorize this code, then tap Continue
            </p>
            <button
              onClick={handleProceedToVerify}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl transition-colors"
            >
              I memorized it — Continue
            </button>
          </div>
        )}

        {/* ── Verify (enter code) ── */}
        {step === "verify" && (
          <div className="py-4">
            <p className="text-zinc-400 text-sm mb-4 text-center">
              Enter the 6-digit code to authorize this action:
            </p>
            <div className="flex justify-center gap-2 mb-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-10 h-12 border rounded-lg flex items-center justify-center text-xl font-mono font-bold transition-all ${
                    i < userCode.length
                      ? "bg-amber-600/20 border-amber-500 text-amber-400"
                      : "bg-zinc-800 border-zinc-600 text-zinc-500"
                  }`}
                >
                  {userCode[i] || "·"}
                </div>
              ))}
            </div>
            {/* Hidden input for keyboard capture */}
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={userCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setUserCode(val);
                setError("");
              }}
              className="sr-only"
              autoFocus
            />
            {/* Numeric keypad for touch devices */}
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto mb-4">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d) =>
                d === "" ? (
                  <div key="empty" />
                ) : d === "⌫" ? (
                  <button
                    key="del"
                    onClick={() => setUserCode((prev) => prev.slice(0, -1))}
                    className="h-12 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-lg transition-colors touch-manipulation"
                  >
                    ⌫
                  </button>
                ) : (
                  <button
                    key={d}
                    onClick={() =>
                      setUserCode((prev) => {
                        if (prev.length >= 6) return prev;
                        return prev + d;
                      })
                    }
                    disabled={verifying}
                    className="h-12 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-medium transition-colors disabled:opacity-50 touch-manipulation"
                  >
                    {d}
                  </button>
                )
              )}
            </div>
            <p className="text-zinc-500 text-xs text-center">
              Expires in {expiresIn}s
            </p>
            {verifying && (
              <div className="flex items-center justify-center gap-2 mt-3 text-amber-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
              </div>
            )}
          </div>
        )}

        {/* ── Success ── */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-400 mb-3" />
            <p className="text-white font-medium">Verified</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && step !== "success" && (
          <div className="flex items-center gap-2 mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {step === "error" && (
          <button
            onClick={onCancel}
            className="w-full mt-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
