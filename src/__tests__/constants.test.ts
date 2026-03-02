import { describe, expect, it } from "vitest";

import { Endpoint, GEMINI_HEADERS, GrpcId, MODEL_ALIASES, MODELS, TOKEN_PATTERNS } from "../core/constants.js";

describe("constants", () => {
  describe("Endpoint", () => {
    it("should generate correct INIT URL for default account", () => {
      expect(Endpoint.INIT()).toBe("https://gemini.google.com/app");
    });

    it("should generate correct INIT URL for account 1", () => {
      expect(Endpoint.INIT(1)).toBe("https://gemini.google.com/u/1/app");
    });

    it("should generate correct GENERATE URL", () => {
      expect(Endpoint.GENERATE()).toContain("StreamGenerate");
    });

    it("should generate correct BATCH_EXEC URL", () => {
      expect(Endpoint.BATCH_EXEC()).toContain("batchexecute");
    });
  });

  describe("GrpcId", () => {
    it("should have all required service IDs", () => {
      expect(GrpcId.LIST_CHATS).toBe("MaZiqc");
      expect(GrpcId.LIST_GEMS).toBe("CNgdBe");
    });
  });

  describe("MODELS", () => {
    it("should have unspecified model", () => {
      expect(MODELS.unspecified).toBeDefined();
      expect(MODELS.unspecified.header).toEqual({});
    });

    it("should have model with header for non-default models", () => {
      const modelKeys = Object.keys(MODELS).filter((key) => key !== "unspecified");
      for (const key of modelKeys) {
        expect(MODELS[key].header).toHaveProperty("x-goog-ext-525001261-jspb");
      }
    });
  });

  describe("MODEL_ALIASES", () => {
    it("should resolve aliases to model names", () => {
      expect(MODEL_ALIASES.pro).toBeDefined();
      expect(MODEL_ALIASES.flash).toBeDefined();
      expect(MODELS[MODEL_ALIASES.pro]).toBeDefined();
      expect(MODELS[MODEL_ALIASES.flash]).toBeDefined();
    });
  });

  describe("TOKEN_PATTERNS", () => {
    it("should have regex patterns for all required tokens", () => {
      expect(TOKEN_PATTERNS.SNlM0e).toBeInstanceOf(RegExp);
      expect(TOKEN_PATTERNS.cfb2h).toBeInstanceOf(RegExp);
      expect(TOKEN_PATTERNS.FdrFJe).toBeInstanceOf(RegExp);
    });

    it("should match token formats in HTML", () => {
      const html = '"SNlM0e":"test_token_123"';
      const match = html.match(TOKEN_PATTERNS.SNlM0e);
      expect(match?.[1]).toBe("test_token_123");
    });
  });

  describe("GEMINI_HEADERS", () => {
    it("should have required headers", () => {
      expect(GEMINI_HEADERS["Content-Type"]).toContain("utf-8");
      expect(GEMINI_HEADERS["X-Same-Domain"]).toBe("1");
      expect(GEMINI_HEADERS.Origin).toBe("https://gemini.google.com");
    });
  });
});
