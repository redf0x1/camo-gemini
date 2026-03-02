import { describe, expect, it } from "vitest";

import { StreamParser } from "../core/stream-parser.js";

function frame(payload: string): string {
  return `${payload.length}${payload}`;
}

describe("StreamParser", () => {
  describe("parseFrameBuffer", () => {
    it("parses single valid frame with JSON array", () => {
      const parser = new StreamParser();
      const payload = "\n[1,2,3]\n";
      const result = parser.parseFrameBuffer(frame(payload));

      expect(result.frames).toEqual([1, 2, 3]);
      expect(result.remainder).toBe("");
    });

    it("parses multiple frames in sequence", () => {
      const parser = new StreamParser();
      const first = "\n[\"a\"]\n";
      const second = "\n[\"b\",\"c\"]\n";
      const result = parser.parseFrameBuffer(`${frame(first)}${frame(second)}`);

      expect(result.frames).toEqual(["a", "b", "c"]);
      expect(result.remainder).toBe("");
    });

    it("returns incomplete frame in remainder", () => {
      const parser = new StreamParser();
      const payload = "\n[\"partial\"]\n";
      const encoded = frame(payload);
      const partial = encoded.slice(0, encoded.length - 2);

      const result = parser.parseFrameBuffer(partial);

      expect(result.frames).toEqual([]);
      expect(result.remainder).toBe(partial);
    });

    it("handles empty input", () => {
      const parser = new StreamParser();
      const result = parser.parseFrameBuffer("");

      expect(result.frames).toEqual([]);
      expect(result.remainder).toBe("");
    });

    it("handles whitespace between frames", () => {
      const parser = new StreamParser();
      const first = "\n[\"x\"]\n";
      const second = "\n[\"y\"]\n";
      const result = parser.parseFrameBuffer(`${frame(first)}\n \t${frame(second)}`);

      expect(result.frames).toEqual(["x", "y"]);
      expect(result.remainder).toBe("");
    });

    it("pushes JSON object frame as a single item", () => {
      const parser = new StreamParser();
      const payload = "\n{\"ok\":true}\n";
      const result = parser.parseFrameBuffer(frame(payload));

      expect(result.frames).toEqual([{ ok: true }]);
    });

    it("spreads nested JSON array into frames", () => {
      const parser = new StreamParser();
      const payload = "\n[[\"a\"],[\"b\"]]\n";
      const result = parser.parseFrameBuffer(frame(payload));

      expect(result.frames).toEqual([["a"], ["b"]]);
    });

    it("skips malformed JSON frame and continues", () => {
      const parser = new StreamParser();
      const bad = "\n{bad json}\n";
      const good = "\n[\"ok\"]\n";
      const result = parser.parseFrameBuffer(`${frame(bad)}${frame(good)}`);

      expect(result.frames).toEqual(["ok"]);
      expect(result.remainder).toBe("");
    });

    it("stops on invalid length marker", () => {
      const parser = new StreamParser();
      const content = "abc\n[1]\n";
      const result = parser.parseFrameBuffer(content);

      expect(result.frames).toEqual([]);
      expect(result.remainder).toBe(content);
    });

    it("handles zero-length frame", () => {
      const parser = new StreamParser();
      const result = parser.parseFrameBuffer("0");

      expect(result.frames).toEqual([]);
      expect(result.remainder).toBe("");
    });

    it("handles UTF-16 emoji length correctly", () => {
      const parser = new StreamParser();
      const payload = "\n[\"😀\"]\n";
      const result = parser.parseFrameBuffer(frame(payload));

      expect(result.frames).toEqual(["😀"]);
      expect(result.remainder).toBe("");
    });

    it("parses large frame with mixed content", () => {
      const parser = new StreamParser();
      const largeText = "x".repeat(5000);
      const payload = `\n${JSON.stringify([{"text":largeText,"n":123,"arr":[1,2,3],"ok":true}])}\n`;
      const result = parser.parseFrameBuffer(frame(payload));

      expect(result.frames).toHaveLength(1);
      expect(result.frames[0]).toEqual({ text: largeText, n: 123, arr: [1, 2, 3], ok: true });
      expect(result.remainder).toBe("");
    });
  });

  describe("extractFrames", () => {
    it("strips XSSI prefix and parses frames", () => {
      const parser = new StreamParser();
      const payload = "\n[\"xssi\"]\n";

      expect(parser.extractFrames(`)]}'${frame(payload)}`)).toEqual(["xssi"]);
    });

    it("parses framed response without XSSI prefix", () => {
      const parser = new StreamParser();
      const payload = "\n[\"plain\"]\n";

      expect(parser.extractFrames(frame(payload))).toEqual(["plain"]);
    });

    it("falls back to direct JSON parse when no frames found", () => {
      const parser = new StreamParser();

      expect(parser.extractFrames('[{"id":1}]')).toEqual([{ id: 1 }]);
    });

    it("returns empty array for invalid input", () => {
      const parser = new StreamParser();

      expect(parser.extractFrames("not-json and not-framed")).toEqual([]);
    });

    it("parses real-world-like multiple frames", () => {
      const parser = new StreamParser();
      const first = "\n[[\"wrb.fr\",null,null,null,null]]\n";
      const second = "\n[[\"wrb.fr\",\"ESY5D\",\"{\\\"some\\\":\\\"json\\\"}\",null,null,null,\"generic\"]]\n";

      const frames = parser.extractFrames(`)]}'\n${frame(first)}${frame(second)}`);
      expect(frames).toEqual([
        ["wrb.fr", null, null, null, null],
        ["wrb.fr", "ESY5D", '{"some":"json"}', null, null, null, "generic"]
      ]);
    });
  });
});
