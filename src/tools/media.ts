import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

const UploadSchema = z.object({
  fileBase64: z.string(),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  accountIndex: z.number().int().min(0).optional()
});

const GenerateImageSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  accountIndex: z.number().int().min(0).optional(),
  gemId: z.string().min(1).optional(),
  autoDelete: z.boolean().optional().default(true)
});

export function registerMediaTools(server: McpServer, deps: ToolDeps): void {
  const uploadService = deps.upload;
  const generateService = deps.generate;

  server.tool(
    "gemini_upload_file",
    "Upload a file to Gemini",
    {
      fileBase64: z.string().describe("Base64-encoded file data"),
      filename: z.string().min(1).describe("Original filename including extension"),
      mimeType: z.string().optional().describe("Optional mime type override"),
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0")
    },
    async (input) => {
      try {
        const parsed = UploadSchema.parse(input);
        const result = await uploadService.uploadFile(parsed);
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_generate_image",
    "Generate an image with Gemini",
    {
      prompt: z.string().min(1).describe("Image generation prompt"),
      model: z.string().optional().describe("Optional Gemini image-capable model"),
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0"),
      gemId: z.string().min(1).optional().describe("Optional Gem ID"),
      autoDelete: z.boolean().optional().default(true).describe("Auto-delete chat history after generation (default: true)")
    },
    async (input) => {
      try {
        const parsed = GenerateImageSchema.parse(input);
        const result = await generateService.generateImage(parsed.prompt, {
          model: parsed.model,
          accountIndex: parsed.accountIndex,
          gemId: parsed.gemId
        });

        const accountIndex = parsed.accountIndex ?? deps.state.activeAccountIndex ?? 0;
        const shouldAutoDelete = (parsed.autoDelete ?? true) && deps.config.AUTO_DELETE_CHAT;
        if (shouldAutoDelete && result.conversationId) {
          try {
            await generateService.deleteConversation(accountIndex, result.conversationId);
          } catch {
            // non-critical cleanup
          }
        }

        const imageContent = (result.generatedImages ?? []).flatMap((image) => {
          if (typeof image.base64 !== "string" || typeof image.mimeType !== "string") {
            return [];
          }

          return [{
            type: "image" as const,
            data: image.base64,
            mimeType: image.mimeType
          }];
        });

        if (imageContent.length === 0) {
          return okResult(result);
        }

        return {
          content: [
            { type: "text", text: JSON.stringify(result) },
            ...imageContent
          ]
        } satisfies ToolResult;
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
