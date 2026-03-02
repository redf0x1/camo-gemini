import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthService } from "../services/health.js";
import { StateManager } from "../state.js";
import type { Config, GeminiSession } from "../types.js";

const config: Config = {
  camofoxUrl: "http://localhost:9377",
  userId: "camo-gemini",
  requestTimeout: 30_000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

function createSession(accountIndex: number): GeminiSession {
  return {
    tabId: `tab-${accountIndex}`,
    userId: `camo-gemini-acct${accountIndex}`,
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

function createService(state: StateManager): HealthService {
  const client = {} as any;
  return new HealthService(client, state, config);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HealthService", () => {
  it("returns offline when no accounts exist", async () => {
    const state = new StateManager();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const service = createService(state);
    const result = await service.checkAllAccounts();

    expect(result.overall).toBe("offline");
    expect(result.totalAccounts).toBe(0);
    expect(result.healthyAccounts).toBe(0);
    expect(result.accounts).toEqual([]);
    expect(result.activeAccountIndex).toBeNull();
    expect(result.camofoxConnected).toBe(true);
  });

  it("returns healthy for one logged-in healthy account", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-acct0");
    state.setSession(0, createSession(0));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const service = createService(state);
    const result = await service.checkAllAccounts();

    expect(result.overall).toBe("healthy");
    expect(result.totalAccounts).toBe(1);
    expect(result.healthyAccounts).toBe(1);
    expect(result.accounts[0]).toMatchObject({
      accountIndex: 0,
      health: "healthy",
      isLoggedIn: true,
      isActive: true
    });
  });

  it("returns degraded for mixed healthy/degraded/cooldown accounts", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-acct0");
    state.addAccount(1, "camo-gemini-acct1");
    state.addAccount(2, "camo-gemini-acct2");
    state.setSession(0, createSession(0));
    state.setSession(1, createSession(1));
    state.setSession(2, createSession(2));
    state.setHealth(1, "degraded");
    state.setHealth(2, "cooldown");
    const account2 = state.getAccount(2);
    if (account2) {
      account2.cooldownUntil = Date.now() + 60_000;
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const service = createService(state);
    const result = await service.checkAllAccounts();

    expect(result.overall).toBe("degraded");
    expect(result.totalAccounts).toBe(3);
    expect(result.healthyAccounts).toBe(2);
    expect(result.camofoxConnected).toBe(false);
  });

  it("expires cooldown into degraded when cooldownUntil has passed", async () => {
    const state = new StateManager();
    state.addAccount(0, "camo-gemini-acct0");
    state.setSession(0, createSession(0));
    state.setHealth(0, "cooldown");
    const account = state.getAccount(0);
    if (account) {
      account.cooldownUntil = Date.now() - 1;
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const service = createService(state);
    const result = await service.checkAllAccounts();

    expect(state.getAccount(0)?.health).toBe("degraded");
    expect(result.accounts[0]?.health).toBe("degraded");
  });
});
