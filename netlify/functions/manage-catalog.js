// manage-catalog.js — Server-side proxy for CatalogManager CRUD.
// Handles GET (list), POST (create), PATCH (update), DELETE on merch_products.
// Requires manager-level auth.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_CATEGORIES = ['menu', 'merch'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  // GET = staff-level (dashboard visibility); writes = manager-only
  const isRead = event.httpMethod === 'GET';
  const auth = await authorize(event, { requireManager: !isRead });
  if (!auth.ok) return auth.response;

  try {
    // ─── LIST ────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('merch_products')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return json(200, { products: data || [] });
    }

    // Parse body for write operations
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    // ─── CREATE ──────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const { name, description, price_cents, image_url, is_active, category } = body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return json(422, { error: 'Name is required' });
      }
      if (typeof price_cents !== 'number' || price_cents <= 0) {
        return json(422, { error: 'price_cents must be a positive integer' });
      }
      if (category && !VALID_CATEGORIES.includes(category)) {
        return json(422, { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      }

      // Validate image_url if provided — must be our Supabase storage
      if (image_url) {
        const validateResult = validateImageUrl(image_url);
        if (!validateResult.ok) return json(422, { error: validateResult.error });
      }

      const { data, error } = await supabase
        .from('merch_products')
        .insert({
          name: name.trim(),
          description: description?.trim() || null,
          price_cents,
          image_url: image_url || null,
          is_active: is_active !== false,
          category: category || 'menu',
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return json(201, { product: data });
    }

    // ─── UPDATE ──────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const { id, ...updates } = body;
      if (!id || typeof id !== 'string') {
        return json(422, { error: 'Missing product id' });
      }

      // Validate fields if present
      if ('price_cents' in updates && (typeof updates.price_cents !== 'number' || updates.price_cents <= 0)) {
        return json(422, { error: 'price_cents must be a positive integer' });
      }
      if ('category' in updates && !VALID_CATEGORIES.includes(updates.category)) {
        return json(422, { error: `Invalid category` });
      }
      if ('name' in updates && (!updates.name || !updates.name.trim())) {
        return json(422, { error: 'Name cannot be empty' });
      }
      if ('image_url' in updates && updates.image_url) {
        const validateResult = validateImageUrl(updates.image_url);
        if (!validateResult.ok) return json(422, { error: validateResult.error });
      }

      // Whitelist allowed columns
      const allowed = ['name', 'description', 'price_cents', 'image_url', 'is_active', 'category', 'archived_at'];
      const row = { updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (key in updates) row[key] = updates[key];
      }
      if ('name' in row) row.name = row.name.trim();
      if ('description' in row) row.description = row.description?.trim() || null;

      const { data, error } = await supabase
        .from('merch_products')
        .update(row)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return json(200, { product: data });
    }

    // ─── DELETE → Soft-delete (archive) ────────────────────
    if (event.httpMethod === 'DELETE') {
      const { id } = body;
      if (!id || typeof id !== 'string') {
        return json(422, { error: 'Missing product id' });
      }

      const { error } = await supabase
        .from('merch_products')
        .update({ archived_at: new Date().toISOString(), is_active: false })
        .eq('id', id);

      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
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
