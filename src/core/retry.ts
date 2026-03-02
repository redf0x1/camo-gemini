import { RetryExhaustedError } from "../errors.js";
import type { ParseErrorCode } from "../types.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_FACTOR } from "./constants.js";

export type ErrorClassification = "retryable" | "rate_limited" | "failover_only" | "fatal";

export interface RetryOptions {
  maxRetries: number;
  delayFactor: number;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: DEFAULT_MAX_RETRIES,
  delayFactor: DEFAULT_RETRY_DELAY_FACTOR
};

const RETRYABLE_PARSE_CODES: ParseErrorCode[] = ["TEMPORARY_ERROR"];
const RATE_LIMIT_PARSE_CODES: ParseErrorCode[] = ["RATE_LIMITED", "USAGE_LIMIT_EXCEEDED"];
const FAILOVER_ONLY_PARSE_CODES: ParseErrorCode[] = ["IMAGE_GEN_BLOCKED"];
const FATAL_PARSE_CODES: ParseErrorCode[] = [
  "IP_BLOCKED",
  "MODEL_INCONSISTENT",
  "MODEL_HEADER_INVALID",
  "UNKNOWN_API_ERROR",
  "PARSE_ERROR"
];

interface ErrorLike {
  code?: unknown;
  errorType?: unknown;
  status?: unknown;
  ok?: unknown;
  error?: unknown;
  message?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string") {
    return new Error(value);
  }

  if (typeof value === "object" && value !== null && "message" in value) {
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
      return new Error(maybeMessage);
    }
  }

  return new Error("Unknown error");
}

function readParseCode(error: unknown): ParseErrorCode | null {
  const asObj = error as ErrorLike;

  if (typeof asObj?.code === "string") {
    return asObj.code as ParseErrorCode;
  }

  if (asObj?.ok === false && typeof asObj.error === "object" && asObj.error !== null) {
    const nestedCode = (asObj.error as ErrorLike).code;
    if (typeof nestedCode === "string") {
      return nestedCode as ParseErrorCode;
    }
  }

  return null;
}

function has429Status(error: unknown): boolean {
  const asObj = error as ErrorLike;
  if (asObj?.status === 429) {
    return true;
  }

  const nestedStatus = (asObj?.error as ErrorLike | undefined)?.status;
  if (nestedStatus === 429) {
    return true;
  }

  const message = toError(error).message;
  return /\b429\b/.test(message) || /rate\s*limit/i.test(message);
}

export function classifyError(error: unknown): ErrorClassification {
  const parseCode = readParseCode(error);
  if (parseCode) {
    if (RETRYABLE_PARSE_CODES.includes(parseCode)) {
      return "retryable";
    }

    if (RATE_LIMIT_PARSE_CODES.includes(parseCode)) {
      return "rate_limited";
    }

    if (FAILOVER_ONLY_PARSE_CODES.includes(parseCode)) {
      return "failover_only";
    }

    if (FATAL_PARSE_CODES.includes(parseCode)) {
      return "fatal";
    }
  }

  const asObj = error as ErrorLike;
  if (typeof asObj?.errorType === "string") {
    if (asObj.errorType === "timeout") {
      return "retryable";
    }

    if (asObj.errorType === "js_error") {
      return "retryable";
    }
  }

  if (has429Status(error)) {
    return "rate_limited";
  }

  const normalized = toError(error);
  if (/timeout|timed out|econnreset|enotfound|network|failed to fetch|networkerror|fetch error/i.test(normalized.message)) {
    return "retryable";
  }

  if (normalized.name === "AbortError") {
    return "retryable";
  }

  return "fatal";
}

export function calculateDelay(attempt: number, maxRetries: number, delayFactor: number): number {
  // Intentionally decreasing delay to match Python implementation:
  // (maxRetries - currentAttempt + 1) * delayFactor.
  return Math.max(0, (maxRetries - attempt + 1) * delayFactor);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const retryOptions: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const normalized = toError(error);
      const classification = classifyError(error);
      const isExhausted = attempt >= retryOptions.maxRetries;

      if (classification === "fatal") {
        throw normalized;
      }

      if (classification === "failover_only") {
        throw new RetryExhaustedError(attempt + 1, normalized);
      }

      if (isExhausted) {
        throw new RetryExhaustedError(attempt + 1, normalized);
      }

      const baseDelay = calculateDelay(attempt, retryOptions.maxRetries, retryOptions.delayFactor);
      const delay = classification === "rate_limited" ? baseDelay * 2 : baseDelay;
      retryOptions.onRetry?.(attempt + 1, normalized, delay);
      await sleep(delay * 1000);
    }
  }

  throw new Error("Unreachable retry state");
}
