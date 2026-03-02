import { NEW_CHAT_METADATA } from "../core/constants.js";
import type {
  ChatMetadata,
  ChatOptions,
  ChatResult,
  ChatSessionInfo,
  ChatSessionState,
  ModelOutput
} from "../types.js";
import type { GenerateService } from "./generate.js";

export class ChatService {
  private sessions = new Map<string, ChatSessionState>();
  private chatLocks = new Map<string, Promise<ChatResult>>();

  constructor(private generateService: GenerateService) {}

  async chat(sessionId: string, prompt: string, options: ChatOptions = {}): Promise<ChatResult> {
    const inflight = this.chatLocks.get(sessionId);
    if (inflight) {
      return inflight;
    }

    const promise = this._doChat(sessionId, prompt, options).finally(() => {
      this.chatLocks.delete(sessionId);
    });
    this.chatLocks.set(sessionId, promise);
    return promise;
  }

  private async _doChat(sessionId: string, prompt: string, options: ChatOptions = {}): Promise<ChatResult> {
    const now = Date.now();
    let session = this.sessions.get(sessionId);
    const isNewSession = !session;

    if (!session) {
      session = {
        id: sessionId,
        cid: "",
        rid: "",
        rcid: "",
        context: "",
        model: options.model,
        accountIndex: options.accountIndex ?? 0,
        gemId: options.gemId,
        turns: [],
        createdAt: now,
        updatedAt: now
      };
    }

    const model = options.model ?? session.model;
    const accountIndex = options.accountIndex ?? session.accountIndex;
    const gemId = options.gemId ?? session.gemId;

    const chatMetadata: ChatMetadata = isNewSession
      ? [...NEW_CHAT_METADATA]
      : [session.cid, session.rid, session.rcid, null, null, null, null, null, null, session.context];

    const generated = await this.generateService.generate({
      prompt,
      model,
      accountIndex,
      chatMetadata,
      gemId
    });

    if (isNewSession) {
      this.generateService.resetReqId();
      this.sessions.set(sessionId, session);
    }

    session.model = model;
    session.accountIndex = accountIndex;
    session.gemId = gemId;
    this.applyMetadataUpdate(session, generated.output);

    session.turns.push({
      prompt,
      response: generated.output,
      timestamp: now
    });
    session.updatedAt = now;

    const primaryIndex = generated.output.chosenIndex >= 0 && generated.output.chosenIndex < generated.output.candidates.length
      ? generated.output.chosenIndex
      : 0;
    const primaryCandidate = generated.output.candidates[primaryIndex];

    return {
      text: primaryCandidate?.text ?? "",
      candidates: generated.output.candidates,
      sessionId,
      isNewSession,
      turnNumber: session.turns.length
    };
  }

  getSession(sessionId: string): ChatSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): ChatSessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      turnCount: session.turns.length,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }));
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clearAll(): void {
    this.sessions.clear();
  }

  clearAccount(accountIndex: number): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.accountIndex === accountIndex) {
        this.sessions.delete(sessionId);
      }
    }
  }

  chooseCandidate(sessionId: string, candidateIndex: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    const lastTurn = session.turns[session.turns.length - 1];
    if (!lastTurn) {
      throw new Error("No turns in session");
    }

    if (candidateIndex < 0 || candidateIndex >= lastTurn.response.candidates.length) {
      throw new Error(`Candidate index out of range: ${candidateIndex}`);
    }

    const candidate = lastTurn.response.candidates[candidateIndex];
    if (!candidate) {
      throw new Error(`Candidate index out of range: ${candidateIndex}`);
    }

    lastTurn.response.chosenIndex = candidateIndex;
    if (candidate.rcid) {
      session.rcid = candidate.rcid;
    }
    session.updatedAt = Date.now();
  }

  private applyMetadataUpdate(session: ChatSessionState, output: ModelOutput): void {
    const metadata = output.metadata;
    const cid = metadata[0];
    const rid = metadata[1];
    const context = metadata[9];

    if (cid) {
      session.cid = cid;
    }
    if (rid) {
      session.rid = rid;
    }
    if (context) {
      session.context = context;
    }

    const chosenCandidate = output.candidates[output.chosenIndex] ?? output.candidates[0];
    if (chosenCandidate?.rcid) {
      session.rcid = chosenCandidate.rcid;
    } else {
      const metadataRcid = metadata[2];
      if (metadataRcid) {
        session.rcid = metadataRcid;
      }
    }
  }
}
