import { ZodError } from "zod";
import { formatFriendlyError } from "./core/error-messages.js";

export type ErrorCode =
  | "CONNECTION_REFUSED"
  | "TAB_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "API_KEY_REQUIRED"
  | "TIMEOUT"
  | "VALIDATION_ERROR"
  | "NOT_IMPLEMENTED"
  | "GEMINI_AUTH_FAILED"
  | "GEMINI_RATE_LIMITED"
  | "GEMINI_TEMPORARY_ERROR"
  | "NOT_AUTHENTICATED"
  | "TOKEN_EXTRACTION_FAILED"
  | "COOKIE_ROTATION_FAILED"
  | "SESSION_EXPIRED"
  | "CAMOFOX_UNAVAILABLE"
  | "RETRY_EXHAUSTED"
  | "INTERNAL_ERROR";

export const GEMINI_ERROR = {
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  TOKEN_EXTRACTION_FAILED: "TOKEN_EXTRACTION_FAILED",
  COOKIE_ROTATION_FAILED: "COOKIE_ROTATION_FAILED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  CAMOFOX_UNAVAILABLE: "CAMOFOX_UNAVAILABLE"
} as const;

export class AppError extends Error {
  public readonly code: ErrorCode;

  public readonly status?: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class RetryExhaustedError extends AppError {
  constructor(attempts: number, lastError: Error) {
    super("RETRY_EXHAUSTED", `Retry exhausted after ${attempts} attempts: ${lastError.message}`);
    this.name = "RetryExhaustedError";
    this.cause = lastError;
  }
}

export interface ToolResult {
  [key: string]: unknown;
  isError?: boolean;
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        data: string;
        mimeType: string;
      }
  >;
}

export function okResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }]
  };
}

export function toErrorResult(error: unknown): ToolResult {
  if (error instanceof Error) {
    return {
      isError: true,
      content: [{ type: "text", text: formatFriendlyError(error) }]
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: String(error) }]
  };
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", error.issues.map((issue) => issue.message).join(", "));
  }

  if (error instanceof Error) {
    if (/not implemented/i.test(error.message)) {
      return new AppError("NOT_IMPLEMENTED", error.message);
    }
    return new AppError("INTERNAL_ERROR", error.message);
  }

  return new AppError("INTERNAL_ERROR", "An unknown internal error occurred");
}
