import type { CamofoxClient } from "../client/camofox-client.js";
import { TOKEN_VALIDITY_MS } from "./constants.js";
import { AppError, GEMINI_ERROR } from "../errors.js";
import type { GeminiTokens, TokenExtractionResult } from "../types.js";

export class TokenManager {
  constructor(private client: CamofoxClient) {}

  async extractTokens(tabId: string, userId: string): Promise<GeminiTokens> {
    const extractionJs = `(() => {
      const url = window.location.href;
      if (url.includes('consent.google.com') || url.includes('accounts.google.com/signin') || url.includes('accounts.google.com/v3')) {
        return { ok: false, error: 'not_authenticated', url: url };
      }

      const html = document.documentElement.innerHTML;
      const snlm0eMatch = html.match(/"SNlM0e"\\s*:\\s*"(.*?)"/);
      const cfb2hMatch  = html.match(/"cfb2h"\\s*:\\s*"(.*?)"/);
      const fdrfjeMatch = html.match(/"FdrFJe"\\s*:\\s*"(.*?)"/);

      const snlm0e = snlm0eMatch ? snlm0eMatch[1] : '';
      const cfb2h = cfb2hMatch ? cfb2hMatch[1] : null;
      const fdrfje = fdrfjeMatch ? fdrfjeMatch[1] : null;

      if (!cfb2h && !fdrfje) {
        return {
          ok: false,
          error: 'no_tokens_found',
          url: url,
          hint: 'Page may not be fully loaded or user is not authenticated'
        };
      }

      return {
        ok: true,
        tokens: { snlm0e: snlm0e, cfb2h: cfb2h, fdrfje: fdrfje },
        url: url,
        extractedAt: Date.now()
      };
    })()`;

    const result = await this.client.evaluate(tabId, extractionJs, userId);
    if (!result.ok) {
      throw new AppError(
        GEMINI_ERROR.TOKEN_EXTRACTION_FAILED,
        `Token extraction evaluate failed: ${result.error ?? "unknown error"}`
      );
    }

    const data = result.result as TokenExtractionResult;
    if (!data?.ok) {
      if (data?.error === "not_authenticated") {
        throw new AppError(
          GEMINI_ERROR.NOT_AUTHENTICATED,
          "User is not authenticated. Please log in to Gemini via CamoFox browser."
        );
      }

      const hint = data?.hint ? ` — ${data.hint}` : "";
      throw new AppError(
        GEMINI_ERROR.TOKEN_EXTRACTION_FAILED,
        `Token extraction failed: ${data?.error ?? "unknown"}${hint}`
      );
    }

    return {
      snlm0e: data.tokens?.snlm0e ?? "",
      cfb2h: data.tokens?.cfb2h ?? "",
      fdrfje: data.tokens?.fdrfje ?? "",
      extractedAt: data.extractedAt ?? Date.now()
    };
  }

  isValid(tokens: GeminiTokens): boolean {
    const age = Date.now() - tokens.extractedAt;
    return age < TOKEN_VALIDITY_MS;
  }
}
