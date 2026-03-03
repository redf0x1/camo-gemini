import {
  API_ERROR_CODES,
  CARD_CONTENT_PATTERN,
  GOOGLE_USER_CONTENT_PATTERN,
  IMAGE_GEN_BLOCKED_PATTERNS,
  RATE_LIMIT_PATTERNS
} from "./constants.js";
import { getNestedValue } from "./utils.js";
import { logger } from "./logger.js";
import type {
  ImageData,
  ModelOutput,
  ParseError,
  ParsedCandidate,
  ParseResult
} from "../types.js";

export class ResponseParser {
  private static readonly IMAGE_COLLECTION_PATTERN =
    /https?:\/\/googleusercontent\.com\/image_collection\/image_retrieval\/[\w]+/g;

  static extractActionInputPrompt(text: string): string | null {
    if (!text || !text.includes("action_input")) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return null;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const action = (parsed as { action?: unknown }).action;
    const actionInput = (parsed as { action_input?: unknown }).action_input;
    if (action !== "image_generation" || typeof actionInput !== "string") {
      return null;
    }

    const trimmedActionInput = actionInput.trim();
    if (!trimmedActionInput) {
      return null;
    }

    try {
      const parsedActionInput = JSON.parse(trimmedActionInput) as unknown;
      if (typeof parsedActionInput === "object" && parsedActionInput !== null) {
        const prompt = (parsedActionInput as { prompt?: unknown }).prompt;
        if (typeof prompt === "string" && prompt.trim()) {
          return prompt.trim();
        }
      }
    } catch {
      // Fall through to Python dict extraction.
    }

    const pythonDictMatch = trimmedActionInput.match(/^\{\s*['"]prompt['"]\s*:\s*['"]([^'"\r\n]{1,2000})['"]\s*\}$/);
    if (pythonDictMatch?.[1]?.trim()) {
      return pythonDictMatch[1].trim();
    }

    return trimmedActionInput;
  }

  parseGenerateResponse(frames: unknown[]): ParseResult<ModelOutput> {
    let result: ModelOutput | null = null;
    let metadata: (string | null)[] = [];
    let isCompleted = false;

    for (const part of frames) {
      const errorCode = getNestedValue<number>(part, [5, 2, 0, 1, 0]);
      if (typeof errorCode === "number") {
        return { ok: false, error: this.mapErrorCode(errorCode) };
      }

      const innerStr = getNestedValue<string>(part, [2]);
      if (typeof innerStr !== "string" || !innerStr) {
        continue;
      }

      let inner: unknown;
      try {
        inner = JSON.parse(innerStr) as unknown;
      } catch {
        continue;
      }

      const maybeMetadata = getNestedValue<unknown[]>(inner, [1]);
      if (Array.isArray(maybeMetadata)) {
        metadata = maybeMetadata.map((value) => {
          if (typeof value === "string" || value === null) {
            return value;
          }
          return null;
        });
      }

      const contextStr = getNestedValue<string>(inner, [25]);
      if (typeof contextStr === "string") {
        isCompleted = true;
      }

      const candidatePaths: number[][] = [[4], [0, 0, 3], [0, 4]];
      let candidatesList: unknown[] = [];
      for (const path of candidatePaths) {
        const extracted = getNestedValue<unknown[]>(inner, path, []);
        if (Array.isArray(extracted) && extracted.length > 0) {
          candidatesList = extracted;
          break;
        }
      }
      if (!Array.isArray(candidatesList) || candidatesList.length === 0) {
        continue;
      }

      const parsedCandidates: ParsedCandidate[] = [];
      for (const candidate of candidatesList) {
        if (!Array.isArray(candidate)) {
          continue;
        }

        const rcid = getNestedValue<string>(candidate, [0]);
        if (typeof rcid !== "string" || !rcid) {
          continue;
        }

        let text = this.extractCandidateText(candidate);
        const textError = this.checkRateLimit(text);
        if (textError) {
          return { ok: false, error: textError };
        }

        const thoughts = getNestedValue<string>(candidate, [37, 0, 0]);
        const completionObj = getNestedValue<unknown>(candidate, [2]);
        const status = getNestedValue<number>(candidate, [8, 0], 1);

        let generatedImages = this.parseGeneratedImages(candidate);
        if (generatedImages.length === 0) {
          const textFallback = this.extractGeneratedImagesFromText(text);
          if (textFallback.generatedImages.length > 0) {
            generatedImages = textFallback.generatedImages;
            text = textFallback.cleanedText;
            logger.info("response-parser", "Using text-based generated image extraction fallback", {
              rcid,
              extractedCount: generatedImages.length
            });
          }
        }

        parsedCandidates.push({
          rcid,
          text,
          thoughts: typeof thoughts === "string" ? thoughts : null,
          webImages: this.parseWebImages(candidate),
          generatedImages,
          isFinal: (typeof completionObj === "object" && completionObj !== null) || status === 2
        });
      }

      if (parsedCandidates.length === 0) {
        continue;
      }

      result = {
        metadata,
        candidates: parsedCandidates,
        chosenIndex: 0,
        isCompleted
      };
    }

    if (!result) {
      logger.warn("response-parser", "No candidates found — raw frame structure", {
        frameCount: frames.length,
        firstFramePreview: JSON.stringify(frames[0])?.substring(0, 2000),
        firstFrameTopLevelPreview: Array.isArray(frames[0])
          ? JSON.stringify(frames[0].slice(0, 20))
          : JSON.stringify(frames[0] && typeof frames[0] === "object"
            ? Object.keys(frames[0] as Record<string, unknown>).slice(0, 20)
            : frames[0])
      });
      return {
        ok: false,
        error: {
          code: "PARSE_ERROR",
          message: "No candidates found in response"
        }
      };
    }

    return { ok: true, data: result };
  }

  parseBatchResponse(frames: unknown[], rpcId: string): ParseResult<unknown> {
    for (const part of frames) {
      const frameRpcId = getNestedValue<string>(part, [1]);
      if (frameRpcId !== rpcId) {
        continue;
      }

      const innerStr = getNestedValue<string>(part, [2]);
      if (typeof innerStr !== "string") {
        return { ok: true, data: null };
      }

      try {
        return { ok: true, data: JSON.parse(innerStr) as unknown };
      } catch {
        return {
          ok: false,
          error: {
            code: "PARSE_ERROR",
            message: `Failed to parse RPC ${rpcId} payload`,
            raw: innerStr
          }
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "PARSE_ERROR",
        message: `RPC ${rpcId} not found`
      }
    };
  }

  private mapErrorCode(code: number): ParseError {
    switch (code) {
      case API_ERROR_CODES.TEMPORARY_ERROR_1013:
        return { code: "TEMPORARY_ERROR", message: "Temporary Gemini error", raw: code };
      case API_ERROR_CODES.USAGE_LIMIT_EXCEEDED:
        return { code: "USAGE_LIMIT_EXCEEDED", message: "Usage limit exceeded", raw: code };
      case API_ERROR_CODES.MODEL_INCONSISTENT:
        return { code: "MODEL_INCONSISTENT", message: "Model is inconsistent", raw: code };
      case API_ERROR_CODES.MODEL_HEADER_INVALID:
        return { code: "MODEL_HEADER_INVALID", message: "Model header is invalid", raw: code };
      case API_ERROR_CODES.IP_TEMPORARILY_BLOCKED:
        return { code: "IP_BLOCKED", message: "IP is temporarily blocked", raw: code };
      default:
        return {
          code: "UNKNOWN_API_ERROR",
          message: `Unknown Gemini API error code: ${code}`,
          raw: code
        };
    }
  }

  private extractCandidateText(candidateData: unknown[]): string {
    const primary = getNestedValue<string>(candidateData, [1, 0], "") ?? "";
    const fallback = getNestedValue<string>(candidateData, [22, 0], "") ?? "";
    const sourceText = CARD_CONTENT_PATTERN.test(primary) ? (fallback || primary) : primary;
    const cleaned = sourceText.replace(GOOGLE_USER_CONTENT_PATTERN, "").trim();
    return this.unescapeHtml(cleaned);
  }

  private parseWebImages(candidateData: unknown[]): ImageData[] {
    const imageItems = getNestedValue<unknown[]>(candidateData, [12, 1], []);
    if (!Array.isArray(imageItems)) {
      return [];
    }

    const images: ImageData[] = [];
    for (const item of imageItems) {
      const url = getNestedValue<string>(item, [0, 0, 0]);
      if (typeof url !== "string" || !url) {
        continue;
      }

      const title = getNestedValue<string>(item, [7, 0]);
      const alt = getNestedValue<string>(item, [0, 4]);
      images.push({
        url,
        ...(typeof title === "string" && title ? { title } : {}),
        ...(typeof alt === "string" && alt ? { alt } : {})
      });
    }

    return images;
  }

  private parseGeneratedImages(candidateData: unknown[]): ImageData[] {
    const imagePaths: number[][] = [[12, 7, 0], [12, 7], [12, 0, 7, 0], [12, 0, 7]];
    let imageItems: unknown[] = [];
    let matchedPath: number[] | null = null;
    for (const p of imagePaths) {
      const ex = getNestedValue<unknown[]>(candidateData, p, []);
      if (Array.isArray(ex) && ex.length > 0) { imageItems = ex; matchedPath = p; break; }
    }
    if (matchedPath && matchedPath.join(".") !== "12.7.0") {
      logger.warn("response-parser", "Non-primary generated image path matched", { path: matchedPath.join(".") });
    }
    if (imageItems.length === 0) {
      return [];
    }

    const images: ImageData[] = [];
    for (const item of imageItems) {
      const url = getNestedValue<string>(item, [0, 3, 3]);
      if (typeof url !== "string" || !url) {
        continue;
      }

      const alt = getNestedValue<string>(item, [3, 5, 0]);
      images.push({
        url,
        title: "generated",
        ...(typeof alt === "string" && alt ? { alt } : {})
      });
    }

    return images;
  }

  private extractGeneratedImagesFromText(text: string): {
    generatedImages: ImageData[];
    cleanedText: string;
  } {
    const matches = text.match(ResponseParser.IMAGE_COLLECTION_PATTERN);
    if (!matches || matches.length === 0) {
      return { generatedImages: [], cleanedText: text };
    }

    const generatedImages: ImageData[] = matches.map((url) => ({
      url,
      title: "generated"
    }));

    const cleanedText = text.replace(ResponseParser.IMAGE_COLLECTION_PATTERN, "").trim();
    return { generatedImages, cleanedText };
  }

  private checkRateLimit(text: string): ParseError | null {
    if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        code: "RATE_LIMITED",
        message: "Rate limited by Gemini",
        raw: text
      };
    }

    if (IMAGE_GEN_BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        code: "IMAGE_GEN_BLOCKED",
        message: "Image generation is currently blocked",
        raw: text
      };
    }

    return null;
  }

  private unescapeHtml(text: string): string {
    const unescaped = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');

    return unescaped.replace(/&#(\d+);/g, (full, decimal) => {
      const code = Number.parseInt(decimal, 10);
      if (Number.isNaN(code)) {
        return full;
      }
      return String.fromCharCode(code);
    });
  }
}
