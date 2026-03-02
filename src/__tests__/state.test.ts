import { describe, expect, it } from "vitest";

import { StateManager } from "../state.js";

function createSession(accountIndex = 0) {
  return {
    tabId: `tab-${accountIndex}`,
    userId: `user-${accountIndex}`,
    accountIndex,
    authenticated: true,
    tokens: { snlm0e: "", cfb2h: "x", fdrfje: "y", extractedAt: Date.now() },
    lastRotation: Date.now()
  };
}

describe("StateManager", () => {
  it("should start with no session", () => {
    const sm = new StateManager();
    expect(sm.getSession()).toBeNull();
    expect(sm.isAuthenticated()).toBe(false);
  });

  it("should set and get session (legacy signature)", () => {
    const sm = new StateManager();
    sm.setSession(createSession(0));
    expect(sm.isAuthenticated()).toBe(true);
    expect(sm.getTabId()).toBe("tab-0");
  });

  it("should clear session without clearing chats", () => {
    const sm = new StateManager();
    sm.setSession({ ...createSession(0), tokens: null, lastRotation: 0 });
    sm.setChat("conv1", { conversationId: "conv1", responseId: "r1", choiceId: "c1", model: "pro" });

    sm.clearSession();
    expect(sm.getSession()).toBeNull();
    expect(sm.getChat("conv1")).toBeDefined();
  });

  it("should update tokens", () => {
    const sm = new StateManager();
    sm.setSession({ ...createSession(0), tokens: null, lastRotation: 0 });

    const tokens = { snlm0e: "", cfb2h: "new", fdrfje: "new", extractedAt: Date.now() };
    sm.updateTokens(tokens);
    expect(sm.getSession()?.tokens).toEqual(tokens);
  });

  it("should track rotation", () => {
    const sm = new StateManager();
    sm.setSession({ ...createSession(0), tokens: null, lastRotation: 0 });

    expect(sm.isRotationOverdue()).toBe(true);
    sm.recordRotation();
    expect(sm.isRotationOverdue()).toBe(false);
  });

  it("should manage chats", () => {
    const sm = new StateManager();
    sm.setChat("c1", { conversationId: "c1", responseId: "r1", choiceId: "ch1", model: "pro" });
    expect(sm.getChat("c1")).toBeDefined();
    expect(sm.listChats()).toHaveLength(1);
    expect(sm.deleteChat("c1")).toBe(true);
    expect(sm.listChats()).toHaveLength(0);
  });

  it("should add, get, list and remove accounts", () => {
    const sm = new StateManager();

    const account = sm.addAccount(0, "camo-gemini-acct0");
    expect(account.accountIndex).toBe(0);
    expect(sm.hasAccount(0)).toBe(true);
    expect(sm.getAccount(0)?.camofoxUserId).toBe("camo-gemini-acct0");

    sm.addAccount(1, "camo-gemini-acct1");
    expect(sm.getAllAccounts()).toHaveLength(2);

    expect(sm.removeAccount(1)).toBe(true);
    expect(sm.hasAccount(1)).toBe(false);
  });

  it("should set and get active account", () => {
    const sm = new StateManager();
    sm.addAccount(0, "camo-gemini-acct0");
    sm.addAccount(1, "camo-gemini-acct1");

    sm.setActiveAccount(1);
    expect(sm.activeAccountIndex).toBe(1);
    expect(sm.getActiveAccount()?.accountIndex).toBe(1);
  });

  it("should throw when setting active account not registered", () => {
    const sm = new StateManager();
    expect(() => sm.setActiveAccount(9)).toThrow("Account 9 not registered");
  });

  it("should set/get sessions per account", () => {
    const sm = new StateManager();
    sm.addAccount(0, "camo-gemini-acct0");
    sm.addAccount(1, "camo-gemini-acct1");

    sm.setSession(0, createSession(0));
    sm.setSession(1, createSession(1));

    expect(sm.getSession(0)?.userId).toBe("user-0");
    expect(sm.getSession(1)?.userId).toBe("user-1");
    expect(sm.activeAccountIndex).toBe(1);
  });

  it("should track health transitions from errors and success", () => {
    const sm = new StateManager();
    sm.addAccount(0, "camo-gemini-acct0");
    sm.setSession(0, createSession(0));

    sm.recordError(0);
    expect(sm.getAccount(0)?.health).toBe("healthy");

    sm.recordError(0);
    expect(sm.getAccount(0)?.health).toBe("degraded");

    sm.recordError(0);
    sm.recordError(0);
    sm.recordError(0);
    expect(sm.getAccount(0)?.health).toBe("cooldown");
    expect((sm.getAccount(0)?.cooldownUntil ?? 0) > Date.now()).toBe(true);

    sm.recordSuccess(0);
    expect(sm.getAccount(0)?.consecutiveErrors).toBe(0);
  });

  it("should return healthy accounts and next healthy account", () => {
    const sm = new StateManager();
    sm.addAccount(0, "camo-gemini-acct0");
    sm.addAccount(1, "camo-gemini-acct1");
    sm.addAccount(2, "camo-gemini-acct2");

    sm.setSession(0, createSession(0));
    sm.setSession(1, createSession(1));
    sm.setSession(2, createSession(2));

    sm.setHealth(1, "degraded");
    sm.setHealth(2, "cooldown");
    const account2 = sm.getAccount(2);
    if (account2) {
      account2.cooldownUntil = Date.now() - 1000;
    }

    const healthy = sm.getHealthyAccounts();
    expect(healthy.map((a) => a.accountIndex).sort()).toEqual([0, 1, 2]);

    const next = sm.getNextHealthyAccount(0);
    expect(next).toBeDefined();
    expect(next?.accountIndex).not.toBe(0);
  });

  it("should support backward-compat session property and auto-create account 0", () => {
    const sm = new StateManager();
    const session = createSession(0);

    sm.session = session;

    expect(sm.hasAccount(0)).toBe(true);
    expect(sm.activeAccountIndex).toBe(0);
    expect(sm.session?.tabId).toBe("tab-0");
  });
});
