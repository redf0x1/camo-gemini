import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

export function registerHealthTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    "gemini_health",
    "Check CamoGemini server health and connection status to CamoFox browser",
    {},
    async () => {
      try {
        const health = await deps.health.checkAllAccounts();
        return okResult(health);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
