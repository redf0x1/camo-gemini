import type { CamofoxClient } from "../client/camofox-client.js";
import { TokenManager } from "../core/token-manager.js";
import { Endpoint, LOGIN_INITIAL_DELAY_MS, LOGIN_RETRY_DELAY_MS, TOKEN_REFRESH_DELAY_MS } from "../core/constants.js";
import { logger } from "../core/logger.js";
import { AppError, GEMINI_ERROR } from "../errors.js";
import type { StateManager } from "../state.js";
import type { Config, GeminiSession, GeminiTokens } from "../types.js";
import { CookieRotationService } from "./cookie-rotation.js";

export class AuthService {
  private tokenManager: TokenManager;
  private rotationService: CookieRotationService;
  private loginPromises = new Map<number, Promise<GeminiSession>>();
  private logoutCallbacks = new Set<(accountIndex: number) => void | Promise<void>>();
  private rotationPauseDepth = new Map<number, number>();
  private shouldResumeRotation = new Set<number>();

  constructor(
    private client: CamofoxClient,
    private state: StateManager,
    private config: Config
  ) {
    this.tokenManager = new TokenManager(client);
    this.rotationService = new CookieRotationService(client, state, config);
  }

  async login(accountIndex = 0): Promise<GeminiSession> {
    const inflight = this.loginPromises.get(accountIndex);
    if (inflight) {
      return inflight;
    }

    const promise = this._doLogin(accountIndex).finally(() => {
      this.loginPromises.delete(accountIndex);
    });
    this.loginPromises.set(accountIndex, promise);
    return promise;
  }

  private async _doLogin(accountIndex: number): Promise<GeminiSession> {
    const account = this.ensureAccount(accountIndex);
    const activeBefore = this.state.activeAccountIndex;
    const existing = this.state.getSession(accountIndex);
    if (
      existing?.authenticated &&
      existing.tokens &&
      this.tokenManager.isValid(existing.tokens)
    ) {
      const tabAlive = await this.isTabAlive(existing.tabId, account.camofoxUserId);
      if (tabAlive) {
        if (!this.rotationService.isRunning(accountIndex)) {
          this.rotationService.startRotation(accountIndex);
        }
        return existing;
      }

      this.state.clearSession(accountIndex);
    }

    const url = Endpoint.INIT(accountIndex);
    let tab: Awaited<ReturnType<CamofoxClient["createTab"]>>;
    try {
      tab = await this.client.createTab(url, account.camofoxUserId, `gemini-session-${accountIndex}`);
    } catch (error) {
      if (error instanceof AppError && error.status === 429) {
        await this.client.deleteSession(account.camofoxUserId);
        tab = await this.client.createTab(url, account.camofoxUserId, `gemini-session-${accountIndex}`);
      } else {
        throw error;
      }
    }

    try {
      await this.delay(LOGIN_INITIAL_DELAY_MS);

      let tokens: GeminiTokens;
      try {
        tokens = await this.tokenManager.extractTokens(tab.tabId, account.camofoxUserId);
      } catch {
        await this.delay(LOGIN_RETRY_DELAY_MS);
        tokens = await this.tokenManager.extractTokens(tab.tabId, account.camofoxUserId);
      }

      const session: GeminiSession = {
        tabId: tab.tabId,
        userId: account.camofoxUserId,
        accountIndex,
        authenticated: true,
        authenticatedEmail: null,
        tokens,
        lastRotation: Date.now()
      };

      try {
        const evalResult = await this.client.evaluate(
          tab.tabId,
          `(() => {
            const emailMeta = document.querySelector('meta[name="google-signin-email"]');
            if (emailMeta && typeof emailMeta.getAttribute === 'function') {
              const content = emailMeta.getAttribute('content');
              if (content && content.includes('@')) return content;
            }
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const text = script.textContent || '';
              const match = text.match(/["']([a-zA-Z0-9._%+-]+@(?:gmail\\.com|googlemail\\.com))["']/);
              if (match && match[1]) return match[1];

              const broadMatch = text.match(/["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})["']/);
              if (broadMatch && broadMatch[1]) return broadMatch[1];
            }
            return null;
          })()`,
          account.camofoxUserId
        );

        if (evalResult.ok && typeof evalResult.result === "string" && evalResult.result.includes("@")) {
          session.authenticatedEmail = evalResult.result;
        }
      } catch {
        session.authenticatedEmail = null;
      }

      this.state.setSession(accountIndex, session);
      if (activeBefore !== null && activeBefore !== accountIndex) {
        this.state.setActiveAccount(activeBefore);
      }
      this.rotationService.startRotation(accountIndex);
      logger.info("auth", "Login successful", { accountIndex, email: session.authenticatedEmail });

      return session;
    } catch (error) {
      try {
        await this.client.closeTab(tab.tabId, account.camofoxUserId);
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  async logout(accountIndex?: number): Promise<void> {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex);
    if (resolvedAccountIndex === null) {
      return;
    }

    this.rotationService.stopRotation(resolvedAccountIndex);

    const session = this.state.getSession(resolvedAccountIndex);
    const account = this.state.getAccount(resolvedAccountIndex);
    const userId = account?.camofoxUserId ?? session?.userId ?? `${this.config.userId}-acct${resolvedAccountIndex}`;
    if (session?.tabId) {
      try {
        await this.client.closeTab(session.tabId, userId);
      } catch {
        // ignore close failures
      }
    }

    this.state.clearSession(resolvedAccountIndex);
    logger.info("auth", "Logout successful", { accountIndex: resolvedAccountIndex });

    for (const callback of this.logoutCallbacks) {
      await callback(resolvedAccountIndex);
    }
  }

  onLogout(callback: (accountIndex: number) => void | Promise<void>): () => void {
    this.logoutCallbacks.add(callback);
    return () => {
      this.logoutCallbacks.delete(callback);
    };
  }

  stopAllRotations(): void {
    this.rotationService.stopAll();
  }

  getStatus(): {
    authenticated: boolean;
    accountIndex?: number;
    tokensValid?: boolean;
    rotationActive?: boolean;
    rotationError?: string | null;
    tabId?: string;
  } {
    const session = this.state.getSession();
    if (!session?.authenticated) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      accountIndex: session.accountIndex,
      tokensValid: session.tokens ? this.tokenManager.isValid(session.tokens) : false,
      rotationActive: this.rotationService.isRunning(session.accountIndex),
      rotationError: this.rotationService.getLastError(session.accountIndex),
      tabId: session.tabId
    };
  }

  async refreshTokens(accountIndex?: number): Promise<GeminiTokens> {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex);
    const session = resolvedAccountIndex === null ? null : this.state.getSession(resolvedAccountIndex);
    if (!session?.tabId) {
      throw new AppError(GEMINI_ERROR.SESSION_EXPIRED, "No active session — call login() first");
    }

    await this.client.navigate(session.tabId, Endpoint.INIT(session.accountIndex), session.userId);
    await this.delay(TOKEN_REFRESH_DELAY_MS);

    const tokens = await this.tokenManager.extractTokens(session.tabId, session.userId);
    this.state.updateTokens(tokens, session.accountIndex);
    logger.info("auth", "Token refresh successful", { accountIndex: session.accountIndex });

    return tokens;
  }

  async ensureFreshTokens(accountIndex?: number): Promise<GeminiTokens> {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex);
    const session = resolvedAccountIndex === null ? null : this.state.getSession(resolvedAccountIndex);
    if (!session?.authenticated || !session.tokens) {
      throw new AppError(GEMINI_ERROR.SESSION_EXPIRED, "No active session — call login() first");
    }

    if (this.tokenManager.isValid(session.tokens)) {
      return session.tokens;
    }

    return this.refreshTokens(session.accountIndex);
  }

  async ensureSession(accountIndex?: number): Promise<GeminiSession> {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex) ?? 0;
    const session = this.state.getSession(resolvedAccountIndex);
    const account = this.state.getAccount(resolvedAccountIndex);

    if (!session?.authenticated) {
      return this.login(resolvedAccountIndex);
    }

    if (session.tokens && this.tokenManager.isValid(session.tokens)) {
      if (!account) {
        return this.login(resolvedAccountIndex);
      }

      const tabAlive = await this.isTabAlive(session.tabId, account.camofoxUserId);
      if (tabAlive) {
        return session;
      }

      this.state.clearSession(resolvedAccountIndex);
      return this.login(resolvedAccountIndex);
    }

    const refreshed = await this.refreshTokens(resolvedAccountIndex);
    return {
      ...session,
      tokens: refreshed
    };
  }

  async getTokens(accountIndex?: number): Promise<GeminiTokens> {
    const session = await this.ensureSession(accountIndex);

    if (session.tokens && this.tokenManager.isValid(session.tokens)) {
      return session.tokens;
    }

    return this.refreshTokens(session.accountIndex);
  }

  pauseRotation(accountIndex?: number): void {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex) ?? 0;
    const currentDepth = this.rotationPauseDepth.get(resolvedAccountIndex) ?? 0;

    if (currentDepth === 0) {
      const wasRunning = this.rotationService.isRunning(resolvedAccountIndex);
      if (wasRunning) {
        this.shouldResumeRotation.add(resolvedAccountIndex);
        this.rotationService.pauseRotation(resolvedAccountIndex);
      }
    }

    this.rotationPauseDepth.set(resolvedAccountIndex, currentDepth + 1);
  }

  resumeRotation(accountIndex?: number): void {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex) ?? 0;
    const currentDepth = this.rotationPauseDepth.get(resolvedAccountIndex) ?? 0;

    if (currentDepth === 0) {
      return;
    }

    const nextDepth = currentDepth - 1;
    if (nextDepth <= 0) {
      this.rotationPauseDepth.delete(resolvedAccountIndex);
      if (this.shouldResumeRotation.has(resolvedAccountIndex)) {
        this.rotationService.resumeRotation(resolvedAccountIndex);
        this.shouldResumeRotation.delete(resolvedAccountIndex);
      }
      return;
    }

    this.rotationPauseDepth.set(resolvedAccountIndex, nextDepth);
  }

  private resolveAccountIndex(accountIndex?: number): number | null {
    if (accountIndex !== undefined) {
      return accountIndex;
    }

    return this.state.activeAccountIndex ?? 0;
  }

  private ensureAccount(accountIndex: number): { camofoxUserId: string } {
    if (!this.state.hasAccount(accountIndex)) {
      this.state.addAccount(accountIndex, `${this.config.userId}-acct${accountIndex}`);
    }

    const account = this.state.getAccount(accountIndex);
    if (!account) {
      throw new Error(`Failed to resolve account ${accountIndex}`);
    }

    return { camofoxUserId: account.camofoxUserId };
  }

  private async isTabAlive(tabId: string, userId: string): Promise<boolean> {
    try {
      await this.client.snapshot(tabId, userId);
      return true;
    } catch {
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
