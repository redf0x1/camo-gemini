import { beforeEach, describe, expect, it, vi } from "vitest";

import { TokenManager } from "../core/token-manager.js";

function createMockClient(evaluateResult: unknown) {
  return {
    evaluate: vi.fn().mockResolvedValue(evaluateResult)
  } as any;
}

describe("TokenManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractTokens", () => {
    it("should extract tokens successfully", async () => {
      const client = createMockClient({
        ok: true,
        result: {
          ok: true,
          tokens: { snlm0e: "", cfb2h: "build_label_123", fdrfje: "session_id_456" },
          extractedAt: 1000
        }
      });

      const tm = new TokenManager(client);
      const tokens = await tm.extractTokens("tab1", "user1");

      expect(tokens.cfb2h).toBe("build_label_123");
      expect(tokens.fdrfje).toBe("session_id_456");
      expect(tokens.snlm0e).toBe("");
      expect(client.evaluate).toHaveBeenCalledOnce();
    });

    it("should throw on not_authenticated error", async () => {
      const client = createMockClient({
        ok: true,
        result: {
          ok: false,
          error: "not_authenticated",
          url: "https://consent.google.com"
        }
      });

      const tm = new TokenManager(client);
      await expect(tm.extractTokens("tab1", "user1")).rejects.toThrow("not authenticated");
    });

    it("should throw on no_tokens_found", async () => {
      const client = createMockClient({
        ok: true,
        result: {
          ok: false,
          error: "no_tokens_found",
          url: "https://gemini.google.com/app",
          hint: "Page may not be fully loaded"
        }
      });

      const tm = new TokenManager(client);
      await expect(tm.extractTokens("tab1", "user1")).rejects.toThrow("no_tokens_found");
    });

    it("should throw on evaluate failure", async () => {
      const client = createMockClient({
        ok: false,
        error: "timeout"
      });

      const tm = new TokenManager(client);
      await expect(tm.extractTokens("tab1", "user1")).rejects.toThrow("evaluate failed");
    });

    it("should handle null cfb2h (fallback to empty string)", async () => {
      const client = createMockClient({
        ok: true,
        result: {
          ok: true,
          tokens: { snlm0e: "", cfb2h: null, fdrfje: "session_id" },
          extractedAt: Date.now()
        }
      });

      const tm = new TokenManager(client);
      const tokens = await tm.extractTokens("tab1", "user1");
      expect(tokens.cfb2h).toBe("");
    });
  });

  describe("isValid", () => {
    it("should return true for fresh tokens", () => {
      const tm = new TokenManager({} as any);
      expect(tm.isValid({ snlm0e: "", cfb2h: "x", fdrfje: "y", extractedAt: Date.now() })).toBe(true);
    });

    it("should return false for expired tokens", () => {
      const tm = new TokenManager({} as any);
      const expired = Date.now() - 700_000;
      expect(tm.isValid({ snlm0e: "", cfb2h: "x", fdrfje: "y", extractedAt: expired })).toBe(false);
    });
  });
});
