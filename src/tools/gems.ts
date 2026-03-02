import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

const CreateGemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemInstruction: z.string().min(1),
  accountIndex: z.number().int().min(0).optional()
});

const ListGemsSchema = z.object({
  accountIndex: z.number().int().min(0).optional()
});

const UpdateGemSchema = z.object({
  gemId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  systemInstruction: z.string().min(1).optional(),
  accountIndex: z.number().int().min(0).optional()
});

const DeleteGemSchema = z.object({
  gemId: z.string().min(1),
  accountIndex: z.number().int().min(0).optional()
});

export function registerGemsTools(server: McpServer, deps: ToolDeps): void {
  const gemsService = deps.gems;

  server.tool(
    "gemini_list_gems",
    "List available Gems",
    {
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0")
    },
    async (input) => {
      try {
        const parsed = ListGemsSchema.parse(input);
        const result = await gemsService.listGems(parsed);
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_create_gem",
    "Create a new Gem",
    {
      name: z.string().min(1).describe("Gem display name"),
      description: z.string().optional().describe("Gem description"),
      systemInstruction: z.string().min(1).describe("System instruction for the Gem"),
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0")
    },
    async (input) => {
      try {
        const parsed = CreateGemSchema.parse(input);
        const result = await gemsService.createGem({
          name: parsed.name,
          description: parsed.description,
          instructions: parsed.systemInstruction,
          accountIndex: parsed.accountIndex
        });
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_update_gem",
    "Update an existing Gem",
    {
      gemId: z.string().min(1).describe("Gem ID to update"),
      name: z.string().min(1).optional().describe("Updated Gem display name"),
      description: z.string().optional().describe("Updated Gem description"),
      systemInstruction: z.string().min(1).optional().describe("Updated system instruction for the Gem"),
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0")
    },
    async (input) => {
      try {
        const parsed = UpdateGemSchema.parse(input);
        const result = await gemsService.updateGem({
          gemId: parsed.gemId,
          name: parsed.name,
          description: parsed.description,
          instructions: parsed.systemInstruction,
          accountIndex: parsed.accountIndex
        });
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_delete_gem",
    "Delete a Gem",
    {
      gemId: z.string().min(1).describe("Gem ID to delete"),
      accountIndex: z.number().int().min(0).optional().describe("Google account index, default 0")
    },
    async (input) => {
      try {
        const parsed = DeleteGemSchema.parse(input);
        await gemsService.deleteGem(parsed.gemId, parsed.accountIndex ?? 0);
        return okResult({ deleted: true, gemId: parsed.gemId });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
