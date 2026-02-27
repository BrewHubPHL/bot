import { toUserSafeMessage } from "@/lib/errorCatalog";

export type AuthzStatus = 401 | 403;

export interface AuthzErrorState {
  status: AuthzStatus;
  title: string;
  message: string;
  actionLabel: string;
}

export interface ErrorInfo {
  authz: AuthzErrorState | null;
  message: string;
}

function readMessageFromBody(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidate = obj.error ?? obj.message;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export async function readErrorBodyMessage(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return readMessageFromBody(body);
  } catch {
    return null;
  }
}

export function getAuthzErrorState(status: number): AuthzErrorState | null {
  if (status === 401) {
    return {
      status,
      title: "Session expired",
      message: "Your staff session is no longer valid. Sign in again to continue.",
      actionLabel: "Sign in again",
    };
  }

  if (status === 403) {
    return {
      status,
      title: "Access restricted",
      message: "You do not have permission to access this operation.",
      actionLabel: "Return to safe view",
    };
  }

  return null;
}

export async function getErrorInfoFromResponse(
  res: Response,
  fallbackMessage = "Request failed",
): Promise<ErrorInfo> {
  const backendMessage = await readErrorBodyMessage(res);
  const authz = getAuthzErrorState(res.status);

  if (authz) {
    return {
      authz,
      message: authz.message,
    };
  }

  return {
    authz: null,
    message: toUserSafeMessage(backendMessage, fallbackMessage),
  };
}

/* ─── Global force-logout for expired/invalid PIN sessions ──────── */
let _logoutFired = false;
/**
 * Immediately clear the OpsGate session and reload the page so the
 * user lands on the PIN entry screen. Debounced: if multiple polling
 * loops detect 401 simultaneously, only the first one triggers a reload.
 */
export function forceOpsLogout(): void {
  if (_logoutFired) return;
  _logoutFired = true;
  try {
    sessionStorage.removeItem("ops_session");
  } catch { /* SSR guard */ }
  window.location.reload();
}