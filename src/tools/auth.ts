import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
import type { ToolDeps } from "../server.js";

export function registerAuthTools(server: McpServer, deps: ToolDeps): void {
  let healthCheckStarted = false;

  server.tool(
    "gemini_login",
    "Connect to an existing Gemini session in CamoFox browser. This tool does NOT perform credential-based login — it validates and connects to a pre-authenticated browser session. User must already be logged into Google in the CamoFox browser profile.",
    {
      accountIndex: z
        .number()
        .int()
        .min(0)
        .max(9)
        .optional()
        .describe("Google account index (0 = default, 1+ = additional accounts)")
    },
    async (input) => {
      try {
        const args = z.object({ accountIndex: z.number().int().min(0).max(9).optional() }).parse(input);
        const session = await deps.auth.login(args.accountIndex ?? 0);
        if (!healthCheckStarted) {
          deps.health.startPeriodicCheck();
          healthCheckStarted = true;
        }
        const result = {
          authenticated: session.authenticated,
          accountIndex: session.accountIndex,
          tabId: session.tabId,
          tokensExtracted: !!session.tokens,
          rotationStarted: !!session.tokens,
          authenticatedEmail: session.authenticatedEmail ?? null,
          sessionBased: true,
          note: "Session-based authentication — connected to existing CamoFox browser profile. No credentials were validated."
        };
        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_auth_status",
    "Check authentication status",
    {},
    async () => {
      try {
        const status = deps.auth.getStatus();
        return okResult(status);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "gemini_logout",
    "Logout from Gemini. Stops cookie rotation, closes the browser tab, and clears session state.",
    {},
    async () => {
      try {
        await deps.auth.logout();
        return okResult({ loggedOut: true });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
