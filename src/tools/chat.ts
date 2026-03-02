import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

const PromptSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  accountIndex: z.number().int().min(0).optional(),
  autoDelete: z.boolean().optional().default(true)
});

const ChatSchema = z.object({
  prompt: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  model: z.string().optional(),
  accountIndex: z.number().int().min(0).optional()
});

export function registerChatTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    "gemini_generate",
    "Generate text with Google Gemini",
    {
      prompt: z.string().min(1).describe("Prompt text to send to Gemini"),
      model: z.string().optional().describe("Optional Gemini model name or alias"),
      accountIndex: z.number().int().min(0).optional().describe("Optional account index"),
      autoDelete: z.boolean().optional().default(true).describe("Auto-delete chat history after generation (default: true)")
    },
    async (input) => {
      try {
        const args = PromptSchema.parse(input);
        const result = await deps.generate.generate({
          prompt: args.prompt,
          model: args.model,
          accountIndex: args.accountIndex
        });

        const accountIndex = args.accountIndex ?? deps.state.activeAccountIndex ?? 0;
        const shouldAutoDelete = (args.autoDelete ?? true) && deps.config.AUTO_DELETE_CHAT;
        if (shouldAutoDelete && result.conversationId) {
          try {
            await deps.generate.deleteConversation(accountIndex, result.conversationId);
          } catch {
            // non-critical cleanup
          }
        }

        return okResult({ text: result.output.candidates[0]?.text ?? "" });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_stream",
    "Stream text generation",
    {
      prompt: z.string().min(1).describe("Prompt text to send to Gemini"),
      model: z.string().optional().describe("Optional Gemini model name or alias"),
      accountIndex: z.number().int().min(0).optional().describe("Optional account index"),
      autoDelete: z.boolean().optional().default(true).describe("Auto-delete chat history after generation (default: true)")
    },
    async (input) => {
      try {
        const args = PromptSchema.parse(input);
        const result = await deps.generate.generate({
          prompt: args.prompt,
          model: args.model,
          accountIndex: args.accountIndex
        });

        const accountIndex = args.accountIndex ?? deps.state.activeAccountIndex ?? 0;
        const shouldAutoDelete = (args.autoDelete ?? true) && deps.config.AUTO_DELETE_CHAT;
        if (shouldAutoDelete && result.conversationId) {
          try {
            await deps.generate.deleteConversation(accountIndex, result.conversationId);
          } catch {
            // non-critical cleanup
          }
        }

        return okResult({ text: result.output.candidates[0]?.text ?? "" });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_chat",
    "Continue a conversation",
    {
      prompt: z.string().min(1).describe("Prompt text to send to Gemini"),
      conversationId: z.string().min(1).optional().describe("Conversation ID (optional; generated if omitted)"),
      model: z.string().optional().describe("Optional Gemini model name or alias"),
      accountIndex: z.number().int().min(0).optional().describe("Optional account index")
    },
    async (input) => {
      try {
        const args = ChatSchema.parse(input);
        const result = await deps.chat.chat(args.conversationId ?? randomUUID(), args.prompt, {
          model: args.model,
          accountIndex: args.accountIndex
        });
        return okResult({
          text: result.text,
          conversationId: result.sessionId,
          turnNumber: result.turnNumber,
          isNewSession: result.isNewSession,
          candidateCount: result.candidates.length,
          model: args.model
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
