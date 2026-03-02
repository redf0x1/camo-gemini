import type { CamofoxClient } from "../client/camofox-client.js";
import type { StateManager } from "../state.js";
import type { Config } from "../types.js";
import type { AccountHealth, HealthCheckResult } from "../types.js";

export class HealthService {
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private client: CamofoxClient,
    private state: StateManager,
    private config: Config
  ) {}

  /** Start periodic health checking */
  startPeriodicCheck(intervalMs = 60_000): void {
    this.stopPeriodicCheck();
    this.checkInterval = setInterval(() => {
      this.checkAllAccounts().catch(() => {});
    }, intervalMs);
    if (typeof this.checkInterval === "object" && "unref" in this.checkInterval) {
      this.checkInterval.unref();
    }
  }

  /** Stop periodic health checking */
  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Check health of all accounts */
  async checkAllAccounts(): Promise<HealthCheckResult> {
    const accounts = this.state.getAllAccounts();
    const camofoxConnected = await this.checkCamofox();

    const now = Date.now();
    for (const account of accounts) {
      if (account.health === "cooldown" && now >= account.cooldownUntil) {
        this.state.setHealth(account.accountIndex, "degraded");
      }
    }

    const refreshedAccounts = this.state.getAllAccounts();
    const healthyCount = this.state.getHealthyAccounts().length;
    const activeIndex = this.state.activeAccountIndex;

    let overall: AccountHealth = "offline";
    if (healthyCount > 0) {
      overall = healthyCount === refreshedAccounts.length ? "healthy" : "degraded";
    } else if (refreshedAccounts.some((account) => account.health === "cooldown")) {
      overall = "cooldown";
    }

    return {
      overall: refreshedAccounts.length === 0 ? "offline" : overall,
      camofoxConnected,
      accounts: refreshedAccounts.map((account) => ({
        accountIndex: account.accountIndex,
        health: account.health,
        isLoggedIn: account.isLoggedIn,
        isActive: account.accountIndex === activeIndex,
        lastSuccessAt: account.lastSuccessAt || null,
        lastErrorAt: account.lastErrorAt || null,
        cooldownUntil: account.cooldownUntil || null
      })),
      activeAccountIndex: activeIndex,
      totalAccounts: refreshedAccounts.length,
      healthyAccounts: healthyCount
    };
  }

  /** Check if CamoFox browser is reachable */
  private async checkCamofox(): Promise<boolean> {
    try {
      const camofoxUrl = new URL(this.config.camofoxUrl);
      const response = await fetch(`${camofoxUrl.origin}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
