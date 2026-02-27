"use client";

/**
 * Parcel Scanner POS — iPad Air M3 Command Center
 *
 * ┌────────────┬──────────────────────────────┬────────────┐
 * │ Cols 1-3   │ Cols 4-9                     │ Cols 10-12 │
 * │ Recent     │ Scanner: tracking input +    │ Resident   │
 * │ Scans      │ big-button unit numpad       │ Card +     │
 * │ list       │ (0-9, A, B, C)               │ Phone/QA   │
 * └────────────┴──────────────────────────────┴────────────┘
 *
 * DATA FLOW:
 *   1. Staff scans/types tracking → detectCarrier auto-fills carrier.
 *   2. Staff taps unit via numpad → fires resident lookup.
 *   3. If unit exists → Resident Card shows initials + name (green).
 *      Phone auto-populates from directory.
 *   4. If unit unknown → "GHOST RESIDENT" → Quick-Add form:
 *      manual name + phone so pickup notification still fires.
 *   5. Staff hits "CHECK IN" → parcel-check-in API → parcels INSERT
 *      → Supabase Realtime fires → Lobby Board flaps immediately.
 *      → Twilio SMS fires to resident phone.
 *
 * REAL-TIME SHADOWING:
 *   The useParcelSync hook listens for iPhone broadcasts. When the
 *   iPhone scans a barcode or types a unit digit, this iPad updates
 *   instantly. A mechanical "clack" sound plays on every iPhone scan.
 *
 * SECURITY: Uses PIN-gated OpsGate session token for all API calls.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useOpsSession } from "@/components/OpsGate";
import { useParcelSync } from "@/hooks/useParcelSync";
import { detectCarrier, type Carrier } from "@/lib/detectCarrier";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import { cn } from "@/lib/utils";
import {
  Package, ScanLine, Loader2, CheckCircle2, AlertTriangle,
  Truck, X, User, Building, Delete, Phone, UserPlus, Wifi, WifiOff,
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────── */
interface RecentScan {
  id: string;
  tracking: string;
  unit: string;
  carrier: Carrier;
  recipientName: string | null;
  timestamp: number;
  source: "local" | "iphone";
}

interface ResidentInfo {
  id: number;
  name: string;
  unit_number: string | null;
  phone: string | null;
}

type CheckInStatus = "idle" | "submitting" | "success" | "error";
type ResidentState = "idle" | "loading" | "found" | "ghost";

const CARRIER_LABELS: Record<Carrier, string> = {
  FEDEX: "FedEx", UPS: "UPS", USPS: "USPS", DHL: "DHL", OTHER: "Other",
};

const CARRIER_COLORS: Record<Carrier, string> = {
  FEDEX: "text-purple-400",
  UPS: "text-amber-400",
  USPS: "text-blue-400",
  DHL: "text-yellow-400",
  OTHER: "text-stone-400",
};

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Haptic helper ────────────────────────────────────────────── */
function haptic(pattern: "tap" | "success" | "error" | "warning") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const map: Record<string, number | number[]> = {
    tap: 15, success: [15, 80, 15], error: [50, 30, 50, 30, 50], warning: [30, 60, 30],
  };
  try { navigator.vibrate(map[pattern]); } catch { /* noop */ }
}

/* ─── Initials from a full name ────────────────────────────────── */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/* ─── Mechanical "clack" sound via Web Audio API ───────────────── */
let audioCtx: AudioContext | null = null;

function playClack() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;

    // Short percussive burst — sounds like a solenoid relay click
    const duration = 0.04;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      // Exponential decay white noise = mechanical click
      const t = i / ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 120) * 0.8;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Band-pass filter for that "clack" character (600-2000 Hz range)
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.7;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch {
    /* Audio not available — silent fallback */
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function ParcelScanPage() {
  const { token } = useOpsSession();

  /* ─── Core State ─────────────────────────────────────────────── */
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState<Carrier>("OTHER");
  const [unitInput, setUnitInput] = useState("");
  const [status, setStatus] = useState<CheckInStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  /* ─── Resident Lookup ────────────────────────────────────────── */
  const [resident, setResident] = useState<ResidentInfo | null>(null);
  const [residentState, setResidentState] = useState<ResidentState>("idle");

  /* ─── Ghost / Quick-Add Fields ───────────────────────────────── */
  const [ghostName, setGhostName] = useState("");
  const [ghostPhone, setGhostPhone] = useState("");

  /* ─── Phone Lookup ───────────────────────────────────────────── */
  const [phoneLookup, setPhoneLookup] = useState("");
  const [phoneLookupResult, setPhoneLookupResult] = useState<ResidentInfo | null>(null);

  /* ─── Recent Scans (session-local) ──────────────────────────── */
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  /* ─── Refs ───────────────────────────────────────────────────── */
  const trackingInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const unitLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session-cached resident directory (small building ≈ <200 rows)
  const sessionResidentDirectory = useRef<ResidentInfo[] | null>(null);
  /** Monotonic seq gate — discard out-of-order iPhone broadcasts */
  const lastProcessedSeq = useRef(0);

  /* ─── iPhone → iPad Real-time Sync (Clack!) ─────────────────── */
  const { connected: syncConnected, sendResult } = useParcelSync({
    onTracking: useCallback((t: string, c: string, seq: number) => {
      if (seq <= lastProcessedSeq.current) return; // out-of-order — discard
      lastProcessedSeq.current = seq;
      setTracking(t);
      setCarrier(c as Carrier);
      playClack();
    }, []),
    onUnit: useCallback((u: string, seq: number) => {
      if (seq <= lastProcessedSeq.current) return; // out-of-order — discard
      lastProcessedSeq.current = seq;
      setUnitInput(u);
      playClack();
    }, []),
    onSubmit: useCallback(() => {
      // iPhone requested submit — the iPad processes it
      playClack();
    }, []),
  });

  /* ─── Auto-detect carrier when tracking changes ──────────────── */
  useEffect(() => {
    if (!tracking.trim()) {
      setCarrier("OTHER");
      return;
    }
    setCarrier(detectCarrier(tracking));
  }, [tracking]);

  /* ─── Focus tracking input on mount ──────────────────────────── */
  useEffect(() => {
    trackingInputRef.current?.focus();
  }, []);

  /* ─── Resident directory loader (one-time, then cached) ──────── */
  const loadDirectory = useCallback(async (): Promise<ResidentInfo[]> => {
    if (sessionResidentDirectory.current) return sessionResidentDirectory.current;

    const prefixes = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
      "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w",
      "x", "y", "z"];

    const allResults = new Map<number, ResidentInfo>();

    const batchSize = 6;
    for (let i = 0; i < prefixes.length; i += batchSize) {
      const batch = prefixes.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (p) => {
          const res = await fetch(
            `${API_BASE}/search-residents?prefix=${encodeURIComponent(p)}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "X-BrewHub-Action": "true",
              },
            },
          );
          if (!res.ok) return [];
          const d = await res.json();
          return (d.results || []) as ResidentInfo[];
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const entry of r.value) {
            allResults.set(entry.id, entry);
          }
        }
      }
    }

    const directory = Array.from(allResults.values());
    sessionResidentDirectory.current = directory;
    return directory;
  }, [token]);

  /* ─── Unit lookup (debounced) ────────────────────────────────── */
  const lookupUnit = useCallback(async (unit: string) => {
    if (!unit.trim()) {
      setResident(null);
      setResidentState("idle");
      return;
    }

    setResidentState("loading");

    try {
      const directory = await loadDirectory();
      const normalised = unit.trim().toLowerCase();
      const match = directory.find(
        (r) => r.unit_number?.trim().toLowerCase() === normalised,
      );

      if (match) {
        setResident(match);
        setResidentState("found");
        setGhostName("");
        setGhostPhone("");
        haptic("success");
      } else {
        setResident(null);
        setResidentState("ghost");
        haptic("error");
      }
    } catch {
      setResident(null);
      setResidentState("ghost");
      haptic("error");
    }
  }, [loadDirectory]);

  /* ─── Debounced unit change handler ──────────────────────────── */
  useEffect(() => {
    if (unitLookupTimer.current) clearTimeout(unitLookupTimer.current);
    if (!unitInput.trim()) {
      setResident(null);
      setResidentState("idle");
      return;
    }
    unitLookupTimer.current = setTimeout(() => lookupUnit(unitInput), 400);
    return () => {
      if (unitLookupTimer.current) clearTimeout(unitLookupTimer.current);
    };
  }, [unitInput, lookupUnit]);

  /* ─── Phone number lookup (debounced) ────────────────────────── */
  const lookupByPhone = useCallback(async (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 7) {
      setPhoneLookupResult(null);
      return;
    }

    try {
      const directory = await loadDirectory();
      const match = directory.find((r) => {
        if (!r.phone) return false;
        const rPhone = r.phone.replace(/\D/g, "");
        return rPhone.slice(-10) === cleaned.slice(-10);
      });

      if (match) {
        setPhoneLookupResult(match);
        setUnitInput(match.unit_number || "");
        setResident(match);
        setResidentState("found");
        haptic("success");
      } else {
        setPhoneLookupResult(null);
      }
    } catch {
      setPhoneLookupResult(null);
    }
  }, [loadDirectory]);

  useEffect(() => {
    if (phoneLookupTimer.current) clearTimeout(phoneLookupTimer.current);
    if (!phoneLookup.trim()) {
      setPhoneLookupResult(null);
      return;
    }
    phoneLookupTimer.current = setTimeout(() => lookupByPhone(phoneLookup), 500);
    return () => {
      if (phoneLookupTimer.current) clearTimeout(phoneLookupTimer.current);
    };
  }, [phoneLookup, lookupByPhone]);

  /* ─── Numpad handler ─────────────────────────────────────────── */
  const handleNumpad = useCallback((key: string) => {
    haptic("tap");
    if (key === "DEL") {
      setUnitInput((prev) => prev.slice(0, -1));
    } else if (key === "CLR") {
      setUnitInput("");
    } else {
      setUnitInput((prev) => (prev.length >= 6 ? prev : prev + key));
    }
    setTimeout(() => trackingInputRef.current?.focus(), 50);
  }, []);

  /* ─── Submit check-in ────────────────────────────────────────── */
  const handleCheckIn = useCallback(async () => {
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

    // Ghost residents can still check in IF they provided a name (Quick-Add)
    const isGhostWithInfo = residentState === "ghost" && ghostName.trim();
    if (residentState === "ghost" && !ghostName.trim()) {
      setStatusMessage("Unknown unit — fill in the Quick-Add name to continue.");
      setStatus("error");
      haptic("error");
      return;
    }

    // Double-submit guard (useRef, not useState — instant)
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setStatus("submitting");
    setStatusMessage(null);

    try {
      const payload: Record<string, string | undefined> = {
        tracking_number: trimmedTracking,
        carrier,
        value_tier: "standard",
      };

      if (isGhostWithInfo) {
        // Ghost / Quick-Add: pass name + phone directly
        payload.recipient_name = ghostName.trim();
        payload.phone_number = ghostPhone.replace(/\D/g, "") || undefined;
        payload.unit_number = unitInput.trim();
      } else {
        // Known resident
        payload.recipient_name = resident?.name || undefined;
        payload.resident_id = resident?.id ? String(resident.id) : undefined;
      }

      const res = await fetch(`${API_BASE}/parcel-check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Check-in failed" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const result = await res.json();

      haptic("success");
      playClack();
      setStatus("success");
      setStatusMessage(result.message || `Checked in ${trimmedTracking}`);

      // Broadcast result to iPhone
      sendResult({ success: true, parcelId: result.parcel_id });

      // Push to recent scans
      setRecentScans((prev) =>
        [{
          id: crypto.randomUUID(),
          tracking: trimmedTracking,
          unit: unitInput.trim(),
          carrier,
          recipientName: isGhostWithInfo ? ghostName.trim() : (resident?.name || null),
          timestamp: Date.now(),
          source: "local" as const,
        }, ...prev].slice(0, 50),
      );

      // Reset for next scan after brief success flash
      setTimeout(() => {
        setTracking("");
        setUnitInput("");
        setCarrier("OTHER");
        setResident(null);
        setResidentState("idle");
        setGhostName("");
        setGhostPhone("");
        setPhoneLookup("");
        setPhoneLookupResult(null);
        setStatus("idle");
        setStatusMessage(null);
        trackingInputRef.current?.focus();
      }, 1500);
    } catch (err: unknown) {
      haptic("error");
      setStatus("error");
      setStatusMessage(toUserSafeMessageFromUnknown(err, "Check-in failed."));
      sendResult({ success: false, error: "Check-in failed" });
    } finally {
      submitLockRef.current = false;
    }
  }, [tracking, unitInput, carrier, resident, residentState, ghostName, ghostPhone, token, sendResult]);

  /* ─── Delete recent scan from local list ─────────────────────── */
  const removeRecentScan = useCallback((id: string) => {
    setRecentScans((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /* ─── Enter to submit ────────────────────────────────────────── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && tracking.trim() && unitInput.trim()) {
        e.preventDefault();
        handleCheckIn();
      }
    },
    [handleCheckIn, tracking, unitInput],
  );

  /* ─── Numpad button layout ───────────────────────────────────── */
  const NUMPAD_KEYS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["A", "0", "B"],
    ["C", "DEL", "CLR"],
  ];

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  /*  RENDER                                                        */
  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <div className="h-screen w-screen select-none overflow-hidden bg-stone-950 text-white flex flex-col lg:grid lg:grid-cols-12">

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* COL 1-3 : RECENT SCANS                                    */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <aside className="hidden lg:flex lg:col-span-3 lg:h-screen flex-col border-r border-stone-800 bg-stone-900/50">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
          <Package className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-stone-300">
            Recent Scans
          </h2>
          <span className="ml-auto rounded-full bg-stone-800 px-2 py-0.5 text-xs font-mono text-stone-400">
            {recentScans.length}
          </span>
        </div>

        {/* Sync Status */}
        <div className={cn(
          "flex items-center gap-2 border-b px-4 py-2 text-xs transition-colors",
          syncConnected
            ? "border-green-900/50 bg-green-950/30 text-green-400"
            : "border-red-900/50 bg-red-950/30 text-red-400",
        )}>
          {syncConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {syncConnected ? "iPhone Link Active" : "iPhone Disconnected"}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {recentScans.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-stone-600">
              No scans this session
            </p>
          )}
          {recentScans.map((scan) => (
            <div
              key={scan.id}
              className="group flex items-center gap-2 rounded-lg bg-stone-800/50 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn("font-bold text-[10px] uppercase", CARRIER_COLORS[scan.carrier])}>
                    {CARRIER_LABELS[scan.carrier]}
                  </span>
                  <span className="truncate font-mono text-stone-300">
                    {scan.tracking.length > 18
                      ? `…${scan.tracking.slice(-14)}`
                      : scan.tracking}
                  </span>
                  {scan.source === "iphone" && (
                    <span className="rounded bg-blue-900/40 px-1 py-0.5 text-[9px] text-blue-400">📱</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-stone-500">
                  <Building className="h-3 w-3" />
                  <span>Unit {scan.unit}</span>
                  {scan.recipientName && (
                    <>
                      <span className="text-stone-700">·</span>
                      <span className="truncate">{scan.recipientName}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeRecentScan(scan.id)}
                className="shrink-0 rounded p-1 text-stone-600 opacity-0 transition hover:bg-red-900/40 hover:text-red-400 group-hover:opacity-100"
                aria-label="Remove scan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* COL 4-9 : THE SCANNER                                     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <main className="flex flex-1 flex-col lg:col-span-6 lg:h-screen overflow-hidden">
        {/* ── Top bar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-b border-stone-800 px-5 py-3">
          <ScanLine className="h-6 w-6 text-amber-400" />
          <h1 className="text-lg font-bold tracking-tight">Parcel Scanner</h1>
          {carrier !== "OTHER" && (
            <span className={cn(
              "ml-2 rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-bold uppercase",
              CARRIER_COLORS[carrier],
            )}>
              <Truck className="mr-1 inline h-3 w-3" />
              {CARRIER_LABELS[carrier]}
            </span>
          )}
          {/* Sync badge */}
          <span className={cn(
            "ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
            syncConnected ? "bg-green-900/40 text-green-400" : "bg-stone-800 text-stone-500",
          )}>
            {syncConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {syncConnected ? "SYNC" : "LOCAL"}
          </span>
        </div>

        {/* ── Tracking Input ───────────────────────────────────── */}
        <div className="px-5 pt-4 pb-2">
          <label htmlFor="tracking" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-stone-500">
            Tracking Number
          </label>
          <input
            ref={trackingInputRef}
            id="tracking"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan barcode or type tracking #"
            className="w-full rounded-xl border-2 border-stone-700 bg-stone-900 px-4 py-3.5 font-mono text-lg text-white placeholder-stone-600 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
            disabled={status === "submitting"}
          />
        </div>

        {/* ── Unit Input Display ───────────────────────────────── */}
        <div className="px-5 pb-2">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-stone-500">
            Unit Number
          </label>
          <div className={cn(
            "flex items-center rounded-xl border-2 px-4 py-3 font-mono text-2xl tracking-widest transition",
            residentState === "ghost"
              ? "border-red-600 bg-red-950/40 text-red-400"
              : residentState === "found"
                ? "border-green-700 bg-green-950/30 text-green-300"
                : "border-stone-700 bg-stone-900 text-stone-300",
          )}>
            <Building className="mr-2 h-5 w-5 shrink-0 text-stone-500" />
            <span className="flex-1">
              {unitInput || <span className="text-lg text-stone-600">Tap numpad below</span>}
            </span>
            {residentState === "loading" && <Loader2 className="h-5 w-5 animate-spin text-stone-500" />}
          </div>
        </div>

        {/* ── Big Button Numpad ─────────────────────────────────── */}
        <div className="flex flex-1 flex-col justify-center px-5 pb-3">
          <div className="mx-auto grid w-full max-w-sm gap-2">
            {NUMPAD_KEYS.map((row, ri) => (
              <div key={ri} className="grid grid-cols-3 gap-2">
                {row.map((key) => {
                  const isDel = key === "DEL";
                  const isClr = key === "CLR";
                  const isLetter = /^[A-C]$/.test(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleNumpad(key)}
                      disabled={status === "submitting"}
                      className={cn(
                        "flex items-center justify-center rounded-xl py-4 text-xl font-bold transition active:scale-95",
                        isDel
                          ? "bg-stone-800 text-orange-400 hover:bg-stone-700"
                          : isClr
                            ? "bg-stone-800 text-red-400 hover:bg-stone-700"
                            : isLetter
                              ? "bg-stone-800 text-amber-300 hover:bg-stone-700"
                              : "bg-stone-800 text-white hover:bg-stone-700",
                        "disabled:opacity-40",
                      )}
                    >
                      {isDel ? <Delete className="h-6 w-6" /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Status Bar + Check In Button ─────────────────────── */}
        <div className="border-t border-stone-800 px-5 py-3 space-y-2">
          {statusMessage && (
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              status === "success"
                ? "border border-green-800 bg-green-900/40 text-green-300"
                : "border border-red-800 bg-red-900/40 text-red-300",
            )}>
              {status === "success"
                ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                : <AlertTriangle className="h-4 w-4 shrink-0" />}
              {statusMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleCheckIn}
            disabled={
              status === "submitting" ||
              !tracking.trim() ||
              !unitInput.trim() ||
              (residentState === "ghost" && !ghostName.trim())
            }
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold transition active:scale-[0.98]",
              residentState === "ghost" && !ghostName.trim()
                ? "bg-red-700 text-white cursor-not-allowed opacity-60"
                : "bg-amber-600 text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {status === "submitting"
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Package className="h-5 w-5" />}
            {status === "submitting" ? "Checking In…" : "CHECK IN"}
          </button>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* COL 10-12 : RESIDENT CARD                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <aside className={cn(
        "hidden lg:flex lg:col-span-3 lg:h-screen flex-col border-l transition-colors duration-300",
        residentState === "ghost"
          ? "border-red-700 bg-red-950/60"
          : residentState === "found"
            ? "border-green-800 bg-stone-900"
            : "border-stone-800 bg-stone-900",
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center gap-2 border-b px-4 py-3 transition-colors duration-300",
          residentState === "ghost" ? "border-red-800" : "border-stone-800",
        )}>
          <User className={cn(
            "h-5 w-5 transition-colors duration-300",
            residentState === "ghost" ? "text-red-400" : "text-amber-400",
          )} />
          <h2 className="text-sm font-bold uppercase tracking-wider text-stone-300">
            Resident
          </h2>
        </div>

        {/* ── Phone Lookup ─────────────────────────────────────── */}
        <div className="border-b border-stone-800 px-4 py-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-stone-500">
            <Phone className="mr-1 inline h-3 w-3" />
            Phone Lookup
          </label>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="(267) 555-1234"
            value={phoneLookup}
            onChange={(e) => setPhoneLookup(e.target.value)}
            className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm font-mono text-white placeholder-stone-600 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
          />
          {phoneLookupResult && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded bg-green-900/40 px-2 py-1 text-xs text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              {phoneLookupResult.name} · Unit {phoneLookupResult.unit_number}
            </div>
          )}
        </div>

        {/* Card Body */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 overflow-y-auto">

          {/* Idle — no unit entered yet */}
          {residentState === "idle" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-stone-800">
                <User className="h-12 w-12 text-stone-600" />
              </div>
              <p className="text-sm text-stone-600">Enter a unit number to look up the resident</p>
            </div>
          )}

          {/* Loading */}
          {residentState === "loading" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-stone-800">
                <Loader2 className="h-12 w-12 animate-spin text-stone-500" />
              </div>
              <p className="text-sm text-stone-500">Looking up unit…</p>
            </div>
          )}

          {/* Found — green ring */}
          {residentState === "found" && resident && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-green-900/60 ring-4 ring-green-700/50">
                <span className="text-3xl font-black text-green-300">
                  {getInitials(resident.name)}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">{resident.name}</h3>
              <div className="mt-2 flex items-center justify-center gap-1.5 text-green-400">
                <Building className="h-4 w-4" />
                <span className="font-mono text-lg font-bold">Unit {resident.unit_number}</span>
              </div>
              {resident.phone && (
                <div className="mt-2 flex items-center justify-center gap-1.5 text-stone-400">
                  <Phone className="h-3.5 w-3.5" />
                  <span className="font-mono text-sm">
                    •••-•••-{resident.phone.replace(/\D/g, "").slice(-4)}
                  </span>
                </div>
              )}
              {!resident.phone && (
                <p className="mt-2 text-[10px] uppercase tracking-wider text-stone-600">
                  No phone on file — SMS won&apos;t send
                </p>
              )}
            </div>
          )}

          {/* Ghost — Quick-Add Form */}
          {residentState === "ghost" && (
            <div className="w-full max-w-[240px] text-center">
              <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-red-900/80 ring-4 ring-red-600/60">
                <AlertTriangle className="h-10 w-10 text-red-400" />
              </div>
              <h3 className="text-lg font-black uppercase tracking-wider text-red-400">
                Ghost Resident
              </h3>
              <p className="mt-1 text-xs text-red-400/70">
                Unit <span className="font-mono font-bold">{unitInput}</span> not found.
              </p>

              {/* Quick-Add Form */}
              <div className="mt-4 space-y-2 text-left">
                <div className="flex items-center gap-2 rounded bg-red-900/30 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  <UserPlus className="h-3.5 w-3.5" />
                  Quick-Add for Notification
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-stone-500">Name *</label>
                  <input
                    type="text"
                    placeholder="John Smith"
                    value={ghostName}
                    onChange={(e) => setGhostName(e.target.value.slice(0, 80))}
                    className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-600 outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-stone-500">
                    <Phone className="mr-0.5 inline h-3 w-3" />
                    Phone (for SMS)
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="(267) 555-1234"
                    value={ghostPhone}
                    onChange={(e) => setGhostPhone(e.target.value.slice(0, 20))}
                    className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm font-mono text-white placeholder-stone-600 outline-none focus:border-amber-500"
                  />
                </div>
                {ghostName.trim() && (
                  <p className="rounded bg-amber-900/30 px-2 py-1 text-[10px] text-amber-400">
                    ✓ Will check in as &ldquo;{ghostName.trim()}&rdquo;
                    {ghostPhone.replace(/\D/g, "").length >= 10 && " + SMS notification"}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Carrier badge footer */}
        {tracking.trim() && (
          <div className="border-t border-stone-800 px-4 py-3 text-center">
            <span className={cn("text-xs font-bold uppercase tracking-wider", CARRIER_COLORS[carrier])}>
              <Truck className="mr-1 inline h-3 w-3" />
              {CARRIER_LABELS[carrier]}
            </span>
            <p className="mt-0.5 truncate font-mono text-[11px] text-stone-500">
              {tracking.length > 24 ? `${tracking.slice(0, 10)}…${tracking.slice(-10)}` : tracking}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
