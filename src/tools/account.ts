import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

const AddAccountSchema = z.object({
  accountIndex: z.number().int().min(0).max(9)
});

export function registerAccountTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    "gemini_add_account",
    "Add Google account for Gemini",
    {
      accountIndex: z.number().int().min(0).max(9).describe("Google account index (0-9)")
    },
    async (input) => {
      try {
        const parsed = AddAccountSchema.parse(input);
        const result = await deps.accountService.addAccount(parsed.accountIndex);
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_list_accounts",
    "List configured accounts",
    {},
    async () => {
      try {
        const result = deps.accountService.listAccounts();
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
