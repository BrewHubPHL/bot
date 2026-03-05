'use strict';

/**
 * _crypto-utils.js — CJS mirror of src/lib/crypto-utils.ts
 *
 * Canonical normalization for agreement text before SHA-256 hashing.
 * Keep in sync with the TypeScript source.
 */

/**
 * Return a deterministic, canonical form of agreement text.
 *
 * Normalization steps (order matters):
 *  1. Convert all line endings (CRLF / CR) → LF (\n).
 *  2. Replace runs of multiple spaces with a single space.
 *  3. Trim leading / trailing whitespace from the entire document.
 *
 * @param {string} text — raw agreement text
 * @returns {string} — normalized text
 */
function getCanonicalAgreementText(text) {
  return text
    .replace(/\r\n/g, '\n')   // CRLF → LF
    .replace(/\r/g, '\n')     // lone CR → LF
    .replace(/ {2,}/g, ' ')   // collapse multiple spaces → single space
    .trim();                   // strip leading/trailing whitespace
}

module.exports = { getCanonicalAgreementText };
