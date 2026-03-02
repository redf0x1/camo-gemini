import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors.js";
import { AuthService } from "../services/auth.js";
import type { GeminiSession, GeminiTokens } from "../types.js";

function createMockClient() {
  return {
    createTab: vi.fn().mockResolvedValue({ tabId: "tab1", url: "https://gemini.google.com/app", title: "Gemini" }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    closeTab: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue({ tabId: "tab1", url: "https://gemini.google.com/app", title: "Gemini" }),
    snapshot: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        tokens: { snlm0e: "", cfb2h: "build123", fdrfje: "session456" },
        extractedAt: Date.now()
      }
    })
  } as any;
}

function createMockState() {
  const accounts = new Map<number, any>();
  let activeAccountIndex: number | null = null;

  const addAccount = vi.fn((accountIndex: number, camofoxUserId: string) => {
    const existing = accounts.get(accountIndex);
    if (existing) {
      return existing;
    }

    const entry = {
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
    accounts.set(accountIndex, entry);
    return entry;
  });

  const getSession = vi.fn((accountIndex?: number) => {
    const idx = accountIndex ?? activeAccountIndex;
    if (idx === null || idx === undefined) {
      return null;
    }
    return accounts.get(idx)?.session ?? null;
  });

  const setSession = vi.fn((accountIndexOrSession: number | GeminiSession, maybeSession?: GeminiSession) => {
    const accountIndex = typeof accountIndexOrSession === "number" ? accountIndexOrSession : accountIndexOrSession.accountIndex;
    const session = typeof accountIndexOrSession === "number" ? maybeSession : accountIndexOrSession;
    if (!session) {
      throw new Error("missing session");
    }

    const entry = accounts.get(accountIndex) ?? addAccount(accountIndex, session.userId);
    entry.session = session;
    entry.isLoggedIn = true;
    entry.tabId = session.tabId;
    activeAccountIndex = accountIndex;
  });

  const clearSession = vi.fn((accountIndex?: number) => {
    const idx = accountIndex ?? activeAccountIndex;
    if (idx === null || idx === undefined) {
      return;
    }
    const entry = accounts.get(idx);
    if (entry) {
      entry.session = null;
      entry.isLoggedIn = false;
      entry.tabId = null;
    }
    if (activeAccountIndex === idx) {
      activeAccountIndex = null;
    }
  });

  const updateTokens = vi.fn((tokens: GeminiTokens, accountIndex?: number) => {
    const idx = accountIndex ?? activeAccountIndex;
    if (idx === null || idx === undefined) {
      return;
    }
    const entry = accounts.get(idx);
    if (entry?.session) {
      entry.session.tokens = tokens;
    }
  });

  return {
    get activeAccountIndex() {
      return activeAccountIndex;
    },
    hasAccount: vi.fn((accountIndex: number) => accounts.has(accountIndex)),
    addAccount,
    getAccount: vi.fn((accountIndex: number) => accounts.get(accountIndex)),
    setActiveAccount: vi.fn((accountIndex: number) => {
      activeAccountIndex = accountIndex;
    }),
    getSession,
    setSession,
    clearSession,
    updateTokens,
    recordRotation: vi.fn()
  } as any;
}

const config = {
  camofoxUrl: "http://localhost:9377",
  userId: "test",
  requestTimeout: 30000,
  dashboardPort: 0,
  dashboardEnabled: false,
  AUTO_DELETE_CHAT: true
};

function createTokens(extractedAt = Date.now()): GeminiTokens {
  return { snlm0e: "", cfb2h: "build123", fdrfje: "session456", extractedAt };
}

describe("AuthService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("login happy path", async () => {
    const client = createMockClient();
    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    const extractSpy = vi.spyOn((auth as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());
    const startSpy = vi.spyOn((auth as any).rotationService, "startRotation").mockImplementation(() => undefined);

    const session = await auth.login(0);

    expect(client.createTab).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledWith("tab1", "test-acct0");
    expect(state.setSession).toHaveBeenCalledWith(0, expect.objectContaining({ tabId: "tab1", accountIndex: 0 }));
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(session.authenticated).toBe(true);
    expect(session.tabId).toBe("tab1");
    expect(session.authenticatedEmail).toBeNull();
  });

  it("login extracts authenticatedEmail when available", async () => {
    const client = createMockClient();
    client.evaluate.mockResolvedValue({ ok: true, result: "user@gmail.com" });
    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    vi.spyOn((auth as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());
    vi.spyOn((auth as any).rotationService, "startRotation").mockImplementation(() => undefined);

    const session = await auth.login(0);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(session.authenticatedEmail).toBe("user@gmail.com");
  });

  it("login does not fail if authenticatedEmail extraction fails", async () => {
    const client = createMockClient();
    client.evaluate.mockRejectedValue(new Error("eval failed"));
    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    vi.spyOn((auth as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());
    vi.spyOn((auth as any).rotationService, "startRotation").mockImplementation(() => undefined);

    const session = await auth.login(0);

    expect(session.authenticated).toBe(true);
    expect(session.authenticatedEmail).toBeNull();
  });

  it("login retries createTab after 429 by deleting stale session", async () => {
    const client = createMockClient();
    client.createTab
      .mockRejectedValueOnce(new AppError("INTERNAL_ERROR", "Maximum tabs per session reached", 429))
      .mockResolvedValueOnce({ tabId: "tab2", url: "https://gemini.google.com/app", title: "Gemini" });

    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    vi.spyOn((auth as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());
    vi.spyOn((auth as any).rotationService, "startRotation").mockImplementation(() => undefined);

    const session = await auth.login(0);

    expect(client.deleteSession).toHaveBeenCalledWith("test-acct0");
    expect(client.createTab).toHaveBeenCalledTimes(2);
    expect(session.tabId).toBe("tab2");
  });

  it("login session cache hit", async () => {
    const client = createMockClient();
    const state = createMockState();
    const existing: GeminiSession = {
      tabId: "tab-existing",
      userId: "test-acct0",
      accountIndex: 0,
      authenticated: true,
      tokens: createTokens(),
      lastRotation: Date.now()
    };
    state.addAccount(0, "test-acct0");
    state.setSession(0, existing);

    const auth = new AuthService(client, state, config);
    vi.spyOn((auth as any).tokenManager, "isValid").mockReturnValue(true);
    const runningSpy = vi.spyOn((auth as any).rotationService, "isRunning").mockReturnValue(false);
    const startSpy = vi.spyOn((auth as any).rotationService, "startRotation").mockImplementation(() => undefined);

    const session = await auth.login(0);

    expect(session).toBe(existing);
    expect(client.snapshot).toHaveBeenCalledWith("tab-existing", "test-acct0");
    expect(client.createTab).not.toHaveBeenCalled();
    expect(runningSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("login failure closes tab", async () => {
    const client = createMockClient();
    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    const extractSpy = vi
      .spyOn((auth as any).tokenManager, "extractTokens")
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("second fail"));

    await expect(auth.login(0)).rejects.toThrow("second fail");

    expect(client.createTab).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledTimes(2);
    expect(client.closeTab).toHaveBeenCalledWith("tab1", "test-acct0");
  });

  it("concurrent login dedup", async () => {
    const client = createMockClient();
    const state = createMockState();
    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    let resolveExtract!: (tokens: GeminiTokens) => void;
    const extractPromise = new Promise<GeminiTokens>((resolve) => {
      resolveExtract = resolve;
    });

    vi.spyOn((auth as any).tokenManager, "extractTokens").mockReturnValue(extractPromise);

    const p1 = auth.login(0);
    const p2 = auth.login(0);

    expect(client.createTab).toHaveBeenCalledTimes(1);

    resolveExtract(createTokens());
    const [s1, s2] = await Promise.all([p1, p2]);

    expect(s1.tabId).toBe("tab1");
    expect(s2.tabId).toBe("tab1");
    expect(client.createTab).toHaveBeenCalledTimes(1);
  });

  it("should not merge login calls for different accounts", async () => {
    const client = createMockClient();
    const state = createMockState();
    const authService = new AuthService(client, state, config);
    vi.spyOn(authService as any, "delay").mockResolvedValue(undefined);
    vi.spyOn((authService as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());

    const promise0 = authService.login(0);
    const promise1 = authService.login(1);
    await Promise.all([promise0, promise1]);

    expect(client.createTab).toHaveBeenCalledTimes(2);
  });

  it("should not return cached session for different accountIndex", async () => {
    const client = createMockClient();
    const state = createMockState();
    let sessionStore: GeminiSession | null = null;
    state.getSession.mockImplementation((accountIndex?: number) => {
      if (accountIndex === undefined || accountIndex === null) {
        return sessionStore;
      }
      return sessionStore && sessionStore.accountIndex === accountIndex ? sessionStore : null;
    });
    state.setSession.mockImplementation((_accountIndex: number, session: GeminiSession) => {
      sessionStore = session;
    });
    state.clearSession.mockImplementation(() => {
      sessionStore = null;
    });

    const authService = new AuthService(client, state, config);
    vi.spyOn(authService as any, "delay").mockResolvedValue(undefined);
    vi.spyOn((authService as any).tokenManager, "extractTokens").mockResolvedValue(createTokens());

    await authService.login(0);
    await authService.login(1);

    expect(client.createTab).toHaveBeenCalledTimes(2);
  });

  it("logout", async () => {
    const client = createMockClient();
    const state = createMockState();
    state.getSession.mockReturnValue({
      tabId: "tab1",
      userId: "test-acct0",
      accountIndex: 0,
      authenticated: true,
      tokens: createTokens(),
      lastRotation: Date.now()
    });

    const auth = new AuthService(client, state, config);
    const stopSpy = vi.spyOn((auth as any).rotationService, "stopRotation").mockImplementation(() => undefined);

    await auth.logout(0);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(client.closeTab).toHaveBeenCalledWith("tab1", "test-acct0");
    expect(state.clearSession).toHaveBeenCalledWith(0);
  });

  it("getStatus authenticated", () => {
    const client = createMockClient();
    const state = createMockState();
    state.getSession.mockReturnValue({
      tabId: "tab1",
      userId: "test-acct2",
      accountIndex: 2,
      authenticated: true,
      tokens: createTokens(),
      lastRotation: Date.now()
    });

    const auth = new AuthService(client, state, config);
    vi.spyOn((auth as any).tokenManager, "isValid").mockReturnValue(true);
    vi.spyOn((auth as any).rotationService, "isRunning").mockReturnValue(true);
    vi.spyOn((auth as any).rotationService, "getLastError").mockReturnValue("rotation failed once");

    const status = auth.getStatus();

    expect(status).toEqual({
      authenticated: true,
      accountIndex: 2,
      tokensValid: true,
      rotationActive: true,
      rotationError: "rotation failed once",
      tabId: "tab1"
    });
  });

  it("getStatus not authenticated", () => {
    const client = createMockClient();
    const state = createMockState();
    state.getSession.mockReturnValue(null);

    const auth = new AuthService(client, state, config);

    expect(auth.getStatus()).toEqual({ authenticated: false });
  });

  it("refreshTokens", async () => {
    const client = createMockClient();
    const state = createMockState();
    state.getSession.mockReturnValue({
      tabId: "tab1",
      userId: "test-acct1",
      accountIndex: 1,
      authenticated: true,
      tokens: createTokens(),
      lastRotation: Date.now()
    });

    const auth = new AuthService(client, state, config);
    vi.spyOn(auth as any, "delay").mockResolvedValue(undefined);

    const fresh = createTokens(Date.now() + 1000);
    vi.spyOn((auth as any).tokenManager, "extractTokens").mockResolvedValue(fresh);

    const tokens = await auth.refreshTokens();

    expect(client.navigate).toHaveBeenCalledTimes(1);
    expect(state.updateTokens).toHaveBeenCalledWith(fresh, 1);
    expect(tokens).toEqual(fresh);
  });

  it("ensureFreshTokens with valid tokens", async () => {
    const client = createMockClient();
    const state = createMockState();
    const cached = createTokens();
    state.getSession.mockReturnValue({
      tabId: "tab1",
      userId: "test-acct0",
      accountIndex: 0,
      authenticated: true,
      tokens: cached,
      lastRotation: Date.now()
    });

    const auth = new AuthService(client, state, config);
    vi.spyOn((auth as any).tokenManager, "isValid").mockReturnValue(true);
    const refreshSpy = vi.spyOn(auth, "refreshTokens");

    const tokens = await auth.ensureFreshTokens();

    expect(tokens).toBe(cached);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("ensureFreshTokens with expired tokens", async () => {
    const client = createMockClient();
    const state = createMockState();
    const expired = createTokens(Date.now() - 700_000);
    state.getSession.mockReturnValue({
      tabId: "tab1",
      userId: "test-acct0",
      accountIndex: 0,
      authenticated: true,
      tokens: expired,
      lastRotation: Date.now()
    });

    const auth = new AuthService(client, state, config);
    vi.spyOn((auth as any).tokenManager, "isValid").mockReturnValue(false);
    const fresh = createTokens();
    vi.spyOn(auth, "refreshTokens").mockResolvedValue(fresh);

    const tokens = await auth.ensureFreshTokens();

    expect(tokens).toEqual(fresh);
    expect(auth.refreshTokens).toHaveBeenCalledTimes(1);
  });
});
