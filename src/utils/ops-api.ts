/**
 * ops-api.ts — Centralized fetch wrapper for all OpsGate-authenticated API calls.
 *
 * Every (ops) component that calls a Netlify Function should use `fetchOps()`
 * instead of raw `fetch()`.  It:
 *   1. Resolves the correct API base (localhost vs production)
 *   2. Auto-attaches the PIN session token passed from OpsGate context
 *   3. Always sends the X-BrewHub-Action CSRF header
 *   4. On 401 → immediately clears the session and reloads (PIN screen)
 *
 * Usage:
 *   const { token } = useOpsSession();
 *   const res = await fetchOps("/get-manager-stats", {}, token);
 *   const res = await fetchOps("/resolve-no-show", { method: "POST", body: JSON.stringify({…}) }, token);
 */

import { forceOpsLogout } from "@/lib/authz";

/* ─── Resolved once at module load ────────────────────── */
export const OPS_API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Core wrapper ────────────────────────────────────── */
/**
 * Authenticated fetch for Netlify Functions behind OpsGate.
 *
 * @param path   Function path, e.g. "/get-manager-stats" or "/get-receipts?limit=10"
 * @param init   Standard RequestInit (method, body, extra headers, etc.)
 * @param token  PIN session token from OpsGate context (useOpsSession().token)
 * @returns      The raw Response — callers still check res.ok, res.status, etc.
 *
 * If the response is **401**, `forceOpsLogout()` fires automatically
 * and the user is bounced to the PIN screen. The Response is still
 * returned so callers can short-circuit without throwing.
 */
export async function fetchOps(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  // Merge caller headers with auth + CSRF headers
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("X-BrewHub-Action", "true");

  const res = await fetch(`${OPS_API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  // Global 401 handler — session expired / fingerprint mismatch / revoked
  if (res.status === 401) {
    forceOpsLogout();
  }

  return res;
}
