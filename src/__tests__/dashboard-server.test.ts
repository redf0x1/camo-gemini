import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountInfo, HealthCheckResult, ModelOutput } from "../types.js";
import { DashboardServer } from "../dashboard/server.js";

const port = 9398;
const baseUrl = `http://127.0.0.1:${port}`;

const accounts: AccountInfo[] = [
  {
    accountIndex: 1,
    health: "healthy",
    isLoggedIn: true,
    isActive: true,
    lastSuccessAt: null,
    lastErrorAt: null,
    cooldownUntil: null
  }
];

const healthResult: HealthCheckResult = {
  overall: "healthy",
  camofoxConnected: true,
  accounts,
  activeAccountIndex: 1,
  totalAccounts: 1,
  healthyAccounts: 1
};

const output: ModelOutput = {
  metadata: [],
  candidates: [
    {
      rcid: "c1",
      text: "hello",
      thoughts: null,
      webImages: [],
      generatedImages: [],
      isFinal: true
    }
  ],
  chosenIndex: 0,
  isCompleted: true
};

function createDashboardServer() {
  const deps = {
    state: {} as never,
    auth: {
      logout: vi.fn().mockResolvedValue(undefined)
    } as never,
    account: {
      listAccounts: vi.fn().mockReturnValue(accounts),
      addAccount: vi.fn().mockResolvedValue(accounts[0]),
      removeAccount: vi.fn().mockResolvedValue(undefined)
    } as never,
    health: {
      checkAllAccounts: vi.fn().mockResolvedValue(healthResult)
    } as never,
    generate: {
      generate: vi.fn().mockResolvedValue({ output, rawFrameCount: 1 })
    } as never
  };

  return { dashboard: new DashboardServer(deps, port), deps };
}

describe("DashboardServer", () => {
  let dashboard: DashboardServer | null = null;

  afterEach(() => {
    dashboard?.stop();
    dashboard = null;
  });

  it("starts and serves dashboard HTML", async () => {
    const setup = createDashboardServer();
    dashboard = setup.dashboard;
    await dashboard.start();

    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("returns /api/health response", async () => {
    const setup = createDashboardServer();
    dashboard = setup.dashboard;
    await dashboard.start();

    const response = await fetch(`${baseUrl}/api/health`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      overall: "healthy",
      camofoxConnected: true,
      accounts: expect.any(Array),
      activeAccountIndex: 1,
      totalAccounts: 1,
      healthyAccounts: 1
    });
  });

  it("returns /api/accounts list", async () => {
    const setup = createDashboardServer();
    dashboard = setup.dashboard;
    await dashboard.start();

    const response = await fetch(`${baseUrl}/api/accounts`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ accounts });
  });

  it("returns 404 for unknown api route", async () => {
    const setup = createDashboardServer();
    dashboard = setup.dashboard;
    await dashboard.start();

    const response = await fetch(`${baseUrl}/api/unknown`);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: "Not found" });
  });

  it("requires prompt for /api/chat", async () => {
    const setup = createDashboardServer();
    dashboard = setup.dashboard;
    await dashboard.start();

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "prompt is required" });
  });
});
