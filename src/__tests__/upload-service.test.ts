import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadService } from "../services/upload.js";

const config = {
  camofoxUrl: "http://localhost:9377",
  userId: "test-user",
  requestTimeout: 30_000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

const tokens = {
  snlm0e: "token-1",
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

function createDeps() {
  return {
    client: {
      evaluate: vi.fn().mockResolvedValue({ ok: true, result: true }),
      evaluateExtended: vi.fn().mockResolvedValue({ ok: true, result: { ok: true, data: "file-uri-1" } })
    } as any,
    auth: {
      ensureSession: vi.fn().mockResolvedValue(session),
      getTokens: vi.fn().mockResolvedValue(tokens),
      pauseRotation: vi.fn(),
      resumeRotation: vi.fn()
    } as any,
    config
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UploadService", () => {
  it("happy path uploads a small file using one chunk then finalize", async () => {
    const deps = createDeps();
    const service = new UploadService(deps);

    const result = await service.uploadFile({
      fileBase64: "Zm9vYmFy",
      filename: "note.txt"
    });

    expect(result).toEqual({ fileUri: "file-uri-1", filename: "note.txt" });
    expect(deps.auth.ensureSession).toHaveBeenCalledWith(0);
    expect(deps.auth.getTokens).toHaveBeenCalledWith(0);
    expect(deps.client.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.client.evaluate.mock.calls[0]?.[1]).toContain("__cg_upload_");
    expect(deps.client.evaluate.mock.calls[0]?.[1]).toContain(".push(");
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
    expect(deps.client.evaluateExtended.mock.calls[0]?.[1]).toContain('"text/plain"');
    expect(deps.auth.pauseRotation).toHaveBeenCalledTimes(1);
    expect(deps.auth.resumeRotation).toHaveBeenCalledTimes(1);
  });

  it("splits large base64 into ordered multi-chunk pushes", async () => {
    const deps = createDeps();
    const service = new UploadService(deps);
    const fileBase64 = "a".repeat((40 * 1024 * 3) + 77);

    await service.uploadFile({
      fileBase64,
      filename: "big.bin"
    });

    expect(deps.client.evaluate).toHaveBeenCalledTimes(4);
    expect(deps.client.evaluate.mock.calls[0]?.[1]).toContain("void 0");
    expect(deps.client.evaluate.mock.calls[1]?.[1]).toContain("void 1");
    expect(deps.client.evaluate.mock.calls[2]?.[1]).toContain("void 2");
    expect(deps.client.evaluate.mock.calls[3]?.[1]).toContain("void 3");
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
  });

  it("auth failure propagates", async () => {
    const deps = createDeps();
    deps.auth.ensureSession.mockRejectedValue(new Error("auth failed"));
    const service = new UploadService(deps);

    await expect(service.uploadFile({ fileBase64: "Zm9v", filename: "a.txt" })).rejects.toThrow("auth failed");
    expect(deps.client.evaluate).not.toHaveBeenCalled();
    expect(deps.client.evaluateExtended).not.toHaveBeenCalled();
    expect(deps.auth.resumeRotation).toHaveBeenCalledTimes(1);
  });

  it("attempts cleanup when a chunk push fails", async () => {
    const deps = createDeps();
    deps.client.evaluate
      .mockResolvedValueOnce({ ok: true, result: true })
      .mockResolvedValueOnce({ ok: false, error: "chunk failed" })
      .mockResolvedValueOnce({ ok: true, result: true });

    const service = new UploadService(deps);
    const fileBase64 = "a".repeat((40 * 1024 * 2) + 5);

    await expect(service.uploadFile({ fileBase64, filename: "broken.bin" })).rejects.toThrow("Chunk 1 push failed");

    expect(deps.client.evaluate).toHaveBeenCalledTimes(3);
    const cleanupExpression = deps.client.evaluate.mock.calls[2]?.[1] ?? "";
    expect(cleanupExpression).toContain("delete window[");
    expect(deps.client.evaluateExtended).not.toHaveBeenCalled();
  });

  it("throws when finalize returns an upload error", async () => {
    const deps = createDeps();
    deps.client.evaluateExtended.mockResolvedValue({ ok: true, result: { ok: false, error: "finalize failed" } });

    const service = new UploadService(deps);
    await expect(service.uploadFile({ fileBase64: "Zm9v", filename: "a.txt" })).rejects.toThrow(
      "Upload finalize failed: finalize failed"
    );
  });

  it("detects mime types from filename extensions", async () => {
    const deps = createDeps();
    const service = new UploadService(deps);

    const cases: Array<[string, string]> = [
      ["photo.jpg", "image/jpeg"],
      ["image.jpeg", "image/jpeg"],
      ["image.png", "image/png"],
      ["anim.gif", "image/gif"],
      ["asset.webp", "image/webp"],
      ["doc.pdf", "application/pdf"],
      ["readme.txt", "text/plain"],
      ["video.mp4", "video/mp4"],
      ["sound.mp3", "audio/mpeg"],
      ["archive.unknown", "application/octet-stream"]
    ];

    for (const [filename, expectedMime] of cases) {
      await service.uploadFile({ fileBase64: "Zg==", filename });
      expect(deps.client.evaluateExtended.mock.calls.at(-1)?.[1]).toContain(JSON.stringify(expectedMime));
    }
  });

  it("handles empty files by skipping chunk pushes and finalizing", async () => {
    const deps = createDeps();
    const service = new UploadService(deps);

    const result = await service.uploadFile({
      fileBase64: "",
      filename: "empty.txt"
    });

    expect(result).toEqual({ fileUri: "file-uri-1", filename: "empty.txt" });
    expect(deps.client.evaluate).not.toHaveBeenCalled();
    expect(deps.client.evaluateExtended).toHaveBeenCalledTimes(1);
  });
});
