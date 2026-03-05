/**
 * _pricing.js — Tax-inclusive pricing utility
 *
 * BrewHub menu prices are tax-inclusive (8% Philadelphia sales tax).
 * The listed/catalog price IS the final price the customer pays.
 *
 * Usage:
 *   const { calculateTaxInclusive } = require('./_pricing');
 *   const { subtotalCents, taxCents, totalCents } = calculateTaxInclusive(menuPriceCents);
 */

const PHILLY_TAX_RATE = 0.08;

/**
 * Back-calculate subtotal and tax from a tax-inclusive total.
 *
 * Math: subtotal = round(total / 1.08), tax = total - subtotal
 * This guarantees subtotal + tax === total (no rounding drift).
 *
 * @param {number} totalCents - The menu/catalog price (tax-inclusive) in cents.
 * @returns {{ subtotalCents: number, taxCents: number, totalCents: number }}
 */
function calculateTaxInclusive(totalCents) {
  const subtotalCents = Math.round(totalCents / (1 + PHILLY_TAX_RATE));
  const taxCents = totalCents - subtotalCents;
  return { subtotalCents, taxCents, totalCents };
}

module.exports = { calculateTaxInclusive, PHILLY_TAX_RATE };
