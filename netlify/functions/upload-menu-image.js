// upload-menu-image.js — Server-side proxy for menu image uploads.
// The browser Supabase client runs as anon (PIN auth ≠ Supabase Auth),
// so storage RLS blocks uploads. This function accepts a JSON body with
// the file as base64 and uploads via service_role.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { formBucket } = require('./_token-bucket');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;


const BUCKET = 'menu-images';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILENAME_LEN = 200;
const MAX_BASE64_LEN = Math.ceil(MAX_SIZE * 4 / 3) + 128; // allow small margin for metadata
const ALLOWED_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function detectImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))) return 'image/png';
  // JPEG: FF D8
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  // GIF: ASCII 'GIF87a' or 'GIF89a'
  const gifHdr = buffer.toString('ascii', 0, 6);
  if (gifHdr === 'GIF87a' || gifHdr === 'GIF89a') return 'image/gif';
  // WebP: 'RIFF'....'WEBP' (bytes 0-3 == 'RIFF' and 8-11 == 'WEBP')
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

exports.handler = async (event) => {
  if (MISSING_ENV) return json(500, { error: 'Server misconfiguration' });

  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Per-IP rate limit (form submissions / uploads)
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = formBucket.consume('upload:' + clientIp);
  if (!ipLimit.allowed) return json(429, { error: 'Too many requests. Please slow down.' });

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

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

    const { fileBase64, contentType, fileName: rawFileName } = body;

    if (!fileBase64 || typeof fileBase64 !== 'string') {
      return json(422, { error: 'fileBase64 is required' });
    }
    // Pre-check base64 length to avoid large allocations
    if (fileBase64.length > MAX_BASE64_LEN) {
      return json(422, { error: 'Encoded image exceeds maximum allowed size' });
    }
    if (!contentType || !ALLOWED_TYPES[contentType]) {
      return json(422, { error: 'Only PNG, JPEG, WebP, or GIF images are allowed' });
    }
    if (!rawFileName || typeof rawFileName !== 'string') {
      return json(422, { error: 'fileName is required' });
    }

    // Enforce filename length cap and sanitize
    const fileName = rawFileName.slice(0, MAX_FILENAME_LEN);

    let buffer;
    try {
      buffer = Buffer.from(fileBase64, 'base64');
    } catch (e) {
      return json(422, { error: 'Invalid base64 image data' });
    }

    if (!buffer || buffer.length < 8) {
      return json(422, { error: 'Uploaded data is too small to be a valid image' });
    }

    if (buffer.length > MAX_SIZE) {
      return json(422, { error: 'Image must be smaller than 5 MB' });
    }

    // Verify image magic bytes match an allowed image type (defense-in-depth)
    const detected = detectImageMime(buffer);
    if (!detected || !ALLOWED_TYPES[detected]) {
      return json(422, { error: 'Uploaded file is not a valid PNG, JPEG, WebP, or GIF image' });
    }

    // Ensure provided contentType matches detected mime (best-effort)
    if (contentType && contentType !== detected) {
      return json(422, { error: 'Content-Type does not match uploaded image data' });
    }

    // Sanitize file name and fallback if empty
    const ext = ALLOWED_TYPES[detected || contentType];
    let safeName = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .toLowerCase();
    if (!safeName || safeName.length === 0) {
      safeName = 'upload_' + Math.random().toString(36).slice(2, 8);
    }
    const path = `catalog/${Date.now()}_${safeName}${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: detected || contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

    // Compatibility across @supabase/supabase-js versions
    const publicUrl = urlData && (urlData.publicUrl || urlData.publicURL || urlData.public_url);
    if (!publicUrl || typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) {
      console.error('[UPLOAD-MENU-IMAGE] Missing public URL after upload');
      return json(500, { error: 'Upload succeeded but public URL unavailable' });
    }

    return json(200, { url: publicUrl });
  } catch (err) {
    return sanitizedError(err, 'upload-menu-image');
  }
};
