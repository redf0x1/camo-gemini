#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { logger } from "./core/logger.js";
import { DashboardServer } from "./dashboard/server.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info("startup", "camo-gemini started", { camofoxUrl: config.camofoxUrl, userId: config.userId });
  const { server, deps, shutdown } = createServer(config);
  const transport = new StdioServerTransport();
  let dashboardServer: DashboardServer | null = null;

  const onShutdown = () => {
    dashboardServer?.stop();
    shutdown();
  };
  process.once("SIGINT", onShutdown);
  process.once("SIGTERM", onShutdown);
  process.once("exit", onShutdown);

  await server.connect(transport);

  if (config.dashboardEnabled) {
    dashboardServer = new DashboardServer(
      {
        state: deps.state,
        auth: deps.auth,
        account: deps.accountService,
        health: deps.health,
        generate: deps.generate
      },
      config.dashboardPort
    );
    await dashboardServer.start();
  }
}

main().catch((error) => {
  process.stderr.write(
    `[camo-gemini] ${error instanceof Error ? error.message : "Unknown startup error"}\n`
  );
  process.exit(1);
});
