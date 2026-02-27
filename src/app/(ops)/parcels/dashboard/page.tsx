"use client";

/**
 * Parcel Command Center — iPad Air M3 Dashboard
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  STATUS BAR — sync status, session count, clock              │
 * ├──────────────────┬───────────────────────────────────────────┤
 * │                  │                                           │
 * │  LIVE INTAKE     │  SESSION HISTORY                          │
 * │  ┌────────────┐  │  ┌─────────────────────────────────────┐  │
 * │  │ Carrier    │  │  │  ▐▌ 9421234… │ FedEx │ 403 │ 2:14p │  │
 * │  │ Logo       │  │  │  ▐▌ 1Z999… │ UPS   │ 201 │ 2:12p │  │
 * │  │            │  │  │  ▐▌ …       │ …     │ …   │ …     │  │
 * │  ├────────────┤  │  └─────────────────────────────────────┘  │
 * │  │ Unit: 403_ │  │                                           │
 * │  │ Resident:  │  │                                           │
 * │  │ ████████   │  │                                           │
 * │  └────────────┘  │                                           │
 * └──────────────────┴───────────────────────────────────────────┘
 *
 * FEATURES:
 *   • Real-time "shadow" effect as iPhone types unit digits
 *   • Carrier logo with mechanical "clack" sound on tracking scan
 *   • Ghost Resident pulsing red alert for unknown units
 *   • Split-Flap animation when parcels move to history
 *   • CRT Scanline GPU overlay for retro ops aesthetic
 *   • Sends 'DENIED' broadcast back to iPhone on ghost units
 *
 * SECURITY: Uses PIN-gated OpsGate session token for all API calls.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useOpsSession } from "@/components/OpsGate";
import { useParcelSync } from "@/hooks/useParcelSync";
import { cn } from "@/lib/utils";
import {
  Package, Truck, Wifi, WifiOff, Clock, AlertTriangle,
  CheckCircle2, Building, User, Archive,
} from "lucide-react";
import type { Carrier } from "@/lib/detectCarrier";

/* ─── Types ────────────────────────────────────────────────────── */
interface ResidentInfo {
  id: number;
  name: string;
  unit_number: string | null;
  phone: string | null;
}

interface HistoryEntry {
  id: string;
  tracking: string;
  carrier: string;
  unit: string;
  residentName: string | null;
  timestamp: number;
  animating: boolean; // Split-flap entrance animation
  highlighted: boolean; // Duplicate-scan amber highlight
}

type IntakeState = "idle" | "tracking" | "unit-entry" | "ghost" | "ready" | "processing";

/* ─── Carrier display config ───────────────────────────────────── */
const CARRIER_LOGO: Record<string, { label: string; bg: string; text: string; border: string }> = {
  FEDEX:  { label: "FedEx",  bg: "bg-purple-900/60", text: "text-purple-300", border: "border-purple-600" },
  UPS:    { label: "UPS",    bg: "bg-amber-900/60",  text: "text-amber-300",  border: "border-amber-600" },
  USPS:   { label: "USPS",   bg: "bg-blue-900/60",   text: "text-blue-300",   border: "border-blue-600" },
  DHL:    { label: "DHL",    bg: "bg-yellow-900/60", text: "text-yellow-300", border: "border-yellow-600" },
  OTHER:  { label: "Other",  bg: "bg-stone-800/60",  text: "text-stone-400",  border: "border-stone-600" },
};

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Audio helper — mechanical clack ──────────────────────────── */
function playClack() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    // Mechanical click: short burst of noise-like high-frequency
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.03);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.05);

    // Cleanup
    setTimeout(() => ctx.close(), 200);
  } catch {
    /* Audio not available */
  }
}

/* ─── Split-Flap character animator ────────────────────────────── */
function SplitFlapChar({ char, delay = 0 }: { char: string; delay?: number }) {
  const [displayed, setDisplayed] = useState(" ");
  const [flipping, setFlipping] = useState(true);

  useEffect(() => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let step = 0;
    const maxSteps = 6 + Math.floor(Math.random() * 4);

    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        step++;
        if (step >= maxSteps) {
          setDisplayed(char);
          setFlipping(false);
          clearInterval(interval);
          return;
        }
        setDisplayed(chars[Math.floor(Math.random() * chars.length)]);
      }, 40);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, [char, delay]);

  return (
    <span className={cn(
      "inline-block w-[1ch] text-center font-mono transition-transform duration-75",
      flipping && "scale-y-90",
    )}>
      {displayed}
    </span>
  );
}

/* ─── Split-Flap row for history entries ───────────────────────── */
function SplitFlapRow({ entry }: { entry: HistoryEntry }) {
  const carrierInfo = CARRIER_LOGO[entry.carrier] || CARRIER_LOGO.OTHER;
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!entry.animating) {
    // Static row — no animation
    return (
      <div className={cn(
        "flex items-center gap-3 border-b border-stone-800/50 px-4 py-2.5 font-mono text-sm transition-colors duration-500",
        entry.highlighted && "bg-amber-900/30 ring-1 ring-inset ring-amber-500/60",
      )}>
        <span className={cn("w-14 shrink-0 text-center rounded px-1.5 py-0.5 text-xs font-bold uppercase", carrierInfo.bg, carrierInfo.text)}>
          {carrierInfo.label}
        </span>
        <span className="w-44 truncate text-stone-300">
          {entry.tracking.length > 20 ? `…${entry.tracking.slice(-16)}` : entry.tracking}
        </span>
        <span className="w-14 text-center text-amber-400 font-bold">{entry.unit}</span>
        <span className="flex-1 truncate text-stone-500">{entry.residentName || "—"}</span>
        <span className="w-16 text-right text-xs text-stone-600">{time}</span>
      </div>
    );
  }

  // Animated entrance — split-flap effect
  const trackingDisplay = entry.tracking.length > 20
    ? `…${entry.tracking.slice(-16)}`
    : entry.tracking;

  return (
    <div className="flex items-center gap-3 border-b border-stone-800/50 bg-amber-950/20 px-4 py-2.5 font-mono text-sm animate-in slide-in-from-top duration-300">
      <span className={cn("w-14 shrink-0 text-center rounded px-1.5 py-0.5 text-xs font-bold uppercase", carrierInfo.bg, carrierInfo.text)}>
        {carrierInfo.label}
      </span>
      <span className="w-44 text-stone-300">
        {trackingDisplay.split("").map((c, i) => (
          <SplitFlapChar key={`${entry.id}-${i}`} char={c} delay={i * 25} />
        ))}
      </span>
      <span className="w-14 text-center text-amber-400 font-bold">
        {entry.unit.split("").map((c, i) => (
          <SplitFlapChar key={`${entry.id}-u-${i}`} char={c} delay={200 + i * 40} />
        ))}
      </span>
      <span className="flex-1 truncate text-stone-500">
        {(entry.residentName || "—").split("").map((c, i) => (
          <SplitFlapChar key={`${entry.id}-n-${i}`} char={c} delay={300 + i * 30} />
        ))}
      </span>
      <span className="w-16 text-right text-xs text-stone-600">{time}</span>
    </div>
  );
}

/* ─── Initials from name ───────────────────────────────────────── */
function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function ParcelDashboardPage() {
  const { token, staff } = useOpsSession();

  /* ─── State ──────────────────────────────────────────────────── */
  const [intakeState, setIntakeState] = useState<IntakeState>("idle");
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("OTHER");
  const [unitInput, setUnitInput] = useState("");
  const [resident, setResident] = useState<ResidentInfo | null>(null);
  const [isGhost, setIsGhost] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [duplicateTracking, setDuplicateTracking] = useState<string | null>(null);

  /** Sequence guard — discard out-of-order broadcast messages */
  const lastProcessedSeqRef = useRef(0);

  /* ─── Resident directory cache ───────────────────────────────── */
  const directoryRef = useRef<ResidentInfo[] | null>(null);
  const directoryLoadingRef = useRef(false);

  const loadDirectory = useCallback(async (): Promise<ResidentInfo[]> => {
    if (directoryRef.current) return directoryRef.current;
    if (directoryLoadingRef.current) {
      // Wait for in-flight load
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (directoryRef.current) { clearInterval(check); resolve(); }
        }, 100);
      });
      return directoryRef.current!;
    }

    directoryLoadingRef.current = true;
    const prefixes = "abcdefghijklmnopqrstuvwxyz".split("");
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
          const data = await res.json();
          return (data.results || []) as ResidentInfo[];
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const res of r.value) allResults.set(res.id, res);
        }
      }
    }

    const dir = Array.from(allResults.values());
    directoryRef.current = dir;
    directoryLoadingRef.current = false;
    return dir;
  }, [token]);

  // Preload directory on mount
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  /* ─── Resident lookup by unit ────────────────────────────────── */
  const lookupUnit = useCallback(async (unit: string): Promise<ResidentInfo | null> => {
    if (!unit.trim()) return null;
    const dir = await loadDirectory();
    const normalised = unit.trim().toLowerCase();
    return dir.find((r) => r.unit_number?.trim().toLowerCase() === normalised) || null;
  }, [loadDirectory]);

  /* ─── Realtime sync from iPhone ──────────────────────────────── */
  const { connected, sendResult } = useParcelSync({
    onTracking: (newTracking: string, newCarrier: string, seq: number) => {
      // Discard out-of-order broadcasts
      if (seq < lastProcessedSeqRef.current) return;
      lastProcessedSeqRef.current = seq;

      setTracking(newTracking);
      setCarrier(newCarrier);
      setIntakeState("tracking");
      setUnitInput("");
      setResident(null);
      setIsGhost(false);
      playClack();
    },

    onUnit: (unit: string, seq: number) => {
      // Discard out-of-order broadcasts
      if (seq < lastProcessedSeqRef.current) return;
      lastProcessedSeqRef.current = seq;

      setUnitInput(unit);
      if (!unit.trim()) {
        setResident(null);
        setIsGhost(false);
        if (tracking) setIntakeState("tracking");
        else setIntakeState("idle");
        return;
      }
      setIntakeState("unit-entry");

      // Debounced resident lookup (only on 2+ chars)
      // Capture seq at dispatch time so we can discard stale results
      const seqAtDispatch = seq;
      if (unit.trim().length >= 2) {
        lookupUnit(unit).then((found) => {
          // If a newer broadcast arrived while we were fetching, discard
          if (seqAtDispatch < lastProcessedSeqRef.current) return;

          if (found) {
            setResident(found);
            setIsGhost(false);
            setIntakeState("ready");
          } else {
            setResident(null);
            setIsGhost(true);
            setIntakeState("ghost");
          }
        });
      }
    },

    onSubmit: async (data) => {
      setIntakeState("processing");

      // Ghost check — if unit doesn't exist, DENY and broadcast back
      const found = await lookupUnit(data.unit);
      if (!found) {
        setIsGhost(true);
        setIntakeState("ghost");
        // Send DENIED back to iPhone
        sendResult({
          success: false,
          error: `Unit ${data.unit} not found. Ghost Resident — check-in blocked.`,
        });
        return;
      }

      // Confirmed — add to history with animation
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        tracking: data.tracking,
        carrier: data.carrier,
        unit: data.unit,
        residentName: found.name,
        timestamp: Date.now(),
        animating: true,
        highlighted: false,
      };

      setHistory((prev) => [entry, ...prev].slice(0, 100));
      setSessionCount((c) => c + 1);

      // Send success confirmation back to iPhone
      sendResult({ success: true, parcelId: entry.id });

      // Clear animation flag after it completes
      setTimeout(() => {
        setHistory((prev) =>
          prev.map((h) => (h.id === entry.id ? { ...h, animating: false } : h)),
        );
      }, 1200);

      // Reset intake for next scan
      setTimeout(() => {
        setTracking("");
        setCarrier("OTHER");
        setUnitInput("");
        setResident(null);
        setIsGhost(false);
        setIntakeState("idle");
      }, 1500);
    },

    onDuplicate: (data) => {
      // Highlight the matching entry in history so staff can see the original
      setDuplicateTracking(data.tracking);
      setHistory((prev) =>
        prev.map((h) =>
          h.tracking === data.tracking ? { ...h, highlighted: true } : h,
        ),
      );

      // Show duplicate state in the intake panel
      setTracking(data.tracking);
      setCarrier(data.carrier);
      setUnitInput(data.unit);
      setIntakeState("idle");

      // Auto-clear highlight after 5 seconds
      setTimeout(() => {
        setDuplicateTracking(null);
        setHistory((prev) =>
          prev.map((h) => ({ ...h, highlighted: false })),
        );
      }, 5000);
    },
  });

  /* ─── Clock ──────────────────────────────────────────────────── */
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  /* ─── Carrier display info ───────────────────────────────────── */
  const carrierInfo = useMemo(() => CARRIER_LOGO[carrier] || CARRIER_LOGO.OTHER, [carrier]);

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  /*  RENDER                                                        */
  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <div className="fixed inset-0 flex flex-col bg-stone-950 text-white select-none overflow-hidden">

      {/* CRT Scanline Overlay — GPU-accelerated via will-change + pointer-events-none */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.03]"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)",
          willChange: "transform",
        }}
      />

      {/* ═══ STATUS BAR ════════════════════════════════════════════ */}
      <div className="flex items-center justify-between border-b border-stone-800 bg-stone-900/80 px-5 py-2 z-10">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-amber-400" />
          <h1 className="text-base font-bold tracking-tight">Command Center</h1>
          <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-mono text-stone-400">
            {staff.name.split(" ")[0]}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Session counter */}
          <div className="flex items-center gap-1.5 text-xs text-stone-400">
            <Archive className="h-3.5 w-3.5" />
            <span className="font-mono font-bold text-amber-400">{sessionCount}</span>
            <span>parcels</span>
          </div>

          {/* Sync status */}
          <div className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest",
            connected
              ? "bg-green-900/40 text-green-400"
              : "bg-red-900/40 text-red-400",
          )}>
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "LINKED" : "DISCONNECTED"}
          </div>

          {/* Clock */}
          <div className="flex items-center gap-1 text-xs font-mono text-stone-500">
            <Clock className="h-3 w-3" />
            {clock}
          </div>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ══════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 z-10">

        {/* ─── LEFT PANEL: LIVE INTAKE ─────────────────────────── */}
        <div className={cn(
          "flex w-[380px] shrink-0 flex-col border-r transition-colors duration-500",
          isGhost
            ? "border-red-700 bg-red-950/20"
            : intakeState === "ready"
              ? "border-green-700 bg-green-950/10"
              : "border-stone-800 bg-stone-900/30",
        )}>
          {/* Panel header */}
          <div className={cn(
            "flex items-center gap-2 border-b px-4 py-3 transition-colors duration-500",
            isGhost ? "border-red-800" : "border-stone-800",
          )}>
            <Truck className={cn(
              "h-4 w-4 transition-colors",
              isGhost ? "text-red-400" : "text-amber-400",
            )} />
            <span className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Live Intake
            </span>
            {intakeState !== "idle" && (
              <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-green-500" />
            )}
          </div>

          {/* Carrier Logo Card */}
          <div className={cn(
            "mx-4 mt-4 flex flex-col items-center justify-center rounded-2xl border-2 p-8 transition-all duration-500",
            tracking
              ? cn(carrierInfo.border, carrierInfo.bg)
              : "border-stone-800 bg-stone-900/50",
          )}>
            {tracking ? (
              <>
                <Truck className={cn("h-16 w-16 mb-3", carrierInfo.text)} />
                <span className={cn("text-3xl font-black uppercase tracking-wider", carrierInfo.text)}>
                  {carrierInfo.label}
                </span>
                <p className="mt-2 max-w-full truncate font-mono text-xs text-stone-500">
                  {tracking.length > 28 ? `${tracking.slice(0, 12)}…${tracking.slice(-12)}` : tracking}
                </p>
              </>
            ) : (
              <>
                <Package className="h-16 w-16 mb-3 text-stone-700" />
                <span className="text-lg font-bold text-stone-700">Waiting for scan…</span>
                <p className="mt-1 text-xs text-stone-600">Point iPhone at barcode</p>
              </>
            )}
          </div>

          {/* Unit Display — shadow effect */}
          <div className="mx-4 mt-4">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-stone-600">
              Unit Number
            </label>
            <div className={cn(
              "flex items-center rounded-xl border-2 px-4 py-3 font-mono transition-all duration-300",
              isGhost
                ? "border-red-600 bg-red-950/40 text-red-400"
                : resident
                  ? "border-green-700 bg-green-950/30 text-green-300"
                  : unitInput
                    ? "border-amber-600 bg-stone-900 text-amber-300"
                    : "border-stone-700 bg-stone-900 text-stone-500",
            )}>
              <Building className="mr-2 h-5 w-5 shrink-0 text-stone-600" />
              <span className="text-4xl font-bold tracking-[0.3em]">
                {unitInput || <span className="text-xl text-stone-700 tracking-normal">—</span>}
              </span>
              {/* Blinking cursor when actively typing */}
              {unitInput && intakeState === "unit-entry" && (
                <span className="ml-1 inline-block h-8 w-0.5 animate-pulse bg-amber-400" />
              )}
            </div>
          </div>

          {/* Resident Card */}
          <div className="mx-4 mt-4 flex-1">
            {/* Found resident */}
            {resident && !isGhost && (
              <div className="flex items-center gap-3 rounded-xl border border-green-800 bg-green-950/20 px-4 py-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-900/60 ring-2 ring-green-700/50">
                  <span className="text-lg font-black text-green-300">
                    {getInitials(resident.name)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-white">{resident.name}</h3>
                  <div className="flex items-center gap-1 text-xs text-green-400">
                    <Building className="h-3 w-3" />
                    <span className="font-mono font-bold">Unit {resident.unit_number}</span>
                  </div>
                </div>
                <CheckCircle2 className="h-6 w-6 shrink-0 text-green-500" />
              </div>
            )}

            {/* Ghost Resident Alert */}
            {isGhost && (
              <div className="animate-pulse rounded-xl border-2 border-red-600 bg-red-950/40 px-4 py-4 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
                <h3 className="mt-2 text-lg font-black uppercase tracking-wider text-red-400">
                  Ghost Resident
                </h3>
                <p className="mt-1 text-sm font-bold text-red-500">BLOCKED</p>
                <p className="mt-2 text-xs text-red-400/70">
                  Unit <span className="font-mono font-bold">{unitInput}</span> not in directory.
                </p>
              </div>
            )}

            {/* Idle state */}
            {!resident && !isGhost && !unitInput && intakeState === "idle" && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <User className="h-10 w-10 text-stone-800" />
                <p className="mt-2 text-xs text-stone-700">Resident info appears here</p>
              </div>
            )}
          </div>

          {/* Processing indicator */}
          {intakeState === "processing" && (
            <div className="mx-4 mb-4 flex items-center justify-center gap-2 rounded-lg bg-amber-900/20 px-4 py-2 text-sm text-amber-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              Processing check-in…
            </div>
          )}
        </div>

        {/* ─── RIGHT PANEL: SESSION HISTORY ────────────────────── */}
        <div className="flex flex-1 flex-col min-h-0 bg-stone-950">
          {/* History header */}
          <div className="flex items-center gap-2 border-b border-stone-800 bg-stone-900/50 px-5 py-3">
            <Archive className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Session History
            </span>
            <span className="ml-auto rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-mono text-stone-500">
              {history.length}
            </span>
          </div>

          {/* Duplicate scan banner */}
          {duplicateTracking && (
            <div className="mx-5 mt-2 flex items-center gap-2 rounded-lg border border-amber-600 bg-amber-900/30 px-4 py-2 text-sm font-medium text-amber-300 animate-pulse">
              <Package className="h-4 w-4 shrink-0" />
              📦 ALREADY ARRIVED — duplicate scan highlighted below
            </div>
          )}

          {/* Column headers */}
          <div className="flex items-center gap-3 border-b border-stone-800/50 bg-stone-900/30 px-4 py-1.5 text-[10px] font-medium uppercase tracking-widest text-stone-600">
            <span className="w-14 text-center">Carrier</span>
            <span className="w-44">Tracking</span>
            <span className="w-14 text-center">Unit</span>
            <span className="flex-1">Resident</span>
            <span className="w-16 text-right">Time</span>
          </div>

          {/* History list — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-stone-700">
                <Package className="h-12 w-12 mb-3" />
                <p className="text-sm font-medium">No parcels this session</p>
                <p className="text-xs mt-1">Scanned parcels will appear here with split-flap animation</p>
              </div>
            ) : (
              history.map((entry) => (
                <SplitFlapRow key={entry.id} entry={entry} />
              ))
            )}
          </div>

          {/* Footer stats */}
          <div className="flex items-center justify-between border-t border-stone-800 bg-stone-900/30 px-5 py-2 text-[10px] text-stone-600">
            <span>
              Session started {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <span className="font-mono">
              {history.filter((h) => h.carrier === "FEDEX").length} FedEx ·{" "}
              {history.filter((h) => h.carrier === "UPS").length} UPS ·{" "}
              {history.filter((h) => h.carrier === "USPS").length} USPS ·{" "}
              {history.filter((h) => h.carrier === "DHL").length} DHL ·{" "}
              {history.filter((h) => h.carrier === "OTHER").length} Other
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
