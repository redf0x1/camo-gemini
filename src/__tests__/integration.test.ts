import { afterEach, describe, expect, it, vi } from "vitest";

import { formatFriendlyError } from "../core/error-messages.js";
import { withFailover } from "../core/failover.js";
import { AccountService } from "../services/account.js";
import { ChatService } from "../services/chat.js";
import { HealthService } from "../services/health.js";
import { StateManager } from "../state.js";
import type { Config, GeminiSession, ModelOutput } from "../types.js";

const config: Config = {
  camofoxUrl: "http://localhost:9377",
  userId: "camo-gemini-test",
  requestTimeout: 30_000,
  dashboardEnabled: false,
  dashboardPort: 3123,
  AUTO_DELETE_CHAT: true
};

function createSession(accountIndex: number): GeminiSession {
  return {
    tabId: `tab-${accountIndex}`,
    userId: `camo-gemini-test-acct${accountIndex}`,
    accountIndex,
    authenticated: true,
    tokens: {
      snlm0e: "",
      cfb2h: "build-label",
      fdrfje: "session-id",
      extractedAt: Date.now()
    },
    lastRotation: Date.now()
  };
}

function createOutput(text: string): ModelOutput {
  return {
    metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx-1"],
    candidates: [
      {
        rcid: "rcid-1",
        text,
        thoughts: null,
        webImages: [],
        generatedImages: [],
        isFinal: true
      }
    ],
    chosenIndex: 0,
    isCompleted: true
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Multi-Account Integration", () => {
  it("should add multiple accounts and list them", async () => {
    const state = new StateManager();
    const auth = {
      login: vi.fn(async (accountIndex: number) => {
        const session = createSession(accountIndex);
        state.setSession(accountIndex, session);
        return session;
      }),
      logout: vi.fn(async (_accountIndex?: number) => undefined)
    } as any;

    const service = new AccountService(auth, state, config);

    await service.addAccount(0);
    await service.addAccount(1);
    const list = service.listAccounts();

    expect(list).toHaveLength(2);
    expect(list.map((entry) => entry.accountIndex).sort()).toEqual([0, 1]);
  });

  it("should switch active account", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-test-acct0");
    state.addAccount(1, "camo-gemini-test-acct1");

    const service = new AccountService({} as any, state, config);
    const switched = service.switchAccount(1);

    expect(switched.accountIndex).toBe(1);
    expect(switched.isActive).toBe(true);
    expect(state.activeAccountIndex).toBe(1);
  });

  it("should remove account and clean up", async () => {
    const state = new StateManager();
    state.addAccount(2, "camo-gemini-test-acct2");
    state.setSession(2, createSession(2));

    const auth = {
      login: vi.fn(),
      logout: vi.fn(async (accountIndex?: number) => {
        state.clearSession(accountIndex);
      })
    } as any;

    const service = new AccountService(auth, state, config);
    await service.removeAccount(2);

    expect(auth.logout).toHaveBeenCalledWith(2);
    expect(state.hasAccount(2)).toBe(false);
  });

  it("should report correct health for multiple accounts", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-test-acct0");
    state.addAccount(1, "camo-gemini-test-acct1");
    state.setSession(0, createSession(0));
    state.setSession(1, createSession(1));
    state.setHealth(1, "degraded");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const health = new HealthService({} as any, state, config);
    const result = await health.checkAllAccounts();

    expect(result.totalAccounts).toBe(2);
    expect(result.healthyAccounts).toBe(2);
    expect(result.overall).toBe("healthy");
    expect(result.accounts.some((entry) => entry.health === "degraded")).toBe(true);
  });
});

describe("Failover Integration", () => {
  it("should failover generate to next account on error", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-test-acct0");
    state.addAccount(1, "camo-gemini-test-acct1");
    state.setSession(0, createSession(0));
    state.setSession(1, createSession(1));

    const calls: number[] = [];
    const result = await withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      calls.push(accountIndex);
      if (accountIndex === 0) {
        const error = new Error("rate limited") as Error & { code?: string };
        error.code = "RATE_LIMITED";
        throw error;
      }
      return { text: "ok" };
    });

    expect(result.result.text).toBe("ok");
    expect(result.usedAccountIndex).toBe(1);
    expect(result.failoverCount).toBe(1);
    expect(calls).toEqual([0, 1]);
  });

  it("should record error and success on accounts", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-test-acct0");
    state.addAccount(1, "camo-gemini-test-acct1");
    state.setSession(0, createSession(0));
    state.setSession(1, createSession(1));

    await withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      if (accountIndex === 0) {
        const error = new Error("temporary") as Error & { code?: string };
        error.code = "TEMPORARY_ERROR";
        throw error;
      }
      return true;
    });

    expect((state.getAccount(0)?.consecutiveErrors ?? 0) > 0).toBe(true);
    expect(state.getAccount(1)?.consecutiveErrors).toBe(0);
    expect((state.getAccount(1)?.lastSuccessAt ?? 0) > 0).toBe(true);
  });

  it("should not failover chat operations", async () => {
    const generate = {
      generate: vi.fn(async () => {
        const error = new Error("rate limited") as Error & { code?: string };
        error.code = "RATE_LIMITED";
        throw error;
      }),
      resetReqId: vi.fn()
    } as any;

    const chat = new ChatService(generate);

    await expect(chat.chat("s1", "hello", { accountIndex: 0 })).rejects.toThrow("rate limited");
    expect(generate.generate).toHaveBeenCalledTimes(1);
    expect(generate.generate).toHaveBeenCalledWith(
      expect.objectContaining({ accountIndex: 0, prompt: "hello" })
    );
  });
});

describe("Error Message Integration", () => {
  it("should return friendly error for auth failure", () => {
    const text = formatFriendlyError(new Error("No active session for account 0"));

    expect(text).toContain("No active Gemini session");
    expect(text).toContain("gemini_login");
  });

  it("should return friendly error for CamoFox unreachable", () => {
    const text = formatFriendlyError(new Error("connect ECONNREFUSED 127.0.0.1:9377"));

    expect(text).toContain("Cannot connect to CamoFox browser");
    expect(text).toContain("npm start");
  });

  it("should return friendly error for rate limit", () => {
    const text = formatFriendlyError(new Error("429 too many requests"));

    expect(text).toContain("Gemini rate limit reached");
    expect(text).toContain("different account");
  });
});
