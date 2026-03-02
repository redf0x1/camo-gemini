import { describe, expect, it } from "vitest";

import {
  buildBatchExpression,
  buildGenerateExpression,
  buildUploadChunkPushExpression,
  buildUploadFinalizeExpression
} from "../core/browser-js.js";

describe("browser-js expression builder", () => {
  it("buildGenerateExpression returns valid JS async IIFE", () => {
    const expression = buildGenerateExpression({
      url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: "at=token&f.req=data",
      bardActivityUrl: "https://gemini.google.com/_/BardChatUi/data/batchexecute",
      bardActivityHeaders: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      bardActivityBody: "at=token&f.req=bard"
    });

    expect(expression.startsWith("(async () => {")).toBe(true);
    expect(expression.endsWith("})()")).toBe(true);
    expect(() => new Function(`return ${expression};`)).not.toThrow();
  });

  it("includes both BARD_ACTIVITY and StreamGenerate fetch calls", () => {
    const expression = buildGenerateExpression({
      url: "https://example.com/stream",
      headers: { "X-Same-Domain": "1" },
      body: "f.req=abc",
      bardActivityUrl: "https://example.com/batch",
      bardActivityHeaders: { "X-Same-Domain": "1" },
      bardActivityBody: "f.req=bard"
    });

    expect(expression).toContain("BARD_ACTIVITY failed");
    expect(expression).toContain("StreamGenerate failed");
    expect(expression).toContain("const bardRes = await fetch(");
    expect(expression).toContain("const res = await fetch(");
  });

  it("uses credentials include in generate expression", () => {
    const expression = buildGenerateExpression({
      url: "https://example.com/stream",
      headers: {},
      body: "a=1",
      bardActivityUrl: "https://example.com/batch",
      bardActivityHeaders: {},
      bardActivityBody: "b=2"
    });

    const matches = expression.match(/credentials:\s*'include'/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("properly escapes special characters in URLs and body", () => {
    const weirdUrl = 'https://example.com/a?x="q"&line=1\\n2&emoji=💡';
    const weirdBody = 'f.req={"k":"v\\n\\"quote\\""}&at=t+ok';

    const expression = buildGenerateExpression({
      url: weirdUrl,
      headers: { "X-Custom": 'value"with\\nchars' },
      body: weirdBody,
      bardActivityUrl: `${weirdUrl}/batch`,
      bardActivityHeaders: { "X-Other": "βeta" },
      bardActivityBody: `${weirdBody}&mode=bard`
    });

    expect(expression).toContain(JSON.stringify(weirdUrl));
    expect(expression).toContain(JSON.stringify(weirdBody));
    expect(expression).toContain(JSON.stringify({ "X-Custom": 'value"with\\nchars' }));
  });

  it("buildBatchExpression returns valid JS and includes credentials include", () => {
    const expression = buildBatchExpression({
      url: "https://example.com/batchexecute",
      headers: { "X-Same-Domain": "1" },
      body: "f.req=batch"
    });

    expect(expression.startsWith("(async () => {")).toBe(true);
    expect(expression.endsWith("})()")).toBe(true);
    expect(expression).toContain("BatchExecute failed");
    expect(expression).toContain("credentials: 'include'");
    expect(() => new Function(`return ${expression};`)).not.toThrow();
  });

  it("throws when generate expression exceeds 64KB", () => {
    const oversizedBody = `f.req=${"x".repeat(70 * 1024)}`;

    expect(() =>
      buildGenerateExpression({
        url: "https://example.com/stream",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: oversizedBody,
        bardActivityUrl: "https://example.com/batch",
        bardActivityHeaders: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        bardActivityBody: "at=token&f.req=bard"
      })
    ).toThrow(/exceeds 64KB/i);
  });

  it("buildUploadChunkPushExpression uses uploadId namespaced global and push", () => {
    const expression = buildUploadChunkPushExpression("abc123", "Zm9vYmFy", 0);

    expect(expression).toContain('__cg_upload_abc123');
    expect(expression).toContain(".push(");
    expect(expression).toContain('"Zm9vYmFy"');
    expect(() => new Function(expression)).not.toThrow();
  });

  it("buildUploadChunkPushExpression includes chunk index marker and returns true", () => {
    const expression = buildUploadChunkPushExpression("upl-id", "Y2h1bms=", 7);

    expect(expression).toContain("void 7");
    expect(expression.trim().endsWith("true")).toBe(true);
    expect(expression).toContain("window[");
  });

  it("buildUploadFinalizeExpression returns valid async JS with cleanup and upload steps", () => {
    const expression = buildUploadFinalizeExpression({
      uploadId: "upl-1",
      filename: "photo.png",
      mimeType: "image/png",
      uploadUrl: "https://push.clients6.google.com/upload/",
      snlm0e: "token-1",
      accountIndex: 0
    });

    expect(expression.startsWith("(async () => {")).toBe(true);
    expect(expression.endsWith("})()")).toBe(true);
    expect(expression).toContain("atob(base64)");
    expect(expression).toContain("X-Goog-Upload-Protocol': 'resumable'");
    expect(expression).toContain("X-Goog-Upload-Command': 'upload, finalize'");
    expect(expression).toContain("delete window[globalKey]");
    expect(expression).toContain("finally");
    expect(() => new Function(`return ${expression};`)).not.toThrow();
  });

  it("buildUploadFinalizeExpression always includes cleanup in finally block", () => {
    const expression = buildUploadFinalizeExpression({
      uploadId: "upl-finally",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      uploadUrl: "https://push.clients6.google.com/upload/",
      snlm0e: "token-finally",
      accountIndex: 3
    });

    const finallyIndex = expression.indexOf("finally");
    const deleteIndex = expression.indexOf("delete window[globalKey]");

    expect(finallyIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(finallyIndex);
    expect(expression).toContain("const globalKey = \"__cg_upload_upl-finally\"");
  });
});
