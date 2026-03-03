import { describe, expect, it, vi } from "vitest";

import { downloadImage } from "../services/image-download.js";

function createClientMocks() {
  return {
    createTab: vi.fn().mockResolvedValue({ tabId: "test-tab", url: "", title: "" }),
    navigate: vi.fn().mockResolvedValue({ tabId: "test-tab", url: "", title: "" }),
    evaluate: vi.fn(),
    evaluateExtended: vi.fn(),
    closeTab: vi.fn().mockResolvedValue(undefined)
  };
}

describe("downloadImage", () => {
  it("follows a 2-hop redirect chain and navigates to body URL", async () => {
    const client = createClientMocks();
    client.evaluate
      .mockResolvedValueOnce({ ok: true, result: { ct: "text/plain", body: "https://lh3.google.com/rd-gg/next" } })
      .mockResolvedValueOnce({ ok: true, result: { ct: "image/png", body: "" } });
    client.evaluateExtended.mockResolvedValueOnce({
      ok: true,
      truncated: false,
      result: { ok: true, base64: "ZmFrZQ==", mimeType: "image/png" }
    });

    const result = await downloadImage(
      client as any,
      "https://lh3.googleusercontent.com/gg-dl/start=s1024",
      "test-user",
      "image-download"
    );

    expect(result).toEqual({ base64: "ZmFrZQ==", mimeType: "image/png" });
    expect(client.navigate).toHaveBeenCalledTimes(2);
    expect(client.navigate).toHaveBeenNthCalledWith(
      2,
      "test-tab",
      "https://lh3.google.com/rd-gg/next",
      "test-user"
    );
    expect(client.closeTab).toHaveBeenCalledWith("test-tab", "test-user");
  });

  it("returns null after redirect hop exhaustion", async () => {
    const client = createClientMocks();
    client.evaluate.mockResolvedValue({ ok: true, result: { ct: "text/plain", body: "https://lh3.google.com/next" } });

    const result = await downloadImage(
      client as any,
      "https://lh3.googleusercontent.com/gg-dl/start=s1024",
      "test-user",
      "image-download"
    );

    expect(result).toBeNull();
    expect(client.navigate).toHaveBeenCalledTimes(5);
    expect(client.evaluateExtended).not.toHaveBeenCalled();
    expect(client.closeTab).toHaveBeenCalledWith("test-tab", "test-user");
  });

  it("returns null gracefully when evaluate fails during redirect hop", async () => {
    const client = createClientMocks();
    client.evaluate.mockResolvedValueOnce({ ok: false, error: "timeout" });

    const result = await downloadImage(
      client as any,
      "https://lh3.googleusercontent.com/gg-dl/start=s1024",
      "test-user",
      "image-download"
    );

    expect(result).toBeNull();
    expect(client.evaluateExtended).not.toHaveBeenCalled();
    expect(client.closeTab).toHaveBeenCalledWith("test-tab", "test-user");
  });

  it("returns null when evaluateExtended response is truncated", async () => {
    const client = createClientMocks();
    client.evaluate.mockResolvedValueOnce({ ok: true, result: { ct: "image/png", body: "" } });
    client.evaluateExtended.mockResolvedValueOnce({ ok: true, truncated: true });

    const result = await downloadImage(
      client as any,
      "https://lh3.googleusercontent.com/gg-dl/start=s1024",
      "test-user",
      "image-download"
    );

    expect(result).toBeNull();
    expect(client.evaluateExtended).toHaveBeenCalledTimes(1);
    expect(client.closeTab).toHaveBeenCalledWith("test-tab", "test-user");
  });
});
