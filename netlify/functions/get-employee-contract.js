'use strict';

/**
 * get-employee-contract.js — Returns the hydrated staff agreement for the
 * currently authenticated employee.
 *
 * GET /.netlify/functions/get-employee-contract
 *
 * Auth: PIN session (requirePin: true)
 * Returns: { agreement: string }
 *
 * Fetches full_name and hourly_rate from staff_directory using the
 * authenticated employee's email address.
 */

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');
const { generateStaffAgreement } = require('./_staff-agreement');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // ── Preflight ──────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (MISSING_ENV) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // ── Rate limiting ──────────────────────────────────────────
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `employee-contract:${hashIP(ip)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[GET-EMPLOYEE-CONTRACT] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // ── Authentication ─────────────────────────────────────────
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  const staffEmail = auth.user?.email?.toLowerCase();
  if (!staffEmail) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Staff email not available' }),
    };
  }

  // ── Fetch employee data ────────────────────────────────────
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: staffRow, error: staffErr } = await supabase
      .from('staff_directory')
      .select('full_name, hourly_rate')
      .eq('email', staffEmail)
      .eq('is_active', true)
      .single();

    if (staffErr) {
      console.error('[GET-EMPLOYEE-CONTRACT] DB error:', staffErr.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to load employee data' }),
      };
    }

    if (!staffRow) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Employee record not found' }),
      };
    }

    const employeeName = staffRow.full_name || 'Employee';
    const baseRate = staffRow.hourly_rate != null
      ? Number(staffRow.hourly_rate).toFixed(2)
      : '0.00';

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const agreement = generateStaffAgreement({
      employeeName,
      baseRate,
      effectiveDate: today,
      noticePeriodDays: 14,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agreement }),
    };
  } catch (err) {
    console.error('[GET-EMPLOYEE-CONTRACT] Unexpected error:', err?.message || err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
