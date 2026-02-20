// upload-menu-image.js — Server-side proxy for menu image uploads.
// The browser Supabase client runs as anon (PIN auth ≠ Supabase Auth),
// so storage RLS blocks uploads. This function accepts a JSON body with
// the file as base64 and uploads via service_role.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'menu-images';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Manager-only: only managers can upload menu images
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const { fileBase64, contentType, fileName } = body;

    if (!fileBase64 || typeof fileBase64 !== 'string') {
      return json(422, { error: 'fileBase64 is required' });
    }
    if (!contentType || !ALLOWED_TYPES[contentType]) {
      return json(422, { error: 'Only PNG, JPEG, WebP, or GIF images are allowed' });
    }
    if (!fileName || typeof fileName !== 'string') {
      return json(422, { error: 'fileName is required' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    if (buffer.length > MAX_SIZE) {
      return json(422, { error: 'Image must be smaller than 5 MB' });
    }

    // Sanitize file name
    const ext = ALLOWED_TYPES[contentType];
    const safeName = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .toLowerCase();
    const path = `catalog/${Date.now()}_${safeName}${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return json(200, { url: urlData.publicUrl });
  } catch (err) {
    return sanitizedError(err, 'upload-menu-image');
  }
};
