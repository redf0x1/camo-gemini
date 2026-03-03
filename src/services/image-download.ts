import { logger } from "../core/logger.js";
import type { CamofoxClient } from "../client/camofox-client.js";

interface DownloadResultPayload {
  ok: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
  body?: string;
}

export async function downloadImage(
  client: CamofoxClient,
  imageUrl: string,
  userId: string,
  sessionKey: string
): Promise<{ base64: string; mimeType: string } | null> {
  const trimmedUrl = imageUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const isAllowedDomain = parsedUrl.hostname.endsWith("googleusercontent.com") || parsedUrl.hostname.endsWith("google.com");

    if (!isAllowedDomain) {
      logger.warn("image-download", "Blocked image download from untrusted domain", {
        userId,
        imageUrl: trimmedUrl,
        hostname: parsedUrl.hostname
      });
      return null;
    }

    logger.info("image-download", "creating temporary image tab", {
      userId,
      imageUrl: trimmedUrl
    });

    const tab = await client.createTab("about:blank", userId, sessionKey);
    if (!tab.tabId) {
      logger.warn("image-download", "Failed to create temporary image download tab", {
        userId,
        imageUrl: trimmedUrl
      });
      return null;
    }

    logger.info("image-download", "temporary image tab created", {
      tabId: tab.tabId,
      userId,
      imageUrl: trimmedUrl,
      initialUrl: tab.url
    });

    try {
      let currentUrl = trimmedUrl;
      if (!/=[shw]\d+/.test(currentUrl)) {
        currentUrl += "=s1024";
      }

      const MAX_REDIRECT_HOPS = 5;
      let reachedImage = false;

      for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
        logger.info("image-download", `Redirect hop ${hop + 1}/${MAX_REDIRECT_HOPS}`, {
          tabId: tab.tabId,
          userId,
          url: currentUrl.substring(0, 120)
        });

        await client.navigate(tab.tabId, currentUrl, userId);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const check = await client.evaluate(
          tab.tabId,
          "({ ct: document.contentType, body: document.body?.innerText?.trim()?.substring(0, 2048) })",
          userId,
          5_000
        );

        if (!check.ok) {
          logger.warn("image-download", "Content type check failed", {
            tabId: tab.tabId,
            userId,
            hop,
            error: check.error,
            errorType: check.errorType
          });
          break;
        }

        const result = check.result as { ct?: string; body?: string } | undefined;
        const contentType = result?.ct;
        const body = result?.body;

        if (typeof contentType === "string" && contentType.startsWith("image/")) {
          reachedImage = true;
          break;
        }

        if (contentType === "text/plain" && typeof body === "string" && body.startsWith("http")) {
          try {
            const nextUrl = new URL(body.split("\n")[0]?.trim() ?? "");
            const hostname = nextUrl.hostname.toLowerCase();
            if (!hostname.endsWith("googleusercontent.com") && !hostname.endsWith("google.com")) {
              logger.warn("image-download", "Redirect hop to untrusted domain blocked", {
                hostname
              });
              return null;
            }
            currentUrl = nextUrl.href;
          } catch {
            logger.warn("image-download", "Invalid redirect URL in body", {
              bodyPreview: body.substring(0, 120)
            });
            return null;
          }
          continue;
        }

        logger.warn("image-download", "Unexpected content type during redirect", {
          tabId: tab.tabId,
          userId,
          hop,
          contentType,
          bodyPreview: typeof body === "string" ? body.substring(0, 120) : undefined
        });
        return null;
      }

      if (!reachedImage) {
        logger.warn("image-download", `Did not reach image after ${MAX_REDIRECT_HOPS} hops`, {
          tabId: tab.tabId,
          userId,
          imageUrl: trimmedUrl
        });
        return null;
      }

      logger.info("image-download", "running evaluateExtended for image extraction", {
        tabId: tab.tabId,
        userId,
        finalUrl: currentUrl.substring(0, 120)
      });

      const expression = `
(async () => {
  try {
    const response = await fetch(window.location.href, { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status };
    }
    if (!contentType.startsWith('image/')) {
      return { ok: false, error: 'Not image: ' + contentType };
    }
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') {
          resolve({ ok: false, error: 'Invalid data URL' });
          return;
        }
        const splitIndex = dataUrl.indexOf(',');
        if (splitIndex <= 0) {
          resolve({ ok: false, error: 'Invalid data URL' });
          return;
        }
        resolve({
          ok: true,
          base64: dataUrl.slice(splitIndex + 1),
          mimeType: contentType.split(';')[0].trim()
        });
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
})()
`.trim();

      const payload = await client.evaluateExtended(tab.tabId, expression, userId, 15_000);
      logger.info("image-download", "evaluateExtended finished", {
        tabId: tab.tabId,
        userId,
        ok: payload.ok,
        truncated: payload.truncated ?? false,
        errorType: payload.errorType
      });

      if (payload.truncated) {
        logger.warn("image-download", "Response truncated for image download", {
          tabId: tab.tabId,
          userId,
          imageUrl: trimmedUrl
        });
        return null;
      }

      if (!payload.ok) {
        logger.warn("image-download", "Image extraction evaluate failed", {
          tabId: tab.tabId,
          userId,
          imageUrl: trimmedUrl,
          error: payload.error,
          errorType: payload.errorType
        });
        return null;
      }

      const result = payload.result as DownloadResultPayload | undefined;
      if (!result?.ok || typeof result.base64 !== "string" || typeof result.mimeType !== "string") {
        logger.warn("image-download", "Image extraction returned invalid payload", {
          tabId: tab.tabId,
          userId,
          imageUrl: trimmedUrl,
          error: result?.error ?? "unknown",
          body: result?.body
        });
        return null;
      }

      logger.info("image-download", "image downloaded", {
        tabId: tab.tabId,
        userId,
        mimeType: result.mimeType,
        base64Length: result.base64.length
      });

      return {
        base64: result.base64,
        mimeType: result.mimeType
      };
    } finally {
      try {
        await client.closeTab(tab.tabId, userId);
      } catch (closeError) {
        logger.warn("image-download", "Failed to close temporary image tab", {
          tabId: tab.tabId,
          userId,
          error: closeError instanceof Error ? closeError.message : String(closeError)
        });
      }
    }
  } catch (error) {
    logger.warn("image-download", "image download failed", {
      userId,
      imageUrl: trimmedUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
