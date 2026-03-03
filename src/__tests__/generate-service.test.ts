import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GenerateService } from "../services/generate.js";
import { RequestBuilder } from "../core/request-builder.js";
import { ResponseParser } from "../core/response-parser.js";
import { StreamParser } from "../core/stream-parser.js";
import { StateManager } from "../state.js";
import type { BrowserFetchResult, ModelOutput } from "../types.js";

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

const modelOutput: ModelOutput = {
  metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
  candidates: [
    {
      rcid: "rcid-1",
      text: "Hello from Gemini",
      thoughts: null,
      webImages: [],
      generatedImages: [],
      isFinal: true
    }
  ],
  chosenIndex: 0,
  isCompleted: true
};

function createGeminiRawBody(text: string): string {
  const candidate: unknown[] = [];
  candidate[0] = "rcid-1";
  candidate[1] = [text];
  candidate[2] = { done: true };
  candidate[8] = [2];

  const inner: unknown[] = [];
  inner[1] = ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"];
  inner[4] = [candidate];
  inner[25] = "ctx";

  const part: unknown[] = [];
  part[2] = JSON.stringify(inner);

  return JSON.stringify([part]);
}

function createGeminiImageRawBody(text: string, imageUrl: string): string {
  const generatedImageItem: unknown[] = [];
  generatedImageItem[0] = [null, null, null, imageUrl];
  generatedImageItem[3] = [null, null, null, null, null, ["generated alt"]];

  const candidate: unknown[] = [];
  candidate[0] = "rcid-1";
  candidate[1] = [text];
  candidate[2] = { done: true };
  candidate[8] = [2];
  candidate[12] = [null, null, null, null, null, null, null, [[generatedImageItem]]];

  const inner: unknown[] = [];
  inner[1] = ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"];
  inner[4] = [candidate];
  inner[25] = "ctx";

  const part: unknown[] = [];
  part[2] = JSON.stringify(inner);

  return JSON.stringify([part]);
}

function createBatchRawBody(rpcId: string, payload: unknown): string {
  const frame: unknown[] = [];
  frame[1] = rpcId;
  frame[2] = JSON.stringify(payload);
  return JSON.stringify([frame]);
}

function createDeps() {
  const state = new StateManager();
  state.addAccount(0, "test-user");

  return {
    client: {
      createTab: vi.fn().mockResolvedValue({ tabId: "download-tab-1", url: "", title: "" }),
      navigate: vi.fn().mockResolvedValue({ tabId: "download-tab-1", url: "https://lh3.googleusercontent.com/gg-dl/test-image", title: "" }),
      evaluate: vi.fn().mockResolvedValue({ ok: true, result: { ct: "image/png", body: "" } }),
      closeTab: vi.fn().mockResolvedValue(undefined),
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
  vi.unstubAllGlobals();
});

describe("GenerateService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("successful generation returns parsed ModelOutput", async () => {
    const deps = createDeps();
    const fetchResult: BrowserFetchResult = { ok: true, data: createGeminiRawBody("Hello from Gemini") };
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: fetchResult });

    const service = new GenerateService(deps);
    const result = await service.generate({ prompt: "Hi", model: "flash" });

    expect(result.output.candidates[0]?.text).toBe("Hello from Gemini");
    expect(result.output.isCompleted).toBe(true);
    expect(result.rawFrameCount).toBeGreaterThan(0);
    expect(deps.auth.ensureSession).toHaveBeenCalledWith(0);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(0);
    expect(deps.client.evaluateExtended).toHaveBeenCalledWith("tab-1", expect.any(String), "test-user", 120_000);
  });

  it("auth failure propagates", async () => {
    const deps = createDeps();
    deps.auth.ensureSession.mockRejectedValue(new Error("auth failed"));

    const service = new GenerateService(deps);
    await expect(service.generate({ prompt: "Hi" })).rejects.toThrow("auth failed");
    expect(deps.client.evaluateExtended).not.toHaveBeenCalled();
  });

  it("browser evaluate failure throws", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: false, error: "js_error" });

    const service = new GenerateService(deps);
    await expect(service.generate({ prompt: "Hi" })).rejects.toThrow("Evaluate failed: js_error");
  });

  it("gemini fetch failure throws", async () => {
    const deps = createDeps();
    const fetchResult: BrowserFetchResult = { ok: false, error: "StreamGenerate failed: 500" };
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: fetchResult });

    const service = new GenerateService(deps);
    await expect(service.generate({ prompt: "Hi" })).rejects.toThrow("Gemini fetch failed: StreamGenerate failed: 500");
  });

  it("parse failure throws and preserves parseErrorCode", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "[]" } });

    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: false,
      error: {
        code: "PARSE_ERROR",
        message: "No candidates found in response"
      }
    });

    const service = new GenerateService(deps);

    try {
      await service.generate({ prompt: "Hi" });
      throw new Error("Expected generate to throw");
    } catch (error) {
      const typed = error as Error & { parseErrorCode?: string };
      expect(typed.message).toBe("No candidates found in response");
      expect(typed.parseErrorCode).toBe("PARSE_ERROR");
    }
  });

  it("retries on retryable error then succeeds", async () => {
    vi.useFakeTimers();

    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "frame-data" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse")
      .mockReturnValueOnce({
        ok: false,
        error: {
          code: "TEMPORARY_ERROR",
          message: "Temporary Gemini error"
        }
      })
      .mockReturnValueOnce({ ok: true, data: modelOutput });

    const service = new GenerateService(deps);
    const promise = service.generate({ prompt: "Hi" });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.output).toEqual(modelOutput);
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(2);
  });

  it("does not retry fatal IP_BLOCKED errors", async () => {
    vi.useFakeTimers();

    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "frame-data" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: false,
      error: {
        code: "IP_BLOCKED",
        message: "IP is temporarily blocked"
      }
    });

    const service = new GenerateService(deps);

    await expect(service.generate({ prompt: "Hi" })).rejects.toThrow("IP is temporarily blocked");
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
  });

  it("calls RequestBuilder methods with expected arguments", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: createGeminiRawBody("ok") } });

    const bardSpy = vi.spyOn(RequestBuilder.prototype, "buildBardActivityPayload");
    const genSpy = vi.spyOn(RequestBuilder.prototype, "buildGeneratePayload");

    const service = new GenerateService(deps);
    await service.generate({
      prompt: "Hi",
      model: "flash",
      accountIndex: 1,
      gemId: "gem-1",
      chatMetadata: ["cid", "rid", "rcid", null, null, null, null, null, null, "ctx"],
      images: [{ url: "https://example.com/a.png", filename: "a.png" }]
    });

    expect(bardSpy).toHaveBeenCalledWith(tokens, 1);
    expect(genSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hi",
        model: "flash",
        gemId: "gem-1",
        images: [{ url: "https://example.com/a.png" }]
      }),
      tokens,
      1,
      ["cid", "rid", "rcid", null, null, null, null, null, null, "ctx"]
    );
  });

  it("generateImage calls image payload path with usePro and returns generated images", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "frame-data" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: true,
      data: {
        metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
        candidates: [
          {
            rcid: "rcid-1",
            text: "Here is your image",
            thoughts: null,
            webImages: [],
            generatedImages: [{ url: "https://img.test/generated.png", alt: "generated alt", title: "generated" }],
            isFinal: true
          }
        ],
        chosenIndex: 0,
        isCompleted: true
      }
    });

    const imageSpy = vi.spyOn(RequestBuilder.prototype, "buildImageGeneratePayload");
    const standardSpy = vi.spyOn(RequestBuilder.prototype, "buildGeneratePayload");

    const service = new GenerateService(deps);
    const result = await service.generateImage("draw a fox", { model: "pro", accountIndex: 1 });

    expect(imageSpy).toHaveBeenCalled();
    expect(standardSpy).not.toHaveBeenCalled();
    expect(result.generatedImages).toEqual([
      {
        url: "https://img.test/generated.png",
        title: "generated",
        alt: "generated alt",
        description: "generated alt"
      }
    ]);
    expect(deps.auth.ensureSession).toHaveBeenCalledWith(1);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(1);
  });

  it("generateImage downloads googleusercontent images and enriches response with base64", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data" } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          ok: true,
          base64: "ZmFrZS1iYXNlNjQ=",
          mimeType: "image/png",
          size: 1024
        }
      });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: true,
      data: {
        metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
        candidates: [
          {
            rcid: "rcid-1",
            text: "Here is your image",
            thoughts: null,
            webImages: [],
            generatedImages: [{ url: "https://lh3.googleusercontent.com/gg-dl/test-image", alt: "generated alt", title: "generated" }],
            isFinal: true
          }
        ],
        chosenIndex: 0,
        isCompleted: true
      }
    });

    const service = new GenerateService(deps);
    const result = await service.generateImage("draw a fox", { model: "pro", accountIndex: 1 });

    expect(result.generatedImages).toEqual([
      {
        url: "https://lh3.googleusercontent.com/gg-dl/test-image",
        title: "generated",
        alt: "generated alt",
        description: "generated alt",
        base64: "ZmFrZS1iYXNlNjQ=",
        mimeType: "image/png"
      }
    ]);

    expect(deps.client.createTab).toHaveBeenCalledWith("about:blank", "test-user", "image-download");
    expect(deps.client.navigate).toHaveBeenCalledWith("download-tab-1", "https://lh3.googleusercontent.com/gg-dl/test-image=s1024", "test-user");
    expect(deps.client.evaluate).toHaveBeenCalledWith(
      "download-tab-1",
      "({ ct: document.contentType, body: document.body?.innerText?.trim()?.substring(0, 2048) })",
      "test-user",
      5_000
    );
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(2);
    expect(deps.client.evaluateExtended).toHaveBeenNthCalledWith(2, "download-tab-1", expect.any(String), "test-user", 15_000);
    expect(deps.client.closeTab).toHaveBeenCalledWith("download-tab-1", "test-user");
  });

  it("generateImage forwards gemId and accountIndex options", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: createGeminiRawBody("ok") } });

    const imageSpy = vi.spyOn(RequestBuilder.prototype, "buildImageGeneratePayload");

    const service = new GenerateService(deps);
    await service.generateImage("draw", { accountIndex: 2, gemId: "gem-1", model: "pro" });

    expect(imageSpy).toHaveBeenCalledWith(
      "draw",
      expect.objectContaining({
        accountIndex: 2,
        gemId: "gem-1",
        model: "pro",
        usePro: true
      }),
      tokens,
      2
    );
  });

  it("generateImage throws PARSE_ERROR directly when usePro response has no candidates", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-1" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse")
      .mockReturnValueOnce({
        ok: false,
        error: {
          code: "PARSE_ERROR",
          message: "No candidates found in response"
        }
      });

    const imageSpy = vi.spyOn(RequestBuilder.prototype, "buildImageGeneratePayload");
    const standardSpy = vi.spyOn(RequestBuilder.prototype, "buildGeneratePayload");

    const service = new GenerateService(deps);
    await expect(service.generateImage("draw a fox", { model: "pro", accountIndex: 1 })).rejects.toMatchObject({
      message: "No candidates found in response",
      code: "PARSE_ERROR"
    });

    expect(imageSpy).toHaveBeenCalledTimes(1);
    expect(standardSpy).not.toHaveBeenCalled();
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
  });

  it("retries with simplified action_input prompt and then returns generated images", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-1" } })
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-2" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse")
      .mockReturnValueOnce({
        ok: true,
        data: {
          metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
          candidates: [
            {
              rcid: "rcid-1",
              text: '{"action":"image_generation","action_input":"{\\"prompt\\":\\"A cute cat\\"}"}',
              thoughts: null,
              webImages: [],
              generatedImages: [],
              isFinal: true
            }
          ],
          chosenIndex: 0,
          isCompleted: true
        }
      })
      .mockReturnValueOnce({
        ok: true,
        data: {
          metadata: ["cid-2", "rid-2", "rcid-2", null, null, null, null, null, null, "ctx"],
          candidates: [
            {
              rcid: "rcid-2",
              text: "Here is your image",
              thoughts: null,
              webImages: [],
              generatedImages: [{ url: "https://img.test/generated.png", alt: "generated alt", title: "generated" }],
              isFinal: true
            }
          ],
          chosenIndex: 0,
          isCompleted: true
        }
      });

    const service = new GenerateService(deps);
    const deleteSpy = vi.spyOn(service, "deleteConversation").mockResolvedValue(undefined);

    const result = await service.generateImage("complex prompt", { model: "pro", accountIndex: 1 });

    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(2);
    expect(result.generatedImages).toHaveLength(1);
    expect(deleteSpy).toHaveBeenCalledWith(1, "cid-1");
    const secondExpression = deps.client.evaluateExtended.mock.calls[1]?.[1] as string;
    expect(secondExpression).toContain("A+cute+cat");
  });

  it("returns last result when action_input retries are exhausted", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-1" } })
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-2" } })
      .mockResolvedValueOnce({ ok: true, result: { ok: true, data: "frame-data-3" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: true,
      data: {
        metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
        candidates: [
          {
            rcid: "rcid-1",
            text: '{"action":"image_generation","action_input":"A simple tree"}',
            thoughts: null,
            webImages: [],
            generatedImages: [],
            isFinal: true
          }
        ],
        chosenIndex: 0,
        isCompleted: true
      }
    });

    const service = new GenerateService(deps);
    vi.spyOn(service, "deleteConversation").mockResolvedValue(undefined);

    const result = await service.generateImage("complex prompt", { model: "pro", accountIndex: 1 });

    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(3);
    expect(result.generatedImages).toEqual([]);
  });

  it("does not retry when action_input text exists but generated images are already present", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "frame-data" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: true,
      data: {
        metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
        candidates: [
          {
            rcid: "rcid-1",
            text: '{"action":"image_generation","action_input":"A simple tree"}',
            thoughts: null,
            webImages: [],
            generatedImages: [{ url: "https://img.test/generated.png", alt: "generated alt", title: "generated" }],
            isFinal: true
          }
        ],
        chosenIndex: 0,
        isCompleted: true
      }
    });

    const service = new GenerateService(deps);

    const result = await service.generateImage("complex prompt", { model: "pro", accountIndex: 1 });

    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
    expect(result.generatedImages).toHaveLength(1);
  });

  it("does not retry for normal responses without action_input", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: true, data: "frame-data" } });

    vi.spyOn(StreamParser.prototype, "extractFrames").mockReturnValue([{}]);
    vi.spyOn(ResponseParser.prototype, "parseGenerateResponse").mockReturnValue({
      ok: true,
      data: {
        metadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx"],
        candidates: [
          {
            rcid: "rcid-1",
            text: "Normal response text",
            thoughts: null,
            webImages: [],
            generatedImages: [],
            isFinal: true
          }
        ],
        chosenIndex: 0,
        isCompleted: true
      }
    });

    const service = new GenerateService(deps);

    const result = await service.generateImage("simple prompt", { model: "pro", accountIndex: 1 });

    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
    expect(result.output.candidates[0]?.text).toBe("Normal response text");
  });

  it("deleteConversation calls BatchExecute with DELETE_CHAT payload", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        data: createBatchRawBody("GzXR5e", ["cid-123"])
      }
    });

    const service = new GenerateService(deps);
    await service.deleteConversation(1, "cid-123");

    expect(deps.auth.ensureSession).toHaveBeenCalledWith(1);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(1);
    expect(deps.client.evaluateExtended).toHaveBeenCalledWith("tab-1", expect.any(String), "test-user", 120_000);
    const expression = deps.client.evaluateExtended.mock.calls[0]?.[1] as string;
    expect(expression).toContain("GzXR5e");
    expect(expression).toContain("cid-123");
  });

  it("deleteConversation skips when conversationId is empty", async () => {
    const deps = createDeps();
    const service = new GenerateService(deps);

    await service.deleteConversation(0, "");

    expect(deps.auth.ensureSession).not.toHaveBeenCalled();
    expect(deps.client.evaluateExtended).not.toHaveBeenCalled();
  });
});
