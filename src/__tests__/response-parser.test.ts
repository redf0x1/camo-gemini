import { describe, expect, it, vi } from "vitest";

import { logger } from "../core/logger.js";
import { ResponseParser } from "../core/response-parser.js";
import { StreamParser } from "../core/stream-parser.js";

function makeErrorFrame(errorCode: number): unknown[] {
  const part: unknown[] = [];
  const level5: unknown[] = [];
  const level2: unknown[] = [];
  const level0: unknown[] = [];
  const level1: unknown[] = [];

  level1[0] = errorCode;
  level0[1] = level1;
  level2[0] = level0;
  level5[2] = level2;
  part[5] = level5;

  return part;
}

function makeCandidate(
  rcid: string,
  text: string,
  options?: {
    thoughts?: string;
    webImages?: boolean;
    generatedImages?: boolean;
    finalByObject?: boolean;
    finalByStatus?: boolean;
    cardContentFallback?: string;
  }
): unknown[] {
  const candidate: unknown[] = [];
  candidate[0] = rcid;
  candidate[1] = [text];

  if (options?.finalByObject) {
    candidate[2] = { done: true };
  }

  if (options?.finalByStatus) {
    candidate[8] = [2];
  }

  if (options?.thoughts) {
    candidate[37] = [[options.thoughts]];
  }

  if (options?.cardContentFallback) {
    candidate[22] = [options.cardContentFallback];
  }

  if (options?.webImages || options?.generatedImages) {
    const media: unknown[] = [];

    if (options.webImages) {
      const webImage: unknown[] = [];
      const webImageMeta: unknown[] = [];
      const webImageUrlNode: unknown[] = [];
      webImageUrlNode[0] = "https://example.com/web.jpg";
      webImageMeta[0] = webImageUrlNode;
      webImageMeta[4] = "web alt";
      webImage[0] = webImageMeta;
      webImage[7] = ["web title"];

      media[1] = [webImage];
    }

    if (options.generatedImages) {
      const generatedImage: unknown[] = [];
      const generatedImageUrlNode: unknown[] = [];
      generatedImageUrlNode[3] = "https://example.com/generated.png";
      generatedImage[0] = [];
      (generatedImage[0] as unknown[])[3] = generatedImageUrlNode;

      generatedImage[3] = [];
      (generatedImage[3] as unknown[])[5] = ["generated alt"];

      media[7] = [[generatedImage]];
    }

    candidate[12] = media;
  }

  return candidate;
}

function makeDataFrame(options: {
  metadata?: unknown[];
  candidates?: unknown[];
  completed?: boolean;
  malformedInnerJson?: boolean;
  noInner?: boolean;
}): unknown[] {
  const part: unknown[] = [];

  if (options.noInner) {
    return part;
  }

  if (options.malformedInnerJson) {
    part[2] = "{bad-json";
    return part;
  }

  const inner: unknown[] = [];
  if (options.metadata) {
    inner[1] = options.metadata;
  }
  if (options.candidates) {
    inner[4] = options.candidates;
  }
  if (options.completed) {
    inner[25] = "context-complete";
  }

  part[2] = JSON.stringify(inner);
  return part;
}

function makeGeneratedImageItem(
  url = "https://example.com/generated.png",
  alt = "generated alt"
): unknown[] {
  const generatedImage: unknown[] = [];
  const generatedImageUrlNode: unknown[] = [];
  generatedImageUrlNode[3] = url;
  generatedImage[0] = [];
  (generatedImage[0] as unknown[])[3] = generatedImageUrlNode;

  generatedImage[3] = [];
  (generatedImage[3] as unknown[])[5] = [alt];

  return generatedImage;
}

function makeFramedRaw(parts: unknown[]): string {
  const payload = `\n${JSON.stringify(parts)}\n`;
  return `)]}'\n${payload.length}${payload}`;
}

describe("ResponseParser.parseGenerateResponse", () => {
  it("returns one candidate for a simple response", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        metadata: ["cid-1", "rid-1", null],
        candidates: [makeCandidate("r1", "Hello world")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].text).toBe("Hello world");
    expect(result.data.metadata[0]).toBe("cid-1");
  });

  it("returns all candidates when multiple are present", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r1", "First"), makeCandidate("r2", "Second")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(2);
    expect(result.data.candidates.map((c) => c.rcid)).toEqual(["r1", "r2"]);
  });

  it("maps error code 1037 to USAGE_LIMIT_EXCEEDED", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(1037)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("USAGE_LIMIT_EXCEEDED");
  });

  it("maps error code 1060 to IP_BLOCKED", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(1060)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("IP_BLOCKED");
  });

  it("maps error code 1013 to TEMPORARY_ERROR", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(1013)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPORARY_ERROR");
  });

  it("maps error code 1050 to MODEL_INCONSISTENT", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(1050)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MODEL_INCONSISTENT");
  });

  it("maps error code 1052 to MODEL_HEADER_INVALID", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(1052)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MODEL_HEADER_INVALID");
  });

  it("maps unknown numeric API error code to UNKNOWN_API_ERROR", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([makeErrorFrame(9999)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNKNOWN_API_ERROR");
  });

  it("returns RATE_LIMITED on known rate-limit text", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r1", "I'm getting a lot of requests right now. Please try again later")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMITED");
  });

  it("returns IMAGE_GEN_BLOCKED on known image-generation blocked text", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r1", "I can search for images, but can't create any for you right now")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("IMAGE_GEN_BLOCKED");
  });

  it("returns IMAGE_GEN_BLOCKED for daily image quota exhaustion", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r1", "I can't generate more images for you today")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("IMAGE_GEN_BLOCKED");
  });

  it("returns PARSE_ERROR for empty frames", () => {
    const parser = new ResponseParser();
    const result = parser.parseGenerateResponse([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARSE_ERROR");
  });

  it("skips frames missing inner JSON and continues", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({ noInner: true }),
      makeDataFrame({ candidates: [makeCandidate("r1", "usable")] })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].text).toBe("usable");
  });

  it("skips malformed inner JSON and continues", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({ malformedInnerJson: true }),
      makeDataFrame({ candidates: [makeCandidate("r1", "valid after malformed") ] })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].text).toBe("valid after malformed");
  });

  it("skips metadata-only frame and parses next candidate frame", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({ metadata: ["cid-only", "rid-only"] }),
      makeDataFrame({ candidates: [makeCandidate("r1", "answer") ] })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(1);
  });

  it("marks output completed when completion marker exists", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        completed: true,
        candidates: [makeCandidate("r1", "done")]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isCompleted).toBe(true);
  });

  it("cleans googleusercontent artifacts and unescapes html entities", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [
          makeCandidate(
            "r1",
            "Answer &amp; &lt;ok&gt; &#39;q&#39; &quot;w&quot; &#65; http://googleusercontent.com/foo/123\n"
          )
        ]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].text).toBe("Answer & <ok> 'q' \"w\" A");
  });

  it("uses card_content fallback text when primary text is card URL", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [
          makeCandidate("r1", "http://googleusercontent.com/card_content/123", {
            cardContentFallback: "fallback text"
          })
        ]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].text).toBe("fallback text");
  });

  it("extracts web and generated images", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [
          makeCandidate("r1", "with images", {
            webImages: true,
            generatedImages: true
          })
        ]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const candidate = result.data.candidates[0];
    expect(candidate.webImages).toEqual([
      { url: "https://example.com/web.jpg", title: "web title", alt: "web alt" }
    ]);
    expect(candidate.generatedImages).toEqual([
      { url: "https://example.com/generated.png", title: "generated", alt: "generated alt" }
    ]);
  });

  it("extracts generated images from fallback path [12,7] and logs warning", () => {
    const parser = new ResponseParser();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const candidate = makeCandidate("r1", "with fallback images");
    candidate[12] = [];
    (candidate[12] as unknown[])[7] = [[], makeGeneratedImageItem("https://example.com/generated-fallback-127.png")];

    const frames = [
      makeDataFrame({
        candidates: [candidate]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].generatedImages).toEqual([
      {
        url: "https://example.com/generated-fallback-127.png",
        title: "generated",
        alt: "generated alt"
      }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      "response-parser",
      "Non-primary generated image path matched",
      { path: "12.7" }
    );
    warnSpy.mockRestore();
  });

  it("extracts generated images from fallback path [12,0,7,0] and logs warning", () => {
    const parser = new ResponseParser();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const candidate = makeCandidate("r1", "with fallback images");
    candidate[12] = [];
    (candidate[12] as unknown[])[7] = [];
    (candidate[12] as unknown[])[0] = [];
    ((candidate[12] as unknown[])[0] as unknown[])[7] = [[
      makeGeneratedImageItem("https://example.com/generated-fallback-12070.png")
    ]];

    const frames = [
      makeDataFrame({
        candidates: [candidate]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].generatedImages).toEqual([
      {
        url: "https://example.com/generated-fallback-12070.png",
        title: "generated",
        alt: "generated alt"
      }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      "response-parser",
      "Non-primary generated image path matched",
      { path: "12.0.7.0" }
    );
    warnSpy.mockRestore();
  });

  it("extracts generated images from fallback path [12,0,7] and logs warning", () => {
    const parser = new ResponseParser();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const candidate = makeCandidate("r1", "with fallback images");
    candidate[12] = [];
    (candidate[12] as unknown[])[7] = [];
    (candidate[12] as unknown[])[0] = [];
    ((candidate[12] as unknown[])[0] as unknown[])[7] = [
      [],
      makeGeneratedImageItem("https://example.com/generated-fallback-1207.png")
    ];

    const frames = [
      makeDataFrame({
        candidates: [candidate]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].generatedImages).toEqual([
      {
        url: "https://example.com/generated-fallback-1207.png",
        title: "generated",
        alt: "generated alt"
      }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      "response-parser",
      "Non-primary generated image path matched",
      { path: "12.0.7" }
    );
    warnSpy.mockRestore();
  });

  it("extracts thoughts when present", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r1", "answer", { thoughts: "reasoning..." })]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].thoughts).toBe("reasoning...");
  });

  it("detects isFinal from completion object", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({ candidates: [makeCandidate("r1", "final by object", { finalByObject: true })] })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].isFinal).toBe(true);
  });

  it("detects isFinal from status value", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({ candidates: [makeCandidate("r1", "final by status", { finalByStatus: true })] })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].isFinal).toBe(true);
  });

  it("skips candidate without rcid and continues gracefully", () => {
    const parser = new ResponseParser();
    const frames = [
      makeDataFrame({
        candidates: [
          (() => {
            const invalid: unknown[] = [];
            invalid[1] = ["missing rcid candidate"];
            return invalid;
          })(),
          makeCandidate("r2", "valid candidate")
        ]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].rcid).toBe("r2");
    expect(result.data.candidates[0].text).toBe("valid candidate");
  });

  it("parses candidates from alternate nested path used by some image responses", () => {
    const parser = new ResponseParser();
    const candidate = makeCandidate("r-alt", "image response candidate");
    const frame: unknown[] = [];
    const inner: unknown[] = [];
    const nested0: unknown[] = [];
    const nested00: unknown[] = [];
    nested00[3] = [candidate];
    nested0[0] = nested00;
    inner[0] = nested0;
    frame[2] = JSON.stringify(inner);

    const result = parser.parseGenerateResponse([frame]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].rcid).toBe("r-alt");
    expect(result.data.candidates[0].text).toBe("image response candidate");
  });
});

describe("ResponseParser.parseBatchResponse", () => {
  it("returns parsed inner JSON for matching rpcId", () => {
    const parser = new ResponseParser();
    const frames = [["wrb.fr", "targetRpc", JSON.stringify({ ok: true })]];

    const result = parser.parseBatchResponse(frames, "targetRpc");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ ok: true });
  });

  it("returns PARSE_ERROR when rpcId does not exist", () => {
    const parser = new ResponseParser();
    const frames = [["wrb.fr", "otherRpc", JSON.stringify({ ok: true })]];

    const result = parser.parseBatchResponse(frames, "targetRpc");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARSE_ERROR");
  });

  it("finds correct rpcId across multiple frames", () => {
    const parser = new ResponseParser();
    const frames = [
      ["wrb.fr", "rpcA", JSON.stringify({ a: 1 })],
      ["wrb.fr", "rpcB", JSON.stringify({ b: 2 })],
      ["wrb.fr", "targetRpc", JSON.stringify({ target: 3 })]
    ];

    const result = parser.parseBatchResponse(frames, "targetRpc");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ target: 3 });
  });

  it("returns PARSE_ERROR for malformed JSON in matched rpc frame", () => {
    const parser = new ResponseParser();
    const frames = [["wrb.fr", "targetRpc", "{bad json"]];

    const result = parser.parseBatchResponse(frames, "targetRpc");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARSE_ERROR");
  });

  it("returns successful null data when matching rpcId has missing payload", () => {
    const parser = new ResponseParser();
    const frames = [["wrb.fr", "targetRpc"]];

    const result = parser.parseBatchResponse(frames, "targetRpc");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });
});

describe("ResponseParser.extractGeneratedImagesFromText", () => {
  it("extracts a single image_collection URL and cleans text", () => {
    const parser = new ResponseParser();
    const text =
      "Before http://googleusercontent.com/image_collection/image_retrieval/12345_0 After";

    const result = (parser as unknown as {
      extractGeneratedImagesFromText: (value: string) => {
        generatedImages: Array<{ url: string; title: string }>;
        cleanedText: string;
      };
    }).extractGeneratedImagesFromText(text);

    expect(result.generatedImages).toEqual([
      {
        url: "http://googleusercontent.com/image_collection/image_retrieval/12345_0",
        title: "generated"
      }
    ]);
    expect(result.cleanedText).toBe("Before  After");
  });

  it("extracts multiple image_collection URLs", () => {
    const parser = new ResponseParser();
    const text =
      "A https://googleusercontent.com/image_collection/image_retrieval/111_0 B http://googleusercontent.com/image_collection/image_retrieval/222_1 C";

    const result = (parser as unknown as {
      extractGeneratedImagesFromText: (value: string) => {
        generatedImages: Array<{ url: string; title: string }>;
        cleanedText: string;
      };
    }).extractGeneratedImagesFromText(text);

    expect(result.generatedImages).toEqual([
      {
        url: "https://googleusercontent.com/image_collection/image_retrieval/111_0",
        title: "generated"
      },
      {
        url: "http://googleusercontent.com/image_collection/image_retrieval/222_1",
        title: "generated"
      }
    ]);
    expect(result.cleanedText).toBe("A  B  C");
  });

  it("returns no images and unchanged text when no URL matches", () => {
    const parser = new ResponseParser();
    const text = "No image links in this response";

    const result = (parser as unknown as {
      extractGeneratedImagesFromText: (value: string) => {
        generatedImages: Array<{ url: string; title: string }>;
        cleanedText: string;
      };
    }).extractGeneratedImagesFromText(text);

    expect(result.generatedImages).toEqual([]);
    expect(result.cleanedText).toBe(text);
  });

  it("removes URL while preserving surrounding text", () => {
    const parser = new ResponseParser();
    const text =
      "prefix\nhttp://googleusercontent.com/image_collection/image_retrieval/98765_0\nsuffix";

    const result = (parser as unknown as {
      extractGeneratedImagesFromText: (value: string) => {
        generatedImages: Array<{ url: string; title: string }>;
        cleanedText: string;
      };
    }).extractGeneratedImagesFromText(text);

    expect(result.generatedImages).toHaveLength(1);
    expect(result.cleanedText).toBe("prefix\n\nsuffix");
  });

  it("populates generatedImages from text-only fallback in parseGenerateResponse", () => {
    const parser = new ResponseParser();
    const fallbackUrl =
      "http://googleusercontent.com/image_collection/image_retrieval/12345_0";
    const frames = [
      makeDataFrame({
        candidates: [makeCandidate("r-text-fallback", `Here is your image ${fallbackUrl} enjoy!`)]
      })
    ];

    const result = parser.parseGenerateResponse(frames);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates[0].generatedImages).toEqual([
      {
        url: fallbackUrl,
        title: "generated"
      }
    ]);
    expect(result.data.candidates[0].text).toBe("Here is your image  enjoy!");
  });
});

describe("StreamParser + ResponseParser integration", () => {
  it("extracts frames and parses model output end-to-end", () => {
    const streamParser = new StreamParser();
    const responseParser = new ResponseParser();

    const part = makeDataFrame({
      metadata: ["cid-int", "rid-int"],
      candidates: [makeCandidate("r-int", "Integrated response")],
      completed: true
    });

    const raw = makeFramedRaw([part]);
    const frames = streamParser.extractFrames(raw);
    const parsed = responseParser.parseGenerateResponse(frames);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.metadata[0]).toBe("cid-int");
    expect(parsed.data.candidates[0].text).toBe("Integrated response");
    expect(parsed.data.isCompleted).toBe(true);
  });
});

describe("ResponseParser.extractActionInputPrompt", () => {
  it("extracts prompt from Python dict action_input", () => {
    const text = '{"action":"image_generation","action_input":"{\'prompt\':\'A cute cat\'}"}';

    const result = ResponseParser.extractActionInputPrompt(text);

    expect(result).toBe("A cute cat");
  });

  it("extracts prompt from JSON dict action_input", () => {
    const text = '{"action":"image_generation","action_input":"{\\"prompt\\":\\"A red car\\"}"}';

    const result = ResponseParser.extractActionInputPrompt(text);

    expect(result).toBe("A red car");
  });

  it("falls back to raw action_input string", () => {
    const text = '{"action":"image_generation","action_input":"A simple tree"}';

    const result = ResponseParser.extractActionInputPrompt(text);

    expect(result).toBe("A simple tree");
  });

  it("returns null for non-matching text", () => {
    expect(ResponseParser.extractActionInputPrompt("Hello world")).toBeNull();
  });

  it("returns null for non-image_generation action", () => {
    const text = '{"action":"web_search","action_input":"query"}';

    expect(ResponseParser.extractActionInputPrompt(text)).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(ResponseParser.extractActionInputPrompt("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(ResponseParser.extractActionInputPrompt("{bad json")).toBeNull();
  });

  it("returns null for empty action_input", () => {
    const text = '{"action":"image_generation","action_input":""}';

    expect(ResponseParser.extractActionInputPrompt(text)).toBeNull();
  });

  it("returns null for non-string action_input", () => {
    const text = '{"action":"image_generation","action_input":42}';

    expect(ResponseParser.extractActionInputPrompt(text)).toBeNull();
  });
});
