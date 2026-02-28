import { NextRequest, NextResponse } from "next/server";

/**
 * Secure middleware for BrewHub ops routes.
 *
 * Reads the HttpOnly `hub_staff_session` cookie (set by pin-login.js),
 * verifies the HMAC signature and expiry, and blocks unauthenticated
 * requests to any /ops/* or /(ops)/* route.
 *
 * Client-side JS cannot read or forge this cookie because it is
 * HttpOnly + Secure + SameSite=Strict.
 */

const OPS_PATHS = ["/kds", "/pos", "/scanner", "/manager", "/staff-hub", "/admin"];

/** Routes that require manager (or higher) role */
const MANAGER_ONLY_PATHS = ["/manager", "/admin"];

function isOpsRoute(pathname: string): boolean {
  // Match /kds, /pos, /scanner, /manager (Next.js removes the (ops) group prefix)
  return OPS_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isManagerRoute(pathname: string): boolean {
  return MANAGER_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Strict hex validation — rejects non-hex characters instead of silently converting to 0 */
const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Derive a device fingerprint from request headers (Edge Runtime compatible).
 * Must match the derivation in pin-login.js:
 *   sha256(user-agent + '|' + accept-language + '|' + clientIP).slice(0, 16)
 *
 * The client IP is included so a stolen cookie cannot be replayed from
 * a different network.  When x-forwarded-for contains multiple IPs we
 * use only the first (left-most) entry — the one set by the edge proxy
 * — to keep the hash deterministic across hops.
 */
async function deriveDeviceFingerprint(request: NextRequest): Promise<string> {
  const ua = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept-language") || "";

  // Resolve the client IP — prefer the Netlify-specific header, then
  // x-forwarded-for (first entry only), then 'unknown'.
  const xff = request.headers.get("x-forwarded-for");
  const clientIp =
    request.headers.get("x-nf-client-connection-ip")
    || (xff ? xff.split(",")[0].trim() : null)
    || "unknown";

  const raw = `${ua}|${accept}|${clientIp}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

async function verifySessionToken(token: string, secret: string): Promise<{ valid: boolean; expired: boolean; payload?: Record<string, unknown> }> {
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx === -1) return { valid: false, expired: false };

    const payloadB64 = token.substring(0, dotIdx);
    const signature = token.substring(dotIdx + 1);
    if (!payloadB64 || !signature) return { valid: false, expired: false };

    const payloadStr = atob(payloadB64);

    // Import key for HMAC-SHA256 (Web Crypto — Edge Runtime compatible)
    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    // Validate hex format before decoding (prevents NaN→0 silent conversion)
    if (!HEX_RE.test(signature) || signature.length % 2 !== 0) {
      return { valid: false, expired: false };
    }
    const sigBytes = new Uint8Array(signature.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    const msgBytes = new TextEncoder().encode(payloadStr);

    // crypto.subtle.verify performs a constant-time comparison internally
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, msgBytes);
    if (!valid) return { valid: false, expired: false };

    const payload = JSON.parse(payloadStr) as Record<string, unknown>;

    // Check expiry
    if (typeof payload.exp === "number" && Date.now() > payload.exp) {
      return { valid: false, expired: true, payload };
    }

    return { valid: true, expired: false, payload };
  } catch {
    return { valid: false, expired: false };
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate ops routes
  if (!isOpsRoute(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("hub_staff_session")?.value;

  if (!sessionCookie) {
    // No session cookie — block access.
    // Return the page shell so OpsGate renders the PIN entry UI,
    // but set a header the client can detect if needed.
    // We allow through because OpsGate.tsx on the client handles the PIN screen.
    // However, for API-level protection, we set a flag.
    // The actual gate is OpsGate.tsx + the _auth.js backend, but we add
    // defense-in-depth: if someone bypasses OpsGate, middleware blocks them.

    // Allow initial page loads (OpsGate will render PIN screen)
    // Block only fetch/API requests without the cookie
    const accept = request.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      // HTML page request — let OpsGate render the PIN screen
      return NextResponse.next();
    }

    // Non-HTML request (RSC, fetch, etc.) without session → deny
    return new NextResponse(JSON.stringify({ error: "Unauthorized — session required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the HMAC session token from the cookie
  const secret = process.env.INTERNAL_SYNC_SECRET || "";
  if (!secret) {
    console.error("[MIDDLEWARE] INTERNAL_SYNC_SECRET not configured — cannot verify session tokens");
    return new NextResponse(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await verifySessionToken(sessionCookie, secret);

  if (result.expired) {
    // Clear the stale cookie and deny access (force re-authentication)
    const accept = request.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      // HTML request — clear cookie and allow through so OpsGate shows PIN screen
      const response = NextResponse.next();
      response.cookies.delete("hub_staff_session");
      return response;
    }
    // Non-HTML (fetch/API) — return 401
    const response = new NextResponse(JSON.stringify({ error: "Session expired" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    response.cookies.delete("hub_staff_session");
    return response;
  }

  if (!result.valid) {
    // Invalid signature — possible spoofing attempt. Delete and deny.
    console.warn(`[MIDDLEWARE] Invalid session cookie on ${pathname}`);
    const response = new NextResponse(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    response.cookies.delete("hub_staff_session");
    return response;
  }

  // ── Payload shape validation (defense-in-depth) ────────────────────
  // Ensure the token contains the fields downstream code relies on.
  const payload = result.payload!;
  if (
    typeof payload.role !== "string" || !payload.role ||
    typeof payload.email !== "string" || !payload.email ||
    (payload.staffId === undefined && payload.staffId !== null)
  ) {
    console.warn(`[MIDDLEWARE] Malformed session payload on ${pathname}: missing role/email/staffId`);
    const badPayloadResp = new NextResponse(JSON.stringify({ error: "Invalid session payload" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    badPayloadResp.cookies.delete("hub_staff_session");
    return badPayloadResp;
  }

  // ── Device fingerprint binding ──────────────────────────────────────
  // Reject sessions replayed from a different device/browser.
  if (typeof payload.dfp === "string" && payload.dfp.length > 0) {
    const currentDfp = await deriveDeviceFingerprint(request);
    if (payload.dfp !== currentDfp) {
      console.warn(`[MIDDLEWARE] Device fingerprint mismatch on ${pathname}`);
      const response = new NextResponse(JSON.stringify({ error: "Session not valid for this device" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
      response.cookies.delete("hub_staff_session");
      return response;
    }
  }

  // ── Role-based route gating (defense-in-depth) ─────────────────────
  if (isManagerRoute(pathname)) {
    const role = String(payload.role ?? "").toLowerCase();
    if (role !== "manager" && role !== "owner" && role !== "admin") {
      return new NextResponse(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Valid session — attach staff info to request headers for downstream use
  const response = NextResponse.next();
  response.headers.set("x-staff-id", String(payload.staffId ?? ""));
  response.headers.set("x-staff-email", String(payload.email ?? ""));
  response.headers.set("x-staff-role", String(payload.role ?? ""));
  return response;
}

export const config = {
  matcher: ["/kds/:path*", "/pos/:path*", "/scanner/:path*", "/manager/:path*", "/staff-hub/:path*", "/admin/:path*"],
};
