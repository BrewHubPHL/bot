"use client";

/**
 * Parcel Mobile Scan — iPhone 17 Pro "Fast-Intake" Page
 *
 * ┌────────────────────────┐
 * │  VIEWFINDER (40%)      │ ← Camera w/ BarcodeScanner + Carrier Badge
 * │  [████ USPS ████]      │
 * ├────────────────────────┤
 * │  UNIT: 4 0 3 _         │ ← Display
 * │  ┌────┬────┬────┐      │
 * │  │ 1  │ 2  │ 3  │      │
 * │  ├────┼────┼────┤      │ ← Massive numpad (60%)
 * │  │ 4  │ 5  │ 6  │      │
 * │  ├────┼────┼────┤      │
 * │  │ 7  │ 8  │ 9  │      │
 * │  ├────┼────┼────┤      │
 * │  │ ⌫  │ 0  │ CLR│      │
 * │  └────┴────┴────┘      │
 * │  [ ■■■ SUBMIT ■■■ ]    │
 * └────────────────────────┘
 *
 * SYNC: Every action broadcasts to iPad Command Center via
 * `supabase.channel('parcel_sync')`.
 *
 * SECURITY: Uses PIN-gated OpsGate session token for all API calls.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useOpsSession } from "@/components/OpsGate";
import BarcodeScanner from "@/components/BarcodeScanner";
import { detectCarrier, type Carrier } from "@/lib/detectCarrier";
import { useParcelSync } from "@/hooks/useParcelSync";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import { cn } from "@/lib/utils";
import {
  Package, Truck, Delete, Loader2, CheckCircle2,
  AlertTriangle, Wifi, WifiOff, Building,
} from "lucide-react";

/* ─── Constants ────────────────────────────────────────────────── */
const CARRIER_LABELS: Record<Carrier, string> = {
  FEDEX: "FedEx", UPS: "UPS", USPS: "USPS", DHL: "DHL", OTHER: "Other",
};

const CARRIER_COLORS: Record<Carrier, string> = {
  FEDEX: "bg-purple-600/80 text-white",
  UPS: "bg-amber-700/80 text-white",
  USPS: "bg-blue-600/80 text-white",
  DHL: "bg-yellow-500/80 text-black",
  OTHER: "bg-stone-700/80 text-stone-200",
};

const CARRIER_BORDER: Record<Carrier, string> = {
  FEDEX: "border-purple-500",
  UPS: "border-amber-500",
  USPS: "border-blue-500",
  DHL: "border-yellow-500",
  OTHER: "border-stone-600",
};

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

type SubmitStatus = "idle" | "submitting" | "success" | "error" | "duplicate";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function MobileScanPage() {
  const { token } = useOpsSession();

  /* ─── State ──────────────────────────────────────────────────── */
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState<Carrier>("OTHER");
  const [unitInput, setUnitInput] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  /* ─── Visual-flash overlay ref ─────────────────────────────── */
  const flashRef = useRef<HTMLDivElement>(null);

  /**
   * triggerFeedback — haptic vibration with visual flash fallback.
   * If navigator.vibrate is blocked (Silent Mode, permissions, etc.),
   * we flash the screen border so the staff member always gets feedback.
   *
   *   success → green border flash, 200ms
   *   error   → red border flash + shake, 500ms
   */
  const triggerFeedback = useCallback(
    (type: "success" | "error") => {
      const vibrationPattern = type === "success" ? [50] : [100, 50, 100];

      // Try haptic first
      let hapticWorked = false;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          hapticWorked = navigator.vibrate(vibrationPattern) !== false;
        } catch {
          hapticWorked = false;
        }
      }

      // Always fire visual flash (belt-and-suspenders — works even if haptic succeeded)
      const el = flashRef.current;
      if (!el) return;

      // Clear any in-progress flash
      el.classList.remove("flash-success", "flash-error", "animate-shake");
      // Force reflow so re-adding the class restarts the animation
      void el.offsetWidth;

      if (type === "success") {
        el.classList.add("flash-success");
        setTimeout(() => el.classList.remove("flash-success"), 200);
      } else {
        el.classList.add("flash-error", "animate-shake");
        setTimeout(() => el.classList.remove("flash-error", "animate-shake"), 500);
      }
    },
    [],
  );

  /** Light tap for numpad / barcode (no visual — just vibration) */
  const hapticTap = useCallback((ms: number) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch { /* noop */ }
    }
  }, []);

  /* ─── Realtime sync to iPad ──────────────────────────────────── */
  const { connected, sendTracking, sendUnit, sendSubmit, sendDuplicate } = useParcelSync({
    // iPhone listens for DENIED results from iPad
    onResult: (data) => {
      if (!data.success) {
        setStatus("error");
        setStatusMessage(data.error || "Denied by Command Center.");
        triggerFeedback("error");
      }
    },
  });

  /* ─── Barcode scan handler ────────────────────────────────────── */
  const handleBarcodeScan = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      setTracking(trimmed);
      const detected = detectCarrier(trimmed);
      setCarrier(detected);

      // Broadcast to iPad immediately
      sendTracking(trimmed, detected);

      // Success tap
      hapticTap(50);
    },
    [sendTracking],
  );

  /* ─── Numpad handler ─────────────────────────────────────────── */
  const handleNumpad = useCallback(
    (key: string) => {
      hapticTap(15);

      let next: string;
      if (key === "DEL") {
        next = unitInput.slice(0, -1);
      } else if (key === "CLR") {
        next = "";
      } else {
        if (unitInput.length >= 6) return;
        next = unitInput + key;
      }

      setUnitInput(next);
      // Broadcast unit keystrokes in real-time (shadow effect)
      sendUnit(next);
    },
    [unitInput, sendUnit],
  );

  /* ─── Submit check-in ────────────────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    const trimmedTracking = tracking.trim();
    if (!trimmedTracking) {
      setStatusMessage("Scan a tracking number first.");
      setStatus("error");
      return;
    }
    if (!unitInput.trim()) {
      setStatusMessage("Enter a unit number.");
      setStatus("error");
      return;
    }

    // Double-submit guard (useRef, not useState — instant)
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setStatus("submitting");
    setStatusMessage(null);

    try {
      // Broadcast submit intent to iPad (iPad will validate + display)
      sendSubmit({
        tracking: trimmedTracking,
        carrier,
        unit: unitInput.trim(),
        residentName: null, // iPad resolves from its cache
        residentId: null,
      });

      const res = await fetch(`${API_BASE}/parcel-check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          tracking_number: trimmedTracking,
          carrier,
          value_tier: "standard",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Check-in failed" }));
        const errMsg = body.error || `HTTP ${res.status}`;

        // ─── Duplicate scan detection ─────────────────────────
        if (res.status === 400 && errMsg.toLowerCase().includes("already checked in")) {
          // Unique triple-pulse vibration for duplicates
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try { navigator.vibrate([80, 60, 80, 60, 80]); } catch { /* noop */ }
          }
          // Visual flash — amber
          const el = flashRef.current;
          if (el) {
            el.classList.remove("flash-success", "flash-error", "flash-duplicate");
            void el.offsetWidth;
            el.classList.add("flash-duplicate");
            setTimeout(() => el.classList.remove("flash-duplicate"), 2500);
          }
          // Broadcast duplicate to iPad so it can highlight the original
          sendDuplicate({ tracking: trimmedTracking, carrier, unit: unitInput.trim() });
          setStatus("duplicate");
          setStatusMessage("📦 ALREADY ARRIVED.");
          // Auto-reset after showing the amber overlay
          setTimeout(() => {
            setStatus("idle");
            setStatusMessage(null);
          }, 3000);
          return;
        }

        throw new Error(errMsg);
      }

      // Success
      triggerFeedback("success");
      setStatus("success");
      setStatusMessage("Checked in!");

      // Reset for next scan after brief flash
      setTimeout(() => {
        setTracking("");
        setUnitInput("");
        setCarrier("OTHER");
        setStatus("idle");
        setStatusMessage(null);
      }, 1200);
    } catch (err: unknown) {
      triggerFeedback("error");
      setStatus("error");
      setStatusMessage(toUserSafeMessageFromUnknown(err, "Check-in failed."));
    } finally {
      submitLockRef.current = false;
    }
  }, [tracking, unitInput, carrier, token, sendSubmit, sendDuplicate, triggerFeedback]);

  /* ─── Auto-detect carrier when tracking changes via manual edit ── */
  useEffect(() => {
    if (!tracking.trim()) {
      setCarrier("OTHER");
      return;
    }
    setCarrier(detectCarrier(tracking));
  }, [tracking]);

  /* ─── Numpad layout ──────────────────────────────────────────── */
  const NUMPAD_KEYS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["DEL", "0", "CLR"],
  ];

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  /*  RENDER                                                        */
  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <div className="fixed inset-0 flex flex-col bg-stone-950 text-white select-none overflow-hidden">

      {/* ═══ VISUAL FLASH OVERLAY (haptic fallback) ═════════════ */}
      {/* Inline <style> keeps the shake keyframes co-located with the component */}
      <style>{`
        .flash-success {
          box-shadow: inset 0 0 0 6px rgba(34,197,94,0.9);
          transition: box-shadow 0ms;
        }
        .flash-error {
          box-shadow: inset 0 0 0 6px rgba(239,68,68,0.9);
          transition: box-shadow 0ms;
        }
        .flash-duplicate {
          box-shadow: inset 0 0 0 6px rgba(245,158,11,0.9);
          transition: box-shadow 0ms;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
      <div
        ref={flashRef}
        className="pointer-events-none fixed inset-0 z-[9999] rounded-none"
        aria-hidden="true"
      />

      {/* ═══ CONNECTION STATUS BAR ═══════════════════════════════ */}
      <div className={cn(
        "flex items-center justify-between px-3 py-1 text-[10px] font-medium uppercase tracking-widest transition-colors",
        connected
          ? "bg-green-900/40 text-green-400"
          : "bg-red-900/40 text-red-400",
      )}>
        <span className="flex items-center gap-1">
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "Synced to Command Center" : "Disconnected"}
        </span>
        <span className="font-mono text-[9px] text-stone-500">SCANNER</span>
      </div>

      {/* ═══ VIEWFINDER — Top 40% ═══════════════════════════════ */}
      <div className="relative h-[40%] min-h-0 shrink-0">
        <BarcodeScanner
          onScan={handleBarcodeScan}
          active={status !== "submitting"}
          className="h-full w-full"
        />

        {/* Carrier Badge Overlay */}
        {tracking && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
            <div className={cn(
              "flex items-center gap-2 rounded-full px-5 py-2 text-lg font-black uppercase tracking-wider shadow-2xl backdrop-blur-sm",
              CARRIER_COLORS[carrier],
            )}>
              <Truck className="h-5 w-5" />
              {CARRIER_LABELS[carrier]}
            </div>
          </div>
        )}

        {/* Tracking number display — subtle overlay at top */}
        {tracking && (
          <div className="pointer-events-none absolute left-3 right-3 top-2">
            <div className="truncate rounded-lg bg-black/60 px-3 py-1.5 font-mono text-xs text-stone-300 backdrop-blur-sm">
              {tracking}
            </div>
          </div>
        )}
      </div>

      {/* ═══ NUMPAD ZONE — Bottom 60% ═══════════════════════════ */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">

        {/* Unit display bar */}
        <div className={cn(
          "mx-3 mt-2 flex items-center rounded-xl border-2 px-4 py-2.5 transition-colors",
          status === "error"
            ? "border-red-600 bg-red-950/40"
            : status === "duplicate"
              ? "border-amber-500 bg-amber-950/40"
              : status === "success"
                ? "border-green-600 bg-green-950/30"
                : unitInput
                  ? CARRIER_BORDER[carrier] + " bg-stone-900"
                  : "border-stone-700 bg-stone-900",
        )}>
          <Building className="mr-2 h-5 w-5 shrink-0 text-stone-500" />
          <span className="flex-1 font-mono text-3xl font-bold tracking-[0.25em]">
            {unitInput || <span className="text-lg text-stone-600 tracking-normal">Unit #</span>}
          </span>
          {status === "submitting" && <Loader2 className="h-5 w-5 animate-spin text-stone-400" />}
        </div>

        {/* Status message */}
        {statusMessage && (
          <div className={cn(
            "mx-3 mt-1.5 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium",
            status === "success"
              ? "bg-green-900/40 text-green-300"
              : status === "duplicate"
                ? "bg-amber-900/40 text-amber-300"
                : "bg-red-900/40 text-red-300",
          )}>
            {status === "success"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              : status === "duplicate"
                ? <Package className="h-3.5 w-3.5 shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {statusMessage}
          </div>
        )}

        {/* Numpad grid — fills remaining space */}
        <div className="flex flex-1 flex-col justify-center gap-1.5 px-3 py-2 min-h-0">
          {NUMPAD_KEYS.map((row, ri) => (
            <div key={ri} className="grid grid-cols-3 gap-1.5 flex-1">
              {row.map((key) => {
                const isDel = key === "DEL";
                const isClr = key === "CLR";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleNumpad(key)}
                    disabled={status === "submitting"}
                    className={cn(
                      "flex items-center justify-center rounded-2xl text-2xl font-bold transition-all active:scale-95",
                      isDel
                        ? "bg-stone-800 text-orange-400 active:bg-stone-700"
                        : isClr
                          ? "bg-stone-800 text-red-400 active:bg-stone-700"
                          : "bg-stone-800 text-white active:bg-stone-700",
                      "disabled:opacity-40",
                    )}
                  >
                    {isDel ? <Delete className="h-7 w-7" /> : key}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* SUBMIT button — bottom */}
        <div className="px-3 pb-3 pt-1 shrink-0">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={status === "submitting" || !tracking.trim() || !unitInput.trim()}
            className={cn(
              "flex w-full items-center justify-center gap-3 rounded-2xl py-5 text-xl font-black uppercase tracking-wider transition-all active:scale-[0.97]",
              status === "submitting"
                ? "bg-stone-700 text-stone-400"
                : "bg-amber-600 text-white active:bg-amber-500 disabled:bg-stone-800 disabled:text-stone-600",
            )}
          >
            {status === "submitting" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Package className="h-6 w-6" />
            )}
            {status === "submitting" ? "CHECKING IN…" : "SUBMIT"}
          </button>
        </div>
      </div>
    </div>
  );
}
