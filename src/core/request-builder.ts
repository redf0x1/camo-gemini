import {
  Endpoint,
  GEMINI_HEADERS,
  GrpcId,
  INNER_REQ_LIST_SIZE,
  MODEL_ALIASES,
  MODELS,
  NEW_CHAT_METADATA
} from "./constants.js";
import type {
  ChatMetadata,
  GenerateOptions,
  GenerateRequest,
  GemCreateOptions,
  GemUpdateOptions,
  GeminiTokens,
  ImageAttachment,
  RPCPayload,
  RequestPayload,
  UploadResult
} from "../types.js";

export class RequestBuilder {
  private _reqid: number;

  constructor() {
    this._reqid = RequestBuilder.randomReqId();
  }

  resetReqId(): void {
    this._reqid = RequestBuilder.randomReqId();
  }

  get reqId(): number {
    return this._reqid;
  }

  static randomReqId(): number {
    return Math.floor(Math.random() * 90000) + 10000;
  }

  buildGeneratePayload(
    request: GenerateRequest,
    tokens: GeminiTokens,
    accountIndex = 0,
    chatMetadata?: ChatMetadata
  ): RequestPayload {
    const reqid = this._reqid;
    this._reqid += 100000;

    const modelName = this.resolveModel(request.model);
    const modelDef = MODELS[modelName] ?? MODELS.unspecified;

    const fileData = request.images?.length ? this.buildFileData(request.images) : null;
    const messageContent: unknown[] = [request.prompt, 0, null, fileData, null, null, 0];

    const innerReqList: unknown[] = new Array(INNER_REQ_LIST_SIZE).fill(null);
    innerReqList[0] = messageContent;
    innerReqList[2] = chatMetadata ? [...chatMetadata] : [...NEW_CHAT_METADATA];
    innerReqList[7] = 1;
    if (request.gemId) {
      innerReqList[19] = request.gemId;
    }

    const fReq = JSON.stringify([null, JSON.stringify(innerReqList)]);

    const params = new URLSearchParams();
    params.set("_reqid", String(reqid));
    params.set("rt", "c");
    if (tokens.cfb2h) params.set("bl", tokens.cfb2h);
    if (tokens.fdrfje) params.set("f.sid", tokens.fdrfje);

    const url = `${Endpoint.GENERATE(accountIndex)}?${params.toString()}`;
    const headers: Record<string, string> = {
      "Content-Type": GEMINI_HEADERS["Content-Type"],
      "X-Same-Domain": GEMINI_HEADERS["X-Same-Domain"],
      ...modelDef.header
    };
    const body = new URLSearchParams({
      at: tokens.snlm0e,
      "f.req": fReq
    }).toString();

    return { url, headers, body };
  }

  buildBatchPayload(
    payloads: RPCPayload[],
    tokens: GeminiTokens,
    accountIndex = 0
  ): RequestPayload {
    const reqid = this._reqid;
    this._reqid += 100000;

    const serialized = payloads.map((payload) => [payload.rpcId, payload.payload, null, payload.identifier ?? "generic"]);

    const params = new URLSearchParams();
    params.set("rpcids", payloads.map((payload) => payload.rpcId).join(","));
    params.set("_reqid", String(reqid));
    params.set("rt", "c");
    params.set("source-path", Endpoint.SOURCE_PATH(accountIndex));
    if (tokens.cfb2h) params.set("bl", tokens.cfb2h);
    if (tokens.fdrfje) params.set("f.sid", tokens.fdrfje);

    const url = `${Endpoint.BATCH_EXEC(accountIndex)}?${params.toString()}`;
    const headers: Record<string, string> = {
      "Content-Type": GEMINI_HEADERS["Content-Type"],
      "X-Same-Domain": GEMINI_HEADERS["X-Same-Domain"]
    };
    const body = new URLSearchParams({
      at: tokens.snlm0e,
      "f.req": JSON.stringify([serialized])
    }).toString();

    return { url, headers, body };
  }

  buildBardActivityPayload(tokens: GeminiTokens, accountIndex = 0): RequestPayload {
    return this.buildBatchPayload(
      [
        {
          rpcId: GrpcId.BARD_ACTIVITY,
          payload: JSON.stringify([["bard_activity_enabled"]]),
          identifier: "generic"
        }
      ],
      tokens,
      accountIndex
    );
  }

  buildUploadedFileData(files: UploadResult[]): unknown[] | null {
    if (!files.length) return null;
    return files.map((file) => [[[file.fileUri], file.filename]]);
  }

  buildImageGeneratePayload(
    prompt: string,
    options: Omit<GenerateOptions, "prompt">,
    tokens: GeminiTokens,
    accountIndex = 0
  ): RequestPayload {
    const reqid = this._reqid;
    this._reqid += 100000;

    const modelName = this.resolveModel(options.model);
    const modelDef = MODELS[modelName] ?? MODELS.unspecified;
    const uploadedFileData = options.files?.length ? this.buildUploadedFileData(options.files) : null;
    const imageFileData = options.images?.length ? this.buildFileData(options.images) : null;
    const fileData = uploadedFileData ?? imageFileData;

    const messageContent: unknown[] = [prompt, 0, null, fileData, null, null, 0];
    if (options.usePro) {
      messageContent.push(null, null, [null, null, null, null, null, null, [null, [1]]]);
    }

    const innerReqList: unknown[] = new Array(INNER_REQ_LIST_SIZE).fill(null);
    innerReqList[0] = messageContent;
    innerReqList[2] = options.chatMetadata ? [...options.chatMetadata] : [...NEW_CHAT_METADATA];
    innerReqList[7] = 1;
    if (options.gemId) {
      innerReqList[19] = options.gemId;
    }
    if (options.usePro) {
      innerReqList[32] = 1;
    }

    const fReq = JSON.stringify([null, JSON.stringify(innerReqList)]);

    const params = new URLSearchParams();
    params.set("_reqid", String(reqid));
    params.set("rt", "c");
    if (tokens.cfb2h) params.set("bl", tokens.cfb2h);
    if (tokens.fdrfje) params.set("f.sid", tokens.fdrfje);

    const url = `${Endpoint.GENERATE(accountIndex)}?${params.toString()}`;
    const headers: Record<string, string> = {
      "Content-Type": GEMINI_HEADERS["Content-Type"],
      "X-Same-Domain": GEMINI_HEADERS["X-Same-Domain"],
      ...modelDef.header
    };
    const body = new URLSearchParams({
      at: tokens.snlm0e,
      "f.req": fReq
    }).toString();

    return { url, headers, body };
  }

  buildGemListPayload(type: "system" | "custom"): RPCPayload {
    return {
      rpcId: GrpcId.LIST_GEMS,
      payload: JSON.stringify([type === "system" ? 4 : 2, ["en"], 0]),
      identifier: "generic"
    };
  }

  buildGemCreatePayload(options: GemCreateOptions): RPCPayload {
    const payload = [
      [
        options.name,
        options.description ?? "",
        options.instructions,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        1,
        null,
        null,
        null,
        []
      ]
    ];

    return {
      rpcId: GrpcId.CREATE_GEM,
      payload: JSON.stringify(payload),
      identifier: "generic"
    };
  }

  buildGemUpdatePayload(options: GemUpdateOptions): RPCPayload {
    const payload = [
      options.gemId,
      [
        options.name ?? null,
        options.description ?? "",
        options.instructions ?? null,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        1,
        null,
        null,
        null,
        [],
        0
      ]
    ];

    return {
      rpcId: GrpcId.UPDATE_GEM,
      payload: JSON.stringify(payload),
      identifier: "generic"
    };
  }

  buildGemDeletePayload(gemId: string): RPCPayload {
    return {
      rpcId: GrpcId.DELETE_GEM,
      payload: JSON.stringify([gemId]),
      identifier: "generic"
    };
  }

  resolveModel(nameOrAlias?: string): string {
    if (!nameOrAlias) return "unspecified";
    const alias = MODEL_ALIASES[nameOrAlias];
    return alias ?? nameOrAlias;
  }

  private buildFileData(images: ImageAttachment[]): unknown[] | null {
    if (!images.length) return null;
    return images.map((image) => [[image.url ?? image.data, image.mimeType ?? "image/png"]]);
  }
}
