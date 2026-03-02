import { describe, expect, it, vi } from "vitest";

import { NEW_CHAT_METADATA } from "../core/constants.js";
import { ChatService } from "../services/chat.js";
import type { GenerateService } from "../services/generate.js";
import type { ModelOutput } from "../types.js";

function createOutput(params: {
  cid?: string | null;
  rid?: string | null;
  context?: string | null;
  candidates?: Array<{ rcid: string; text: string }>;
  chosenIndex?: number;
} = {}): ModelOutput {
  const candidates = (params.candidates ?? [{ rcid: "rcid-1", text: "reply-1" }]).map((candidate) => ({
    rcid: candidate.rcid,
    text: candidate.text,
    thoughts: null,
    webImages: [],
    generatedImages: [],
    isFinal: true
  }));

  return {
    metadata: [
      params.cid ?? "cid-1",
      params.rid ?? "rid-1",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      params.context ?? "ctx-1"
    ],
    candidates,
    chosenIndex: params.chosenIndex ?? 0,
    isCompleted: true
  };
}

function createChatService() {
  const generate = vi.fn<GenerateService["generate"]>();
  const resetReqId = vi.fn<GenerateService["resetReqId"]>();

  const generateService = {
    generate,
    resetReqId
  } as unknown as GenerateService;

  return {
    service: new ChatService(generateService),
    generate,
    resetReqId
  };
}

describe("ChatService", () => {
  it("new chat session creates session and uses initial metadata", async () => {
    const { service, generate, resetReqId } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });

    const result = await service.chat("s1", "hello", { model: "flash", accountIndex: 2, gemId: "gem-1" });

    expect(resetReqId).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({
      prompt: "hello",
      model: "flash",
      accountIndex: 2,
      chatMetadata: [...NEW_CHAT_METADATA],
      gemId: "gem-1"
    });
    expect(result).toEqual({
      text: "reply-1",
      candidates: expect.any(Array),
      sessionId: "s1",
      isNewSession: true,
      turnNumber: 1
    });

    const session = service.getSession("s1");
    expect(session).toBeDefined();
    expect(session?.cid).toBe("cid-1");
    expect(session?.rid).toBe("rid-1");
    expect(session?.rcid).toBe("rcid-1");
    expect(session?.context).toBe("ctx-1");
    expect(session?.model).toBe("flash");
    expect(session?.accountIndex).toBe(2);
    expect(session?.gemId).toBe("gem-1");
    expect(session?.turns).toHaveLength(1);
  });

  it("multi-turn conversation uses updated metadata for continuation", async () => {
    const { service, generate } = createChatService();
    generate
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-A", rid: "rid-A", context: "ctx-A", candidates: [{ rcid: "rcid-A", text: "a" }] }), rawFrameCount: 1 })
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-A", rid: "rid-B", context: "ctx-B", candidates: [{ rcid: "rcid-B", text: "b" }] }), rawFrameCount: 1 });

    await service.chat("s1", "first", { model: "flash" });
    const second = await service.chat("s1", "second");

    expect(generate).toHaveBeenNthCalledWith(2, {
      prompt: "second",
      model: "flash",
      accountIndex: 0,
      chatMetadata: ["cid-A", "rid-A", "rcid-A", null, null, null, null, null, null, "ctx-A"],
      gemId: undefined
    });
    expect(second.turnNumber).toBe(2);

    const session = service.getSession("s1");
    expect(session?.rid).toBe("rid-B");
    expect(session?.rcid).toBe("rcid-B");
    expect(session?.context).toBe("ctx-B");
  });

  it("session persistence returns correct state", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput({ cid: "cid-X", rid: "rid-X", context: "ctx-X" }), rawFrameCount: 1 });

    await service.chat("persist", "hello", { accountIndex: 3, model: "pro" });

    const session = service.getSession("persist");
    expect(session).toMatchObject({
      id: "persist",
      cid: "cid-X",
      rid: "rid-X",
      rcid: "rcid-1",
      context: "ctx-X",
      model: "pro",
      accountIndex: 3
    });
  });

  it("session listing returns all active sessions", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });

    await service.chat("s1", "hello");
    await service.chat("s2", "hello");

    const sessions = service.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.id).sort()).toEqual(["s1", "s2"]);
    expect(sessions.every((session) => session.turnCount === 1)).toBe(true);
  });

  it("session deletion removes session", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });

    await service.chat("delete-me", "hello");

    expect(service.deleteSession("delete-me")).toBe(true);
    expect(service.getSession("delete-me")).toBeUndefined();
    expect(service.deleteSession("delete-me")).toBe(false);
  });

  it("clearAll removes all sessions", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });

    await service.chat("s1", "hello");
    await service.chat("s2", "hello");

    service.clearAll();

    expect(service.listSessions()).toHaveLength(0);
    expect(service.getSession("s1")).toBeUndefined();
    expect(service.getSession("s2")).toBeUndefined();
  });

  it("chooseCandidate updates rcid", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({
      output: createOutput({
        candidates: [
          { rcid: "rcid-1", text: "a" },
          { rcid: "rcid-2", text: "b" }
        ]
      }),
      rawFrameCount: 1
    });

    await service.chat("s1", "hello");
    service.chooseCandidate("s1", 1);

    const session = service.getSession("s1");
    expect(session?.rcid).toBe("rcid-2");
    expect(session?.turns[0]?.response.chosenIndex).toBe(1);
  });

  it("non-null overwrite updates only truthy metadata fields", async () => {
    const { service, generate } = createChatService();
    generate
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-1", rid: "rid-1", context: "ctx-1", candidates: [{ rcid: "rcid-1", text: "a" }] }), rawFrameCount: 1 })
      .mockResolvedValueOnce({
        output: {
          ...createOutput({ candidates: [{ rcid: "rcid-2", text: "b" }] }),
          metadata: ["", null, null, null, null, null, null, null, null, ""]
        },
        rawFrameCount: 1
      });

    await service.chat("s1", "first");
    await service.chat("s1", "second");

    const session = service.getSession("s1");
    expect(session?.cid).toBe("cid-1");
    expect(session?.rid).toBe("rid-1");
    expect(session?.context).toBe("ctx-1");
    expect(session?.rcid).toBe("rcid-2");
  });

  it("reqId reset runs only for new sessions", async () => {
    const { service, generate, resetReqId } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });

    await service.chat("s1", "first");
    await service.chat("s1", "second");
    await service.chat("s2", "third");

    expect(resetReqId).toHaveBeenCalledTimes(2);
  });

  it("multiple sessions maintain independent metadata", async () => {
    const { service, generate } = createChatService();
    generate
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-1", rid: "rid-1", context: "ctx-1", candidates: [{ rcid: "rcid-1", text: "a" }] }), rawFrameCount: 1 })
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-2", rid: "rid-2", context: "ctx-2", candidates: [{ rcid: "rcid-2", text: "b" }] }), rawFrameCount: 1 })
      .mockResolvedValueOnce({ output: createOutput({ cid: "cid-1", rid: "rid-3", context: "ctx-3", candidates: [{ rcid: "rcid-3", text: "c" }] }), rawFrameCount: 1 });

    await service.chat("s1", "first s1");
    await service.chat("s2", "first s2");
    await service.chat("s1", "second s1");

    expect(generate).toHaveBeenNthCalledWith(3, {
      prompt: "second s1",
      model: undefined,
      accountIndex: 0,
      chatMetadata: ["cid-1", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx-1"],
      gemId: undefined
    });

    const s1 = service.getSession("s1");
    const s2 = service.getSession("s2");
    expect(s1?.cid).toBe("cid-1");
    expect(s1?.rid).toBe("rid-3");
    expect(s2?.cid).toBe("cid-2");
    expect(s2?.rid).toBe("rid-2");
  });
});
