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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
      allowAccountFailover: false,
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
      allowAccountFailover: false,
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
      allowAccountFailover: false,
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

  it("serializes concurrent chats for the same session in order", async () => {
    const { service, generate } = createChatService();
    const first = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    const second = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();

    generate
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);

    const p1 = service.chat("s1", "first");
    const p2 = service.chat("s1", "second");

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(1);
    });

    first.resolve({
      output: createOutput({
        cid: "cid-queue",
        rid: "rid-1",
        context: "ctx-1",
        candidates: [{ rcid: "rcid-1", text: "first-reply" }]
      }),
      rawFrameCount: 1
    });

    await p1;

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(2, {
      prompt: "second",
      model: undefined,
      accountIndex: 0,
      allowAccountFailover: false,
      chatMetadata: ["cid-queue", "rid-1", "rcid-1", null, null, null, null, null, null, "ctx-1"],
      gemId: undefined
    });

    second.resolve({
      output: createOutput({
        cid: "cid-queue",
        rid: "rid-2",
        context: "ctx-2",
        candidates: [{ rcid: "rcid-2", text: "second-reply" }]
      }),
      rawFrameCount: 1
    });

    const result2 = await p2;
    expect(result2.text).toBe("second-reply");
    expect(result2.turnNumber).toBe(2);
  });

  it("isolates errors so a failed queued request does not block the next one", async () => {
    const { service, generate } = createChatService();
    const first = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();

    generate
      .mockImplementationOnce(async () => first.promise)
      .mockResolvedValueOnce({
        output: createOutput({
          cid: "cid-ok",
          rid: "rid-ok",
          context: "ctx-ok",
          candidates: [{ rcid: "rcid-ok", text: "ok" }]
        }),
        rawFrameCount: 1
      });

    const p1 = service.chat("s1", "will-fail");
    const p2 = service.chat("s1", "will-pass");

    first.reject(new Error("boom"));

    await expect(p1).rejects.toThrow("boom");
    const result2 = await p2;

    expect(result2.text).toBe("ok");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(2, {
      prompt: "will-pass",
      model: undefined,
      accountIndex: 0,
      allowAccountFailover: false,
      chatMetadata: [...NEW_CHAT_METADATA],
      gemId: undefined
    });
  });

  it("allows concurrent chats across different sessions", async () => {
    const { service, generate } = createChatService();
    const s1Deferred = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    const s2Deferred = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();

    let inFlight = 0;
    let maxInFlight = 0;

    generate.mockImplementation(async ({ prompt }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (prompt === "p1") {
          return await s1Deferred.promise;
        }
        return await s2Deferred.promise;
      } finally {
        inFlight -= 1;
      }
    });

    const p1 = service.chat("session-1", "p1");
    const p2 = service.chat("session-2", "p2");

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(2);
    });
    expect(maxInFlight).toBe(2);

    s1Deferred.resolve({ output: createOutput({ candidates: [{ rcid: "r1", text: "one" }] }), rawFrameCount: 1 });
    s2Deferred.resolve({ output: createOutput({ candidates: [{ rcid: "r2", text: "two" }] }), rawFrameCount: 1 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.text).toBe("one");
    expect(r2.text).toBe("two");
  });

  it("keeps a deleted session deleted when queued chats resolve", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValueOnce({
      output: createOutput({ cid: "cid-seed", rid: "rid-seed", context: "ctx-seed", candidates: [{ rcid: "rcid-seed", text: "seed" }] }),
      rawFrameCount: 1
    });
    await service.chat("delete-queued", "seed");

    const deferred = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    generate
      .mockImplementationOnce(async () => deferred.promise)
      .mockResolvedValueOnce({
        output: createOutput({
          cid: "cid-seed",
          rid: "rid-queued",
          context: "ctx-queued",
          candidates: [{ rcid: "rcid-queued", text: "queued" }]
        }),
        rawFrameCount: 1
      });

    const inflight = service.chat("delete-queued", "pending");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const queued = service.chat("delete-queued", "queued");
    const canceled = expect(queued).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
    expect(service.deleteSession("delete-queued")).toBe(true);
    expect(service.getSession("delete-queued")).toBeUndefined();

    deferred.resolve({
      output: createOutput({
        cid: "cid-seed",
        rid: "rid-after-delete",
        context: "ctx-after-delete",
        candidates: [{ rcid: "rcid-after-delete", text: "done" }]
      }),
      rawFrameCount: 1
    });

    await inflight;
    await canceled;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(service.getSession("delete-queued")).toBeUndefined();
  });

  it("cancels work cleared before it starts without invoking generation", async () => {
    const { service, generate } = createChatService();
    const pending = service.chat("not-started", "must not be sent");
    const canceled = expect(pending).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
    service.clearAll();
    await canceled;
    expect(generate).not.toHaveBeenCalled();
    expect(service.listSessions()).toEqual([]);
  });

  it("does not let an old in-flight result overwrite a recreated session", async () => {
    const { service, generate } = createChatService();
    const old = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    generate.mockImplementationOnce(() => old.promise).mockResolvedValueOnce({
      output: createOutput({ cid: "new-cid", candidates: [{ rcid: "new-r", text: "new" }] }), rawFrameCount: 1
    });
    const pending = service.chat("reuse", "old");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(service.deleteSession("reuse")).toBe(true);
    await service.chat("reuse", "new");
    old.resolve({ output: createOutput({ cid: "old-cid" }), rawFrameCount: 1 });
    await pending;
    expect(service.getSession("reuse")?.cid).toBe("new-cid");
    expect(service.getSession("reuse")?.turns.map(t => t.prompt)).toEqual(["new"]);
  });

  it("clears pending first turns for one account without affecting another account", async () => {
    const { service, generate } = createChatService();
    const old = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    generate.mockImplementationOnce(() => old.promise).mockResolvedValueOnce({
      output: createOutput({ cid: "other-cid" }), rawFrameCount: 1
    });
    const pending = service.chat("account-pending", "first", { accountIndex: 3 });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const queued = service.chat("account-pending", "inherited-account");
    const canceled = expect(queued).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
    await service.chat("other-account", "other", { accountIndex: 4 });
    service.clearAccount(3);
    old.resolve({ output: createOutput({ cid: "logged-out-cid" }), rawFrameCount: 1 });
    await pending;
    await canceled;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(service.getSession("account-pending")).toBeUndefined();
    expect(service.getSession("other-account")?.cid).toBe("other-cid");
  });

  it("clearAll prevents late results from resurrecting any session", async () => {
    const { service, generate } = createChatService();
    const old = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    generate.mockImplementationOnce(() => old.promise);
    const pending = service.chat("cleared", "first");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const queued = service.chat("cleared", "second");
    const canceled = expect(queued).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
    service.clearAll();
    old.resolve({ output: createOutput(), rawFrameCount: 1 });
    await pending;
    await canceled;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(service.listSessions()).toEqual([]);
  });

  it("inherits the preceding queued account rather than the default account", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput(), rawFrameCount: 1 });
    await Promise.all([
      service.chat("queued-account", "first", { accountIndex: 3 }),
      service.chat("queued-account", "second")
    ]);
    expect(generate.mock.calls.map(([options]: Parameters<GenerateService["generate"]>) => options.accountIndex)).toEqual([3, 3]);
    expect(service.getSession("queued-account")?.turns).toHaveLength(2);
  });

  it("does not clear a new account's conversation after the old account's work settled", async () => {
    const { service, generate } = createChatService();
    const held = createDeferred<{ output: ModelOutput; rawFrameCount: number }>();
    generate.mockResolvedValueOnce({ output: createOutput(), rawFrameCount: 1 })
      .mockResolvedValueOnce({ output: createOutput({ cid: "new-account-cid" }), rawFrameCount: 1 })
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValueOnce({ output: createOutput({ cid: "new-account-cid" }), rawFrameCount: 1 });
    const first = service.chat("switch-logout", "old-account", { accountIndex: 0 });
    const second = service.chat("switch-logout", "new-account", { accountIndex: 1 });
    const third = service.chat("switch-logout", "pending", { accountIndex: 1 });
    const fourth = service.chat("switch-logout", "queued", { accountIndex: 1 });
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    expect(service.getSession("switch-logout")?.accountIndex).toBe(1);
    service.clearAccount(0);
    held.resolve({ output: createOutput({ cid: "new-account-cid" }), rawFrameCount: 1 });
    await Promise.all([third, fourth]);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(service.getSession("switch-logout")?.accountIndex).toBe(1);
    expect(service.getSession("switch-logout")?.turns.map(t => t.prompt)).toEqual(["new-account", "pending", "queued"]);
  });

  it("never carries conversation metadata into a different queued account", async () => {
    const { service, generate } = createChatService();
    generate.mockResolvedValue({ output: createOutput({ cid: "account-cid" }), rawFrameCount: 1 });
    const results = await Promise.all([
      service.chat("account-switch", "first", { accountIndex: 1 }),
      service.chat("account-switch", "second", { accountIndex: 2 })
    ]);
    expect(generate.mock.calls[1]?.[0]).toMatchObject({
      accountIndex: 2,
      allowAccountFailover: false,
      chatMetadata: [...NEW_CHAT_METADATA]
    });
    expect(results[1]).toMatchObject({ isNewSession: true, turnNumber: 1 });
    expect(service.getSession("account-switch")?.accountIndex).toBe(2);
    expect(service.getSession("account-switch")?.turns.map(t => t.prompt)).toEqual(["second"]);
  });
});
