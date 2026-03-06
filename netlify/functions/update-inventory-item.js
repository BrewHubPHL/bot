// update-inventory-item.js — PATCH fields on a single inventory row.
// Manager-only, CSRF-protected, rate-limited.
// Supports: item_name, category, unit, min_threshold, unit_cost_cents.

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_CATEGORIES = new Set([
  'Coffee Beans', 'Milk & Dairy', 'Syrups & Flavors', 'Cups & Lids',
  'Pastry & Food', 'Cleaning Supplies', 'Equipment Parts', 'Merchandise', 'Other',
  'general',
]);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  // ── CORS ──────────────────────────────────────────────
  const ALLOWED_ORIGINS = [
    process.env.URL, process.env.SITE_URL,
    'https://brewhubphl.com', 'https://www.brewhubphl.com',
  ].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const cors = (code, data) => ({ statusCode: code, headers, body: JSON.stringify(data) });

  if (MISSING_ENV) return cors(500, { error: 'Server misconfiguration' });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method not allowed' });

  // ── Auth (Manager + PIN) ──────────────────────────────
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // ── CSRF ──────────────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Rate limit ────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rl = staffBucket.consume(`update-inv:${clientIp}`);
  if (!rl.allowed) {
    return cors(429, { error: 'Too many requests' });
  }

  // ── Parse body ────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return cors(400, { error: 'Invalid JSON body' });
  }

  const { id, item_name, category, unit, min_threshold, unit_cost_cents } = body;

  if (!id || !UUID_RE.test(String(id))) {
    return cors(400, { error: 'Valid inventory item id (UUID) is required' });
  }

  // ── Build update patch (only provided fields) ─────────
  const patch = {};

  if (item_name !== undefined) {
    const name = sanitizeInput(String(item_name).trim()).slice(0, 100);
    if (name.length < 1) return cors(400, { error: 'Item name must be at least 1 character' });
    patch.item_name = name;
  }

  if (category !== undefined) {
    const cat = sanitizeInput(String(category).trim()).slice(0, 100);
    if (!ALLOWED_CATEGORIES.has(cat)) return cors(400, { error: 'Invalid category' });
    patch.category = cat;
  }

  if (unit !== undefined) {
    const u = sanitizeInput(String(unit).trim()).slice(0, 20);
    if (u.length < 1) return cors(400, { error: 'Unit must be at least 1 character' });
    patch.unit = u;
  }

  if (min_threshold !== undefined) {
    const t = Number(min_threshold);
    if (!Number.isFinite(t) || t < 0 || t > 100000) {
      return cors(400, { error: 'min_threshold must be 0–100000' });
    }
    patch.min_threshold = Math.round(t);
  }

  if (unit_cost_cents !== undefined) {
    if (unit_cost_cents === null) {
      patch.unit_cost_cents = null;
    } else {
      const c = Number(unit_cost_cents);
      if (!Number.isFinite(c) || c < 0 || c > 99999999) {
        return cors(400, { error: 'unit_cost_cents must be 0–99999999 or null' });
      }
      patch.unit_cost_cents = Math.round(c);
    }
  }

  if (Object.keys(patch).length === 0) {
    return cors(400, { error: 'No valid fields to update' });
  }

  patch.updated_at = new Date().toISOString();

  // ── Execute ───────────────────────────────────────────
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('inventory')
      .update(patch)
      .eq('id', String(id))
      .select()
      .single();

    if (error) throw error;

    if (!data) return cors(404, { error: 'Inventory item not found' });

    return cors(200, { item: data });
  } catch (err) {
    const res = sanitizedError(err, 'update-inventory-item');
    return cors(res.statusCode || 500, JSON.parse(res.body));
  }
};
