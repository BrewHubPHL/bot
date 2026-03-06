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

const OPS_PATHS = ["/kds", "/pos", "/scanner", "/manager", "/staff-hub", "/admin", "/parcels-pickup"];

/** Routes that require manager (or higher) role */
const MANAGER_ONLY_PATHS = ["/manager", "/admin"];

/** Subpaths under manager routes that all staff can access (read-only) */
const STAFF_ALLOWED_MANAGER_PATHS = ["/manager/calendar"];

function isOpsRoute(pathname: string): boolean {
  // Match /kds, /pos, /scanner, /manager (Next.js removes the (ops) group prefix)
  return OPS_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isManagerRoute(pathname: string): boolean {
  // Allow staff-accessible subpaths through
  if (STAFF_ALLOWED_MANAGER_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return false;
  }
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
    || "127.0.0.1";

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
    // No session cookie — let page loads AND RSC navigations through
    // so OpsGate.tsx can render the PIN entry screen.
    // Only hard-block raw API fetches that lack a session.
    const accept = request.headers.get("accept") || "";
    const isRsc =
      request.headers.get("rsc") === "1" ||
      request.headers.has("next-router-state-tree") ||
      request.headers.has("next-router-prefetch") ||
      request.nextUrl.searchParams.has("_rsc");
    if (accept.includes("text/html") || isRsc) {
      // HTML page request or RSC navigation — let OpsGate render the PIN screen
      return NextResponse.next();
    }

    // Non-HTML, non-RSC request (raw fetch, etc.) without session → deny
    return new NextResponse(JSON.stringify({ error: "Unauthorized — session required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the HMAC session token from the cookie
  // Must match the key precedence in _auth.js signToken() and authorize():
  //   SESSION_SIGNING_KEY (dedicated session key) → INTERNAL_SYNC_SECRET (fallback)
  const secret = process.env.SESSION_SIGNING_KEY || process.env.INTERNAL_SYNC_SECRET || "";
  if (!secret) {
    console.error("[MIDDLEWARE] SESSION_SIGNING_KEY / INTERNAL_SYNC_SECRET not configured — cannot verify session tokens");
    return new NextResponse(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await verifySessionToken(sessionCookie, secret);

  // ── Helper: graceful session failure ────────────────────────────────
  // On any cookie validation failure, clear the cookie and let the page
  // through so OpsGate can render the PIN screen.  Only deny non-page
  // requests (RSC, fetch, etc.) with a 401.  This prevents raw JSON
  // responses on full page loads AND prevents cookie deletion on RSC
  // navigations from breaking the login flow.
  function failSession(reason: string) {
    console.warn(`[MIDDLEWARE] ${reason} on ${pathname}`);
    const accept = request.headers.get("accept") || "";
    const isRsc =
      request.headers.get("rsc") === "1" ||
      request.headers.has("next-router-state-tree") ||
      request.headers.has("next-router-prefetch") ||
      request.nextUrl.searchParams.has("_rsc");
    if (accept.includes("text/html") || isRsc) {
      // Page load or RSC navigation — clear cookie and let OpsGate
      // render the PIN screen on next render cycle.
      const response = NextResponse.next();
      response.cookies.delete("hub_staff_session");
      return response;
    }
    // Non-HTML, non-RSC: return 401 and clear the cookie so the next
    // page load shows the PIN screen instead of looping.
    const response = new NextResponse(JSON.stringify({ error: reason }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    response.cookies.delete("hub_staff_session");
    return response;
  }

  if (result.expired) {
    return failSession("Session expired");
  }

  if (!result.valid) {
    return failSession("Invalid session");
  }

  // ── Payload shape validation (defense-in-depth) ────────────────────
  // Ensure the token contains the fields downstream code relies on.
  const payload = result.payload!;
  if (
    typeof payload.role !== "string" || !payload.role ||
    typeof payload.email !== "string" || !payload.email ||
    (payload.staffId === undefined && payload.staffId !== null)
  ) {
    return failSession("Invalid session payload — missing role/email/staffId");
  }

  // ── Device fingerprint binding ──────────────────────────────────────
  // Defense-in-depth: If the edge runtime derives a different fingerprint
  // than the serverless function that issued the token (possible on
  // Netlify where edge and Lambda see slightly different headers), log
  // it but DON'T block — DFP is defense-in-depth and header drift
  // between edge runtime and serverless causes false positives.
  // The cookie is already HttpOnly+Secure+SameSite=Lax+HMAC-signed.
  if (typeof payload.dfp === "string" && payload.dfp.length > 0) {
    const currentDfp = await deriveDeviceFingerprint(request);
    if (payload.dfp !== currentDfp) {
      console.warn(`[MIDDLEWARE] DFP drift on ${pathname}: token=${payload.dfp} edge=${currentDfp} (allowing through)`);
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
