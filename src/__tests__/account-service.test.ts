import { describe, expect, it, vi } from "vitest";

import { AccountService } from "../services/account.js";
import { StateManager } from "../state.js";

const config = {
  camofoxUrl: "http://localhost:9377",
  userId: "test",
  requestTimeout: 30_000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

function createSession(accountIndex: number) {
  return {
    tabId: `tab-${accountIndex}`,
    userId: `test-acct${accountIndex}`,
    accountIndex,
    authenticated: true,
    tokens: { snlm0e: "", cfb2h: "build123", fdrfje: "session456", extractedAt: Date.now() },
    lastRotation: Date.now()
  };
}

describe("AccountService", () => {
  it("addAccount registers and logs in account", async () => {
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
    const info = await service.addAccount(1);

    expect(auth.login).toHaveBeenCalledWith(1);
    expect(info.accountIndex).toBe(1);
    expect(info.isLoggedIn).toBe(true);
    expect(info.isActive).toBe(true);
  });

  it("listAccounts returns account infos", () => {
    const state = new StateManager();
    state.addAccount(0, "test-acct0");
    state.addAccount(1, "test-acct1");
    state.setSession(0, createSession(0));

    const service = new AccountService({} as any, state, config);
    const list = service.listAccounts();

    expect(list).toHaveLength(2);
    expect(list.map((entry) => entry.accountIndex).sort()).toEqual([0, 1]);
  });

  it("switchAccount changes active account", () => {
    const state = new StateManager();
    state.addAccount(0, "test-acct0");
    state.addAccount(1, "test-acct1");

    const service = new AccountService({} as any, state, config);
    const info = service.switchAccount(1);

    expect(state.activeAccountIndex).toBe(1);
    expect(info.isActive).toBe(true);
  });

  it("removeAccount logs out and removes account", async () => {
    const state = new StateManager();
    state.addAccount(2, "test-acct2");
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

  it("getAccountInfo throws for unknown account", () => {
    const service = new AccountService({} as any, new StateManager(), config);
    expect(() => service.getAccountInfo(99)).toThrow("Account 99 not registered");
  });
});
