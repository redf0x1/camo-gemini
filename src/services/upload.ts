import { randomUUID } from "node:crypto";

import type { CamofoxClient } from "../client/camofox-client.js";
import { buildUploadChunkPushExpression, buildUploadFinalizeExpression } from "../core/browser-js.js";
import { MAX_UPLOAD_SIZE_BYTES, UPLOAD_URL } from "../core/constants.js";
import { withRetry } from "../core/retry.js";
import { AppError } from "../errors.js";
import type { Config, UploadOptions, UploadResult } from "../types.js";
import type { AuthService } from "./auth.js";

const BASE64_CHUNK_SIZE = 40 * 1024;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg"
};

export interface UploadServiceDeps {
  client: CamofoxClient;
  auth: AuthService;
  config: Config;
}

interface BrowserUploadResult {
  ok: boolean;
  data?: string;
  error?: string;
}

export class UploadService {
  constructor(private deps: UploadServiceDeps) {}

  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const estimatedSizeBytes = Math.ceil(options.fileBase64.length * (3 / 4));
    if (estimatedSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Upload failed for ${options.filename}: file size ${estimatedSizeBytes} bytes exceeds max ${MAX_UPLOAD_SIZE_BYTES} bytes`
      );
    }

    const accountIndex = options.accountIndex ?? 0;
    const mimeType = options.mimeType ?? this.detectMimeType(options.filename);

    this.deps.auth.pauseRotation(accountIndex);
    try {
      return await withRetry(async () => {
        const session = await this.deps.auth.ensureSession(accountIndex);
        const tokens = await this.deps.auth.getTokens(accountIndex);
        const uploadId = randomUUID();
        const chunks = this.splitIntoChunks(options.fileBase64);
        let chunkFailed = false;

        try {
          for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index] ?? "";
            const expression = buildUploadChunkPushExpression(uploadId, chunk, index);
            const chunkResult = await this.deps.client.evaluate(session.tabId, expression, session.userId);
            if (!chunkResult.ok) {
              chunkFailed = true;
              throw new Error(`Chunk ${index} push failed: ${chunkResult.error ?? "unknown error"}`);
            }
          }

          const finalizeExpression = buildUploadFinalizeExpression({
            uploadId,
            filename: options.filename,
            mimeType,
            uploadUrl: UPLOAD_URL,
            snlm0e: tokens.snlm0e,
            accountIndex
          });

          const finalizeResult = await this.deps.client.evaluateExtended(
            session.tabId,
            finalizeExpression,
            session.userId,
            120_000
          );

          if (!finalizeResult.ok) {
            throw new Error(`Upload finalize evaluate failed: ${finalizeResult.error ?? "unknown error"}`);
          }

          const parsed = finalizeResult.result as BrowserUploadResult | undefined;
          if (!parsed?.ok) {
            throw new Error(`Upload finalize failed: ${parsed?.error ?? "unknown error"}`);
          }

          if (typeof parsed.data !== "string" || parsed.data.length === 0) {
            throw new Error("Upload finalize failed: missing file URI");
          }

          return {
            fileUri: parsed.data,
            filename: options.filename
          };
        } catch (error) {
          if (chunkFailed) {
            await this.cleanupPartialUpload(session.tabId, session.userId, uploadId);
          }
          throw error;
        }
      }, { maxRetries: 2 });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new AppError("INTERNAL_ERROR", `Upload failed for ${options.filename}: ${message}`);
    } finally {
      this.deps.auth.resumeRotation(accountIndex);
    }
  }

  private splitIntoChunks(base64: string): string[] {
    if (base64.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < base64.length; offset += BASE64_CHUNK_SIZE) {
      chunks.push(base64.slice(offset, offset + BASE64_CHUNK_SIZE));
    }

    return chunks;
  }

  private detectMimeType(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex < 0) {
      return "application/octet-stream";
    }

    const extension = filename.slice(dotIndex).toLowerCase();
    return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
  }

  private async cleanupPartialUpload(tabId: string, userId: string, uploadId: string): Promise<void> {
    const globalKey = `__cg_upload_${uploadId}`;
    const cleanupExpression = `delete window[${JSON.stringify(globalKey)}]; true`;

    try {
      await this.deps.client.evaluate(tabId, cleanupExpression, userId);
    } catch {
      // cleanup is best-effort
    }
  }
}
