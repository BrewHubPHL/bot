"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { KeyRound, Loader2, AlertCircle, CheckCircle2, X } from "lucide-react";

interface PinRotationModalProps {
  /** Manager's email for the rotation RPC */
  email: string;
  /** Bearer token for the current session */
  token: string;
  /** Days since last PIN change (for informational display) */
  daysSinceChange?: number;
  /** Called after successful PIN change — session may be invalidated */
  onSuccess: () => void;
  /** Called if user opts to defer (only if canDefer is true) */
  onDefer?: () => void;
  /** Whether the user can skip for now */
  canDefer?: boolean;
}

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

export default function PinRotationModal({
  email,
  token,
  daysSinceChange,
  onSuccess,
  onDefer,
  canDefer = false,
}: PinRotationModalProps) {
  const [step, setStep] = useState<"old" | "new" | "confirm" | "saving" | "success" | "error">("old");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const activePin = step === "old" ? oldPin : step === "new" ? newPin : confirmPin;
  const setActivePin =
    step === "old" ? setOldPin : step === "new" ? setNewPin : setConfirmPin;
  const stepLabel =
    step === "old"
      ? "Enter your current PIN"
      : step === "new"
      ? "Choose a new 6-digit PIN"
      : "Confirm your new PIN";

  const handleDigit = useCallback(
    (d: string) => {
      setActivePin((prev) => {
        if (prev.length >= 6) return prev;
        return prev + d;
      });
      setError("");
    },
    [setActivePin]
  );

  const handleDelete = useCallback(() => {
    setActivePin((prev) => prev.slice(0, -1));
  }, [setActivePin]);

  // Auto-advance when 6 digits entered
  useEffect(() => {
    if (step === "old" && oldPin.length === 6) {
      setTimeout(() => setStep("new"), 200);
    } else if (step === "new" && newPin.length === 6) {
      setTimeout(() => setStep("confirm"), 200);
    } else if (step === "confirm" && confirmPin.length === 6) {
      if (confirmPin !== newPin) {
        setError("PINs don't match — try again");
        setConfirmPin("");
        setStep("new");
        setNewPin("");
        return;
      }
      handleSave();
    }
  }, [oldPin, newPin, confirmPin, step]);

  const handleSave = useCallback(async () => {
    setStep("saving");
    setError("");

    try {
      const res = await fetch(`${API_BASE}/pin-change`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        credentials: "include",
        body: JSON.stringify({ old_pin: oldPin, new_pin: newPin }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "PIN change failed");
        setStep("error");
        return;
      }

      setStep("success");
      setTimeout(() => onSuccess(), 1500);
    } catch {
      setError("Connection error — try again");
      setStep("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldPin, newPin, token, onSuccess]);

  const canInput = step === "old" || step === "new" || step === "confirm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 relative">
        {/* Close (defer) button */}
        {canDefer && onDefer && (
          <button
            onClick={onDefer}
            className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
            aria-label="Skip for now"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">PIN Rotation Required</h2>
            <p className="text-zinc-400 text-sm">
              {daysSinceChange
                ? `Your PIN hasn't been changed in ${daysSinceChange} days.`
                : "It's time to change your PIN for security."}
            </p>
          </div>
        </div>

        {canInput && (
          <>
            <p className="text-zinc-400 text-sm mb-4 text-center">{stepLabel}</p>

            {/* PIN dots */}
            <div className="flex justify-center gap-3 mb-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                    i < activePin.length
                      ? "bg-amber-400 border-amber-400 scale-110"
                      : "border-zinc-600 bg-transparent"
                  }`}
                />
              ))}
            </div>

            {/* Hidden input */}
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={activePin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setActivePin(val);
                setError("");
              }}
              className="sr-only"
              autoFocus
            />

            {/* Numeric keypad */}
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d) =>
                d === "" ? (
                  <div key="empty" />
                ) : d === "⌫" ? (
                  <button
                    key="del"
                    onClick={handleDelete}
                    className="h-12 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-lg transition-colors touch-manipulation"
                  >
                    ⌫
                  </button>
                ) : (
                  <button
                    key={d}
                    onClick={() => handleDigit(d)}
                    className="h-12 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-medium transition-colors touch-manipulation"
                  >
                    {d}
                  </button>
                )
              )}
            </div>
          </>
        )}

        {step === "saving" && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-3" />
            <p className="text-zinc-400 text-sm">Updating your PIN…</p>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-400 mb-3" />
            <p className="text-white font-medium">PIN updated successfully</p>
            <p className="text-zinc-400 text-sm mt-1">You will be logged out. Please log in with your new PIN.</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {step === "error" && (
          <button
            onClick={() => {
              setStep("old");
              setOldPin("");
              setNewPin("");
              setConfirmPin("");
              setError("");
            }}
            className="w-full mt-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl transition-colors"
          >
            Try Again
          </button>
        )}

        {/* Step indicators */}
        {canInput && (
          <div className="flex justify-center gap-2 mt-6">
            {["old", "new", "confirm"].map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all ${
                  step === s ? "bg-amber-400 scale-125" : "bg-zinc-700"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
