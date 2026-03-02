import { describe, expect, it } from "vitest";

import { Endpoint, GrpcId, NEW_CHAT_METADATA } from "../core/constants.js";
import { RequestBuilder } from "../core/request-builder.js";
import type { ChatMetadata, GeminiTokens, RPCPayload } from "../types.js";

const TOKENS: GeminiTokens = {
  snlm0e: "token_snlm0e",
  cfb2h: "boq_test_build_label",
  fdrfje: "session_123",
  extractedAt: Date.now()
};

function parseBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

describe("RequestBuilder", () => {
  describe("resolveModel", () => {
    it("resolves aliases", () => {
      const builder = new RequestBuilder();
      expect(builder.resolveModel("pro")).toBe("gemini-3.0-pro");
      expect(builder.resolveModel("flash")).toBe("gemini-3.0-flash");
      expect(builder.resolveModel("thinking")).toBe("gemini-3.0-flash-thinking");
    });

    it("returns unspecified when omitted", () => {
      const builder = new RequestBuilder();
      expect(builder.resolveModel()).toBe("unspecified");
    });

    it("returns canonical and unknown names unchanged", () => {
      const builder = new RequestBuilder();
      expect(builder.resolveModel("gemini-3.0-pro")).toBe("gemini-3.0-pro");
      expect(builder.resolveModel("some-unknown-model")).toBe("some-unknown-model");
    });
  });

  describe("reqid lifecycle", () => {
    it("generates random reqid in range", () => {
      for (let i = 0; i < 25; i++) {
        const reqid = RequestBuilder.randomReqId();
        expect(reqid).toBeGreaterThanOrEqual(10000);
        expect(reqid).toBeLessThanOrEqual(99999);
      }
    });

    it("increments by 100000 for generate and batch", () => {
      const builder = new RequestBuilder();
      const start = builder.reqId;

      builder.buildGeneratePayload({ prompt: "hello" }, TOKENS);
      expect(builder.reqId).toBe(start + 100000);

      builder.buildBatchPayload(
        [{ rpcId: "X1", payload: JSON.stringify(["a"]) }],
        TOKENS
      );
      expect(builder.reqId).toBe(start + 200000);
    });

    it("resetReqId sets a fresh in-range reqid", () => {
      const builder = new RequestBuilder();
      builder.buildGeneratePayload({ prompt: "hello" }, TOKENS);
      builder.resetReqId();

      expect(builder.reqId).toBeGreaterThanOrEqual(10000);
      expect(builder.reqId).toBeLessThanOrEqual(99999);
    });
  });

  describe("buildGeneratePayload", () => {
    it("builds basic payload with double-encoded f.req", () => {
      const builder = new RequestBuilder();
      const firstReqid = builder.reqId;

      const payload = builder.buildGeneratePayload({ prompt: "hello world" }, TOKENS);

      expect(payload.url).toContain(Endpoint.GENERATE(0));
      expect(payload.url).toContain(`_reqid=${firstReqid}`);
      expect(payload.url).toContain("rt=c");
      expect(payload.url).toContain(`bl=${TOKENS.cfb2h}`);
      expect(payload.url).toContain(`f.sid=${TOKENS.fdrfje}`);

      expect(payload.headers["Content-Type"]).toBe("application/x-www-form-urlencoded;charset=utf-8");
      expect(payload.headers["X-Same-Domain"]).toBe("1");
      expect(payload.headers["x-goog-ext-525001261-jspb"]).toBeUndefined();

      const body = parseBody(payload.body);
      expect(body.get("at")).toBe(TOKENS.snlm0e);

      const fReqRaw = body.get("f.req");
      expect(fReqRaw).toBeTruthy();
      const parsedOuter = JSON.parse(fReqRaw as string) as [null, string];
      expect(parsedOuter[0]).toBeNull();
      expect(typeof parsedOuter[1]).toBe("string");

      const innerReq = JSON.parse(parsedOuter[1]) as unknown[];
      expect(innerReq).toHaveLength(73);
      expect(innerReq[7]).toBe(1);

      const messageContent = innerReq[0] as unknown[];
      expect(messageContent[0]).toBe("hello world");
      expect(messageContent[1]).toBe(0);
      expect(messageContent[3]).toBeNull();

      expect(innerReq[2]).toEqual(NEW_CHAT_METADATA);
    });

    it("adds model header for pro model", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildGeneratePayload({ prompt: "hi", model: "pro" }, TOKENS);

      expect(payload.headers["x-goog-ext-525001261-jspb"]).toBeDefined();
      expect(payload.headers["x-goog-ext-525001261-jspb"]).toContain("9d8ca3786ebdfbea");
    });

    it("adds model header for flash alias", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildGeneratePayload({ prompt: "hi", model: "flash" }, TOKENS);

      expect(payload.headers["x-goog-ext-525001261-jspb"]).toContain("fbb127bbb056c959");
    });

    it("uses provided chat metadata for continuation", () => {
      const builder = new RequestBuilder();
      const metadata: ChatMetadata = ["cid1", "rid1", "rcid1", null, null, null, null, null, null, "ctx"];

      const payload = builder.buildGeneratePayload({ prompt: "continue" }, TOKENS, 0, metadata);
      const fReqRaw = parseBody(payload.body).get("f.req") as string;
      const outer = JSON.parse(fReqRaw) as [null, string];
      const innerReq = JSON.parse(outer[1]) as unknown[];

      expect(innerReq[2]).toEqual(metadata);
    });

    it("sets gemId at index 19 when provided", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildGeneratePayload({ prompt: "hello", gemId: "gem_abc" }, TOKENS);

      const fReqRaw = parseBody(payload.body).get("f.req") as string;
      const outer = JSON.parse(fReqRaw) as [null, string];
      const innerReq = JSON.parse(outer[1]) as unknown[];

      expect(innerReq[19]).toBe("gem_abc");
    });

    it("includes image data stub when images are attached", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildGeneratePayload(
        {
          prompt: "describe",
          images: [
            { url: "https://example.com/a.png", mimeType: "image/png" },
            { data: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" }
          ]
        },
        TOKENS
      );

      const fReqRaw = parseBody(payload.body).get("f.req") as string;
      const outer = JSON.parse(fReqRaw) as [null, string];
      const innerReq = JSON.parse(outer[1]) as unknown[];
      const messageContent = innerReq[0] as unknown[];
      const fileData = messageContent[3] as unknown[];

      expect(Array.isArray(fileData)).toBe(true);
      expect(fileData).toHaveLength(2);
      expect(fileData[0]).toEqual([["https://example.com/a.png", "image/png"]]);
      expect(fileData[1]).toEqual([["data:image/jpeg;base64,abc", "image/jpeg"]]);
    });

    it("builds account scoped URL for account index 2", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildGeneratePayload({ prompt: "hello" }, TOKENS, 2);
      expect(payload.url.startsWith(Endpoint.GENERATE(2))).toBe(true);
    });

    it("omits optional bl and f.sid params when token fields are empty", () => {
      const builder = new RequestBuilder();
      const tokenNoOptional: GeminiTokens = {
        ...TOKENS,
        cfb2h: "",
        fdrfje: ""
      };

      const payload = builder.buildGeneratePayload({ prompt: "hello" }, tokenNoOptional);
      const url = new URL(payload.url);

      expect(url.searchParams.get("bl")).toBeNull();
      expect(url.searchParams.get("f.sid")).toBeNull();
    });
  });

  describe("buildBatchPayload", () => {
    it("builds single rpc payload", () => {
      const builder = new RequestBuilder();
      const payloads: RPCPayload[] = [{ rpcId: "MaZiqc", payload: JSON.stringify([1, 2, 3]) }];

      const payload = builder.buildBatchPayload(payloads, TOKENS);
      expect(payload.url).toContain(Endpoint.BATCH_EXEC(0));
      expect(payload.url).toContain("rpcids=MaZiqc");
      expect(payload.url).toContain(`source-path=${encodeURIComponent(Endpoint.SOURCE_PATH(0))}`);

      const body = parseBody(payload.body);
      expect(body.get("at")).toBe(TOKENS.snlm0e);

      const fReq = JSON.parse(body.get("f.req") as string) as unknown[];
      expect(fReq).toHaveLength(1);
      expect(Array.isArray(fReq[0])).toBe(true);
      expect(fReq[0]).toEqual([["MaZiqc", "[1,2,3]", null, "generic"]]);
    });

    it("builds multiple rpc payloads and joins rpcids", () => {
      const builder = new RequestBuilder();
      const payloads: RPCPayload[] = [
        { rpcId: "A1", payload: JSON.stringify(["one"]), identifier: "id1" },
        { rpcId: "B2", payload: JSON.stringify(["two"]), identifier: "id2" }
      ];

      const payload = builder.buildBatchPayload(payloads, TOKENS, 2);
      expect(payload.url).toContain("rpcids=A1%2CB2");
      expect(payload.url.startsWith(Endpoint.BATCH_EXEC(2))).toBe(true);
      expect(payload.url).toContain(`source-path=${encodeURIComponent(Endpoint.SOURCE_PATH(2))}`);

      const fReq = JSON.parse(parseBody(payload.body).get("f.req") as string) as unknown[];
      expect(fReq[0]).toEqual([
        ["A1", '["one"]', null, "id1"],
        ["B2", '["two"]', null, "id2"]
      ]);
    });
  });

  describe("buildBardActivityPayload", () => {
    it("builds BARD_ACTIVITY pre-call payload", () => {
      const builder = new RequestBuilder();
      const firstReqid = builder.reqId;

      const payload = builder.buildBardActivityPayload(TOKENS);
      expect(payload.url).toContain("rpcids=ESY5D");
      expect(payload.url).toContain(`_reqid=${firstReqid}`);

      const fReq = JSON.parse(parseBody(payload.body).get("f.req") as string) as unknown[];
      expect(fReq[0]).toEqual([
        [GrpcId.BARD_ACTIVITY, '[["bard_activity_enabled"]]', null, "generic"]
      ]);
      expect(builder.reqId).toBe(firstReqid + 100000);
    });
  });

  describe("buildUploadedFileData", () => {
    it("builds Python-compatible uploaded file_data shape", () => {
      const builder = new RequestBuilder();
      const fileData = builder.buildUploadedFileData([
        { fileUri: "/contrib_service/ttl_1d/file_a", filename: "a.png" },
        { fileUri: "/contrib_service/ttl_1d/file_b", filename: "b.pdf" }
      ]);

      expect(fileData).toEqual([
        [[["/contrib_service/ttl_1d/file_a"], "a.png"]],
        [[["/contrib_service/ttl_1d/file_b"], "b.pdf"]]
      ]);
    });

    it("returns null when no files are provided", () => {
      const builder = new RequestBuilder();
      expect(builder.buildUploadedFileData([])).toBeNull();
    });
  });

  describe("buildImageGeneratePayload", () => {
    it("enables pro flags and injects uploaded file references", () => {
      const builder = new RequestBuilder();
      const payload = builder.buildImageGeneratePayload(
        "generate a city skyline",
        {
          model: "pro",
          usePro: true,
          files: [{ fileUri: "/contrib_service/ttl_1d/file_img", filename: "seed.png" }],
          gemId: "gem_xyz"
        },
        TOKENS,
        0
      );

      const fReqRaw = parseBody(payload.body).get("f.req") as string;
      const outer = JSON.parse(fReqRaw) as [null, string];
      const innerReq = JSON.parse(outer[1]) as unknown[];
      const messageContent = innerReq[0] as unknown[];

      expect(messageContent[0]).toBe("generate a city skyline");
      expect(messageContent[3]).toEqual([[[["/contrib_service/ttl_1d/file_img"], "seed.png"]]]);
      expect(messageContent[9]).toEqual([null, null, null, null, null, null, [null, [1]]]);
      expect(innerReq[19]).toBe("gem_xyz");
      expect(innerReq[32]).toBe(1);
      expect(payload.headers["x-goog-ext-525001261-jspb"]).toContain("9d8ca3786ebdfbea");
    });
  });

  describe("Gem payload helpers", () => {
    it("builds LIST_GEMS payload for system gems", () => {
      const builder = new RequestBuilder();
      const rpc = builder.buildGemListPayload("system");

      expect(rpc.rpcId).toBe(GrpcId.LIST_GEMS);
      expect(rpc.payload).toBe('[4,["en"],0]');
      expect(rpc.identifier).toBe("generic");
    });

    it("builds CREATE_GEM payload with Python-compatible 15-element array", () => {
      const builder = new RequestBuilder();
      const rpc = builder.buildGemCreatePayload({
        name: "Writer",
        description: "Writing assistant",
        instructions: "Be concise"
      });

      expect(rpc.rpcId).toBe(GrpcId.CREATE_GEM);
      const parsed = JSON.parse(rpc.payload) as unknown[];
      const body = parsed[0] as unknown[];
      expect(body).toHaveLength(15);
      expect(body[0]).toBe("Writer");
      expect(body[1]).toBe("Writing assistant");
      expect(body[2]).toBe("Be concise");
      expect(body[14]).toEqual([]);
    });
  });
});
