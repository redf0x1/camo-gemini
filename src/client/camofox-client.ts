import { z } from "zod";

import { AppError } from "../errors.js";
import type { Config, Cookie, EvaluateResponse, TabInfo } from "../types.js";

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

const ApiErrorPayloadSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional()
  })
  .passthrough();

const CreateTabRawResponseSchema = z
  .object({
    tabId: z.string().optional(),
    id: z.string().optional(),
    tab: z
      .object({
        id: z.string().optional()
      })
      .optional(),
    url: z.string().optional(),
    title: z.string().optional()
  })
  .passthrough();

const NavigateRawResponseSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().optional()
  })
  .passthrough();

const SnapshotRawResponseSchema = z
  .object({
    snapshot: z.string().optional()
  })
  .passthrough();

const EvaluateResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    resultType: z.string().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
    errorType: z.string().optional()
  })
  .passthrough();

const CookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.string().optional()
  })
  .passthrough();

const CookieExportResponseSchema = z.union([
  z.array(CookieSchema),
  z
    .object({
      cookies: z.array(CookieSchema)
    })
    .passthrough()
]);

export class CamofoxClient {
  private readonly baseUrl: string;

  private readonly timeout: number;

  private readonly apiKey?: string;

  constructor(config: Config) {
    this.baseUrl = config.camofoxUrl.replace(/\/$/, "");
    this.timeout = config.requestTimeout;
    this.apiKey = config.camofoxApiKey;
  }

  async createTab(url: string, userId: string, sessionKey?: string): Promise<TabInfo> {
    const response = await this.requestJson(
      "/tabs",
      {
        method: "POST",
        body: JSON.stringify({ url, userId, ...(sessionKey ? { sessionKey } : {}) })
      },
      CreateTabRawResponseSchema
    );

    const tabId = response.tabId ?? response.id ?? response.tab?.id;
    if (!tabId) {
      throw new AppError("INTERNAL_ERROR", "CamoFox did not return a valid tab ID");
    }

    return {
      tabId,
      url: response.url ?? url,
      title: response.title ?? ""
    };
  }

  async closeTab(tabId: string, userId: string): Promise<void> {
    await this.requestNoContent(`/tabs/${encodeURIComponent(tabId)}?userId=${encodeURIComponent(userId)}`, {
      method: "DELETE"
    });
  }

  async deleteSession(userId: string): Promise<void> {
    await this.requestNoContent(`/sessions/${encodeURIComponent(userId)}`, {
      method: "DELETE"
    });
  }

  async navigate(tabId: string, url: string, userId: string): Promise<TabInfo> {
    const response = await this.requestJson(
      `/tabs/${encodeURIComponent(tabId)}/navigate`,
      {
        method: "POST",
        body: JSON.stringify({ userId, url })
      },
      NavigateRawResponseSchema
    );

    return {
      tabId,
      url: response.url ?? url,
      title: response.title ?? ""
    };
  }

  async snapshot(tabId: string, userId: string): Promise<string> {
    const response = await this.requestJson(
      `/tabs/${encodeURIComponent(tabId)}/snapshot?userId=${encodeURIComponent(userId)}`,
      { method: "GET" },
      SnapshotRawResponseSchema
    );

    return response.snapshot ?? "";
  }

  async evaluate(tabId: string, expression: string, userId: string, timeout?: number): Promise<EvaluateResponse> {
    const response = await this.requestJson(
      `/tabs/${encodeURIComponent(tabId)}/evaluate`,
      {
        method: "POST",
        body: JSON.stringify({ expression, userId, ...(timeout !== undefined ? { timeout } : {}) }),
        requireApiKey: true
      },
      EvaluateResponseSchema
    );

    return response;
  }

  async evaluateExtended(tabId: string, expression: string, userId: string, timeout?: number): Promise<EvaluateResponse> {
    const response = await this.requestJson(
      `/tabs/${encodeURIComponent(tabId)}/evaluate-extended`,
      {
        method: "POST",
        body: JSON.stringify({ expression, userId, ...(timeout !== undefined ? { timeout } : {}) }),
        requireApiKey: true
      },
      EvaluateResponseSchema
    );

    return response;
  }

  async exportCookies(tabId: string, userId: string): Promise<Cookie[]> {
    const response = await this.requestJson(
      `/tabs/${encodeURIComponent(tabId)}/cookies?userId=${encodeURIComponent(userId)}`,
      { method: "GET" },
      CookieExportResponseSchema
    );

    const cookies = Array.isArray(response) ? response : response.cookies;
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? false,
      sameSite: cookie.sameSite,
      expires: cookie.expires
    }));
  }

  async importCookies(userId: string, cookies: Cookie[], tabId?: string): Promise<void> {
    const MAX_COOKIES_PER_REQUEST = 500;

    if (cookies.length <= MAX_COOKIES_PER_REQUEST) {
      await this.requestNoContent(`/sessions/${encodeURIComponent(userId)}/cookies`, {
        method: "POST",
        body: JSON.stringify({ cookies, ...(tabId ? { tabId } : {}) }),
        requireApiKey: true
      });
      return;
    }

    for (let index = 0; index < cookies.length; index += MAX_COOKIES_PER_REQUEST) {
      const batch = cookies.slice(index, index + MAX_COOKIES_PER_REQUEST);
      await this.requestNoContent(`/sessions/${encodeURIComponent(userId)}/cookies`, {
        method: "POST",
        body: JSON.stringify({ cookies: batch, ...(tabId ? { tabId } : {}) }),
        requireApiKey: true
      });
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit & { requireApiKey?: boolean },
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await this.request(path, init);
    const rawBody = await response.text();

    if (!rawBody || rawBody.trim().length === 0) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Expected JSON response from ${path} but received empty body (status ${response.status})`
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AppError(
        "INTERNAL_ERROR",
        `Expected JSON response from ${path} but received non-JSON body (status ${response.status})`
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Unexpected response from CamoFox API: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`
      );
    }

    return parsed.data;
  }

  private async requestNoContent(path: string, init: RequestInit & { requireApiKey?: boolean }): Promise<void> {
    await this.request(path, init);
  }

  private async request(path: string, init: RequestInit & { requireApiKey?: boolean }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");

      if (this.apiKey) {
        headers.set("x-api-key", this.apiKey);
        headers.set("authorization", `Bearer ${this.apiKey}`);
      }

      if (init.headers) {
        const extra = new Headers(init.headers);
        extra.forEach((value, key) => {
          headers.set(key, value);
        });
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        throw await this.buildHttpError(response);
      }

      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("TIMEOUT", `CamoFox API request timed out after ${this.timeout}ms`);
      }

      if (error instanceof Error) {
        throw new AppError("CONNECTION_REFUSED", `Failed to connect to CamoFox API: ${error.message}`);
      }

      throw new AppError("INTERNAL_ERROR", "Unknown error while calling CamoFox API");
    } finally {
      clearTimeout(timer);
    }
  }

  private async buildHttpError(response: Response): Promise<AppError> {
    let message = `CamoFox API request failed with ${response.status}`;

    const rawBody = await response.text();
    if (rawBody) {
      try {
        const json: unknown = JSON.parse(rawBody);
        const parsed = ApiErrorPayloadSchema.safeParse(json);
        if (parsed.success) {
          const body: ApiErrorPayload = parsed.data;
          message = body.error ?? body.message ?? rawBody;
        } else {
          message = rawBody;
        }
      } catch {
        message = rawBody;
      }
    }

    if (response.status === 404) {
      return new AppError("TAB_NOT_FOUND", message, response.status);
    }

    if (response.status === 401 || response.status === 403) {
      const hint = "CAMOFOX_API_KEY is required for this operation";
      const combined = message.toLowerCase().includes("camofox_api_key")
        ? message
        : `${hint} (${response.status}): ${message}`;
      return new AppError("API_KEY_REQUIRED", combined, response.status);
    }

    if (response.status >= 500) {
      return new AppError("GEMINI_TEMPORARY_ERROR", message, response.status);
    }

    return new AppError("INTERNAL_ERROR", message, response.status);
  }
}
