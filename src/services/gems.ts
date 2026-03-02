import type { CamofoxClient } from "../client/camofox-client.js";
import { buildBatchExpression } from "../core/browser-js.js";
import { GrpcId } from "../core/constants.js";
import { RequestBuilder } from "../core/request-builder.js";
import { ResponseParser } from "../core/response-parser.js";
import { StreamParser } from "../core/stream-parser.js";
import { withFailover } from "../core/failover.js";
import { withRetry } from "../core/retry.js";
import { AppError } from "../errors.js";
import type { AuthService } from "./auth.js";
import type { StateManager } from "../state.js";
import type { BrowserFetchResult, Config, Gem, GemCreateOptions, GemUpdateOptions, GeminiTokens, RPCPayload } from "../types.js";

export interface GemsServiceDeps {
  client: CamofoxClient;
  auth: AuthService;
  config: Config;
  state: StateManager;
}

export class GemsService {
  private readonly requestBuilder: RequestBuilder;

  private readonly streamParser: StreamParser;

  private readonly responseParser: ResponseParser;

  constructor(
    private deps: GemsServiceDeps
  ) {
    this.requestBuilder = new RequestBuilder();
    this.streamParser = new StreamParser();
    this.responseParser = new ResponseParser();
  }

  async listGems(options: { accountIndex?: number } = {}): Promise<Gem[]> {
    const accountIndex = this.resolveAccountIndex(options.accountIndex);

    try {
      return await this.executeWithOptionalFailover(accountIndex, async (resolvedAccountIndex) => withRetry(async () => {
        const session = await this.deps.auth.ensureSession(resolvedAccountIndex);
        const tokens = await this.deps.auth.getTokens(resolvedAccountIndex);

        const systemRaw = await this.executeBatch(
          this.requestBuilder.buildGemListPayload("system"),
          tokens,
          session.tabId,
          session.userId,
          resolvedAccountIndex
        );
        const customRaw = await this.executeBatch(
          this.requestBuilder.buildGemListPayload("custom"),
          tokens,
          session.tabId,
          session.userId,
          resolvedAccountIndex
        );

        const systemGems = this.parseGemListPayload(systemRaw, true);
        const customGems = this.parseGemListPayload(customRaw, false);
        return [...systemGems, ...customGems];
      }, { maxRetries: 2 }));
    } catch (error) {
      throw this.wrapGemsError(error);
    }
  }

  async createGem(options: GemCreateOptions): Promise<Gem> {
    const accountIndex = this.resolveAccountIndex(options.accountIndex);

    try {
      return await this.executeWithOptionalFailover(accountIndex, async (resolvedAccountIndex) => withRetry(async () => {
        const session = await this.deps.auth.ensureSession(resolvedAccountIndex);
        const tokens = await this.deps.auth.getTokens(resolvedAccountIndex);

        const payload = this.requestBuilder.buildGemCreatePayload({ ...options, accountIndex: resolvedAccountIndex });
        const raw = await this.executeBatch(payload, tokens, session.tabId, session.userId, resolvedAccountIndex);

        const parsedGem = this.parseGemMutationPayload(raw);
        return {
          id: parsedGem?.id ?? "",
          name: parsedGem?.name ?? options.name,
          description: parsedGem?.description ?? options.description,
          instructions: parsedGem?.instructions ?? options.instructions,
          isSystem: false
        };
      }, { maxRetries: 2 }));
    } catch (error) {
      throw this.wrapGemsError(error);
    }
  }

  async updateGem(options: GemUpdateOptions): Promise<Gem> {
    const accountIndex = this.resolveAccountIndex(options.accountIndex);

    try {
      return await this.executeWithOptionalFailover(accountIndex, async (resolvedAccountIndex) => withRetry(async () => {
        const session = await this.deps.auth.ensureSession(resolvedAccountIndex);
        const tokens = await this.deps.auth.getTokens(resolvedAccountIndex);

        const payload = this.requestBuilder.buildGemUpdatePayload({ ...options, accountIndex: resolvedAccountIndex });
        const raw = await this.executeBatch(payload, tokens, session.tabId, session.userId, resolvedAccountIndex);
        const parsedGem = this.parseGemMutationPayload(raw);

        return {
          id: parsedGem?.id ?? options.gemId,
          name: parsedGem?.name ?? options.name ?? "",
          description: parsedGem?.description ?? options.description,
          instructions: parsedGem?.instructions ?? options.instructions,
          isSystem: false
        };
      }, { maxRetries: 2 }));
    } catch (error) {
      throw this.wrapGemsError(error);
    }
  }

  async deleteGem(gemId: string, accountIndex?: number): Promise<void> {
    const resolvedAccountIndex = this.resolveAccountIndex(accountIndex);

    try {
      await this.executeWithOptionalFailover(resolvedAccountIndex, async (activeAccountIndex) => withRetry(async () => {
        const session = await this.deps.auth.ensureSession(activeAccountIndex);
        const tokens = await this.deps.auth.getTokens(activeAccountIndex);

        const payload = this.requestBuilder.buildGemDeletePayload(gemId);
        await this.executeBatch(payload, tokens, session.tabId, session.userId, activeAccountIndex);
      }, { maxRetries: 2 }));
    } catch (error) {
      throw this.wrapGemsError(error);
    }
  }

  private async executeBatch(
    payload: RPCPayload,
    tokens: GeminiTokens,
    tabId: string,
    userId: string,
    accountIndex: number
  ): Promise<unknown> {
    const batch = this.requestBuilder.buildBatchPayload([payload], tokens, accountIndex);
    const expression = buildBatchExpression({
      url: batch.url,
      headers: batch.headers,
      body: batch.body
    });

    const evalResult = await this.deps.client.evaluateExtended(
      tabId,
      expression,
      userId,
      120_000
    );

    if (!evalResult.ok) {
      throw new Error(`Evaluate failed: ${evalResult.error ?? "unknown"}`);
    }

    const fetchResult = evalResult.result as BrowserFetchResult | undefined;
    if (!fetchResult?.ok || typeof fetchResult.data !== "string") {
      throw new Error(`Gem batch fetch failed: ${fetchResult?.error ?? "no data"}`);
    }

    const frames = this.streamParser.extractFrames(fetchResult.data);
    const parsed = this.responseParser.parseBatchResponse(frames, payload.rpcId);
    if (!parsed.ok) {
      const error = new Error(parsed.error.message) as Error & { code?: string };
      error.code = parsed.error.code;
      throw error;
    }

    return parsed.data;
  }

  private parseGemListPayload(payload: unknown, isSystem: boolean): Gem[] {
    const list = this.readArray(payload, 2);
    if (!list) {
      return [];
    }

    return list
      .map((item) => this.parseGemItem(item, isSystem))
      .filter((item): item is Gem => item !== null);
  }

  private parseGemMutationPayload(payload: unknown): Partial<Gem> | null {
    const root = this.asArray(payload);
    if (!root || root.length === 0) {
      return null;
    }

    const id = typeof root[0] === "string" ? root[0] : "";
    if (!id) {
      return null;
    }

    const details = this.readArray(root, 1);
    const instructionsNode = this.readArray(root, 2);
    const instructions = instructionsNode && typeof instructionsNode[0] === "string" ? instructionsNode[0] : undefined;

    return {
      id,
      name: details && typeof details[0] === "string" ? details[0] : undefined,
      description: details && typeof details[1] === "string" ? details[1] : undefined,
      instructions,
      isSystem: false
    };
  }

  private parseGemItem(item: unknown, isSystem: boolean): Gem | null {
    const row = this.asArray(item);
    if (!row) {
      return null;
    }

    const id = typeof row[0] === "string" ? row[0] : "";
    if (!id) {
      return null;
    }

    const details = this.readArray(row, 1);
    const instructionsNode = this.readArray(row, 2);
    const instructions = instructionsNode && typeof instructionsNode[0] === "string" ? instructionsNode[0] : undefined;

    return {
      id,
      name: details && typeof details[0] === "string" ? details[0] : "",
      description: details && typeof details[1] === "string" ? details[1] : undefined,
      instructions,
      isSystem
    };
  }

  private asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }

  private readArray(value: unknown, index: number): unknown[] | null {
    const arr = this.asArray(value);
    if (!arr) {
      return null;
    }

    const nested = arr[index];
    return Array.isArray(nested) ? nested : null;
  }

  private wrapGemsError(error: unknown): Error {
    if (error instanceof AppError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/subscription|upgrade|gemini advanced|paid|not available|permission denied|403/i.test(message)) {
      return new AppError("INTERNAL_ERROR", "Gems require a paid Gemini subscription for this account");
    }

    return new AppError("INTERNAL_ERROR", message);
  }

  private resolveAccountIndex(accountIndex?: number): number {
    return accountIndex ?? this.deps.state.activeAccountIndex ?? 0;
  }

  private async executeWithOptionalFailover<T>(
    accountIndex: number,
    operation: (accountIndex: number) => Promise<T>
  ): Promise<T> {
    if (this.deps.state.getAllAccounts().length <= 1) {
      return operation(accountIndex);
    }

    const failoverResult = await withFailover(this.deps.state, { accountIndex }, operation);
    if (this.deps.state.activeAccountIndex !== failoverResult.usedAccountIndex) {
      this.deps.state.setActiveAccount(failoverResult.usedAccountIndex);
    }

    return failoverResult.result;
  }
}
