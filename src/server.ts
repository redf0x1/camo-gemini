import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CamofoxClient } from "./client/camofox-client.js";
import { AccountService } from "./services/account.js";
import { AuthService } from "./services/auth.js";
import { ChatService } from "./services/chat.js";
import { GenerateService } from "./services/generate.js";
import { GemsService } from "./services/gems.js";
import { HealthService } from "./services/health.js";
import { UploadService } from "./services/upload.js";
import { StateManager } from "./state.js";
import { registerAccountTools } from "./tools/account.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerChatTools } from "./tools/chat.js";
import { registerGemsTools } from "./tools/gems.js";
import { registerHealthTools } from "./tools/health.js";
import { logger } from "./core/logger.js";
import { registerMediaTools } from "./tools/media.js";
import type { Config } from "./types.js";

export interface ToolDeps {
  client: CamofoxClient;
  config: Config;
  state: StateManager;
  auth: AuthService;
  accountService: AccountService;
  generate: GenerateService;
  chat: ChatService;
  upload: UploadService;
  gems: GemsService;
  health: HealthService;
}

export function createServer(config: Config): {
  server: McpServer;
  client: CamofoxClient;
  state: StateManager;
  deps: ToolDeps;
  shutdown: () => void;
} {
  const client = new CamofoxClient(config);
  const state = new StateManager();
  const auth = new AuthService(client, state, config);
  const accountService = new AccountService(auth, state, config);
  const health = new HealthService(client, state, config);
  const generate = new GenerateService({ client, auth, config, state });
  const upload = new UploadService({ client, auth, config });
  const gems = new GemsService({ client, auth, config, state });
  const chat = new ChatService(generate);

  auth.onLogout((accountIndex) => {
    chat.clearAccount(accountIndex);
  });

  const server = new McpServer({
    name: "camo-gemini",
    version: "0.1.0"
  });

  const deps: ToolDeps = { client, config, state, auth, accountService, generate, chat, upload, gems, health };

  registerAuthTools(server, deps);
  registerChatTools(server, deps);
  registerMediaTools(server, deps);
  registerGemsTools(server, deps);
  registerAccountTools(server, deps);
  registerHealthTools(server, deps);

  return {
    server,
    client,
    state,
    deps,
    shutdown: () => {
      logger.info("shutdown", "Server shutting down");
      auth.stopAllRotations();
      health.stopPeriodicCheck();
    }
  };
}
