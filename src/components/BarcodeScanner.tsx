"use client";

/**
 * BarcodeScanner — Camera-based barcode/QR detection using the
 * BarcodeDetector API (Chrome 83+, Safari 17.2+) with getUserMedia.
 *
 * Prefers the ultra-wide (0.5×) lens when available for close-up scans
 * by requesting a wider field-of-view via `facingMode: "environment"`.
 *
 * Falls back to a text-input overlay if the BarcodeDetector API or
 * camera is unavailable (e.g. desktop browsers without hardware).
 */

import { useEffect, useRef, useState, useCallback } from "react";

/* ─── BarcodeDetector type shim (not yet in all TS libs) ─────── */
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

/**
 * Runtime accessor — works whether or not the global BarcodeDetector
 * type already exists in the TS lib (avoids "duplicate declarations").
 */
function getBarcodeDetectorCtor(): BarcodeDetectorCtorLike | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).BarcodeDetector as BarcodeDetectorCtorLike | undefined;
}

/* ─── Props ──────────────────────────────────────────────────── */
export interface BarcodeScannerProps {
  /** Called when a barcode is successfully detected */
  onScan: (value: string) => void;
  /** Whether scanning is active (pause when processing) */
  active?: boolean;
  /** Additional className for the container */
  className?: string;
}

export default function BarcodeScanner({
  onScan,
  active = true,
  className = "",
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const rafRef = useRef<number>(0);
  const lastScanRef = useRef<string>("");
  const lastScanTimeRef = useRef<number>(0);

  const [supported, setSupported] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  /* ─── Initialize camera + BarcodeDetector ────────────────────── */
  const startCamera = useCallback(async () => {
    // Check BarcodeDetector support
    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }

    try {
      const formats = await Ctor.getSupportedFormats();
      if (!formats.length) {
        setSupported(false);
        return;
      }

      detectorRef.current = new Ctor({
        formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix"],
      });
    } catch {
      setSupported(false);
      return;
    }

    // Request camera — prefer ultra-wide environment camera for close scans
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // Prefer wider FoV for ultra-wide lens selection on iPhone 17 Pro
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // @ts-expect-error -- non-standard constraint for ultra-wide lens
          zoom: { ideal: 0.5 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setCameraError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access denied. Enable camera permissions."
          : "Unable to access camera.",
      );
    }
  }, []);

  /* ─── Detection loop ─────────────────────────────────────────── */
  const scanFrame = useCallback(() => {
    if (!active || !detectorRef.current || !videoRef.current || !canvasRef.current) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    detectorRef.current
      .detect(canvas)
      .then((barcodes) => {
        if (barcodes.length > 0) {
          const value = barcodes[0].rawValue.trim();
          const now = Date.now();

          // Debounce: same barcode within 2 seconds is ignored
          if (value && (value !== lastScanRef.current || now - lastScanTimeRef.current > 2000)) {
            lastScanRef.current = value;
            lastScanTimeRef.current = now;
            onScan(value);
          }
        }
      })
      .catch(() => {
        // Detection errors are non-fatal — just skip this frame
      });

    rafRef.current = requestAnimationFrame(scanFrame);
  }, [active, onScan]);

  /* ─── Lifecycle ──────────────────────────────────────────────── */
  useEffect(() => {
    startCamera();

    return () => {
      // Stop camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [startCamera]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [scanFrame]);

  /* ─── Fallback: manual entry ─────────────────────────────────── */
  if (!supported || cameraError) {
    return (
      <div className={`flex items-center justify-center bg-stone-900 ${className}`}>
        <div className="px-4 text-center">
          <p className="mb-2 text-sm text-stone-400">
            {cameraError || "Camera barcode scanning not available."}
          </p>
          <p className="text-xs text-stone-600">
            Use the tracking input below to type or paste the number.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Viewfinder crosshair overlay */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-32 w-64 rounded-lg border-2 border-amber-400/60" />
      </div>

      {/* Corner brackets */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top-left */}
        <div className="absolute left-[calc(50%-8.5rem)] top-[calc(50%-4.5rem)] h-6 w-6 border-l-3 border-t-3 border-amber-400 rounded-tl" />
        {/* Top-right */}
        <div className="absolute right-[calc(50%-8.5rem)] top-[calc(50%-4.5rem)] h-6 w-6 border-r-3 border-t-3 border-amber-400 rounded-tr" />
        {/* Bottom-left */}
        <div className="absolute bottom-[calc(50%-4.5rem)] left-[calc(50%-8.5rem)] h-6 w-6 border-b-3 border-l-3 border-amber-400 rounded-bl" />
        {/* Bottom-right */}
        <div className="absolute bottom-[calc(50%-4.5rem)] right-[calc(50%-8.5rem)] h-6 w-6 border-b-3 border-r-3 border-amber-400 rounded-br" />
      </div>

      {/* Scanning line animation */}
      {active && (
        <div className="pointer-events-none absolute left-[calc(50%-8rem)] right-[calc(50%-8rem)] top-[calc(50%-4rem)] h-0.5 animate-pulse bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      )}
    </div>
  );
}
