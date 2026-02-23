/**
 * Ambient type declarations for the experimental BarcodeDetector API.
 * https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
 *
 * BarcodeDetector is natively available in Safari 17+ and Chrome 83+
 * but is not yet included in TypeScript's lib.dom.d.ts.
 */

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector: typeof BarcodeDetector;
}
