export interface TabInfo {
  tabId: string;
  url: string;
  title: string;
}

export interface EvaluateResponse {
  ok: boolean;
  result?: unknown;
  resultType?: string;
  truncated?: boolean;
  error?: string;
  errorType?: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  expires?: number;
}

export interface GeminiSession {
  tabId: string;
  userId: string;
  accountIndex: number;
  authenticated: boolean;
  authenticatedEmail?: string | null;
  tokens: GeminiTokens | null;
  lastRotation: number;
}

/** Health status for an account */
export type AccountHealth = "healthy" | "degraded" | "cooldown" | "offline";

/** Per-account state entry */
export interface AccountEntry {
  accountIndex: number;
  session: GeminiSession | null;
  health: AccountHealth;
  /** CamoFox userId for this account's isolated browser context */
  camofoxUserId: string;
  /** Tab ID for this account's persistent session tab */
  tabId: string | null;
  /** Timestamp of last successful operation */
  lastSuccessAt: number;
  /** Timestamp of last error */
  lastErrorAt: number;
  /** Number of consecutive errors */
  consecutiveErrors: number;
  /** Cooldown until timestamp (for rate-limited accounts) */
  cooldownUntil: number;
  /** Whether this account is actively logged in */
  isLoggedIn: boolean;
}

/** Account info for external reporting (MCP tools) */
export interface AccountInfo {
  accountIndex: number;
  health: AccountHealth;
  isLoggedIn: boolean;
  isActive: boolean;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  cooldownUntil: number | null;
}

/** Health check result */
export interface HealthCheckResult {
  overall: AccountHealth;
  camofoxConnected: boolean;
  accounts: AccountInfo[];
  activeAccountIndex: number | null;
  totalAccounts: number;
  healthyAccounts: number;
}

export interface GeminiTokens {
  snlm0e: string;
  cfb2h: string;
  fdrfje: string;
  extractedAt: number;
}

export interface TokenExtractionResult {
  ok: boolean;
  tokens?: {
    snlm0e: string;
    cfb2h: string | null;
    fdrfje: string | null;
  };
  error?: string;
  url?: string;
  hint?: string;
  extractedAt?: number;
}

export interface CookieRotationResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface GenerateRequest {
  prompt: string;
  model?: string;
  images?: ImageAttachment[];
  conversationId?: string;
  responseId?: string;
  choiceId?: string;
  gemId?: string;
}

export interface GenerateOptions {
  prompt: string;
  model?: string;
  accountIndex?: number;
  chatMetadata?: ChatMetadata;
  gemId?: string;
  images?: Array<{ url: string; filename: string }>;
  usePro?: boolean;
  files?: UploadResult[];
}

export interface RequestPayload {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type ChatMetadata = [
  string,
  string,
  string,
  null,
  null,
  null,
  null,
  null,
  null,
  string
];

export interface BrowserFetchResult {
  ok: boolean;
  data?: string;
  error?: string;
}

export interface RPCPayload {
  rpcId: string;
  payload: string;
  identifier?: string;
}

export interface ImageAttachment {
  url?: string;
  data?: string;
  mimeType?: string;
}

export interface ImageData {
  url: string;
  alt?: string;
  title?: string;
}

export interface GenerateResponse {
  text: string;
  conversationId: string;
  responseId: string;
  choiceId: string;
  images: GeneratedImage[];
  metadata: ResponseMetadata;
}

export interface GeneratedImage {
  url: string;
  description?: string;
  alt?: string;
  title?: string;
  base64?: string;
  mimeType?: string;
}

export interface UploadOptions {
  fileBase64: string;
  filename: string;
  mimeType?: string;
  accountIndex?: number;
}

export interface UploadResult {
  fileUri: string;
  filename: string;
}

export interface ResponseMetadata {
  model: string;
  thinkingTime?: number;
  searchQueries?: string[];
}

export interface ChatSession {
  conversationId: string;
  responseId: string;
  choiceId: string;
  model: string;
}

export interface ParseSuccess<T> {
  ok: true;
  data: T;
}

export interface ParseFailure {
  ok: false;
  error: ParseError;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  raw?: unknown;
}

export type ParseErrorCode =
  | "TEMPORARY_ERROR"
  | "USAGE_LIMIT_EXCEEDED"
  | "MODEL_INCONSISTENT"
  | "MODEL_HEADER_INVALID"
  | "IP_BLOCKED"
  | "RATE_LIMITED"
  | "IMAGE_GEN_BLOCKED"
  | "PARSE_ERROR"
  | "UNKNOWN_API_ERROR";

export interface ModelOutput {
  metadata: (string | null)[];
  candidates: ParsedCandidate[];
  chosenIndex: number;
  isCompleted: boolean;
}

export interface ChatTurn {
  prompt: string;
  response: ModelOutput;
  timestamp: number;
}

export interface ChatSessionState {
  id: string;
  cid: string;
  rid: string;
  rcid: string;
  context: string;
  model?: string;
  accountIndex: number;
  gemId?: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatOptions {
  model?: string;
  accountIndex?: number;
  gemId?: string;
}

export interface ChatResult {
  text: string;
  candidates: ParsedCandidate[];
  sessionId: string;
  isNewSession: boolean;
  turnNumber: number;
}

export interface ChatSessionInfo {
  id: string;
  turnCount: number;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ParsedCandidate {
  rcid: string;
  text: string;
  thoughts: string | null;
  webImages: ImageData[];
  generatedImages: ImageData[];
  isFinal: boolean;
}

export interface Gem {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  isSystem: boolean;
}

export interface GemCreateOptions {
  name: string;
  description?: string;
  instructions: string;
  accountIndex?: number;
}

export interface GemUpdateOptions {
  gemId: string;
  name?: string;
  description?: string;
  instructions?: string;
  accountIndex?: number;
}

export interface GenerateResult {
  output: ModelOutput;
  rawFrameCount: number;
  conversationId?: string | null;
  generatedImages?: GeneratedImage[];
}

export interface Config {
  camofoxUrl: string;
  camofoxApiKey?: string;
  userId: string;
  requestTimeout: number;
  dashboardPort: number;
  dashboardEnabled: boolean;
  AUTO_DELETE_CHAT: boolean;
}
