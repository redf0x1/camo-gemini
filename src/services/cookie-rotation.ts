import type { CamofoxClient } from "../client/camofox-client.js";
import type { StateManager } from "../state.js";
import type { Config, CookieRotationResult } from "../types.js";
import { COOKIE_ROTATION_INTERVAL_MS, Endpoint } from "../core/constants.js";
import { logger } from "../core/logger.js";

export class CookieRotationService {
  private intervals = new Map<number, ReturnType<typeof setTimeout>>();
  private paused = new Set<number>();
  private lastErrors = new Map<number, string | null>();

  constructor(
    private client: CamofoxClient,
    private state: StateManager,
    private config: Config
  ) {}

  startRotation(accountIndex: number): void {
    if (this.intervals.has(accountIndex)) {
      return;
    }

    this.scheduleNext(accountIndex);
  }

  stopRotation(accountIndex: number): void {
    const timer = this.intervals.get(accountIndex);
    if (timer) {
      clearTimeout(timer);
      this.intervals.delete(accountIndex);
    }

    this.paused.delete(accountIndex);
    this.lastErrors.delete(accountIndex);
  }

  pauseRotation(accountIndex: number): void {
    this.paused.add(accountIndex);
  }

  resumeRotation(accountIndex: number): void {
    this.paused.delete(accountIndex);
  }

  stopAll(): void {
    for (const accountIndex of this.intervals.keys()) {
      this.stopRotation(accountIndex);
    }
  }

  start(): void {
    this.startRotation(0);
  }

  stop(): void {
    this.stopRotation(0);
  }

  isRunning(accountIndex = 0): boolean {
    return this.intervals.has(accountIndex);
  }

  getLastError(accountIndex = 0): string | null {
    return this.lastErrors.get(accountIndex) ?? null;
  }

  async rotateOnce(accountIndex = 0): Promise<CookieRotationResult> {
    const entry = this.state.getAccount(accountIndex);
    if (!entry?.session) {
      return { ok: false, error: `No active session for account ${accountIndex}` };
    }

    const userId = entry.camofoxUserId;
    let ephemeralTabId: string | null = null;

    try {
      const tab = await this.client.createTab("https://accounts.google.com", userId, `cookie-rotation-${accountIndex}`);
      ephemeralTabId = tab.tabId;

      await this.delay(1000);

      const rotationJs = `(async () => {
        try {
          const resp = await fetch('${Endpoint.ROTATE_COOKIES}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '[000,"-0000000000000000000"]',
            credentials: 'include'
          });
          return { ok: resp.ok, status: resp.status };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })()`;

      const result = await this.client.evaluate(ephemeralTabId, rotationJs, userId, 10000);
      if (!result.ok) {
        return { ok: false, error: `Evaluate failed: ${result.error ?? "unknown error"}` };
      }

      const data = result.result as CookieRotationResult | undefined;
      if (data?.ok) {
        this.state.recordRotation(accountIndex);
      }

      return data ?? { ok: false, error: "Missing rotation result" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      if (ephemeralTabId) {
        try {
          await this.client.closeTab(ephemeralTabId, userId);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  private scheduleNext(accountIndex: number): void {
    const timerId = setTimeout(async () => {
      if (!this.intervals.has(accountIndex)) {
        return;
      }

      if (this.paused.has(accountIndex)) {
        this.scheduleNext(accountIndex);
        return;
      }

      try {
        const result = await this.rotateOnce(accountIndex);
        this.lastErrors.set(accountIndex, result.ok ? null : (result.error ?? "Unknown rotation error"));
        if (!result.ok) {
          logger.warn("rotation", "Cookie rotation failed", { accountIndex });
        }
      } catch (error) {
        this.lastErrors.set(accountIndex, error instanceof Error ? error.message : String(error));
        logger.warn("rotation", "Cookie rotation failed", { accountIndex });
      }

      this.scheduleNext(accountIndex);
    }, COOKIE_ROTATION_INTERVAL_MS);

    this.intervals.set(accountIndex, timerId);
    if (typeof timerId === "object" && "unref" in timerId) {
      timerId.unref();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      if (typeof id === "object" && "unref" in id) {
        id.unref();
      }
    });
  }
}
