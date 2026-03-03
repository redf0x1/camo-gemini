import { buildGenerateExpression } from "../core/browser-js.js";
import { buildBatchExpression } from "../core/browser-js.js";
import { GrpcId } from "../core/constants.js";
import { RequestBuilder } from "../core/request-builder.js";
import { ResponseParser } from "../core/response-parser.js";
import { StreamParser } from "../core/stream-parser.js";
import { withFailover } from "../core/failover.js";
import { withRetry } from "../core/retry.js";
import { logger } from "../core/logger.js";
import { downloadImage } from "./image-download.js";
import type { CamofoxClient } from "../client/camofox-client.js";
import type { AuthService } from "./auth.js";
import type { StateManager } from "../state.js";
import type { Config, BrowserFetchResult, GenerateOptions, GenerateResult, GeminiTokens, RPCPayload } from "../types.js";

export interface GenerateServiceDeps {
  client: CamofoxClient;
  auth: AuthService;
  config: Config;
  state: StateManager;
}

export class GenerateService {
  private static readonly MAX_ACTION_INPUT_RETRIES = 2;

  private readonly streamParser: StreamParser;

  private readonly responseParser: ResponseParser;

  private readonly requestBuilder: RequestBuilder;

  constructor(
    private deps: GenerateServiceDeps
  ) {
    this.streamParser = new StreamParser();
    this.responseParser = new ResponseParser();
    this.requestBuilder = new RequestBuilder();
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const accountIndex = this.resolveAccountIndex(options.accountIndex);

    if (this.deps.state.getAllAccounts().length <= 1) {
      return this.generateForAccount(options, accountIndex);
    }

    const failoverResult = await withFailover(
      this.deps.state,
      { accountIndex },
      async (resolvedAccountIndex) => this.generateForAccount({ ...options, accountIndex: resolvedAccountIndex }, resolvedAccountIndex)
    );

    if (this.deps.state.activeAccountIndex !== failoverResult.usedAccountIndex) {
      this.deps.state.setActiveAccount(failoverResult.usedAccountIndex);
    }

    return failoverResult.result;
  }

  private async generateForAccount(options: GenerateOptions, accountIndex: number): Promise<GenerateResult> {
    return withRetry(async () => {
      const session = await this.deps.auth.ensureSession(accountIndex);
      const tokens = await this.deps.auth.getTokens(accountIndex);

      const bardPayload = this.requestBuilder.buildBardActivityPayload(tokens, accountIndex);
      const generatePayload = options.usePro
        ? this.requestBuilder.buildImageGeneratePayload(
          options.prompt,
          {
            model: options.model,
            accountIndex,
            chatMetadata: options.chatMetadata,
            gemId: options.gemId,
            images: options.images,
            usePro: options.usePro,
            files: options.files
          },
          tokens,
          accountIndex
        )
        : this.requestBuilder.buildGeneratePayload(
          {
            prompt: options.prompt,
            model: options.model,
            gemId: options.gemId,
            images: options.images?.map((image) => ({ url: image.url }))
          },
          tokens,
          accountIndex,
          options.chatMetadata
        );

      const expression = buildGenerateExpression({
        url: generatePayload.url,
        headers: generatePayload.headers,
        body: generatePayload.body,
        bardActivityUrl: bardPayload.url,
        bardActivityHeaders: bardPayload.headers,
        bardActivityBody: bardPayload.body
      });

      const evalResult = await this.deps.client.evaluateExtended(
        session.tabId,
        expression,
        session.userId,
        120_000
      );

      if (!evalResult.ok) {
        const error = new Error(`Evaluate failed: ${evalResult.error ?? "unknown"}`) as Error & {
          errorType?: string;
        };
        if (evalResult.errorType) {
          error.errorType = evalResult.errorType;
        }
        throw error;
      }

      const fetchResult = evalResult.result as BrowserFetchResult | undefined;
      if (!fetchResult?.ok || typeof fetchResult.data !== "string") {
        throw new Error(`Gemini fetch failed: ${fetchResult?.error ?? "no data"}`);
      }

      const rawBody = fetchResult.data;
      const frames = this.streamParser.extractFrames(rawBody);
      const parseResult = this.responseParser.parseGenerateResponse(frames);

      if (!parseResult.ok) {
        const error = new Error(parseResult.error.message) as Error & {
          code?: string;
          parseErrorCode?: string;
        };
        error.code = parseResult.error.code;
        error.parseErrorCode = parseResult.error.code;
        throw error;
      }

      const generatedImages = await Promise.all(
        parseResult.data.candidates.flatMap((candidate) =>
          candidate.generatedImages.map(async (image) => {
            const imageResult = {
              url: image.url,
              alt: image.alt,
              title: image.title,
              description: image.alt
            };

            let host: string;
            try {
              host = new URL(image.url).hostname.toLowerCase();
            } catch {
              return imageResult;
            }

            if (host !== "googleusercontent.com" && !host.endsWith(".googleusercontent.com")) {
              return imageResult;
            }

            const downloaded = await downloadImage(
              this.deps.client,
              image.url,
              session.userId,
              "image-download"
            );

            if (!downloaded) {
              logger.warn("generate", "Image download failed; returning URL only", {
                accountIndex,
                tabId: session.tabId,
                imageUrl: image.url.slice(0, 120)
              });
              return imageResult;
            }

            return {
              ...imageResult,
              base64: downloaded.base64,
              mimeType: downloaded.mimeType
            };
          })
        )
      );

      return {
        output: parseResult.data,
        rawFrameCount: frames.length,
        conversationId: typeof parseResult.data.metadata[0] === "string" && parseResult.data.metadata[0]
          ? parseResult.data.metadata[0]
          : null,
        generatedImages
      };
    }, { maxRetries: 5 });
  }

  async deleteConversation(accountIndex: number, conversationId: string): Promise<void> {
    if (!conversationId) {
      return;
    }

    const session = await this.deps.auth.ensureSession(accountIndex);
    const tokens = await this.deps.auth.getTokens(accountIndex);
    const payload: RPCPayload = {
      rpcId: GrpcId.DELETE_CHAT,
      payload: JSON.stringify([conversationId]),
      identifier: "generic"
    };

    await this.executeBatch(payload, tokens, session.tabId, session.userId, accountIndex);
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

  private resolveAccountIndex(accountIndex?: number): number {
    return accountIndex ?? this.deps.state.activeAccountIndex ?? 0;
  }

  resetReqId(): void {
    this.requestBuilder.resetReqId();
  }

  getRequestBuilder(): RequestBuilder {
    return this.requestBuilder;
  }

  async generateImage(
    prompt: string,
    options: Omit<GenerateOptions, "prompt" | "usePro"> = {}
  ): Promise<GenerateResult> {
    let currentPrompt = prompt;
    let lastResult: GenerateResult | null = null;

    for (let attempt = 0; attempt <= GenerateService.MAX_ACTION_INPUT_RETRIES; attempt += 1) {
      const result = await this.generate({
        ...options,
        prompt: currentPrompt,
        usePro: true,
        ...(attempt > 0 ? { chatMetadata: undefined } : {})
      });
      lastResult = result;

      const actionInputPrompt = this.checkForActionInput(result);
      if (!actionInputPrompt) {
        return result;
      }

      if (attempt >= GenerateService.MAX_ACTION_INPUT_RETRIES) {
        return result;
      }

      logger.info("generate", "Retrying image generation with action_input prompt", {
        attempt: attempt + 1,
        maxRetries: GenerateService.MAX_ACTION_INPUT_RETRIES,
        originalPromptLength: currentPrompt.length,
        simplifiedPromptLength: actionInputPrompt.length
      });

      const accountIndex = options.accountIndex ?? this.deps.state.activeAccountIndex ?? 0;
      if (result.conversationId) {
        try {
          await this.deleteConversation(accountIndex, result.conversationId);
        } catch (error) {
          logger.warn("generate", "Failed to delete intermediate conversation before retry", {
            accountIndex,
            conversationId: result.conversationId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      currentPrompt = actionInputPrompt;
    }

    return lastResult as GenerateResult;
  }

  private checkForActionInput(result: GenerateResult): string | null {
    if (result.generatedImages?.some((image) => Boolean(image.base64 || image.url))) {
      return null;
    }

    for (const candidate of result.output.candidates) {
      const extractedPrompt = ResponseParser.extractActionInputPrompt(candidate.text);
      if (extractedPrompt) {
        return extractedPrompt;
      }
    }

    return null;
  }
}
