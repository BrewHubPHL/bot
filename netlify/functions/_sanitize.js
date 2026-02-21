'use strict';

/**
 * Sanitize free-form text input before it reaches the database.
 *
 * 1. Coerces to string and trims whitespace.
 * 2. Strips all HTML / XML tags (including self-closing).
 * 3. Neutralises common script-injection tokens:
 *    - javascript: / data: / vbscript: URI schemes
 *    - on* event handlers (onerror, onload, etc.)
 * 4. Collapses any leftover runs of whitespace into single spaces.
 *
 * Intentionally zero-dependency so it adds no cold-start cost to
 * serverless functions.
 *
 * @param {unknown} str – raw user input
 * @returns {string} sanitised string (may be empty)
 */
function sanitizeInput(str) {
  if (str === null || str === undefined) return '';

  let out = String(str).trim();

  // Strip HTML / XML tags
  out = out.replace(/<[^>]*>/g, '');

  // Remove javascript: / data: / vbscript: URI schemes (case-insensitive)
  out = out.replace(/\b(javascript|data|vbscript)\s*:/gi, '');

  // Remove on-event handlers (onerror=, onclick=, etc.)
  out = out.replace(/\bon\w+\s*=/gi, '');

  // Decode common HTML entities that attackers use to bypass the above
  out = out.replace(/&#(x?[0-9a-f]+);?/gi, '');

  // Collapse multiple spaces into one
  out = out.replace(/\s{2,}/g, ' ').trim();

  return out;
}

module.exports = { sanitizeInput };
