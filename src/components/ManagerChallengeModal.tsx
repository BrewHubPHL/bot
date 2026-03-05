"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Shield, Loader2, AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/* ─── Types ────────────────────────────────────────────── */
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
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup success timer on unmount
  useEffect(() => {
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  }, []);

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

  const handleProceedToVerify = useCallback(() => {
    setStep("verify");
  }, []);

  const handleVerify = useCallback(async (code: string) => {
    if (code.length !== 6) {
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
        body: JSON.stringify({ mode: "verify", code, nonce }),
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
      successTimerRef.current = setTimeout(() => onSuccess(nonce), 600);
    } catch {
      setError("Connection error — try again");
      setUserCode("");
    } finally {
      setVerifying(false);
    }
  }, [nonce, token, onSuccess]);

  const handleOtpChange = useCallback(
    (value: string) => {
      setUserCode(value);
      setError("");
      if (value.length === 6 && !verifying && step === "verify") {
        handleVerify(value);
      }
    },
    [verifying, step, handleVerify],
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-700 rounded-2xl shadow-2xl max-w-md [&>button]:text-zinc-500 [&>button]:hover:text-white">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <DialogTitle className="text-lg font-bold text-white">Manager Verification</DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">{actionDescription}</DialogDescription>
          </div>
        </DialogHeader>

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
            <div className="flex justify-center mb-4">
              <InputOTP
                maxLength={6}
                value={userCode}
                onChange={handleOtpChange}
                disabled={verifying}
                autoFocus
              >
                <InputOTPGroup className="gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="w-10 h-12 rounded-lg border bg-zinc-800 border-zinc-600 text-xl font-mono font-bold text-amber-400 ring-amber-500 first:rounded-l-lg last:rounded-r-lg"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
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
      </DialogContent>
    </Dialog>
  );
}
