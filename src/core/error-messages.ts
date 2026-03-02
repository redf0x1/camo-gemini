export interface FriendlyError {
  code: string;
  message: string;
  suggestion: string;
}

const errorCatalog: Record<string, FriendlyError> = {
  CAMOFOX_UNREACHABLE: {
    code: "CAMOFOX_UNREACHABLE",
    message: "Cannot connect to CamoFox browser",
    suggestion: "Start CamoFox browser: cd camofox-browser && npm start"
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED",
    message: "No active Gemini session. Please login first.",
    suggestion: "Use gemini_login tool or add an account via gemini_add_account"
  },
  AUTH_FAILED: {
    code: "AUTH_FAILED",
    message: "Google login failed or session expired",
    suggestion: "Try logging in again. Ensure your Google account has Gemini access."
  },
  TOKEN_EXTRACTION_FAILED: {
    code: "TOKEN_EXTRACTION_FAILED",
    message: "Failed to extract Gemini security tokens",
    suggestion: "Session may have expired. Try logging out and back in."
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Gemini rate limit reached for this account",
    suggestion: "Wait a moment or switch to a different account with gemini_add_account"
  },
  IMAGE_GEN_BLOCKED: {
    code: "IMAGE_GEN_BLOCKED",
    message: "Image generation is blocked for this account",
    suggestion:
      "Try running gemini_logout then gemini_login to refresh your session. If the issue persists, image generation may require visiting gemini.google.com in a browser first to accept terms."
  },
  RETRY_EXHAUSTED: {
    code: "RETRY_EXHAUSTED",
    message: "Operation failed after multiple retries",
    suggestion:
      "Check CamoFox browser status and network connectivity. If using multiple accounts, failover was attempted."
  },
  UPLOAD_TOO_LARGE: {
    code: "UPLOAD_TOO_LARGE",
    message: "File exceeds the 25MB upload limit",
    suggestion: "Reduce file size or compress before uploading"
  },
  ACCOUNT_NOT_FOUND: {
    code: "ACCOUNT_NOT_FOUND",
    message: "The specified account is not registered",
    suggestion: "Add the account first with gemini_add_account"
  },
  ACCOUNT_COOLDOWN: {
    code: "ACCOUNT_COOLDOWN",
    message: "This account is in cooldown due to repeated errors",
    suggestion: "Wait for cooldown to expire or use a different account"
  },
  ALL_ACCOUNTS_UNHEALTHY: {
    code: "ALL_ACCOUNTS_UNHEALTHY",
    message: "No healthy accounts available for this operation",
    suggestion:
      "Check account health with gemini_health. Login to additional accounts or wait for cooldowns to expire."
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "Network connection error",
    suggestion: "Check your internet connection and CamoFox browser status"
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "Received unexpected response from Gemini",
    suggestion: "This may be a temporary issue. Try again in a few seconds."
  },
  CHAT_SESSION_NOT_FOUND: {
    code: "CHAT_SESSION_NOT_FOUND",
    message: "Chat session not found",
    suggestion: "Start a new chat with gemini_chat. Sessions are per-account."
  },
  GEM_NOT_FOUND: {
    code: "GEM_NOT_FOUND",
    message: "The specified Gem was not found",
    suggestion: "List available Gems with gemini_list_gems"
  }
};

export function getFriendlyError(error: Error): FriendlyError {
  const code = (error as { code?: string }).code;
  if (code && errorCatalog[code]) {
    return errorCatalog[code];
  }

  const msg = error.message.toLowerCase();

  if (msg.includes("econnrefused") || msg.includes("fetch failed") || msg.includes("camofox")) {
    return errorCatalog.CAMOFOX_UNREACHABLE;
  }
  if (msg.includes("not logged in") || msg.includes("no active session") || msg.includes("no session")) {
    return errorCatalog.AUTH_REQUIRED;
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return errorCatalog.RATE_LIMITED;
  }
  if (msg.includes("retry") && msg.includes("exhausted")) {
    return errorCatalog.RETRY_EXHAUSTED;
  }
  if (msg.includes("upload") && (msg.includes("large") || msg.includes("25mb") || msg.includes("size"))) {
    return errorCatalog.UPLOAD_TOO_LARGE;
  }
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("networkerror")) {
    return errorCatalog.NETWORK_ERROR;
  }
  if (msg.includes("account") && msg.includes("not registered")) {
    return errorCatalog.ACCOUNT_NOT_FOUND;
  }
  if (msg.includes("cooldown")) {
    return errorCatalog.ACCOUNT_COOLDOWN;
  }
  if (msg.includes("chat") && msg.includes("not found")) {
    return errorCatalog.CHAT_SESSION_NOT_FOUND;
  }

  return {
    code: "UNKNOWN",
    message: error.message,
    suggestion: "Check the error details and try again. Use gemini_health to check system status."
  };
}

export function formatFriendlyError(error: Error): string {
  const friendly = getFriendlyError(error);
  return `Error: ${friendly.message}\nSuggestion: ${friendly.suggestion}`;
}
