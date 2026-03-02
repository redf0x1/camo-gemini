import { logger } from "../core/logger.js";
import type { CamofoxClient } from "../client/camofox-client.js";

interface DownloadResultPayload {
  ok: boolean;
  base64?: string;
  mimeType?: string;
  size?: number;
  error?: string;
  body?: string;
}

export async function downloadImage(
  imageUrl: string,
  tabId: string,
  userId: string,
  client: CamofoxClient
): Promise<{ base64: string; mimeType: string } | null> {
  const trimmedUrl = imageUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  const previewUrl = trimmedUrl.includes("=s") ? trimmedUrl : `${trimmedUrl}=s512`;
  const expression = `
(async () => {
  const originalUrl = ${JSON.stringify(previewUrl)};
  let currentUrl = originalUrl;

  for (let i = 0; i < 5; i++) {
    const resp = await fetch(currentUrl, { credentials: 'include' });
    const contentType = resp.headers.get('content-type') || '';

    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: 'HTTP error', body: String(resp.status) + ' ' + body.slice(0, 200) };
    }

    if (contentType.startsWith('image/')) {
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      return {
        ok: true,
        base64: btoa(binary),
        mimeType: contentType,
        size: bytes.length
      };
    }

    const text = await resp.text();
    const trimmed = text.trim();
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      if (!url.hostname.endsWith('.google.com') && !url.hostname.endsWith('.googleusercontent.com')) {
        return { ok: false, error: 'Untrusted redirect domain', body: url.hostname };
      }
      currentUrl = trimmed;
    } else {
      return { ok: false, error: 'Non-URL text body', body: trimmed.substring(0, 200) };
    }
  }

  return { ok: false, error: 'Too many redirects' };
})()
`.trim();

  try {
    const payload = await client.evaluateExtended(tabId, expression, userId, 30_000);
    if (!payload.ok) {
      logger.warn("image-download", "evaluate-extended returned error", {
        tabId,
        userId,
        error: payload.error,
        errorType: payload.errorType
      });
      return null;
    }

    const result = payload.result as DownloadResultPayload | undefined;
    if (!result?.ok || typeof result.base64 !== "string" || typeof result.mimeType !== "string") {
      logger.warn("image-download", "image download failed in page context", {
        tabId,
        userId,
        error: result?.error,
        body: result?.body
      });
      return null;
    }

    logger.info("image-download", "image downloaded", {
      tabId,
      userId,
      mimeType: result.mimeType,
      size: result.size
    });

    return {
      base64: result.base64,
      mimeType: result.mimeType
    };
  } catch (error) {
    logger.warn("image-download", "image download request threw", {
      tabId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
