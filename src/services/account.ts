import type { StateManager } from "../state.js";
import type { AccountEntry, AccountInfo, Config } from "../types.js";
import type { AuthService } from "./auth.js";

export class AccountService {
  constructor(
    private auth: AuthService,
    private state: StateManager,
    private config: Config
  ) {}

  async addAccount(accountIndex: number): Promise<AccountInfo> {
    if (accountIndex < 0 || accountIndex > 9) {
      throw new Error("Account index must be between 0 and 9");
    }

    const camofoxUserId = `${this.config.userId}-acct${accountIndex}`;
    this.state.addAccount(accountIndex, camofoxUserId);
    await this.auth.login(accountIndex);
    return this.getAccountInfo(accountIndex);
  }

  listAccounts(): AccountInfo[] {
    return this.state.getAllAccounts().map((entry) => this.toAccountInfo(entry));
  }

  switchAccount(accountIndex: number): AccountInfo {
    if (!this.state.hasAccount(accountIndex)) {
      throw new Error(`Account ${accountIndex} not registered`);
    }

    this.state.setActiveAccount(accountIndex);
    return this.getAccountInfo(accountIndex);
  }

  async removeAccount(accountIndex: number): Promise<void> {
    if (!this.state.hasAccount(accountIndex)) {
      return;
    }

    await this.auth.logout(accountIndex);
    this.state.removeAccount(accountIndex);
  }

  getAccountInfo(accountIndex: number): AccountInfo {
    const entry = this.state.getAccount(accountIndex);
    if (!entry) {
      throw new Error(`Account ${accountIndex} not registered`);
    }

    return this.toAccountInfo(entry);
  }

  private toAccountInfo(entry: AccountEntry): AccountInfo {
    return {
      accountIndex: entry.accountIndex,
      health: entry.health,
      isLoggedIn: entry.isLoggedIn,
      isActive: entry.accountIndex === this.state.activeAccountIndex,
      lastSuccessAt: entry.lastSuccessAt || null,
      lastErrorAt: entry.lastErrorAt || null,
      cooldownUntil: entry.cooldownUntil || null
    };
  }
}
