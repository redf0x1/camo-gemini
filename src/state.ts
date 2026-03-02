import { COOKIE_ROTATION_INTERVAL_MS, HEALTH_BACKOFF_BASE_MS, HEALTH_BACKOFF_CAP_MS } from "./core/constants.js";
import type { AccountEntry, AccountHealth, ChatSession, GeminiSession } from "./types.js";

export class StateManager {
  /** Per-account state registry */
  private accounts = new Map<number, AccountEntry>();
  /** Currently active account index */
  private activeIndex: number | null = null;
  private chats: Map<string, ChatSession> = new Map();

  // === Account Registry ===

  /** Register a new account entry */
  addAccount(accountIndex: number, camofoxUserId: string): AccountEntry {
    if (this.accounts.has(accountIndex)) {
      return this.accounts.get(accountIndex)!;
    }

    const entry: AccountEntry = {
      accountIndex,
      session: null,
      health: "offline",
      camofoxUserId,
      tabId: null,
      lastSuccessAt: 0,
      lastErrorAt: 0,
      consecutiveErrors: 0,
      cooldownUntil: 0,
      isLoggedIn: false
    };

    this.accounts.set(accountIndex, entry);
    return entry;
  }

  /** Remove an account */
  removeAccount(accountIndex: number): boolean {
    if (this.activeIndex === accountIndex) {
      this.activeIndex = null;
    }

    return this.accounts.delete(accountIndex);
  }

  /** Get account entry */
  getAccount(accountIndex: number): AccountEntry | undefined {
    return this.accounts.get(accountIndex);
  }

  /** Get all accounts */
  getAllAccounts(): AccountEntry[] {
    return Array.from(this.accounts.values());
  }

  /** Check if account exists */
  hasAccount(accountIndex: number): boolean {
    return this.accounts.has(accountIndex);
  }

  // === Active Account ===

  /** Get active account index */
  get activeAccountIndex(): number | null {
    return this.activeIndex;
  }

  /** Set active account */
  setActiveAccount(accountIndex: number): void {
    if (!this.accounts.has(accountIndex)) {
      throw new Error(`Account ${accountIndex} not registered`);
    }

    this.activeIndex = accountIndex;
  }

  /** Get active account entry */
  getActiveAccount(): AccountEntry | undefined {
    if (this.activeIndex === null) return undefined;
    return this.accounts.get(this.activeIndex);
  }

  // === Session Management (backward compatible) ===

  /** Get session for account (or active account if not specified) */
  getSession(accountIndex?: number): GeminiSession | null {
    const idx = accountIndex ?? this.activeIndex;
    if (idx === null) return null;
    return this.accounts.get(idx)?.session ?? null;
  }

  setSession(accountIndex: number, session: GeminiSession): void;
  setSession(session: GeminiSession): void;
  /** Set session for account */
  setSession(accountIndexOrSession: number | GeminiSession, maybeSession?: GeminiSession): void {
    if (typeof accountIndexOrSession === "number") {
      const entry = this.accounts.get(accountIndexOrSession);
      if (!entry || !maybeSession) {
        throw new Error(`Account ${accountIndexOrSession} not registered`);
      }

      entry.session = maybeSession;
      entry.isLoggedIn = true;
      entry.health = "healthy";
      entry.consecutiveErrors = 0;
      entry.lastSuccessAt = Date.now();
      entry.tabId = maybeSession.tabId;
      this.activeIndex = accountIndexOrSession;
      return;
    }

    const session = accountIndexOrSession;
    const accountIndex = session.accountIndex;
    if (!this.accounts.has(accountIndex)) {
      this.addAccount(accountIndex, session.userId || `camo-gemini-acct${accountIndex}`);
    }
    this.setSession(accountIndex, session);
  }

  clearSession(accountIndex?: number): void {
    const idx = accountIndex ?? this.activeIndex;
    if (idx === null) {
      return;
    }

    const entry = this.accounts.get(idx);
    if (entry) {
      entry.session = null;
      entry.isLoggedIn = false;
      entry.health = "offline";
      entry.tabId = null;
    }

    if (accountIndex === undefined && this.activeIndex === idx) {
      this.activeIndex = null;
    }
  }

  // === Backward-compatible property (legacy single-session access) ===

  /** @deprecated Use getSession(accountIndex) instead */
  get session(): GeminiSession | null {
    return this.getSession();
  }

  set session(value: GeminiSession | null) {
    if (value === null) {
      if (this.activeIndex !== null) {
        this.clearSession(this.activeIndex);
      }
      return;
    }

    // Legacy: auto-create account 0 if none exists
    if (this.activeIndex === null) {
      if (!this.accounts.has(0)) {
        // This should be set by AuthService, but fallback for backward compat
        this.addAccount(0, "camo-gemini-acct0");
      }
      this.activeIndex = 0;
    }

    this.setSession(this.activeIndex, value);
  }

  isAuthenticated(accountIndex?: number): boolean {
    return this.getSession(accountIndex)?.authenticated === true;
  }

  updateTokens(tokens: NonNullable<GeminiSession["tokens"]>, accountIndex?: number): void {
    const session = this.getSession(accountIndex);
    if (session) {
      session.tokens = tokens;
    }
  }

  recordRotation(accountIndex?: number): void {
    const session = this.getSession(accountIndex);
    if (session) {
      session.lastRotation = Date.now();
    }
  }

  isRotationOverdue(accountIndex?: number): boolean {
    const session = this.getSession(accountIndex);
    if (!session) return false;
    return Date.now() - session.lastRotation > COOKIE_ROTATION_INTERVAL_MS;
  }

  // === Health Tracking ===

  /** Record a successful operation for account */
  recordSuccess(accountIndex: number): void {
    const entry = this.accounts.get(accountIndex);
    if (entry) {
      entry.lastSuccessAt = Date.now();
      entry.consecutiveErrors = 0;
      if (entry.health === "degraded") {
        entry.health = "healthy";
      }
    }
  }

  /** Record an error for account */
  recordError(accountIndex: number): void {
    const entry = this.accounts.get(accountIndex);
    if (entry) {
      entry.lastErrorAt = Date.now();
      entry.consecutiveErrors += 1;

      // Health state transitions
      if (entry.consecutiveErrors >= 5) {
        entry.health = "cooldown";
        // Exponential backoff: 30s, 60s, 120s, 240s... capped at 600s
        const backoff = Math.min(HEALTH_BACKOFF_BASE_MS * Math.pow(2, entry.consecutiveErrors - 5), HEALTH_BACKOFF_CAP_MS);
        entry.cooldownUntil = Date.now() + backoff;
      } else if (entry.consecutiveErrors >= 2) {
        entry.health = "degraded";
      }
    }
  }

  /** Set account health directly */
  setHealth(accountIndex: number, health: AccountHealth): void {
    const entry = this.accounts.get(accountIndex);
    if (entry) {
      entry.health = health;
      if (health === "cooldown") {
        entry.cooldownUntil = Date.now() + 60000;
      }
    }
  }

  /** Get healthy accounts (healthy or degraded, not in cooldown) */
  getHealthyAccounts(): AccountEntry[] {
    const now = Date.now();
    return this.getAllAccounts().filter((account) => {
      if (account.health === "cooldown" && now >= account.cooldownUntil) {
        account.health = "degraded";
      }

      return account.isLoggedIn && (account.health === "healthy" || account.health === "degraded");
    });
  }

  /** Get next healthy account for failover (round-robin from active) */
  getNextHealthyAccount(excludeIndex?: number): AccountEntry | undefined {
    const healthy = this.getHealthyAccounts().filter((account) => account.accountIndex !== excludeIndex);
    if (healthy.length === 0) return undefined;

    // Prefer healthy over degraded
    const fullyHealthy = healthy.filter((account) => account.health === "healthy");
    if (fullyHealthy.length > 0) {
      // Sort by last success time (most recently successful first)
      fullyHealthy.sort((a, b) => b.lastSuccessAt - a.lastSuccessAt);
      return fullyHealthy[0];
    }

    // Fall back to degraded
    healthy.sort((a, b) => a.consecutiveErrors - b.consecutiveErrors);
    return healthy[0];
  }

  // === Tab Tracking ===

  /** Set tab ID for account */
  setTabId(accountIndex: number, tabId: string): void {
    const entry = this.accounts.get(accountIndex);
    if (entry) {
      entry.tabId = tabId;
      if (entry.session) {
        entry.session.tabId = tabId;
      }
    }
  }

  /** Get tab ID for account */
  getTabId(accountIndex?: number): string | null {
    const idx = accountIndex ?? this.activeIndex;
    if (idx === null) return null;
    return this.accounts.get(idx)?.tabId ?? this.accounts.get(idx)?.session?.tabId ?? null;
  }

  getChat(conversationId: string): ChatSession | undefined {
    return this.chats.get(conversationId);
  }

  setChat(conversationId: string, chat: ChatSession): void {
    this.chats.set(conversationId, chat);
  }

  deleteChat(conversationId: string): boolean {
    return this.chats.delete(conversationId);
  }

  listChats(): ChatSession[] {
    return Array.from(this.chats.values());
  }

  // === Reset ===

  /** Clear all state */
  clear(): void {
    this.accounts.clear();
    this.activeIndex = null;
    this.chats.clear();
  }
}
