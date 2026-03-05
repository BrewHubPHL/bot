/**
 * crypto-utils.ts — Canonical normalization and hashing utilities for
 * agreement text.  Ensures that minor whitespace / line-ending differences
 * between browsers, copy-paste artefacts, or OS-level encoding quirks
 * never produce a different SHA-256 hash for semantically identical text.
 *
 * Used by:
 *   - AgreementViewer.tsx  (frontend — normalize before sending)
 *   - record-agreement-signature.js  (backend — normalize before hashing)
 *   - get-signed-certificate.js  (backend — re-derive hash for display)
 */

/**
 * Return a deterministic, canonical form of agreement text.
 *
 * Normalization steps (order matters):
 *  1. Convert all line endings (CRLF / CR) → LF (\n).
 *  2. Replace runs of multiple spaces with a single space.
 *  3. Trim leading / trailing whitespace from the entire document.
 *
 * The result is always valid UTF-8 because JS strings are already
 * UCS-2/UTF-16 internally and all consumers encode to UTF-8 when
 * passing to `crypto.createHash` or `TextEncoder`.
 */
export function getCanonicalAgreementText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')   // CRLF → LF
    .replace(/\r/g, '\n')     // lone CR → LF
    .replace(/ {2,}/g, ' ')   // collapse multiple spaces → single space
    .trim();                   // strip leading/trailing whitespace
}
