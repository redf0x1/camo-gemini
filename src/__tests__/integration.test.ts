import { afterEach, describe, expect, it, vi } from "vitest";

import { formatFriendlyError } from "../core/error-messages.js";
import { withFailover } from "../core/failover.js";
import { AccountService } from "../services/account.js";

import { HealthService } from "../services/health.js";
import { StateManager } from "../state.js";
import { createServer } from "../server.js";
import type { Config, GenerateOptions, GenerateResult, GeminiSession, ModelOutput } from "../types.js";

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

function createChatBoundaryFixture() {
  const app = createServer(config);
  for (const index of [0, 1]) {
    app.state.addAccount(index, `camo-gemini-test-acct${index}`);
    app.state.setSession(index, createSession(index));
  }
  const closeTab = vi.spyOn(app.client, "closeTab").mockResolvedValue(undefined);
  const generation = vi.spyOn(app.deps.generate as unknown as {
    generateForAccount: (options: GenerateOptions, accountIndex: number) => Promise<GenerateResult>;
  }, "generateForAccount");
  return { app, closeTab, generation };
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
    const { app, generation } = createChatBoundaryFixture();
    generation.mockImplementation(async (_options, accountIndex) => {
      if (accountIndex === 0) throw Object.assign(new Error("rate limited"), { code: "RATE_LIMITED" });
      return { output: createOutput("one-shot fallback"), rawFrameCount: 1 };
    });
    try {
      await expect(app.deps.chat.chat("s1", "chat", { accountIndex: 0 })).rejects.toThrow("rate limited");
      expect(generation.mock.calls.map(([, index]) => index)).toEqual([0]);
      expect(app.deps.chat.getSession("s1")).toBeUndefined();
      // Exercise the actual GenerateService/withFailover path, not a mock generate().
      const result = await app.deps.generate.generate({ prompt: "one-shot", accountIndex: 0 });
      expect(result.output.candidates[0]?.text).toBe("one-shot fallback");
      expect(generation.mock.calls.map(([, index]) => index)).toEqual([0, 0, 1]);
    } finally { app.shutdown(); }
  });

  it("actual logout fences pending and queued chat for its pinned account", async () => {
    const { app, generation, closeTab } = createChatBoundaryFixture();
    let resolve!: (value: GenerateResult) => void;
    const held = new Promise<GenerateResult>(done => { resolve = done; });
    generation.mockImplementation(() => held);
    try {
      const active = app.deps.chat.chat("logout-pending", "active", { accountIndex: 1 });
      await vi.waitFor(() => expect(generation).toHaveBeenCalledTimes(1));
      const queued = app.deps.chat.chat("logout-pending", "queued");
      const canceled = expect(queued).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
      await app.deps.auth.logout(1);
      expect(closeTab).toHaveBeenCalledWith("tab-1", "camo-gemini-test-acct1");
      resolve({ output: createOutput("late account-1 result"), rawFrameCount: 1 });
      await active;
      await canceled;
      expect(generation).toHaveBeenCalledTimes(1);
      expect(app.deps.chat.getSession("logout-pending")).toBeUndefined();
      expect(app.state.getSession(1)).toBeNull();
    } finally { app.shutdown(); }
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
