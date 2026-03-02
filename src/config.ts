import type { Config } from "./types.js";

interface CliArgs {
  camofoxUrl?: string;
  camofoxApiKey?: string;
  userId?: string;
  requestTimeout?: number;
  dashboardPort?: number;
  dashboardEnabled?: boolean;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if ((current === "--camofox-url" || current === "--url") && next) {
      args.camofoxUrl = next;
      i += 1;
      continue;
    }

    if ((current === "--camofox-api-key" || current === "--api-key" || current === "--key") && next) {
      args.camofoxApiKey = next;
      i += 1;
      continue;
    }

    if ((current === "--user-id" || current === "--camo-gemini-user-id") && next) {
      args.userId = next;
      i += 1;
      continue;
    }

    if ((current === "--request-timeout" || current === "--timeout") && next) {
      const timeout = Number.parseInt(next, 10);
      if (!Number.isNaN(timeout) && timeout > 0) {
        args.requestTimeout = timeout;
      }
      i += 1;
      continue;
    }

    if (current === "--dashboard") {
      args.dashboardEnabled = true;
      continue;
    }

    if (current === "--no-dashboard") {
      args.dashboardEnabled = false;
      continue;
    }

    if (current === "--dashboard-port" && next) {
      const port = Number.parseInt(next, 10);
      if (!Number.isNaN(port) && port > 0) {
        args.dashboardPort = port;
      }
      i += 1;
      continue;
    }
  }

  return args;
}

function validateConfig(config: Config): void {
  if (config.camofoxUrl && !config.camofoxUrl.startsWith("http")) {
    throw new Error("Invalid CAMOFOX_URL: must start with http:// or https://");
  }
  if (config.requestTimeout < 1000 || config.requestTimeout > 300000) {
    throw new Error(`Invalid request timeout: must be 1000-300000ms, got ${config.requestTimeout}`);
  }
  if (config.dashboardPort < 1 || config.dashboardPort > 65535) {
    throw new Error(`Invalid dashboard port: must be 1-65535, got ${config.dashboardPort}`);
  }
  if (!config.userId || config.userId.trim() === "") {
    throw new Error("userId cannot be empty");
  }
}

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const cli = parseCliArgs(argv);
  const timeoutFromEnv = Number.parseInt(env.CAMOGEMINI_REQUEST_TIMEOUT ?? "", 10);
  const dashboardPortFromEnv = Number.parseInt(env.CAMOGEMINI_DASHBOARD_PORT ?? "", 10);
  const dashboardEnabledFromEnv = parseBoolean(env.CAMOGEMINI_DASHBOARD ?? env.CAMOGEMINI_DASHBOARD_ENABLED);
  const camofoxUrlFromEnv =
    env.CAMOFOX_URL ??
    (env.CAMOFOX_HOST ? `http://${env.CAMOFOX_HOST}:${env.CAMOFOX_PORT ?? "9377"}` : "http://localhost:9377");

  const config: Config = {
    camofoxUrl: cli.camofoxUrl ?? camofoxUrlFromEnv,
    camofoxApiKey: cli.camofoxApiKey ?? env.CAMOFOX_API_KEY,
    userId: cli.userId ?? env.CAMOGEMINI_USER_ID ?? "camo-gemini",
    requestTimeout: cli.requestTimeout ?? (Number.isNaN(timeoutFromEnv) ? 30_000 : timeoutFromEnv),
    dashboardPort: cli.dashboardPort ?? (Number.isNaN(dashboardPortFromEnv) ? 9378 : dashboardPortFromEnv),
    dashboardEnabled: cli.dashboardEnabled ?? dashboardEnabledFromEnv ?? false,
    AUTO_DELETE_CHAT: parseBoolean(env.CAMOGEMINI_AUTO_DELETE_CHAT) ?? true
  };

  validateConfig(config);
  return config;
}
