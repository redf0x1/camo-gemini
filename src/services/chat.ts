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

interface ChatQueue {
  valid: boolean;
  accountIndex: number;
  accounts: Map<number, number>;
  tail?: Promise<ChatResult>;
}

export class ChatService {
  private sessions = new Map<string, ChatSessionState>();
  private chatQueues = new Map<string, ChatQueue>();

  constructor(private generateService: GenerateService) {}

  async chat(sessionId: string, prompt: string, options: ChatOptions = {}): Promise<ChatResult> {
    let queue = this.chatQueues.get(sessionId);
    if (!queue) {
      queue = {
        valid: true,
        accountIndex: this.sessions.get(sessionId)?.accountIndex ?? 0,
        accounts: new Map<number, number>()
      };
      this.chatQueues.set(sessionId, queue);
    }
    const currentQueue = queue;
    const accountIndex = options.accountIndex ?? currentQueue.accountIndex;
    currentQueue.accountIndex = accountIndex;
    currentQueue.accounts.set(accountIndex, (currentQueue.accounts.get(accountIndex) ?? 0) + 1);
    const prev = currentQueue.tail ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => {
        if (!currentQueue.valid) {
          throw Object.assign(new Error("Chat session was cleared before this request started"), {
            code: "CHAT_SESSION_NOT_FOUND"
          });
        }
        return this._doChat(sessionId, prompt, { ...options, accountIndex }, currentQueue);
      });
    currentQueue.tail = next;
    return next.finally(() => {
      const remaining = (currentQueue.accounts.get(accountIndex) ?? 1) - 1;
      if (remaining === 0) currentQueue.accounts.delete(accountIndex);
      else currentQueue.accounts.set(accountIndex, remaining);
      if (currentQueue.tail === next && this.chatQueues.get(sessionId) === currentQueue) {
        this.chatQueues.delete(sessionId);
      }
    });
  }

  private async _doChat(sessionId: string, prompt: string, options: ChatOptions, queue: ChatQueue): Promise<ChatResult> {
    const now = Date.now();
    let session = this.sessions.get(sessionId);
    const accountIndex = options.accountIndex ?? session?.accountIndex ?? 0;
    const isNewSession = !session || session.accountIndex !== accountIndex;

    if (!session || session.accountIndex !== accountIndex) {
      session = {
        id: sessionId,
        cid: "",
        rid: "",
        rcid: "",
        context: "",
        model: options.model,
        accountIndex,
        gemId: options.gemId,
        turns: [],
        createdAt: now,
        updatedAt: now
      };
    }

    const model = options.model ?? session.model;
    const gemId = options.gemId ?? session.gemId;

    const chatMetadata: ChatMetadata = isNewSession
      ? [...NEW_CHAT_METADATA]
      : [session.cid, session.rid, session.rcid, null, null, null, null, null, null, session.context];

    const generated = await this.generateService.generate({
      prompt,
      model,
      accountIndex,
      allowAccountFailover: false,
      chatMetadata,
      gemId
    });

    const primaryIndex = generated.output.chosenIndex >= 0 && generated.output.chosenIndex < generated.output.candidates.length
      ? generated.output.chosenIndex
      : 0;
    const primaryCandidate = generated.output.candidates[primaryIndex];

    if (queue.valid) {
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
    }

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
    const hadQueue = this.invalidateQueue(sessionId);
    return this.sessions.delete(sessionId) || hadQueue;
  }

  clearAll(): void {
    for (const sessionId of this.chatQueues.keys()) {
      this.invalidateQueue(sessionId);
    }
    this.sessions.clear();
  }

  clearAccount(accountIndex: number): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.accountIndex === accountIndex) {
        this.invalidateQueue(sessionId);
        this.sessions.delete(sessionId);
      }
    }
    // Include first turns that have not produced a saved session yet.
    for (const [sessionId, queue] of this.chatQueues) {
      if (queue.accounts.has(accountIndex)) {
        this.invalidateQueue(sessionId);
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

  private invalidateQueue(sessionId: string): boolean {
    const queue = this.chatQueues.get(sessionId);
    if (!queue) return false;
    queue.valid = false;
    this.chatQueues.delete(sessionId);
    return true;
  }
}
