const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// SCHEMA-STRICT BARCODE VALIDATION
// ============================================================
// Supported barcode formats (whitelist approach):
//   - UPC-A:    12 digits                    ^[0-9]{12}$
//   - EAN-13:   13 digits                    ^[0-9]{13}$
//   - CODE-128: 6-20 alphanumeric            ^[A-Z0-9]{6,20}$
//   - Internal: BRW-XXXXXX (BrewHub format)  ^BRW-[A-Z0-9]{6}$
//
// Rejects: emojis, SQL chars, non-ASCII, control chars, excessive length

const BARCODE_FORMATS = {
  UPC_A:    /^[0-9]{12}$/,
  EAN_13:   /^[0-9]{13}$/,
  EAN_8:    /^[0-9]{8}$/,
  CODE_128: /^[A-Z0-9]{6,20}$/,
  INTERNAL: /^BRW-[A-Z0-9]{6}$/
};

/**
 * Schema-strict barcode validator.
 * Rejects any input that doesn't match known barcode formats.
 * @param {string} input - Raw barcode string
 * @returns {{ valid: boolean, sanitized: string|null, format: string|null, error: string|null }}
 */
function validateBarcode(input) {
  // 1. Type check
  if (typeof input !== 'string') {
    return { valid: false, sanitized: null, format: null, error: 'Input must be a string' };
  }

  // 2. Length guard (prevent DoS via massive strings)
  if (input.length > 50) {
    return { valid: false, sanitized: null, format: null, error: 'Input exceeds maximum length' };
  }

  // 3. ASCII-only filter (rejects emojis, non-UTF-8, control chars)
  // Only allow printable ASCII (0x20-0x7E) excluding dangerous chars
  const ASCII_SAFE = /^[\x20-\x7E]+$/;
  if (!ASCII_SAFE.test(input)) {
    return { valid: false, sanitized: null, format: null, error: 'Non-ASCII characters detected' };
  }

  // 4. Normalize: trim whitespace and uppercase
  const normalized = input.trim().toUpperCase();

  // 5. Minimum length check
  if (normalized.length < 6) {
    return { valid: false, sanitized: null, format: null, error: 'Barcode too short' };
  }

  // 6. Match against known formats (whitelist)
  for (const [format, regex] of Object.entries(BARCODE_FORMATS)) {
    if (regex.test(normalized)) {
      return { valid: true, sanitized: normalized, format, error: null };
    }
  }

  // 7. No format matched
  return { valid: false, sanitized: null, format: null, error: 'Unknown barcode format' };
}

exports.handler = async (event) => {
  // Staff-only endpoint
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
      body: ''
    };
  }

  const barcode = event.queryStringParameters?.barcode;

  if (!barcode) {
    return json(400, { error: 'Barcode required' });
  }

  // SCHEMA-STRICT VALIDATION
  const validation = validateBarcode(barcode);
  
  if (!validation.valid) {
    // Log sanitized preview only (never log raw malicious input)
    const safePreview = barcode.replace(/[^\x20-\x7E]/g, '?').substring(0, 15);
    console.warn(`[SECURITY] Barcode rejected: "${safePreview}..." - ${validation.error}`);
    return json(400, { error: validation.error });
  }

  const sanitized = validation.sanitized;

  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('barcode', sanitized)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[INVENTORY-LOOKUP] Error:', error);
      return json(500, { error: 'Lookup failed' });
    }

    if (!data) {
      return json(404, { found: false, barcode: sanitized, format: validation.format });
    }

    return json(200, { found: true, item: data, format: validation.format });

  } catch (err) {
    console.error('[INVENTORY-LOOKUP] Crash:', err);
    return json(500, { error: 'Internal error' });
  }
};
