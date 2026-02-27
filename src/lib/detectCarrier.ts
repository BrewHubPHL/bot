/**
 * detectCarrier — Client-side carrier auto-detection from tracking numbers.
 *
 * Mirrors the backend `identifyCarrier()` logic in parcel-check-in.js /
 * register-tracking.js but uses the Codex-Max 5.1 expanded pattern set.
 *
 * All matching is case-insensitive. If no pattern matches, returns 'OTHER'
 * so the staff dropdown pre-selects a safe default that allows manual override.
 */

export type Carrier = "FEDEX" | "UPS" | "USPS" | "DHL" | "OTHER";

/** Known carrier patterns — order matters (most specific first). */
const PATTERNS: [RegExp, Carrier][] = [
  // UPS: always starts with '1Z', 18 chars total (1Z + 16 alphanum)
  [/^1Z[A-Z0-9]{16}$/i, "UPS"],

  // USPS: starts with 92, 94, 42, or 95, 20-22 digits total
  [/^(92|94|42|95)\d{18,20}$/, "USPS"],

  // FedEx: 12 or 15 pure digits, OR starts with 'T' (door-tag / TNT legacy)
  [/^\d{12}$/, "FEDEX"],
  [/^\d{15}$/, "FEDEX"],
  [/^T\d{10,}$/i, "FEDEX"],

  // DHL: 10 digits starting with 10, 11, or 00
  [/^(10|11|00)\d{8}$/, "DHL"],
];

/**
 * Detect the shipping carrier from a tracking number string.
 *
 * @param tracking — raw tracking number (scanned or typed)
 * @returns The detected `Carrier`, or `'OTHER'` if unrecognised.
 */
export function detectCarrier(tracking: string): Carrier {
  const cleaned = tracking.trim();
  if (!cleaned) return "OTHER";

  for (const [pattern, carrier] of PATTERNS) {
    if (pattern.test(cleaned)) return carrier;
  }
  return "OTHER";
}
