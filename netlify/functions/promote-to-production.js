// ═══════════════════════════════════════════════════════════════════════════
// promote-to-production.js — Promote simulation items to production
//
// Allows managers to batch-promote inventory, orders, equipment, or
// maintenance_logs from data_integrity_level = 'simulation' to 'production'
// once real assets are verified on-site.
//
// POST body:
//   { "table": "inventory", "ids": ["uuid-1", "uuid-2", ...] }
//
// Requires: Manager PIN auth + CSRF header + rate limiting.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader }              = require('./_csrf');
const { sanitizeInput }                  = require('./_sanitize');
const { staffBucket }                    = require('./_token-bucket');
const { logSystemError }                 = require('./_system-errors');

const ALLOWED_TABLES = new Set(['inventory', 'orders', 'equipment', 'maintenance_logs']);
const MAX_BATCH_SIZE = 500;

// UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  // ── Method gate ────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── CSRF ───────────────────────────────────────────────────
  const csrfErr = requireCsrfHeader(event);
  if (csrfErr) return csrfErr;

  // ── Auth: Manager PIN required ─────────────────────────────
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // ── Rate limit ─────────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rl = staffBucket.consume(`promote:${clientIp}`);
  if (!rl.allowed) {
    return json(429, { error: 'Too many requests', retryAfterMs: rl.retryAfterMs });
  }

  try {
    // ── Parse & validate body ──────────────────────────────────
    const body = JSON.parse(event.body || '{}');
    const tableName = sanitizeInput(String(body.table || '')).trim().toLowerCase();
    const ids = body.ids;

    if (!ALLOWED_TABLES.has(tableName)) {
      return json(400, {
        error: `Invalid table. Allowed: ${[...ALLOWED_TABLES].join(', ')}`,
      });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return json(400, { error: 'ids must be a non-empty array of UUIDs' });
    }

    if (ids.length > MAX_BATCH_SIZE) {
      return json(400, { error: `Batch size limited to ${MAX_BATCH_SIZE}` });
    }

    // Validate each ID is a proper UUID
    for (const id of ids) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return json(400, { error: `Invalid UUID: ${sanitizeInput(String(id)).slice(0, 50)}` });
      }
    }

    // ── Call RPC ──────────────────────────────────────────────
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data, error } = await supabase.rpc('promote_to_production', {
      p_table_name: tableName,
      p_ids: ids,
    });

    if (error) throw error;

    return json(200, {
      success: true,
      result: data,
    });
  } catch (err) {
    await logSystemError({
      error_type: 'promote_to_production_failed',
      severity: 'warning',
      source_function: 'promote-to-production',
      message: err.message || 'Unknown error',
    }).catch(() => {});

    return sanitizedError(err, 'promote-to-production');
  }
};
