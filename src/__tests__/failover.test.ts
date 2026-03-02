import { describe, expect, it } from "vitest";

import { withFailover } from "../core/failover.js";
import { RetryExhaustedError } from "../errors.js";
import { StateManager } from "../state.js";
import type { GeminiSession } from "../types.js";

function createSession(accountIndex: number): GeminiSession {
  return {
    tabId: `tab-${accountIndex}`,
    userId: `user-${accountIndex}`,
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

function addLoggedInAccount(state: StateManager, accountIndex: number): void {
  state.addAccount(accountIndex, `user-${accountIndex}`);
  state.setSession(accountIndex, createSession(accountIndex));
}

describe("withFailover", () => {
  it("succeeds on the first account", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);

    const result = await withFailover(state, { accountIndex: 0 }, async () => "ok");

    expect(result.result).toBe("ok");
    expect(result.usedAccountIndex).toBe(0);
    expect(result.failoverCount).toBe(0);
  });

  it("fails over once and succeeds on next healthy account", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);
    addLoggedInAccount(state, 1);

    const calls: number[] = [];
    const result = await withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      calls.push(accountIndex);
      if (accountIndex === 0) {
        const error = new Error("rate limited") as Error & { code?: string };
        error.code = "RATE_LIMITED";
        throw error;
      }
      return "ok";
    });

    expect(result.result).toBe("ok");
    expect(result.usedAccountIndex).toBe(1);
    expect(result.failoverCount).toBe(1);
    expect(calls).toEqual([0, 1]);
  });

  it("throws when failover options are exhausted", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);
    addLoggedInAccount(state, 1);

    const calls: number[] = [];
    await expect(withFailover(state, { accountIndex: 0, maxFailovers: 2 }, async (accountIndex) => {
      calls.push(accountIndex);
      const error = new Error("temporary") as Error & { code?: string };
      error.code = "TEMPORARY_ERROR";
      throw error;
    })).rejects.toThrow("temporary");

    expect(calls).toEqual([0, 1]);
  });

  it("does not failover on fatal errors", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);
    addLoggedInAccount(state, 1);

    const calls: number[] = [];
    await expect(withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      calls.push(accountIndex);
      const error = new Error("parse error") as Error & { code?: string };
      error.code = "PARSE_ERROR";
      throw error;
    })).rejects.toThrow("parse error");

    expect(calls).toEqual([0]);
  });

  it("does not failover when only one account exists", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);

    const calls: number[] = [];
    await expect(withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      calls.push(accountIndex);
      const error = new Error("temporary") as Error & { code?: string };
      error.code = "TEMPORARY_ERROR";
      throw error;
    })).rejects.toThrow("temporary");

    expect(calls).toEqual([0]);
  });

  it("should failover after RetryExhaustedError", async () => {
    const state = new StateManager();
    addLoggedInAccount(state, 0);
    addLoggedInAccount(state, 1);

    const calls: number[] = [];
    const result = await withFailover(state, { accountIndex: 0 }, async (accountIndex) => {
      calls.push(accountIndex);
      if (accountIndex === 0) {
        throw new RetryExhaustedError(3, new Error("temporary"));
      }
      return "ok";
    });

    expect(result.result).toBe("ok");
    expect(result.usedAccountIndex).toBe(1);
    expect(result.failoverCount).toBe(1);
    expect(calls).toEqual([0, 1]);
  });
});
