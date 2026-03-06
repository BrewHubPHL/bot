"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { toUserSafeMessage, toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import {
  Camera, CameraOff, Package, Heart, ScanLine, Plus, Minus,
  Save, X, Loader2, CheckCircle2, AlertTriangle, RotateCcw,
  Keyboard, History, Search
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
type ViewState = "idle" | "scanning" | "result" | "saving" | "success" | "error" | "name-results";
type InputMode = "barcode" | "name";

/* ─── Haptic helper (iPhone Taptic Engine) ─────────────────────── */
function haptic(pattern: "tap" | "success" | "error" | "warning") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const patterns: Record<string, number | number[]> = {
    tap: 15,
    success: [15, 80, 15],
    error: [50, 30, 50, 30, 50],
    warning: [30, 60, 30],
  };
  try { navigator.vibrate(patterns[pattern]); } catch { /* silent */ }
}

/* ─── BarcodeDetector type shim ────────────────────────────────── */
interface BarcodeDetectorResult {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
}
interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]>;
}
interface BarcodeDetectorCtorLike {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats: () => Promise<string[]>;
}
function getBarcodeDetectorCtor(): BarcodeDetectorCtorLike | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).BarcodeDetector as BarcodeDetectorCtorLike | undefined;
}

/* ─── Barcode validation ───────────────────────────────────────── */
const BARCODE_FORMATS: Record<string, RegExp> = {
  UPC_A:    /^[0-9]{12}$/,
  EAN_13:   /^[0-9]{13}$/,
  EAN_8:    /^[0-9]{8}$/,
  CODE_128: /^[A-Z0-9]{6,20}$/,
  INTERNAL: /^BRW-[A-Z0-9]{4}(-[A-Z0-9]{4}){0,2}$/,
};

function validateBarcode(input: string): { valid: boolean; sanitized: string | null; error: string | null } {
  if (!input || typeof input !== "string") return { valid: false, sanitized: null, error: "Input must be a string" };
  if (input.length > 50) return { valid: false, sanitized: null, error: "Input too long" };
  if (!/^[\x20-\x7E]+$/.test(input)) return { valid: false, sanitized: null, error: "Invalid characters" };
  const normalized = input.trim().toUpperCase();
  if (normalized.length < 6) return { valid: false, sanitized: null, error: "Too short — barcodes are at least 6 characters" };
  for (const regex of Object.values(BARCODE_FORMATS)) {
    if (regex.test(normalized)) return { valid: true, sanitized: normalized, error: null };
  }
  return { valid: false, sanitized: null, error: "Unknown barcode format — try searching by name instead" };
}

function isLoyaltyCode(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function ScannerPage() {
  const { token: opsToken } = useOpsSession();

  /* ─── State ──────────────────────────────────────────────────── */
  const [scanMode, setScanMode] = useState<ScanMode>("inventory");
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorStatus, setDetectorStatus] = useState<"init" | "active" | "unsupported">("init");

  // Inventory
  const [currentItem, setCurrentItem] = useState<InventoryItem | null>(null);
  const [pendingStock, setPendingStock] = useState(0);
  const [nameResults, setNameResults] = useState<InventoryItem[]>([]);

  // Loyalty
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyResult | null>(null);

  // UI
  const [manualInput, setManualInput] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("barcode");
  const [inputError, setInputError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("Tap camera to scan or type below");
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [clock, setClock] = useState(new Date());

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanLockRef = useRef(false);
  const saveLockRef = useRef(false);
  const lastScannedCode = useRef<string>("");
  const lastScannedTime = useRef<number>(0);
  const animFrameRef = useRef<number>(0);
  const handleScanRef = useRef<(raw: string) => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);

  /* ─── Clock ──────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  /* ─── Camera lifecycle ───────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setDetectorStatus("init");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
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

      // Initialize BarcodeDetector after camera is live
      const Ctor = getBarcodeDetectorCtor();
      if (Ctor) {
        try {
          const supported = await Ctor.getSupportedFormats();
          if (supported.length > 0) {
            detectorRef.current = new Ctor({
              formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
            });
            setDetectorStatus("active");
            startDetectionLoop();
          } else {
            setDetectorStatus("unsupported");
          }
        } catch {
          setDetectorStatus("unsupported");
        }
      } else {
        setDetectorStatus("unsupported");
      }
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Camera access denied. Check Settings > Safari > Camera.");
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
    detectorRef.current = null;
    setCameraActive(false);
    setDetectorStatus("init");
    setStatusMsg("Camera stopped");
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  /* ─── BarcodeDetector loop — waits for video readyState ──────── */
  const startDetectionLoop = useCallback(() => {
    let consecutiveErrors = 0;

    const detect = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;

      if (!video || !detector || !streamRef.current) return;

      // Wait for video to have enough data before detecting
      if (video.readyState < video.HAVE_ENOUGH_DATA) {
        animFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      try {
        const barcodes = await detector.detect(video);
        consecutiveErrors = 0; // Reset on success

        if (barcodes.length > 0 && !scanLockRef.current) {
          const value = barcodes[0].rawValue.trim();
          if (value) {
            handleScanRef.current(value);
          }
        }
      } catch (err) {
        consecutiveErrors++;
        // If detection consistently fails, switch to canvas-based approach
        if (consecutiveErrors > 10 && canvasRef.current && video.videoWidth > 0) {
          try {
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0);
              const barcodes = await detector.detect(canvas);
              if (barcodes.length > 0 && !scanLockRef.current) {
                const value = barcodes[0].rawValue.trim();
                if (value) handleScanRef.current(value);
              }
              consecutiveErrors = 0;
            }
          } catch {
            // Canvas fallback also failed — continue loop
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(detect);
    };

    animFrameRef.current = requestAnimationFrame(detect);
  }, []);

  /* ─── Handle scan result ─────────────────────────────────────── */
  const handleScan = async (rawValue: string) => {
    if (scanLockRef.current) return;

    const value = rawValue.trim().slice(0, 254);
    const now = Date.now();

    if (value === lastScannedCode.current && now - lastScannedTime.current < 3000) {
      return;
    }

    scanLockRef.current = true;
    lastScannedCode.current = value;
    lastScannedTime.current = now;
    haptic("tap");

    if (isLoyaltyCode(value)) {
      await lookupLoyalty(value);
    } else if (scanMode === "loyalty") {
      setStatusMsg("That looks like a product barcode, not a loyalty QR");
      setInputError("Not an email — switch to Inventory mode for barcodes");
      haptic("warning");
      setTimeout(() => { scanLockRef.current = false; }, 1500);
      return;
    } else {
      await lookupBarcode(value);
    }
  };

  useEffect(() => { handleScanRef.current = handleScan; });

  /* ─── Inventory: barcode lookup ──────────────────────────────── */
  const lookupBarcode = async (barcode: string) => {
    const v = validateBarcode(barcode);
    if (!v.valid) {
      setInputError(v.error);
      setStatusMsg(`Could not look up: ${barcode.slice(0, 20)}`);
      haptic("warning");
      setTimeout(() => { scanLockRef.current = false; }, 1000);
      return;
    }

    setInputError(null);
    setViewState("scanning");
    setStatusMsg(`Looking up: ${v.sanitized}`);

    try {
      const resp = await fetchOps(`/inventory-lookup?barcode=${encodeURIComponent(v.sanitized!)}`, {}, opsToken);
      const result = await resp.json();

      if (!resp.ok || !result.found) {
        setStatusMsg(`Barcode "${v.sanitized}" not found — try name search`);
        setInputError("Not found. Try searching by name instead.");
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
      const msg = toUserSafeMessageFromUnknown(err, "Unable to look up this barcode right now.");
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    }

    setTimeout(() => { scanLockRef.current = false; }, 1500);
  };

  /* ─── Inventory: name search ─────────────────────────────────── */
  const lookupByName = async (name: string) => {
    const safeName = name.replace(/[^\x20-\x7E]/g, "").trim().slice(0, 100);
    if (safeName.length < 2) {
      setInputError("Type at least 2 characters to search");
      return;
    }

    setInputError(null);
    setViewState("scanning");
    setStatusMsg(`Searching: "${safeName}"`);

    try {
      const resp = await fetchOps(`/inventory-lookup?name=${encodeURIComponent(safeName)}`, {}, opsToken);
      const result = await resp.json();

      if (!resp.ok) {
        throw new Error(result.error || "Search failed");
      }

      if (!result.found || !result.items?.length) {
        setStatusMsg(`No items matching "${safeName}"`);
        setInputError("No results found. Try a different name.");
        setViewState("idle");
        haptic("warning");
        return;
      }

      // Single result → go directly to stock adjustment
      if (result.items.length === 1) {
        setCurrentItem(result.items[0]);
        setPendingStock(result.items[0].current_stock || 0);
        setViewState("result");
        setStatusMsg("Adjust stock and save");
        haptic("success");
        return;
      }

      // Multiple results → show picker
      setNameResults(result.items);
      setViewState("name-results");
      setStatusMsg(`${result.items.length} items found`);
      haptic("success");
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to search right now.");
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    }
  };

  const selectNameResult = (item: InventoryItem) => {
    setCurrentItem(item);
    setPendingStock(item.current_stock || 0);
    setNameResults([]);
    setViewState("result");
    setStatusMsg("Adjust stock and save");
    haptic("tap");
  };

  /* ─── Loyalty lookup ─────────────────────────────────────────── */
  const lookupLoyalty = async (email: string) => {
    const safeEmail = email.toLowerCase().trim().slice(0, 254);
    setViewState("scanning");
    setStatusMsg("Looking up loyalty...");

    try {
      const resp = await fetchOps("/get-staff-loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: safeEmail }),
      }, opsToken);

      const result = await resp.json();

      if (!resp.ok || !result.found) {
        setStatusMsg(toUserSafeMessage(result.error, "No loyalty account found."));
        setViewState("idle");
        haptic("warning");
        setTimeout(() => { scanLockRef.current = false; }, 2000);
        return;
      }

      setLoyaltyResult({
        email: result.email,
        name: result.name,
        loyalty_points: result.loyalty_points || 0,
        drinks_toward_free: result.drinks_toward_free ?? Math.floor(((result.loyalty_points || 0) % 500) / 50),
      });
      setViewState("result");
      setStatusMsg("Loyalty card found");
      haptic("success");
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to look up loyalty right now.");
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
    if (saveLockRef.current) return;
    saveLockRef.current = true;

    setViewState("saving");

    try {
      const resp = await fetchOps("/process-inventory-adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: currentItem.id,
          itemName: currentItem.item_name,
          barcode: currentItem.barcode,
          delta,
        }),
      }, opsToken);

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }

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
      setStatusMsg(`${currentItem.item_name} updated`);

      setTimeout(() => clearResult(), 2000);
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to save inventory changes right now.");
      setStatusMsg(msg);
      setViewState("error");
      haptic("error");
    } finally {
      saveLockRef.current = false;
    }
  };

  /* ─── Clear / reset ──────────────────────────────────────────── */
  const clearResult = () => {
    setCurrentItem(null);
    setLoyaltyResult(null);
    setNameResults([]);
    setPendingStock(0);
    setViewState("idle");
    setInputError(null);
    setStatusMsg("Ready — scan or search");
    scanLockRef.current = false;
  };

  /* ─── Manual entry submit ────────────────────────────────────── */
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualInput.trim().slice(0, 254);
    if (!cleaned) return;

    setInputError(null);

    if (scanMode === "inventory" && inputMode === "name") {
      lookupByName(cleaned);
    } else {
      handleScan(cleaned);
    }
    setManualInput("");
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <main className="h-[100dvh] w-screen flex flex-col bg-stone-950 text-white select-none overflow-hidden" aria-label="Scanner">
      {/* ═══════ Top Bar ═══════ */}
      <header className="bg-stone-900 border-b border-stone-800 flex items-center justify-between px-4 py-3 shrink-0 safe-area-top">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="BrewHub" className="w-7 h-7 rounded-full" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <span className="font-bold text-sm tracking-tight">Scanner</span>
        </div>

        {/* Mode Toggle */}
        <div className="flex bg-stone-800 rounded-lg p-0.5">
          <button
            onClick={() => { setScanMode("inventory"); clearResult(); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${scanMode === "inventory" ? "bg-amber-500/20 text-amber-400" : "text-stone-500"}`}
          >
            <Package size={13} /> Inventory
          </button>
          <button
            onClick={() => { setScanMode("loyalty"); clearResult(); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${scanMode === "loyalty" ? "bg-emerald-500/20 text-emerald-400" : "text-stone-500"}`}
          >
            <Heart size={13} /> Loyalty
          </button>
        </div>

        <div className="text-xs font-mono text-stone-500">
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {/* ═══════ Camera Viewfinder (compact on mobile) ═══════ */}
      <div className="relative bg-black flex items-center justify-center shrink-0" style={{ height: "35dvh" }}>
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover ${cameraActive ? "opacity-100" : "opacity-0"}`}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan reticle */}
        {cameraActive && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-36 border-2 border-amber-400/60 rounded-2xl relative">
              <div className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-[3px] border-l-[3px] border-amber-400 rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-[3px] border-r-[3px] border-amber-400 rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-[3px] border-l-[3px] border-amber-400 rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-[3px] border-r-[3px] border-amber-400 rounded-br-lg" />
              <div className="absolute left-2 right-2 h-0.5 bg-amber-400/80 animate-scan-line" />
            </div>
          </div>
        )}

        {/* Camera off */}
        {!cameraActive && (
          <button
            onClick={startCamera}
            className="flex flex-col items-center gap-3 text-stone-600 active:scale-95 transition-transform"
          >
            <Camera size={40} />
            <p className="text-sm font-medium">Tap to start camera</p>
            {cameraError && (
              <p className="text-xs text-red-400 max-w-xs text-center px-4">{cameraError}</p>
            )}
          </button>
        )}

        {/* Status pill */}
        <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
          <div className={`px-3 py-1.5 rounded-full text-[11px] font-semibold backdrop-blur-md
            ${viewState === "scanning" ? "bg-blue-500/20 text-blue-300" :
              viewState === "error" ? "bg-red-500/20 text-red-300" :
              viewState === "success" ? "bg-emerald-500/20 text-emerald-300" :
              "bg-stone-900/60 text-stone-400"}`}
          >
            {viewState === "scanning" && <Loader2 size={11} className="inline animate-spin mr-1" />}
            {statusMsg}
          </div>
        </div>

        {/* Detector status badge */}
        {cameraActive && detectorStatus === "unsupported" && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
            <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300 text-[10px] font-medium backdrop-blur-md">
              Auto-detect unavailable — use manual entry below
            </span>
          </div>
        )}

        {/* Camera stop button (only when active) */}
        {cameraActive && (
          <button
            onClick={stopCamera}
            className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-red-500/80 flex items-center justify-center active:scale-90 transition-transform"
          >
            <CameraOff size={16} className="text-white" />
          </button>
        )}
      </div>

      {/* ═══════ Bottom Panel — scrollable ═══════ */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-stone-900 border-t border-stone-800 safe-area-bottom">

        {/* ── Inventory Result Card ── */}
        {(viewState === "result" || viewState === "saving") && scanMode === "inventory" && currentItem && (
          <div className="p-4 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-amber-400 truncate">{currentItem.item_name}</h3>
                <p className="text-[11px] font-mono text-stone-500 mt-0.5">{currentItem.barcode || "No barcode"}</p>
              </div>
              <button onClick={clearResult} className="p-2 hover:bg-stone-800 rounded-lg shrink-0 ml-2">
                <X size={18} className="text-stone-500" />
              </button>
            </div>

            <div className="flex items-center justify-center gap-5 my-3">
              <button
                onClick={() => adjustPending(-1)}
                className="w-14 h-14 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center text-red-400 active:scale-90 transition-transform"
              >
                <Minus size={24} />
              </button>
              <div className="text-center min-w-[5rem]">
                <span className={`text-4xl font-bold font-mono ${pendingStock <= (currentItem.min_threshold || 10) ? "text-red-400" : "text-emerald-400"}`}>
                  {pendingStock}
                </span>
                <p className="text-[10px] text-stone-600 uppercase tracking-widest mt-0.5">
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

            <div className="flex gap-3">
              <button
                onClick={saveStock}
                disabled={viewState === "saving"}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-widest rounded-xl transition-all active:scale-[0.97] flex items-center justify-center gap-2"
              >
                {viewState === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
              <button
                onClick={clearResult}
                className="px-5 py-3 bg-stone-800 hover:bg-stone-700 text-stone-400 font-semibold text-sm rounded-xl"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ── Name search results picker ── */}
        {viewState === "name-results" && nameResults.length > 0 && (
          <div className="p-4 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-stone-300">{nameResults.length} items found</h3>
              <button onClick={clearResult} className="p-1.5 hover:bg-stone-800 rounded-lg">
                <X size={16} className="text-stone-500" />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {nameResults.map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectNameResult(item)}
                  className="w-full flex items-center justify-between bg-stone-800/60 hover:bg-stone-800 rounded-xl px-4 py-3 transition-colors text-left active:scale-[0.98]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{item.item_name}</p>
                    <p className="text-[10px] text-stone-500 font-mono mt-0.5">{item.barcode || "No barcode"}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className={`text-lg font-bold font-mono ${(item.current_stock || 0) <= (item.min_threshold || 10) ? "text-red-400" : "text-emerald-400"}`}>
                      {item.current_stock || 0}
                    </span>
                    <p className="text-[9px] text-stone-600">{item.unit || "units"}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Loyalty Result Card ── */}
        {viewState === "result" && loyaltyResult && (
          <div className="p-4 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-emerald-400">{loyaltyResult.name || "Customer"}</h3>
                <p className="text-xs text-stone-500 mt-0.5">{loyaltyResult.email}</p>
              </div>
              <button onClick={clearResult} className="p-2 hover:bg-stone-800 rounded-lg">
                <X size={18} className="text-stone-500" />
              </button>
            </div>

            <div className="bg-stone-800/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-white">{loyaltyResult.loyalty_points}</p>
                <p className="text-[10px] text-stone-500 uppercase tracking-widest">Total Points</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-amber-400">{loyaltyResult.drinks_toward_free}/10</p>
                <p className="text-[10px] text-stone-500 uppercase tracking-widest">Toward Free Drink</p>
              </div>
            </div>

            {loyaltyResult.drinks_toward_free >= 10 && (
              <div className="mt-3 bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 text-center">
                <p className="text-amber-400 font-bold text-sm">FREE DRINK EARNED!</p>
              </div>
            )}

            <button
              onClick={clearResult}
              className="w-full mt-3 py-3 bg-stone-800 hover:bg-stone-700 text-stone-400 font-semibold text-sm rounded-xl"
            >
              Scan Next
            </button>
          </div>
        )}

        {/* ── Success flash ── */}
        {viewState === "success" && (
          <div className="p-4 flex items-center justify-center gap-3 animate-in fade-in duration-200">
            <CheckCircle2 size={22} className="text-emerald-400" />
            <span className="font-bold text-emerald-300">{statusMsg}</span>
          </div>
        )}

        {/* ── Error state ── */}
        {viewState === "error" && (
          <div className="p-4 space-y-3">
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

            {/* Input mode toggle (inventory only) */}
            {scanMode === "inventory" && (
              <div className="flex bg-stone-800 rounded-lg p-0.5">
                <button
                  onClick={() => { setInputMode("barcode"); setInputError(null); setManualInput(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all
                    ${inputMode === "barcode" ? "bg-stone-700 text-white" : "text-stone-500"}`}
                >
                  <Keyboard size={13} /> Barcode #
                </button>
                <button
                  onClick={() => { setInputMode("name"); setInputError(null); setManualInput(""); inputRef.current?.focus(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all
                    ${inputMode === "name" ? "bg-stone-700 text-white" : "text-stone-500"}`}
                >
                  <Search size={13} /> Search Name
                </button>
              </div>
            )}

            {/* Manual input */}
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <div className="relative flex-1">
                {inputMode === "name" && scanMode === "inventory" ? (
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
                ) : (
                  <Keyboard size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
                )}
                <input
                  ref={inputRef}
                  type={inputMode === "barcode" && scanMode === "inventory" ? "text" : "text"}
                  inputMode={inputMode === "barcode" && scanMode !== "loyalty" ? "numeric" : "text"}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={manualInput}
                  onChange={(e) => { setManualInput(e.target.value); setInputError(null); }}
                  placeholder={
                    scanMode === "loyalty"
                      ? "Type email address..."
                      : inputMode === "name"
                        ? "Search by product name..."
                        : "Type barcode number..."
                  }
                  className={`w-full pl-9 pr-4 py-3.5 bg-stone-800 border rounded-xl text-sm text-white placeholder:text-stone-600 focus:outline-none transition-colors
                    ${inputError ? "border-red-500/50 focus:border-red-500" : "border-stone-700 focus:border-amber-500/50"}`}
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim() || viewState === "scanning"}
                className="px-5 py-3.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-800 disabled:opacity-40 text-white font-semibold text-sm rounded-xl transition-all active:scale-95"
              >
                {viewState === "scanning" ? <Loader2 size={16} className="animate-spin" /> : inputMode === "name" ? <Search size={16} /> : <ScanLine size={16} />}
              </button>
            </form>

            {/* Inline error message */}
            {inputError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{inputError}</p>
              </div>
            )}

            {/* Scan history */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <History size={12} className="text-stone-600" />
                  <span className="text-[10px] text-stone-600 uppercase tracking-widest">Recent</span>
                </div>
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between bg-stone-800/50 rounded-lg px-3 py-2">
                      <span className="text-xs font-medium text-stone-300 truncate mr-2">{h.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-bold ${h.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {h.change >= 0 ? "+" : ""}{h.change} &rarr; {h.newStock}
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

      {/* ═══════ CSS ═══════ */}
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
    </main>
  );
}
