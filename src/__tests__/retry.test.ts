import { afterEach, describe, expect, it, vi } from "vitest";

import { RetryExhaustedError } from "../errors.js";
import { calculateDelay, withRetry } from "../core/retry.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retry", () => {
  it("succeeds on first try with no retry callback", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(withRetry(fn, { onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("succeeds on third attempt after two retries", async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "TEMPORARY_ERROR", message: "temp-1" })
      .mockRejectedValueOnce({ code: "TEMPORARY_ERROR", message: "temp-2" })
      .mockResolvedValue("done");
    const onRetry = vi.fn();

    const promise = withRetry(fn, { onRetry });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 30);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 25);
  });

  it("does not retry fatal errors", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "IP_BLOCKED", message: "blocked" });
    const onRetry = vi.fn();

    await expect(withRetry(fn, { onRetry })).rejects.toThrow("blocked");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("retries rate-limited errors with doubled delay", async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "RATE_LIMITED", message: "rl-1" })
      .mockRejectedValueOnce({ status: 429, message: "rl-2" })
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    const promise = withRetry(fn, { onRetry });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 60);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 50);
  });

  it("throws RetryExhaustedError when max retries are exhausted", async () => {
    vi.useFakeTimers();

    const fn = vi.fn().mockRejectedValue({ code: "TEMPORARY_ERROR", message: "still failing" });
    const promise = withRetry(fn, { maxRetries: 2, delayFactor: 1 });
    const handled = promise.catch((error) => error);
    await vi.runAllTimersAsync();

    const rejection = await handled;
    expect(rejection).toBeInstanceOf(RetryExhaustedError);
    expect((rejection as Error).message).toContain("Retry exhausted after 3 attempts");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calculates decreasing delay values", () => {
    expect(calculateDelay(0, 5, 5)).toBe(30);
    expect(calculateDelay(1, 5, 5)).toBe(25);
    expect(calculateDelay(2, 5, 5)).toBe(20);
    expect(calculateDelay(3, 5, 5)).toBe(15);
    expect(calculateDelay(4, 5, 5)).toBe(10);
    expect(calculateDelay(5, 5, 5)).toBe(5);
  });

  it("calls onRetry with attempt number, error, and delay", async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce({ errorType: "timeout", message: "slow" })
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    const promise = withRetry(fn, { maxRetries: 1, delayFactor: 2, onRetry });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toBe(1);
    expect(onRetry.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    expect(onRetry.mock.calls[0]?.[2]).toBe(4);
  });
});
