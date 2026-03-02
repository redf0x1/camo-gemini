import type { StateManager } from "../state.js";
import { RetryExhaustedError } from "../errors.js";
import { classifyError } from "./retry.js";
import { logger } from "./logger.js";

export interface FailoverOptions {
  /** Account index to try first */
  accountIndex: number;
  /** Maximum failover attempts (default: 2) */
  maxFailovers?: number;
}

export interface FailoverResult<T> {
  result: T;
  /** Account index that actually succeeded */
  usedAccountIndex: number;
  /** Number of failover attempts */
  failoverCount: number;
}

/**
 * Execute operation with automatic account failover.
 * On retryable/rate_limited errors, tries next healthy account.
 * On fatal errors, does NOT failover.
 */
export async function withFailover<T>(
  state: StateManager,
  options: FailoverOptions,
  operation: (accountIndex: number) => Promise<T>
): Promise<FailoverResult<T>> {
  const maxFailovers = options.maxFailovers ?? 2;
  let currentIndex = options.accountIndex;
  let failoverCount = 0;
  let lastError: Error | undefined;
  const tried = new Set<number>();

  while (failoverCount <= maxFailovers) {
    tried.add(currentIndex);
    try {
      const result = await operation(currentIndex);
      state.recordSuccess(currentIndex);
      return { result, usedAccountIndex: currentIndex, failoverCount };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      state.recordError(currentIndex);

      if (!(error instanceof RetryExhaustedError)) {
        const classification = classifyError(error);
        if (classification === "fatal") {
          throw error;
        }
      }

      const next = state.getNextHealthyAccount(currentIndex);
      if (!next || tried.has(next.accountIndex)) {
        throw error;
      }

      logger.warn("failover", "Switching account", {
        fromIndex: currentIndex,
        toIndex: next.accountIndex,
        reason: error.message
      });

      currentIndex = next.accountIndex;
      failoverCount += 1;
    }
  }

  throw lastError ?? new Error("Failover exhausted");
}
