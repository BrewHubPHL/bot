"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useOpsSession } from "@/components/OpsGate";
import {
  Camera, CameraOff, Package, Heart, ScanLine, Plus, Minus,
  Save, X, Loader2, CheckCircle2, AlertTriangle, RotateCcw,
  Keyboard, History, Vibrate
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────── */

interface InventoryItem {
  id: string;
  item_name: string;
  current_stock: number;
  min_threshold: number;
  unit: string;
  barcode: string | null;
}

interface LoyaltyResult {
  email: string;
  name: string | null;
  loyalty_points: number;
  drinks_toward_free: number;
}

interface ScanHistoryEntry {
  name: string;
  change: number;
  newStock: number;
  time: string;
}

type ScanMode = "inventory" | "loyalty";
type ViewState = "idle" | "scanning" | "result" | "saving" | "success" | "error";

/* ─── Haptic helper (iPhone 17 Pro Taptic Engine) ──────────────── */
function haptic(pattern: "tap" | "success" | "error" | "warning") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const patterns: Record<string, number | number[]> = {
    tap: 15,            // light tap
    success: [15, 80, 15], // double tap
    error: [50, 30, 50, 30, 50], // triple buzz
    warning: [30, 60, 30],
  };
  try { navigator.vibrate(patterns[pattern]); } catch {}
}

/* ─── Barcode validation (mirrors scan.html) ───────────────────── */
const BARCODE_FORMATS: Record<string, RegExp> = {
  UPC_A:    /^[0-9]{12}$/,
  EAN_13:   /^[0-9]{13}$/,
  EAN_8:    /^[0-9]{8}$/,
  CODE_128: /^[A-Z0-9]{6,20}$/,
  INTERNAL: /^BRW-[A-Z0-9]{6}$/,
};

function validateBarcode(input: string): { valid: boolean; sanitized: string | null; error: string | null } {
  if (!input || typeof input !== "string") return { valid: false, sanitized: null, error: "Input must be a string" };
  if (input.length > 50) return { valid: false, sanitized: null, error: "Input too long" };
  if (!/^[\x20-\x7E]+$/.test(input)) return { valid: false, sanitized: null, error: "Invalid characters" };
  const normalized = input.trim().toUpperCase();
  if (normalized.length < 6) return { valid: false, sanitized: null, error: "Too short" };
  for (const regex of Object.values(BARCODE_FORMATS)) {
    if (regex.test(normalized)) return { valid: true, sanitized: normalized, error: null };
  }
  return { valid: false, sanitized: null, error: "Unknown barcode format" };
}

/* ─── Detect if scanned value is a loyalty QR ──────────────────── */
function isLoyaltyCode(value: string): boolean {
  // Loyalty QR = customer email address
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function ScannerPage() {
  /* ─── Auth: use PIN session token for API calls ──────────── */
  const { token: opsToken } = useOpsSession();

  /* ─── State ──────────────────────────────────────────────────── */
  const [scanMode, setScanMode] = useState<ScanMode>("inventory");
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Inventory
  const [currentItem, setCurrentItem] = useState<InventoryItem | null>(null);
  const [pendingStock, setPendingStock] = useState(0);

  // Loyalty
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyResult | null>(null);

  // UI
  const [manualInput, setManualInput] = useState("");
  const [statusMsg, setStatusMsg] = useState("Tap Start Camera to scan");
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [clock, setClock] = useState(new Date());

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLockRef = useRef(false); // prevents double-scans
  const animFrameRef = useRef<number>(0);

  /* ─── Clock ──────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Hardware scanner support removed — iOS camera only (Feb 2026) */

  /* ─── Camera lifecycle ───────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          // iPhone 17 Pro: request high-res for better barcode recognition
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setStatusMsg("Point at barcode or QR code");
      startBarcodeDetection();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      setCameraError(msg);
      haptic("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setCameraActive(false);
    setStatusMsg("Camera stopped");
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  /* ─── BarcodeDetector API (native on Safari/iOS 17+) ─────────── */
  const startBarcodeDetection = useCallback(() => {
    // Use native BarcodeDetector if available (Safari, Chrome)
    if ("BarcodeDetector" in window) {
      const detector = new (window as any).BarcodeDetector({
        formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
      });

      const detect = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0 && !scanLockRef.current) {
            handleScan(barcodes[0].rawValue);
          }
        } catch {}
        animFrameRef.current = requestAnimationFrame(detect);
      };
      animFrameRef.current = requestAnimationFrame(detect);
    } else {
      // Fallback: BarcodeDetector not available in this browser
      setStatusMsg("Camera active — try Safari for best barcode detection");
    }
  }, []);

  /* ─── Handle scan result ─────────────────────────────────────── */
  const handleScan = async (rawValue: string) => {
    if (scanLockRef.current) return; // Prevent double-scan
    scanLockRef.current = true;
    haptic("tap");

    const value = rawValue.trim();

    // Auto-detect: is this a loyalty QR (email) or inventory barcode?
    if (isLoyaltyCode(value)) {
      await lookupLoyalty(value);
    } else if (scanMode === "loyalty") {
      // In loyalty mode but got a barcode — show hint
      setStatusMsg("That's a product barcode, not a loyalty QR");
      haptic("warning");
      setTimeout(() => { scanLockRef.current = false; }, 1500);
      return;
    } else {
      await lookupBarcode(value);
    }
  };

  /* ─── Inventory lookup ───────────────────────────────────────── */
  const lookupBarcode = async (barcode: string) => {
    const v = validateBarcode(barcode);
    if (!v.valid) {
      setStatusMsg(`⚠️ ${v.error}`);
      haptic("warning");
      setTimeout(() => { scanLockRef.current = false; }, 1000);
      return;
    }

    setViewState("scanning");
    setStatusMsg(`Looking up: ${v.sanitized}`);

    try {
      const resp = await fetch(`/.netlify/functions/inventory-lookup?barcode=${encodeURIComponent(v.sanitized!)}`, {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      const result = await resp.json();

      if (!resp.ok || !result.found) {
        setStatusMsg(`Barcode "${v.sanitized}" not found`);
        setViewState("idle");
        haptic("warning");
        setTimeout(() => { scanLockRef.current = false; }, 2000);
        return;
      }

      setCurrentItem(result.item);
      setPendingStock(result.item.current_stock || 0);
      setViewState("result");
      setStatusMsg("Adjust stock and save");
      haptic("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lookup failed";
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    }

    setTimeout(() => { scanLockRef.current = false; }, 1500);
  };

  /* ─── Loyalty lookup ─────────────────────────────────────────── */
  const lookupLoyalty = async (email: string) => {
    setViewState("scanning");
    setStatusMsg(`Looking up loyalty: ${email}`);

    try {
      const { data, error } = await supabase
        .from("customers")
        .select("email, name, loyalty_points")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setStatusMsg(`No loyalty account for ${email}`);
        setViewState("idle");
        haptic("warning");
        setTimeout(() => { scanLockRef.current = false; }, 2000);
        return;
      }

      setLoyaltyResult({
        email: data.email,
        name: data.name,
        loyalty_points: data.loyalty_points || 0,
        drinks_toward_free: Math.floor(((data.loyalty_points || 0) % 500) / 50),
      });
      setViewState("result");
      setStatusMsg("Loyalty card found");
      haptic("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Loyalty lookup failed";
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    }

    setTimeout(() => { scanLockRef.current = false; }, 1500);
  };

  /* ─── Inventory: adjust + save ───────────────────────────────── */
  const adjustPending = (delta: number) => {
    setPendingStock((prev) => Math.max(0, prev + delta));
    haptic("tap");
  };

  const saveStock = async () => {
    if (!currentItem) return;
    const delta = pendingStock - (currentItem.current_stock || 0);
    if (delta === 0) { clearResult(); return; }

    setViewState("saving");

    try {
      const resp = await fetch("/.netlify/functions/adjust-inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opsToken}`,
        },
        body: JSON.stringify({
          itemId: currentItem.id,
          itemName: currentItem.item_name,
          barcode: currentItem.barcode,
          delta,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }

      // Add to history
      setHistory((prev) => [
        {
          name: currentItem.item_name,
          change: delta,
          newStock: pendingStock,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
        ...prev.slice(0, 9),
      ]);

      haptic("success");
      setViewState("success");
      setStatusMsg(`✅ ${currentItem.item_name} updated`);

      setTimeout(() => clearResult(), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    }
  };

  /* ─── Clear / reset ──────────────────────────────────────────── */
  const clearResult = () => {
    setCurrentItem(null);
    setLoyaltyResult(null);
    setPendingStock(0);
    setViewState("idle");
    setStatusMsg("Ready — scan next item");
    scanLockRef.current = false;
  };

  /* ─── Manual entry ───────────────────────────────────────────── */
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      handleScan(manualInput.trim());
      setManualInput("");
    }
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="h-screen w-screen flex flex-col bg-stone-950 text-white select-none overflow-hidden">
      {/* ═══════ Top Bar ═══════ */}
      <header className="h-14 bg-stone-900 border-b border-stone-800 flex items-center justify-between px-5 shrink-0 safe-area-top">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="BrewHub" className="w-8 h-8 rounded-full" />
          <span className="font-bold text-sm tracking-tight">Scanner</span>
        </div>

        {/* Mode Toggle */}
        <div className="flex bg-stone-800 rounded-lg p-0.5">
          <button
            onClick={() => { setScanMode("inventory"); clearResult(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${scanMode === "inventory" ? "bg-amber-500/20 text-amber-400" : "text-stone-500"}`}
          >
            <Package size={14} /> Inventory
          </button>
          <button
            onClick={() => { setScanMode("loyalty"); clearResult(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${scanMode === "loyalty" ? "bg-emerald-500/20 text-emerald-400" : "text-stone-500"}`}
          >
            <Heart size={14} /> Loyalty
          </button>
        </div>

        {/* Clock */}
        <div className="text-xs font-mono text-stone-500">
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {/* ═══════ Camera Viewfinder ═══════ */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        {/* Video element — sized for iPhone 17 Pro aspect ratio */}
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover ${cameraActive ? "opacity-100" : "opacity-0"}`}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan reticle overlay */}
        {cameraActive && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-44 border-2 border-amber-400/60 rounded-2xl relative">
              {/* Corner markers */}
              <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-[3px] border-l-[3px] border-amber-400 rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-[3px] border-r-[3px] border-amber-400 rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-[3px] border-l-[3px] border-amber-400 rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-[3px] border-r-[3px] border-amber-400 rounded-br-lg" />
              {/* Scan line animation */}
              <div className="absolute left-2 right-2 h-0.5 bg-amber-400/80 animate-scan-line" />
            </div>
            <p className="absolute bottom-8 text-xs text-stone-400 tracking-widest uppercase">
              {scanMode === "inventory" ? "Align barcode in frame" : "Scan loyalty QR code"}
            </p>
          </div>
        )}

        {/* Camera off state */}
        {!cameraActive && (
          <div className="flex flex-col items-center gap-4 text-stone-600">
            <CameraOff size={48} />
            <p className="text-sm">Camera off — tap to start</p>
            {cameraError && (
              <p className="text-xs text-red-400 max-w-xs text-center">{cameraError}</p>
            )}
          </div>
        )}

        {/* Status bar */}
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <div className={`px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-md
            ${viewState === "scanning" ? "bg-blue-500/20 text-blue-300" :
              viewState === "error" ? "bg-red-500/20 text-red-300" :
              viewState === "success" ? "bg-emerald-500/20 text-emerald-300" :
              "bg-stone-900/60 text-stone-400"}`}
          >
            {viewState === "scanning" && <Loader2 size={12} className="inline animate-spin mr-1.5" />}
            {statusMsg}
          </div>
        </div>

        {/* Camera toggle button */}
        <button
          onClick={cameraActive ? stopCamera : startCamera}
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-90
            ${cameraActive
              ? "bg-red-500/90 hover:bg-red-400"
              : "bg-amber-500/90 hover:bg-amber-400"}`}
        >
          {cameraActive ? <CameraOff size={24} className="text-white" /> : <Camera size={24} className="text-stone-950" />}
        </button>
      </div>

      {/* ═══════ Bottom Panel — Result / Manual Entry / History ═══════ */}
      <div className="bg-stone-900 border-t border-stone-800 safe-area-bottom">

        {/* ── Inventory Result Card ── */}
        {(viewState === "result" || viewState === "saving") && scanMode === "inventory" && currentItem && (
          <div className="p-5 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-amber-400">{currentItem.item_name}</h3>
                <p className="text-xs font-mono text-stone-500 mt-0.5">{currentItem.barcode || "No barcode"}</p>
              </div>
              <button onClick={clearResult} className="p-2 hover:bg-stone-800 rounded-lg">
                <X size={18} className="text-stone-500" />
              </button>
            </div>

            {/* Stock adjuster */}
            <div className="flex items-center justify-center gap-6 my-4">
              <button
                onClick={() => adjustPending(-1)}
                className="w-14 h-14 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center text-red-400 active:scale-90 transition-transform"
              >
                <Minus size={24} />
              </button>
              <div className="text-center">
                <span className={`text-5xl font-bold font-mono ${pendingStock <= (currentItem.min_threshold || 10) ? "text-red-400" : "text-emerald-400"}`}>
                  {pendingStock}
                </span>
                <p className="text-[10px] text-stone-600 uppercase tracking-widest mt-1">
                  {currentItem.unit || "units"} · min {currentItem.min_threshold || 10}
                </p>
              </div>
              <button
                onClick={() => adjustPending(1)}
                className="w-14 h-14 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 flex items-center justify-center text-emerald-400 active:scale-90 transition-transform"
              >
                <Plus size={24} />
              </button>
            </div>

            {/* Save / Clear */}
            <div className="flex gap-3">
              <button
                onClick={saveStock}
                disabled={viewState === "saving"}
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-widest rounded-xl transition-all active:scale-[0.97] flex items-center justify-center gap-2"
              >
                {viewState === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
              <button
                onClick={clearResult}
                className="px-6 py-3.5 bg-stone-800 hover:bg-stone-700 text-stone-400 font-semibold text-sm rounded-xl transition-all"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ── Loyalty Result Card ── */}
        {viewState === "result" && loyaltyResult && (
          <div className="p-5 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-xl font-bold text-emerald-400">{loyaltyResult.name || "Customer"}</h3>
                <p className="text-xs text-stone-500 mt-0.5">{loyaltyResult.email}</p>
              </div>
              <button onClick={clearResult} className="p-2 hover:bg-stone-800 rounded-lg">
                <X size={18} className="text-stone-500" />
              </button>
            </div>

            <div className="bg-stone-800/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-white">{loyaltyResult.loyalty_points}</p>
                <p className="text-[10px] text-stone-500 uppercase tracking-widest">Total Points</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-amber-400">{loyaltyResult.drinks_toward_free}/10</p>
                <p className="text-[10px] text-stone-500 uppercase tracking-widest">Toward Free Drink</p>
              </div>
            </div>

            {loyaltyResult.drinks_toward_free >= 10 && (
              <div className="mt-3 bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 text-center">
                <p className="text-amber-400 font-bold text-sm">🎉 FREE DRINK EARNED!</p>
              </div>
            )}

            <button
              onClick={clearResult}
              className="w-full mt-4 py-3 bg-stone-800 hover:bg-stone-700 text-stone-400 font-semibold text-sm rounded-xl transition-all"
            >
              Scan Next
            </button>
          </div>
        )}

        {/* ── Success flash ── */}
        {viewState === "success" && (
          <div className="p-5 flex items-center justify-center gap-3 animate-in fade-in duration-200">
            <CheckCircle2 size={24} className="text-emerald-400" />
            <span className="font-bold text-emerald-300">{statusMsg}</span>
          </div>
        )}

        {/* ── Error state ── */}
        {viewState === "error" && (
          <div className="p-5 space-y-3">
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{statusMsg}</p>
            </div>
            <button onClick={clearResult} className="w-full py-3 bg-stone-800 text-stone-400 font-semibold text-sm rounded-xl flex items-center justify-center gap-2">
              <RotateCcw size={14} /> Try Again
            </button>
          </div>
        )}

        {/* ── Idle: Manual entry + History ── */}
        {(viewState === "idle" || viewState === "scanning") && !currentItem && !loyaltyResult && (
          <div className="p-4 space-y-3">
            {/* Manual input */}
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Keyboard size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder={scanMode === "loyalty" ? "Type email address…" : "Type barcode manually…"}
                  className="w-full pl-9 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-xl text-sm text-white placeholder:text-stone-600 focus:border-amber-500/50 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="px-5 py-3 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-300 font-semibold text-sm rounded-xl transition-all"
              >
                <ScanLine size={16} />
              </button>
            </form>

            {/* Scan history */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <History size={12} className="text-stone-600" />
                  <span className="text-[10px] text-stone-600 uppercase tracking-widest">Recent</span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between bg-stone-800/50 rounded-lg px-3 py-2">
                      <span className="text-xs font-medium text-stone-300">{h.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${h.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {h.change >= 0 ? "+" : ""}{h.change} → {h.newStock}
                        </span>
                        <span className="text-[10px] text-stone-600">{h.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════ Scan line animation CSS ═══════ */}
      <style jsx>{`
        @keyframes scan-line {
          0%, 100% { top: 10%; opacity: 0.4; }
          50% { top: 85%; opacity: 1; }
        }
        .animate-scan-line {
          animation: scan-line 2s ease-in-out infinite;
          position: absolute;
        }
        .safe-area-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
      `}</style>
    </div>
  );
}
