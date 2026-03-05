// ═══════════════════════════════════════════════════════════════════════════
// currency-utils.ts — Safe integer-cents → display-string conversion
//
// All monetary values in the system are stored and transmitted as integers
// representing US cents.  This utility converts cents to a human-readable
// dollar string using Intl.NumberFormat to avoid floating-point display bugs.
//
// Usage:
//   import { formatCentsToDollars } from '@/utils/currency-utils';
//   formatCentsToDollars(1_234_56)  // → "$1,234.56"
//   formatCentsToDollars(-500)      // → "-$5.00"
//   formatCentsToDollars(0)         // → "$0.00"
// ═══════════════════════════════════════════════════════════════════════════

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Convert an integer cent amount to a formatted US-dollar string.
 *
 * The division is the **only** place in the UI layer where cents are divided
 * by 100.  All upstream values must remain as integer cents.
 *
 * @param cents  Integer amount in US cents (e.g. 50000 = $500.00)
 * @returns      Locale-formatted string, e.g. "$500.00"
 */
export function formatCentsToDollars(cents: number): string {
  return formatter.format(cents / 100);
}
