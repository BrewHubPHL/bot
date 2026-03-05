"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomInt } from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// generatePickupCode — Secure High-Value Parcel Pickup Code Generation
//
// Called from the ops parcels-pickup UI when a staff member initiates
// the secure handoff flow for a high-value or premium parcel.
//
// Security layers:
//   1. CSRF header (X-BrewHub-Action: true)
//   2. Staff PIN session (HMAC-signed HttpOnly cookie)
//   3. Parcel value-tier gate (high_value / premium only)
//   4. HMAC-SHA256 code hashing (consistent with parcel-check-in.js)
//   5. SMS delivery via existing TCPA-compliant gateway
// ═══════════════════════════════════════════════════════════════════════════

interface GeneratePickupCodeResult {
  success: boolean;
  error?: string;
  parcelId?: string;
  recipientName?: string;
  smsSent?: boolean;
  smsBlocked?: boolean;
  smsBlockReason?: string;
}

/** Strict hex format check for HMAC signatures */
const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Verify the HMAC-signed staff PIN session from the HttpOnly cookie.
 * Replicates the verification logic from middleware.ts and _auth.js.
 */
async function verifyStaffSession(): Promise<{
  valid: boolean;
  staffId: string | null;
  email: string | null;
  role: string | null;
}> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("hub_staff_session")?.value;

  if (!sessionCookie) {
    return { valid: false, staffId: null, email: null, role: null };
  }

  const secret = process.env.SESSION_SIGNING_KEY || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) {
    console.error("[PARCEL-ACTION] SESSION_SIGNING_KEY / INTERNAL_SYNC_SECRET not configured");
    return { valid: false, staffId: null, email: null, role: null };
  }

  try {
    const dotIdx = sessionCookie.lastIndexOf(".");
    if (dotIdx === -1) return { valid: false, staffId: null, email: null, role: null };

    const payloadB64 = sessionCookie.substring(0, dotIdx);
    const signature = sessionCookie.substring(dotIdx + 1);
    if (!payloadB64 || !signature) return { valid: false, staffId: null, email: null, role: null };

    const payloadStr = Buffer.from(payloadB64, "base64").toString("utf8");

    // HMAC-SHA256 verification (constant-time via timingSafeEqual)
    const expected = createHmac("sha256", secret).update(payloadStr).digest("hex");

    if (!HEX_RE.test(signature) || signature.length % 2 !== 0) {
      return { valid: false, staffId: null, email: null, role: null };
    }

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) {
      return { valid: false, staffId: null, email: null, role: null };
    }

    const { timingSafeEqual } = await import("crypto");
    if (!timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, staffId: null, email: null, role: null };
    }

    const payload = JSON.parse(payloadStr) as Record<string, unknown>;

    // Check expiry
    if (typeof payload.exp === "number" && Date.now() > payload.exp) {
      return { valid: false, staffId: null, email: null, role: null };
    }

    return {
      valid: true,
      staffId: (payload.staffId as string) || null,
      email: (payload.email as string) || null,
      role: (payload.role as string) || null,
    };
  } catch {
    return { valid: false, staffId: null, email: null, role: null };
  }
}

/**
 * HMAC-SHA256 hash a pickup code — identical to parcel-check-in.js and
 * parcel-pickup.js so the verification flow stays consistent.
 */
function hashPickupCode(code: string): string {
  const secret = process.env.PICKUP_CODE_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error("PICKUP_CODE_SECRET or INTERNAL_SYNC_SECRET env var required");
  return createHmac("sha256", secret).update(String(code).trim()).digest("hex");
}

/**
 * Send SMS via the existing TCPA-compliant send-sms-email Netlify function.
 * Uses the internal service secret for service-to-service auth.
 */
async function triggerPickupSms(
  phone: string,
  recipientName: string,
  trackingNumber: string,
  pickupCode: string,
  valueTier: string,
): Promise<{ sent: boolean; blocked?: boolean; reason?: string }> {
  const siteUrl = process.env.URL || process.env.SITE_URL || "https://brewhubphl.com";
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret) {
    console.error("[PARCEL-ACTION] INTERNAL_SYNC_SECRET not set — cannot call send-sms-email");
    return { sent: false, reason: "server_misconfiguration" };
  }

  const functionUrl = `${siteUrl.replace(/\/$/, "")}/.netlify/functions/send-sms-email`;

  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BrewHub-Secret": secret,
      "X-BrewHub-Action": "true",
    },
    body: JSON.stringify({
      recipient_name: recipientName,
      phone,
      tracking: trackingNumber,
      pickup_code: pickupCode,
      value_tier: valueTier,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    console.error(`[PARCEL-ACTION] send-sms-email returned ${res.status}: ${text}`);
    return { sent: false, reason: "sms_service_error" };
  }

  const result = await res.json();
  return {
    sent: result.sms_sent === true,
    blocked: result.sms_blocked || false,
    reason: result.sms_block_reason || undefined,
  };
}

/**
 * Generate a secure 6-digit pickup code for a high-value parcel.
 *
 * Requires:
 *   - X-BrewHub-Action: true header (CSRF)
 *   - Active staff PIN session (HttpOnly cookie)
 *   - Parcel must have estimated_value_tier = 'high_value' or 'premium'
 *
 * Flow:
 *   1. Verify CSRF + staff session
 *   2. Look up parcel, verify high-value tier
 *   3. Generate cryptographic 6-digit code
 *   4. HMAC hash the code and update parcels.pickup_code_hash
 *   5. Insert audit record in parcel_pickup_log
 *   6. Send unhashed code to customer via SMS
 *   7. Return success so UI can prompt for ID + code verification
 */
export async function generatePickupCode(
  parcelId: string,
): Promise<GeneratePickupCodeResult> {
  // ── 1. CSRF header check ─────────────────────────────────────────
  const headerStore = await headers();
  const csrfHeader = headerStore.get("x-brewhub-action");
  if (csrfHeader !== "true") {
    return { success: false, error: "Missing or invalid CSRF header" };
  }

  // ── 2. Verify staff PIN session ──────────────────────────────────
  const session = await verifyStaffSession();
  if (!session.valid || !session.staffId) {
    return { success: false, error: "Unauthorized — valid staff PIN session required" };
  }

  // ── 3. Input validation ──────────────────────────────────────────
  if (!parcelId || typeof parcelId !== "string") {
    return { success: false, error: "parcel_id is required" };
  }

  // Strict UUID format check to prevent injection
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(parcelId)) {
    return { success: false, error: "Invalid parcel_id format" };
  }

  // ── 4. Supabase service-role client ──────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[PARCEL-ACTION] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return { success: false, error: "Server misconfiguration" };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── 5. Look up parcel and verify high-value ──────────────────────
  const { data: parcel, error: parcelErr } = await supabase
    .from("parcels")
    .select("id, tracking_number, recipient_name, recipient_phone, estimated_value_tier, status")
    .eq("id", parcelId)
    .single();

  if (parcelErr) {
    console.error("[PARCEL-ACTION] Parcel lookup failed:", parcelErr.message);
    return { success: false, error: "Parcel not found" };
  }

  if (!parcel) {
    return { success: false, error: "Parcel not found" };
  }

  // Gate: only high_value and premium parcels qualify
  if (parcel.estimated_value_tier !== "high_value" && parcel.estimated_value_tier !== "premium") {
    return { success: false, error: "Parcel is not flagged as high-value or premium" };
  }

  // Gate: parcel must be in a pickup-eligible status
  if (parcel.status !== "arrived" && parcel.status !== "in_lobby") {
    return { success: false, error: `Parcel status '${parcel.status}' is not eligible for pickup code generation` };
  }

  if (!parcel.recipient_phone) {
    return { success: false, error: "No phone number on file for this parcel's recipient" };
  }

  // ── 6. Generate cryptographic 6-digit code ───────────────────────
  const pickupCode = String(randomInt(100000, 999999));
  const codeHash = hashPickupCode(pickupCode);

  // ── 7. Update parcel with new pickup code hash ───────────────────
  const { error: updateErr } = await supabase
    .from("parcels")
    .update({ pickup_code_hash: codeHash })
    .eq("id", parcelId);

  if (updateErr) {
    console.error("[PARCEL-ACTION] Failed to update pickup_code_hash:", updateErr.message);
    return { success: false, error: "Failed to store pickup code" };
  }

  // ── 8. Insert audit record in parcel_pickup_log ──────────────────
  const { error: logErr } = await supabase
    .from("parcel_pickup_log")
    .insert({
      parcel_id: parcelId,
      tracking_number: parcel.tracking_number,
      attempt_type: "code_generated",
      staff_user: session.email || session.staffId,
      value_tier: parcel.estimated_value_tier,
      code_hash: codeHash,
    });

  if (logErr) {
    console.error("[PARCEL-ACTION] Failed to insert pickup log:", logErr.message);
    return { success: false, error: "Failed to record pickup audit log" };
  }

  // ── 9. Send pickup code via SMS ──────────────────────────────────
  const smsResult = await triggerPickupSms(
    parcel.recipient_phone,
    parcel.recipient_name || "Resident",
    parcel.tracking_number,
    pickupCode,
    parcel.estimated_value_tier,
  );

  // ── 10. Return success ───────────────────────────────────────────
  return {
    success: true,
    parcelId,
    recipientName: parcel.recipient_name || undefined,
    smsSent: smsResult.sent,
    smsBlocked: smsResult.blocked,
    smsBlockReason: smsResult.reason,
  };
}
