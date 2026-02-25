export type UserErrorCode =
  | "E_AUTH_EXPIRED"
  | "E_ACCESS_DENIED"
  | "E_TEMP_UNAVAILABLE"
  | "E_RATE_LIMITED"
  | "E_NOT_FOUND"
  | "E_INVALID_INPUT"
  | "E_GENERIC";

interface CatalogEntry {
  code: UserErrorCode;
  message: string;
}

const ERROR_CATALOG: Record<UserErrorCode, CatalogEntry> = {
  E_AUTH_EXPIRED: {
    code: "E_AUTH_EXPIRED",
    message: "Session expired. Sign in again to continue.",
  },
  E_ACCESS_DENIED: {
    code: "E_ACCESS_DENIED",
    message: "Access denied for this operation.",
  },
  E_TEMP_UNAVAILABLE: {
    code: "E_TEMP_UNAVAILABLE",
    message: "Service is temporarily unavailable. Please retry shortly.",
  },
  E_RATE_LIMITED: {
    code: "E_RATE_LIMITED",
    message: "Too many requests right now. Please wait and try again.",
  },
  E_NOT_FOUND: {
    code: "E_NOT_FOUND",
    message: "Requested data was not found.",
  },
  E_INVALID_INPUT: {
    code: "E_INVALID_INPUT",
    message: "Please review your input and try again.",
  },
  E_GENERIC: {
    code: "E_GENERIC",
    message: "Something went wrong. Please try again.",
  },
};

export function getCatalogMessage(code: UserErrorCode): string {
  return ERROR_CATALOG[code].message;
}

function mapRawMessageToCode(raw: string): UserErrorCode {
  const text = raw.toLowerCase();

  if (/(401|unauthoriz|token|jwt|session expired|login required)/.test(text)) {
    return "E_AUTH_EXPIRED";
  }

  if (/(403|forbidden|permission|not allowed|access denied|rls)/.test(text)) {
    return "E_ACCESS_DENIED";
  }

  if (/(429|rate limit|too many request)/.test(text)) {
    return "E_RATE_LIMITED";
  }

  if (/(404|not found|missing)/.test(text)) {
    return "E_NOT_FOUND";
  }

  if (/(invalid|required|must be|malformed|validation)/.test(text)) {
    return "E_INVALID_INPUT";
  }

  if (/(network|fetch|timeout|connection|offline|temporar)/.test(text)) {
    return "E_TEMP_UNAVAILABLE";
  }

  return "E_GENERIC";
}

export function toUserSafeMessage(raw: string | null | undefined, fallbackMessage?: string): string {
  if (!raw || !raw.trim()) {
    return fallbackMessage ?? getCatalogMessage("E_GENERIC");
  }
  const code = mapRawMessageToCode(raw);
  if (code === "E_GENERIC" && fallbackMessage) return fallbackMessage;
  return getCatalogMessage(code);
}

export function toUserSafeMessageFromUnknown(error: unknown, fallbackMessage?: string): string {
  if (error instanceof Error) {
    return toUserSafeMessage(error.message, fallbackMessage);
  }
  return fallbackMessage ?? getCatalogMessage("E_GENERIC");
}
