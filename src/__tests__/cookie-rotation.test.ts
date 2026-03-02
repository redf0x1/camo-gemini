import { afterEach, describe, expect, it, vi } from "vitest";

import { CookieRotationService } from "../services/cookie-rotation.js";

function createMockClient() {
  return {
    createTab: vi.fn().mockResolvedValue({ tabId: "ephemeral-tab" }),
    evaluate: vi.fn().mockResolvedValue({ ok: true, result: { ok: true, status: 200 } }),
    closeTab: vi.fn().mockResolvedValue(undefined)
  } as any;
}

function createMockState() {
  return {
    recordRotation: vi.fn(),
    getSession: vi.fn().mockReturnValue({ tabId: "main-tab" }),
    getAccount: vi.fn().mockImplementation((accountIndex: number) => ({
      accountIndex,
      session: { tabId: "main-tab" },
      camofoxUserId: `test-acct${accountIndex}`
    }))
  } as any;
}

const config = {
  camofoxUrl: "http://localhost:9377",
  userId: "test",
  requestTimeout: 30000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

describe("CookieRotationService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rotateOnce", () => {
    it("should create ephemeral tab, rotate, and close", async () => {
      const client = createMockClient();
      const state = createMockState();
      const svc = new CookieRotationService(client, state, config);

      const result = await svc.rotateOnce(2);

      expect(result.ok).toBe(true);
      expect(client.createTab).toHaveBeenCalledWith("https://accounts.google.com", "test-acct2", "cookie-rotation-2");
      expect(client.evaluate).toHaveBeenCalledOnce();
      expect(client.closeTab).toHaveBeenCalledWith("ephemeral-tab", "test-acct2");
      expect(state.recordRotation).toHaveBeenCalledWith(2);
    });

    it("should close ephemeral tab even on failure", async () => {
      const client = createMockClient();
      client.evaluate.mockResolvedValue({ ok: false, error: "timeout" });
      const state = createMockState();
      const svc = new CookieRotationService(client, state, config);

      const result = await svc.rotateOnce(0);

      expect(result.ok).toBe(false);
      expect(client.closeTab).toHaveBeenCalledWith("ephemeral-tab", "test-acct0");
    });

    it("should handle createTab failure gracefully", async () => {
      const client = createMockClient();
      client.createTab.mockRejectedValue(new Error("connection refused"));
      const state = createMockState();
      const svc = new CookieRotationService(client, state, config);

      const result = await svc.rotateOnce(0);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("connection refused");
    });

    it("should skip rotation when account has no active session", async () => {
      const client = createMockClient();
      const state = createMockState();
      state.getAccount.mockReturnValue({ accountIndex: 3, session: null, camofoxUserId: "test-acct3" });
      const svc = new CookieRotationService(client, state, config);

      const result = await svc.rotateOnce(3);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("No active session for account 3");
      expect(client.createTab).not.toHaveBeenCalled();
    });
  });

  describe("startRotation/stopRotation", () => {
    it("should not allow double-start", () => {
      const svc = new CookieRotationService(createMockClient(), createMockState(), config);
      svc.startRotation(1);
      svc.startRotation(1);
      expect(svc.isRunning(1)).toBe(true);
      svc.stopRotation(1);
    });

    it("should stop cleanly", () => {
      const svc = new CookieRotationService(createMockClient(), createMockState(), config);
      svc.startRotation(1);
      svc.stopRotation(1);
      expect(svc.isRunning(1)).toBe(false);
    });

    it("should support pause and resume without clearing timer", () => {
      const svc = new CookieRotationService(createMockClient(), createMockState(), config);
      svc.startRotation(1);
      svc.pauseRotation(1);
      expect(svc.isRunning(1)).toBe(true);
      svc.resumeRotation(1);
      svc.stopAll();
      expect(svc.isRunning(1)).toBe(false);
    });

    it("should pause and resume per account independently", () => {
      const svc = new CookieRotationService(createMockClient(), createMockState(), config);
      svc.startRotation(0);
      svc.startRotation(1);

      svc.pauseRotation(0);
      expect(svc.isRunning(0)).toBe(true);
      expect(svc.isRunning(1)).toBe(true);

      svc.resumeRotation(0);
      svc.stopRotation(0);
      expect(svc.isRunning(1)).toBe(true);

      svc.stopRotation(1);
      expect(svc.isRunning(1)).toBe(false);
    });

    it("should stopAll and clear all active timers", () => {
      const svc = new CookieRotationService(createMockClient(), createMockState(), config);
      svc.startRotation(0);
      svc.startRotation(1);
      svc.startRotation(2);

      expect(svc.isRunning(0)).toBe(true);
      expect(svc.isRunning(1)).toBe(true);
      expect(svc.isRunning(2)).toBe(true);

      svc.stopAll();

      expect(svc.isRunning(0)).toBe(false);
      expect(svc.isRunning(1)).toBe(false);
      expect(svc.isRunning(2)).toBe(false);
    });

    it("should skip rotateOnce when account session is null", async () => {
      const state = createMockState();
      state.getAccount.mockReturnValue({ accountIndex: 4, session: null, camofoxUserId: "test-acct4" });
      const client = createMockClient();
      const svc = new CookieRotationService(client, state, config);

      const result = await svc.rotateOnce(4);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("No active session for account 4");
      expect(client.createTab).not.toHaveBeenCalled();
    });
  });
});
