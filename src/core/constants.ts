import type { ChatMetadata } from "../types.js";

export const GEMINI_BASE = "https://gemini.google.com";
export const ANTI_XSSI_PREFIX = ")]}'";
export const UPLOAD_URL = "https://push.clients6.google.com/upload/";
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

// === Timing Constants ===
export const LOGIN_INITIAL_DELAY_MS = 3000;
export const LOGIN_RETRY_DELAY_MS = 2000;
export const TOKEN_REFRESH_DELAY_MS = 3000;
export const TOKEN_VALIDITY_MS = 600_000;

// === Retry Constants ===
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_RETRY_DELAY_FACTOR = 5;

// === Health Constants ===
export const HEALTH_BACKOFF_BASE_MS = 30000;
export const HEALTH_BACKOFF_CAP_MS = 600000;

export function getAccountPrefix(accountIndex: number): string {
  return accountIndex > 0 ? `/u/${accountIndex}` : "";
}

export const Endpoint = {
  GOOGLE: "https://www.google.com",
  INIT: (accountIndex = 0) => `${GEMINI_BASE}${getAccountPrefix(accountIndex)}/app`,
  GENERATE: (accountIndex = 0) =>
    `${GEMINI_BASE}${getAccountPrefix(accountIndex)}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`,
  BATCH_EXEC: (accountIndex = 0) => `${GEMINI_BASE}${getAccountPrefix(accountIndex)}/_/BardChatUi/data/batchexecute`,
  ROTATE_COOKIES: "https://accounts.google.com/RotateCookies",
  UPLOAD: (accountIndex = 0) => `${UPLOAD_URL}?authuser=${accountIndex}`,
  SOURCE_PATH: (accountIndex = 0) => `${getAccountPrefix(accountIndex)}/app`
} as const;

export const GrpcId = {
  LIST_CHATS: "MaZiqc",
  READ_CHAT: "hNvQHb",
  DELETE_CHAT: "GzXR5e",
  LIST_GEMS: "CNgdBe",
  CREATE_GEM: "oMH3Zd",
  UPDATE_GEM: "kHv0Vd",
  DELETE_GEM: "UXcSJb",
  BARD_ACTIVITY: "ESY5D"
} as const;

export const GEMINI_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
  Origin: "https://gemini.google.com",
  Referer: "https://gemini.google.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "X-Same-Domain": "1"
} as const;

export const ROTATE_COOKIES_HEADERS = {
  "Content-Type": "application/json"
} as const;

export interface GeminiModelDef {
  readonly name: string;
  readonly header: Readonly<Record<string, string>>;
}

export const MODELS: Readonly<Record<string, GeminiModelDef>> = {
  unspecified: {
    name: "unspecified",
    header: {}
  },
  "gemini-3.0-pro": {
    name: "gemini-3.0-pro",
    header: {
      "x-goog-ext-525001261-jspb": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4],null,null,1]'
    }
  },
  "gemini-3.0-flash": {
    name: "gemini-3.0-flash",
    header: {
      "x-goog-ext-525001261-jspb": '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4],null,null,1]'
    }
  },
  "gemini-3.0-flash-thinking": {
    name: "gemini-3.0-flash-thinking",
    header: {
      "x-goog-ext-525001261-jspb": '[1,null,null,null,"5bf011840784117a",null,null,0,[4],null,null,1]'
    }
  }
} as const;

export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  pro: "gemini-3.0-pro",
  flash: "gemini-3.0-flash",
  thinking: "gemini-3.0-flash-thinking"
} as const;

export const API_ERROR_CODES = {
  TEMPORARY_ERROR_1013: 1013,
  USAGE_LIMIT_EXCEEDED: 1037,
  MODEL_INCONSISTENT: 1050,
  MODEL_HEADER_INVALID: 1052,
  IP_TEMPORARILY_BLOCKED: 1060
} as const;

export const RATE_LIMIT_PATTERNS = [
  /I couldn't do that because I'm getting a lot of requests right now/i,
  /I'm getting a lot of requests right now/i,
  /Please try again later/i
];

export const IMAGE_GEN_BLOCKED_PATTERNS = [
  /Are you signed in\?.*(?:search for images|can't.*create)/i,
  /can't seem to create any.*for you right now/i,
  /image creation isn't available in your location/i,
  /I can search for images, but can't.*create/i,
  /can't (?:generate|create) (?:more |any )?images/i
];

export const GOOGLE_USER_CONTENT_PATTERN = /http:\/\/googleusercontent\.com\/\w+\/\d+\n*/g;
export const CARD_CONTENT_PATTERN = /^http:\/\/googleusercontent\.com\/card_content\/\d+/;

export const TOKEN_PATTERNS = {
  SNlM0e: /"SNlM0e":"(.*?)"/,
  cfb2h: /"cfb2h":"(.*?)"/,
  FdrFJe: /"FdrFJe":"(.*?)"/
} as const;

export const COOKIE_ROTATION_INTERVAL_MS = 540_000;

export const COOKIE_NAMES = {
  PSID: "__Secure-1PSID",
  PSIDTS: "__Secure-1PSIDTS",
  PSIDCC: "__Secure-1PSIDCC"
} as const;

export const DEFAULT_PARAMS = {
  bl: "boq_assistant-bard-web-server_20250601.00_p0",
  rt: "c"
} as const;

export const INNER_REQ_LIST_SIZE = 73;

export const NEW_CHAT_METADATA: ChatMetadata = ["", "", "", null, null, null, null, null, null, ""];
