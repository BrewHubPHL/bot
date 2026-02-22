/**
 * IP Hashing Helper — Salted SHA-256
 *
 * SECURITY RATIONALE:
 * Raw IPs in the database are a timestamped location map.
 * This module hashes IPs with a per-installation salt before
 * they are passed to any Supabase RPC, ensuring the DB stores
 * only opaque hex strings. The salt lives in the environment
 * (IP_HASH_SALT) and in the Postgres runtime config
 * (brewhub.ip_salt), never in a queryable table.
 *
 * The same salt MUST be used in both SQL (hash_ip function)
 * and JS (this module) so that rate-limiting lookups match.
 *
 * Usage:
 *   const { hashIP } = require('./_ip-hash');
 *   const hashed = hashIP('203.0.113.42');
 */

'use strict';

const crypto = require('crypto');

// Salt loaded once from environment. Falls back to a dev-only default
// that MUST NOT be used in production (deploy will fail lint check).
const IP_SALT = process.env.IP_HASH_SALT || process.env.BREWHUB_IP_SALT || '';

/**
 * Hash an IP address with the installation salt.
 * Returns a 64-char hex SHA-256 digest.
 *
 * @param {string} rawIP — The raw IPv4/IPv6 address
 * @returns {string} 64-char lowercase hex hash
 */
function hashIP(rawIP) {
  if (!rawIP || rawIP === 'unknown') return 'unknown';
  return crypto
    .createHash('sha256')
    .update(rawIP + IP_SALT)
    .digest('hex');
}

/**
 * Redact an IP for logging — shows only the /24 prefix (IPv4)
 * or first 4 hextets (IPv6), replacing the rest with "x".
 *
 * @param {string} rawIP
 * @returns {string}
 */
function redactIP(rawIP) {
  if (!rawIP || rawIP === 'unknown') return 'unknown';
  // IPv4: keep first 3 octets, mask last
  if (rawIP.includes('.')) {
    const parts = rawIP.split('.');
    return parts.length === 4
      ? `${parts[0]}.${parts[1]}.${parts[2]}.x`
      : 'x.x.x.x';
  }
  // IPv6: keep first 4 hextets
  if (rawIP.includes(':')) {
    return rawIP.split(':').slice(0, 4).join(':') + '::x';
  }
  return 'x';
}

module.exports = { hashIP, redactIP, IP_SALT };
