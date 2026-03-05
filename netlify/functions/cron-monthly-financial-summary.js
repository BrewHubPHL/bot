// ═══════════════════════════════════════════════════════════════════════════
// cron-monthly-financial-summary.js — Scheduled monthly profitability email
//
// Runs on the 1st of every month at 10:00 AM UTC (5:00 AM EST).
// 1. Computes the profit report for the PREVIOUS month via shared logic
//    in _profit-report.js (same engine as get-true-profit-report.js).
// 2. Queries all active managers from staff_directory.
// 3. Sends a professional HTML summary via Resend.
// 4. Includes a CTA link to /manager/assets when the Maintenance-to-Revenue
//    ratio exceeds 10 %.
//
// Netlify scheduled functions use ESM default export + config.schedule.
//
// ENV required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
//   SITE_URL | URL (for CTA links)
//
// SECURITY:
//   - No user-facing HTTP surface (scheduled trigger only).
//   - Supabase errors explicitly checked (no silent failures).
//   - logSystemError() for dead-letter persistence on failures.
//   - PII-safe: manager emails never logged in plaintext.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

// ── Shared profit engine (CJS — use createRequire for ESM compat) ────────
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { computeProfitReport } = require('./_profit-report');
const { logSystemError } = require('./_system-errors');

// ── Helpers ──────────────────────────────────────────────────────────────

const SITE_ORIGIN = process.env.SITE_URL || process.env.URL || 'https://brewhubphl.com';

/**
 * Return the YYYY-MM string for the month before the given date.
 */
function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Return a human-readable month label, e.g. "February 2026"
 */
function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[m - 1]} ${y}`;
}

/**
 * Simple HTML-entity escaper to prevent XSS in the email template.
 */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the professional HTML email body.
 */
function buildEmailHtml(report) {
  const label = monthLabel(report.month);
  const ratioExceeds10 = report.maintenance_to_revenue_ratio > 0.10;

  // Conditional text color for net profit
  const profitColor = report.net_profit_cents >= 0 ? '#16a34a' : '#dc2626';
  const ratioColor = ratioExceeds10 ? '#dc2626' : '#16a34a';

  const ctaBlock = ratioExceeds10
    ? `<tr>
        <td style="padding: 24px 0 0 0;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background: #dc2626; border-radius: 8px;">
                <a href="${esc(SITE_ORIGIN)}/manager/assets"
                   style="display: inline-block; padding: 14px 28px; color: #ffffff;
                          text-decoration: none; font-weight: bold; font-size: 15px;
                          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                  ⚠️ Review Equipment &amp; Maintenance Costs →
                </a>
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0 0; font-size: 12px; color: #888;">
            Maintenance costs exceeded 10% of revenue this month.
          </p>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f4f4f5; padding: 40px 20px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background: #1c1917; padding: 28px 32px;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">
              ☕ BrewHub PHL — Monthly Financial Summary
            </h1>
            <p style="margin: 6px 0 0 0; color: #a1a1aa; font-size: 14px;">
              ${esc(label)}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding: 32px;">

            <!-- KPI Grid -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="50%" style="padding: 0 8px 16px 0; vertical-align: top;">
                  <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Revenue</p>
                    <p style="margin: 6px 0 0 0; font-size: 24px; font-weight: 700; color: #111827;">${esc(report.revenue_display)}</p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #9ca3af;">${report.order_count} completed order${report.order_count !== 1 ? 's' : ''}</p>
                  </div>
                </td>
                <td width="50%" style="padding: 0 0 16px 8px; vertical-align: top;">
                  <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Maintenance</p>
                    <p style="margin: 6px 0 0 0; font-size: 24px; font-weight: 700; color: #111827;">${esc(report.maintenance_cost_display)}</p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #9ca3af;">${report.maintenance_event_count} event${report.maintenance_event_count !== 1 ? 's' : ''}</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding: 0 8px 0 0; vertical-align: top;">
                  <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Net Profit</p>
                    <p style="margin: 6px 0 0 0; font-size: 24px; font-weight: 700; color: ${profitColor};">${esc(report.net_profit_display)}</p>
                  </div>
                </td>
                <td width="50%" style="padding: 0 0 0 8px; vertical-align: top;">
                  <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Maint / Revenue</p>
                    <p style="margin: 6px 0 0 0; font-size: 24px; font-weight: 700; color: ${ratioColor};">${esc(report.maintenance_to_revenue_pct)}</p>
                  </div>
                </td>
              </tr>
            </table>

            <!-- CTA (conditional) -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${ctaBlock}
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background: #fafaf9; padding: 20px 32px; border-top: 1px solid #e5e5e5;">
            <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">
              This is an automated report from BrewHub PHL. Do not reply to this email.<br>
              <a href="${esc(SITE_ORIGIN)}/manager" style="color: #78716c; text-decoration: underline;">Open Manager Dashboard</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Scheduled handler ────────────────────────────────────────────────────

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey  = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[MONTHLY-SUMMARY] Missing SUPABASE env vars — aborting.');
    return new Response('Server misconfiguration', { status: 500 });
  }
  if (!resendKey) {
    console.error('[MONTHLY-SUMMARY] RESEND_API_KEY not set — aborting.');
    return new Response('Email not configured', { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const month = previousMonth();

  // 1. Compute the profit report for the previous month
  let report;
  try {
    report = await computeProfitReport(supabase, month);
  } catch (err) {
    console.error('[MONTHLY-SUMMARY] Profit computation failed:', err.message);
    await logSystemError(supabase, {
      error_type: 'cron_failure',
      severity: 'critical',
      source_function: 'cron-monthly-financial-summary',
      error_message: `Profit computation failed for ${month}: ${err.message}`,
    }).catch(() => {});
    return new Response(JSON.stringify({ error: 'Computation failed' }), { status: 502 });
  }

  // 2. Fetch active manager emails from staff_directory
  const { data: managers, error: mgrErr } = await supabase
    .from('staff_directory')
    .select('email')
    .in('role', ['manager', 'admin'])
    .eq('is_active', true);

  if (mgrErr) {
    console.error('[MONTHLY-SUMMARY] Manager query failed:', mgrErr.message);
    await logSystemError(supabase, {
      error_type: 'db_query_failed',
      severity: 'critical',
      source_function: 'cron-monthly-financial-summary',
      error_message: `Manager email query failed: ${mgrErr.message}`,
    }).catch(() => {});
    return new Response(JSON.stringify({ error: 'Manager lookup failed' }), { status: 502 });
  }

  const recipients = (managers || [])
    .map(m => m.email)
    .filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (recipients.length === 0) {
    console.warn('[MONTHLY-SUMMARY] No active manager email addresses found — skipping send.');
    return new Response('No recipients', { status: 200 });
  }

  // 3. Build email
  const label = monthLabel(month);
  const subject = report.maintenance_to_revenue_ratio > 0.10
    ? `⚠️ BrewHub Financial Summary — ${label} (High Maintenance Costs)`
    : `☕ BrewHub Financial Summary — ${label}`;

  const html = buildEmailHtml(report);

  // 4. Send via Resend
  let sendFailed = false;
  const errors = [];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'BrewHub PHL <info@brewhubphl.com>',
        to: recipients,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody.message || errBody.error || `HTTP ${res.status}`;
      console.error('[MONTHLY-SUMMARY] Resend API error:', errMsg);
      errors.push(errMsg);
      sendFailed = true;
    }
  } catch (fetchErr) {
    console.error('[MONTHLY-SUMMARY] Resend fetch failed:', fetchErr.message);
    errors.push(fetchErr.message);
    sendFailed = true;
  }

  if (sendFailed) {
    await logSystemError(supabase, {
      error_type: 'email_send_failed',
      severity: 'critical',
      source_function: 'cron-monthly-financial-summary',
      error_message: `Monthly summary email failed for ${month}: ${errors.join('; ')}`,
      context: { month, recipientCount: recipients.length },
    }).catch(() => {});
    return new Response(JSON.stringify({ error: 'Email delivery failed' }), { status: 502 });
  }

  console.log(`[MONTHLY-SUMMARY] Sent ${label} summary to ${recipients.length} manager(s).`);
  return new Response(JSON.stringify({
    sent: true,
    month,
    recipientCount: recipients.length,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ── Netlify scheduled trigger: 1st of every month at 10:00 AM UTC ────────
export const config = {
  schedule: '0 10 1 * *',
};
