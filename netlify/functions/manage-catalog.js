// manage-catalog.js — Server-side proxy for CatalogManager CRUD.
// Handles GET (list), POST (create), PATCH (update), DELETE on merch_products.
// Requires manager-level auth.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_CATEGORIES = ['menu', 'merch'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fire-and-forget: bust the Next.js ISR cache for /shop so customers
 * see catalog changes immediately instead of waiting up to 60 seconds.
 */
async function revalidateShopCache() {
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://brewhubphl.com';
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret) { console.warn('[manage-catalog] Skipping revalidation — INTERNAL_SYNC_SECRET not set'); return; }
  try {
    await fetch(`${siteUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-brewhub-secret': secret },
      body: JSON.stringify({ paths: ['/shop'] }),
    });
  } catch (err) {
    console.warn('[manage-catalog] Shop revalidation failed (non-blocking):', err.message);
  }
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = { 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
  const corsJson = (code, data) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...corsHeaders }, body: JSON.stringify(data) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  // GET = staff-level (dashboard visibility); writes = manager-only
  const isRead = event.httpMethod === 'GET';
  const auth = await authorize(event, { requirePin: true, requireManager: !isRead });
  if (!auth.ok) return auth.response;

  try {
    // ─── LIST ────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('merch_products')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return corsJson(200, { products: data || [] });
    }

    // CSRF protection for write operations
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // Parse body for write operations
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return corsJson(400, { error: 'Invalid JSON body' });
    }

    // ─── CREATE ──────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const { name, description, price_cents, image_url, is_active, category, stock_quantity } = body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return corsJson(422, { error: 'Name is required' });
      }
      if (typeof price_cents !== 'number' || !Number.isInteger(price_cents) || price_cents <= 0) {
        return corsJson(422, { error: 'price_cents must be a positive integer' });
      }
      if (category && !VALID_CATEGORIES.includes(category)) {
        return corsJson(422, { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      }

      // stock_quantity: null = unlimited, integer >= 0 = tracked
      if (stock_quantity !== undefined && stock_quantity !== null) {
        if (typeof stock_quantity !== 'number' || !Number.isInteger(stock_quantity) || stock_quantity < 0) {
          return corsJson(422, { error: 'stock_quantity must be a non-negative integer or null (unlimited)' });
        }
      }

      // Validate image_url if provided — must be our Supabase storage
      if (image_url) {
        if (typeof image_url !== 'string' || image_url.length > 2048) {
          return corsJson(422, { error: 'Image URL too long (max 2048)' });
        }
        const validateResult = validateImageUrl(image_url);
        if (!validateResult.ok) return corsJson(422, { error: validateResult.error });
      }

      const safeName = sanitizeInput(name.trim()).slice(0, 200);
      const safeDesc = description ? sanitizeInput(String(description).trim()).slice(0, 2000) : null;

      const { data, error } = await supabase
        .from('merch_products')
        .insert({
          name: safeName,
          description: safeDesc,
          price_cents,
          image_url: image_url || null,
          is_active: is_active !== false,
          category: category || 'menu',
          stock_quantity: stock_quantity !== undefined ? stock_quantity : null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      revalidateShopCache().catch(() => {}); // bust ISR cache — non-blocking
      return corsJson(201, { product: data });
    }

    // ─── UPDATE ──────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const { id, ...updates } = body;
      if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
        return corsJson(422, { error: 'Missing or invalid product id (UUID)' });
      }

      // Validate fields if present
      if ('price_cents' in updates && (typeof updates.price_cents !== 'number' || !Number.isInteger(updates.price_cents) || updates.price_cents <= 0)) {
        return corsJson(422, { error: 'price_cents must be a positive integer' });
      }
      if ('category' in updates && !VALID_CATEGORIES.includes(updates.category)) {
        return corsJson(422, { error: `Invalid category` });
      }
      if ('name' in updates && (!updates.name || !updates.name.trim())) {
        return corsJson(422, { error: 'Name cannot be empty' });
      }
      if ('stock_quantity' in updates && updates.stock_quantity !== null) {
        if (typeof updates.stock_quantity !== 'number' || !Number.isInteger(updates.stock_quantity) || updates.stock_quantity < 0) {
          return corsJson(422, { error: 'stock_quantity must be a non-negative integer or null (unlimited)' });
        }
      }
      if ('image_url' in updates && updates.image_url) {
        if (typeof updates.image_url !== 'string' || updates.image_url.length > 2048) {
          return corsJson(422, { error: 'Image URL too long (max 2048)' });
        }
        const validateResult = validateImageUrl(updates.image_url);
        if (!validateResult.ok) return corsJson(422, { error: validateResult.error });
      }

      // Whitelist allowed columns
      const allowed = ['name', 'description', 'price_cents', 'image_url', 'is_active', 'category', 'archived_at', 'stock_quantity'];
      const row = { updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (key in updates) row[key] = updates[key];
      }
      if ('name' in row) row.name = sanitizeInput(row.name.trim()).slice(0, 200);
      if ('description' in row) row.description = row.description ? sanitizeInput(String(row.description).trim()).slice(0, 2000) : null;

      const { data, error } = await supabase
        .from('merch_products')
        .update(row)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      revalidateShopCache().catch(() => {}); // bust ISR cache — non-blocking
      return corsJson(200, { product: data });
    }

    // ─── DELETE → Soft-delete (archive) ────────────────────
    if (event.httpMethod === 'DELETE') {
      const { id } = body;
      if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
        return corsJson(422, { error: 'Missing or invalid product id (UUID)' });
      }

      const { error } = await supabase
        .from('merch_products')
        .update({ archived_at: new Date().toISOString(), is_active: false })
        .eq('id', id);

      if (error) throw error;
      revalidateShopCache().catch(() => {}); // bust ISR cache — non-blocking
      return corsJson(200, { ok: true });
    }

    return corsJson(405, { error: 'Method not allowed' });
  } catch (err) {
    return sanitizedError(err, 'manage-catalog');
  }
};

/**
 * Validate image_url: must point to our Supabase storage bucket.
 */
function validateImageUrl(url) {
  if (typeof url !== 'string') return { ok: false, error: 'Invalid image URL' };

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const allowedPrefix = `${supabaseUrl}/storage/v1/object/public/menu-images/`;

  if (!url.startsWith('https://')) {
    return { ok: false, error: 'Image URL must use HTTPS' };
  }
  if (!url.startsWith(allowedPrefix)) {
    return { ok: false, error: 'Image URL must be from the BrewHub menu-images bucket' };
  }
  if (url.includes('..') || url.includes('%2e%2e') || url.includes('%2E%2E')) {
    return { ok: false, error: 'Invalid image URL path' };
  }

  return { ok: true };
}
