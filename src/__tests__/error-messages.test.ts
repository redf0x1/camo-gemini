import { describe, expect, it } from "vitest";

import { formatFriendlyError, getFriendlyError } from "../core/error-messages.js";

describe("error-messages", () => {
  it("matches by error code", () => {
    const error = new Error("raw error") as Error & { code: string };
    error.code = "AUTH_REQUIRED";

    const friendly = getFriendlyError(error);
    expect(friendly.code).toBe("AUTH_REQUIRED");
    expect(friendly.message).toContain("No active Gemini session");
  });

  it("matches by message pattern", () => {
    const friendly = getFriendlyError(new Error("connect ECONNREFUSED 127.0.0.1:9377"));
    expect(friendly.code).toBe("CAMOFOX_UNREACHABLE");
  });

  it("returns default for unknown errors", () => {
    const friendly = getFriendlyError(new Error("totally custom error"));
    expect(friendly.code).toBe("UNKNOWN");
    expect(friendly.message).toBe("totally custom error");
    expect(friendly.suggestion).toContain("gemini_health");
  });

  it("formats friendly output with suggestion", () => {
    const text = formatFriendlyError(new Error("rate limit exceeded"));
    expect(text).toContain("Error: Gemini rate limit reached for this account");
    expect(text).toContain("Suggestion:");
  });

  it("ensures all catalog entries have required fields", () => {
    const expectedCodes = [
      "CAMOFOX_UNREACHABLE",
      "AUTH_REQUIRED",
      "AUTH_FAILED",
      "TOKEN_EXTRACTION_FAILED",
      "RATE_LIMITED",
      "RETRY_EXHAUSTED",
      "UPLOAD_TOO_LARGE",
      "ACCOUNT_NOT_FOUND",
      "ACCOUNT_COOLDOWN",
      "ALL_ACCOUNTS_UNHEALTHY",
      "NETWORK_ERROR",
      "INVALID_RESPONSE",
      "CHAT_SESSION_NOT_FOUND",
      "GEM_NOT_FOUND"
    ];

    for (const code of expectedCodes) {
      const error = new Error("catalog check") as Error & { code: string };
      error.code = code;

      const friendly = getFriendlyError(error);
      expect(friendly.code).toBe(code);
      expect(friendly.message.trim().length).toBeGreaterThan(0);
      expect(friendly.suggestion.trim().length).toBeGreaterThan(0);
    }
  });
});
