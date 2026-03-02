import { afterEach, describe, expect, it, vi } from "vitest";

import { GrpcId } from "../core/constants.js";
import { GemsService } from "../services/gems.js";
import { StateManager } from "../state.js";
import type { BrowserFetchResult } from "../types.js";

const config = {
  camofoxUrl: "http://localhost:9377",
  userId: "test-user",
  requestTimeout: 30_000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

const tokens = {
  snlm0e: "",
  cfb2h: "build-label",
  fdrfje: "session-id",
  extractedAt: Date.now()
};

const session = {
  tabId: "tab-1",
  userId: "test-user",
  accountIndex: 0,
  authenticated: true,
  tokens,
  lastRotation: Date.now()
};

function createBatchResponse(rpcId: string, payload: unknown): BrowserFetchResult {
  const frame: unknown[] = [];
  frame[1] = rpcId;
  frame[2] = JSON.stringify(payload);

  return {
    ok: true,
    data: JSON.stringify([frame])
  };
}

function createDeps() {
  const state = new StateManager();
  state.addAccount(0, "test-user");

  return {
    client: {
      evaluateExtended: vi.fn()
    } as any,
    auth: {
      ensureSession: vi.fn().mockResolvedValue(session),
      getTokens: vi.fn().mockResolvedValue(tokens)
    } as any,
    config,
    state
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GemsService", () => {
  it("listGems merges system and custom results", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended
      .mockResolvedValueOnce({
        ok: true,
        result: createBatchResponse(GrpcId.LIST_GEMS, [
          null,
          null,
          [["system-1", ["System Gem", "System desc"], ["System instructions"]]]
        ])
      })
      .mockResolvedValueOnce({
        ok: true,
        result: createBatchResponse(GrpcId.LIST_GEMS, [
          null,
          null,
          [["custom-1", ["Custom Gem", "Custom desc"], ["Custom instructions"]]]
        ])
      });

    const service = new GemsService(deps);
    const result = await service.listGems({ accountIndex: 1 });

    expect(result).toEqual([
      {
        id: "system-1",
        name: "System Gem",
        description: "System desc",
        instructions: "System instructions",
        isSystem: true
      },
      {
        id: "custom-1",
        name: "Custom Gem",
        description: "Custom desc",
        instructions: "Custom instructions",
        isSystem: false
      }
    ]);
    expect(deps.auth.ensureSession).toHaveBeenCalledWith(1);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(1);
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(2);
  });

  it("createGem returns parsed created gem", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({
      ok: true,
      result: createBatchResponse(GrpcId.CREATE_GEM, ["gem-created", ["Writer", "Writing helper"], ["Be concise"]])
    });

    const service = new GemsService(deps);
    const result = await service.createGem({
      name: "Writer",
      description: "Writing helper",
      instructions: "Be concise"
    });

    expect(result).toEqual({
      id: "gem-created",
      name: "Writer",
      description: "Writing helper",
      instructions: "Be concise",
      isSystem: false
    });
  });

  it("updateGem falls back to provided values when response has no gem details", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({
      ok: true,
      result: createBatchResponse(GrpcId.UPDATE_GEM, [])
    });

    const service = new GemsService(deps);
    const result = await service.updateGem({
      gemId: "gem-1",
      name: "Updated",
      description: "Updated desc",
      instructions: "Updated instructions"
    });

    expect(result).toEqual({
      id: "gem-1",
      name: "Updated",
      description: "Updated desc",
      instructions: "Updated instructions",
      isSystem: false
    });
  });

  it("deleteGem executes delete batch request", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({
      ok: true,
      result: createBatchResponse(GrpcId.DELETE_GEM, [true])
    });

    const service = new GemsService(deps);
    await expect(service.deleteGem("gem-1", 2)).resolves.toBeUndefined();

    expect(deps.auth.ensureSession).toHaveBeenCalledWith(2);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(2);
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
  });

  it("maps paid-tier failures to a friendly gems subscription error", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({
      ok: true,
      result: { ok: false, error: "403 Gemini Advanced subscription required" }
    });

    const service = new GemsService(deps);
    await expect(service.listGems()).rejects.toThrow("Gems require a paid Gemini subscription for this account");
  });

  it("retries transient timeout errors and then succeeds", async () => {
    vi.useFakeTimers();

    const deps = createDeps();
    deps.client.evaluateExtended
      .mockRejectedValueOnce(new Error("request timeout"))
      .mockResolvedValueOnce({
        ok: true,
        result: createBatchResponse(GrpcId.CREATE_GEM, ["gem-created", ["Writer", "Desc"], ["Prompt"]])
      });

    const service = new GemsService(deps);
    const promise = service.createGem({
      name: "Writer",
      description: "Desc",
      instructions: "Prompt"
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.id).toBe("gem-created");
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(2);
  });
});
