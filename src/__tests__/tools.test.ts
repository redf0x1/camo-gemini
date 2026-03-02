import { describe, expect, it, vi } from "vitest";

import type { ToolResult } from "../errors.js";
import { registerAccountTools } from "../tools/account.js";
import { registerAuthTools } from "../tools/auth.js";
import { registerChatTools } from "../tools/chat.js";
import { registerGemsTools } from "../tools/gems.js";
import { registerHealthTools } from "../tools/health.js";
import { registerMediaTools } from "../tools/media.js";

interface ToolHandlerInput {
  [key: string]: unknown;
}

type ToolHandler = (input: ToolHandlerInput) => Promise<ToolResult>;

class MockMcpServer {
  handlers = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }
}

function parseTextResult(result: ToolResult): unknown {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function createDeps() {
  return {
    config: {
      AUTO_DELETE_CHAT: true
    },
    state: {
      activeAccountIndex: null
    },
    auth: {
      login: vi.fn().mockResolvedValue({
        accountIndex: 0,
        tabId: "tab-1",
        authenticated: true,
        authenticatedEmail: "user@gmail.com",
        tokens: { snlm0e: "", cfb2h: "x", fdrfje: "y", extractedAt: Date.now() }
      }),
      getStatus: vi.fn().mockReturnValue({ authenticated: true }),
      logout: vi.fn().mockResolvedValue(undefined)
    },
    health: {
      startPeriodicCheck: vi.fn(),
      checkAllAccounts: vi.fn().mockResolvedValue({ overall: "healthy", totalAccounts: 1 })
    },
    generate: {
      generate: vi.fn().mockResolvedValue({
        output: {
          candidates: [{ text: "hello" }]
        },
        conversationId: "cid-1"
      }),
      generateImage: vi.fn().mockResolvedValue({ generatedImages: [{ url: "https://example.com/image.png" }], conversationId: "cid-1" }),
      deleteConversation: vi.fn().mockResolvedValue(undefined)
    },
    chat: {
      chat: vi.fn().mockResolvedValue({
        text: "chat reply",
        sessionId: "session-1",
        turnNumber: 2,
        isNewSession: false,
        candidates: [{ text: "chat reply" }]
      })
    },
    accountService: {
      addAccount: vi.fn().mockResolvedValue({ accountIndex: 1, isLoggedIn: true }),
      listAccounts: vi.fn().mockReturnValue([{ accountIndex: 0 }, { accountIndex: 1 }])
    },
    upload: {
      uploadFile: vi.fn().mockResolvedValue({ fileUri: "uri://file", filename: "a.txt" })
    },
    gems: {
      listGems: vi.fn().mockResolvedValue([{ id: "g1", name: "Gem One" }]),
      createGem: vi.fn(),
      updateGem: vi.fn(),
      deleteGem: vi.fn()
    }
  } as any;
}

function registerAll(deps: any): MockMcpServer {
  const server = new MockMcpServer();
  registerAuthTools(server as any, deps);
  registerChatTools(server as any, deps);
  registerMediaTools(server as any, deps);
  registerGemsTools(server as any, deps);
  registerAccountTools(server as any, deps);
  registerHealthTools(server as any, deps);
  return server;
}

describe("Tool Handlers", () => {
  describe("gemini_generate", () => {
    it("should return text content on success", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      const result = await handler?.({ prompt: "hello" });
      const parsed = parseTextResult(result as ToolResult) as { text: string };

      expect(result?.isError).toBeUndefined();
      expect(parsed.text).toBe("hello");
    });

    it("should return error result on service failure", async () => {
      const deps = createDeps();
      deps.generate.generate.mockRejectedValue(new Error("generate failed"));
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      const result = await handler?.({ prompt: "hello" });

      expect(result?.isError).toBe(true);
      expect((result?.content[0] as { text: string }).text).toContain("generate failed");
    });

    it("should pass options through correctly", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      await handler?.({ prompt: "hello", model: "flash", accountIndex: 2 });

      expect(deps.generate.generate).toHaveBeenCalledWith({
        prompt: "hello",
        model: "flash",
        accountIndex: 2
      });
    });

    it("should auto-delete conversation by default", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      await handler?.({ prompt: "hello", accountIndex: 2 });

      expect(deps.generate.deleteConversation).toHaveBeenCalledWith(2, "cid-1");
    });

    it("should skip auto-delete when autoDelete is false", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      await handler?.({ prompt: "hello", autoDelete: false });

      expect(deps.generate.deleteConversation).not.toHaveBeenCalled();
    });

    it("should skip auto-delete when AUTO_DELETE_CHAT is false", async () => {
      const deps = createDeps();
      deps.config.AUTO_DELETE_CHAT = false;
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      await handler?.({ prompt: "hello" });

      expect(deps.generate.deleteConversation).not.toHaveBeenCalled();
    });

    it("should ignore auto-delete failure and still return success", async () => {
      const deps = createDeps();
      deps.generate.deleteConversation.mockRejectedValue(new Error("delete failed"));
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate");
      const result = await handler?.({ prompt: "hello" });
      const parsed = parseTextResult(result as ToolResult) as { text: string };

      expect(result?.isError).toBeUndefined();
      expect(parsed.text).toBe("hello");
    });
  });

  describe("gemini_chat", () => {
    it("should return chat response with session info", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_chat");
      const result = await handler?.({ prompt: "hello", conversationId: "conv-1", model: "flash", accountIndex: 1 });

      const parsed = parseTextResult(result as ToolResult) as {
        text: string;
        conversationId: string;
        turnNumber: number;
        candidateCount: number;
      };
      expect(parsed.text).toBe("chat reply");
      expect(parsed.conversationId).toBe("session-1");
      expect(parsed.turnNumber).toBe(2);
      expect(parsed.candidateCount).toBe(1);
    });

    it("should create new session if none exists", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_chat");
      await handler?.({ prompt: "start chat" });

      expect(deps.chat.chat).toHaveBeenCalledTimes(1);
      const [sessionId] = deps.chat.chat.mock.calls[0] as [string, string, unknown];
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });
  });

  describe("gemini_login", () => {
    it("should return success with session details", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_login");
      const result = await handler?.({ accountIndex: 0 });

      const parsed = parseTextResult(result as ToolResult) as {
        authenticated: boolean;
        accountIndex: number;
        tabId: string;
        authenticatedEmail: string | null;
        sessionBased: boolean;
      };
      expect(parsed.authenticated).toBe(true);
      expect(parsed.accountIndex).toBe(0);
      expect(parsed.tabId).toBe("tab-1");
      expect(parsed.authenticatedEmail).toBe("user@gmail.com");
      expect(parsed.sessionBased).toBe(true);
      expect(deps.health.startPeriodicCheck).toHaveBeenCalledTimes(1);
    });

    it("should return error on login failure", async () => {
      const deps = createDeps();
      deps.auth.login.mockRejectedValue(new Error("login failed"));
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_login");
      const result = await handler?.({ accountIndex: 0 });

      expect(result?.isError).toBe(true);
      expect((result?.content[0] as { text: string }).text).toContain("login failed");
    });
  });

  describe("gemini_add_account", () => {
    it("should return account info on success", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_add_account");
      const result = await handler?.({ accountIndex: 1 });

      const parsed = parseTextResult(result as ToolResult) as { accountIndex: number };
      expect(parsed.accountIndex).toBe(1);
    });

    it("should reject invalid account index", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_add_account");
      const result = await handler?.({ accountIndex: -1 });

      expect(result?.isError).toBe(true);
      expect(deps.accountService.addAccount).not.toHaveBeenCalled();
    });

    it("should reject account index > 9", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_add_account");
      const result = await handler?.({ accountIndex: 10 });

      expect(result?.isError).toBe(true);
      expect(deps.accountService.addAccount).not.toHaveBeenCalled();
    });
  });

  describe("gemini_health", () => {
    it("should return health check result", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_health");
      const result = await handler?.({});
      const parsed = parseTextResult(result as ToolResult) as { overall: string };

      expect(parsed.overall).toBe("healthy");
      expect(deps.health.checkAllAccounts).toHaveBeenCalledTimes(1);
    });
  });

  describe("gemini_upload_file", () => {
    it("should return upload result on success", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_upload_file");
      const result = await handler?.({ fileBase64: "Zm9v", filename: "a.txt" });
      const parsed = parseTextResult(result as ToolResult) as { fileUri: string };

      expect(parsed.fileUri).toBe("uri://file");
      expect(deps.upload.uploadFile).toHaveBeenCalledWith({ fileBase64: "Zm9v", filename: "a.txt" });
    });

    it("should reject missing file data", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_upload_file");
      const result = await handler?.({ filename: "a.txt" });

      expect(result?.isError).toBe(true);
      expect(deps.upload.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe("gemini_generate_image", () => {
    it("should auto-delete conversation by default", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate_image");
      await handler?.({ prompt: "draw fox", accountIndex: 1 });

      expect(deps.generate.deleteConversation).toHaveBeenCalledWith(1, "cid-1");
    });

    it("should skip auto-delete when autoDelete is false", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_generate_image");
      await handler?.({ prompt: "draw fox", autoDelete: false });

      expect(deps.generate.deleteConversation).not.toHaveBeenCalled();
    });
  });

  describe("gemini_list_gems", () => {
    it("should return gems list", async () => {
      const deps = createDeps();
      const server = registerAll(deps);

      const handler = server.handlers.get("gemini_list_gems");
      const result = await handler?.({ accountIndex: 0 });
      const parsed = parseTextResult(result as ToolResult) as Array<{ id: string }>;

      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.id).toBe("g1");
      expect(deps.gems.listGems).toHaveBeenCalledWith({ accountIndex: 0 });
    });
  });
});
