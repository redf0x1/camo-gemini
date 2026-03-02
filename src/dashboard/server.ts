import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccountService } from "../services/account.js";
import type { AuthService } from "../services/auth.js";
import type { GenerateService } from "../services/generate.js";
import type { HealthService } from "../services/health.js";
import type { StateManager } from "../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DashboardDeps {
  state: StateManager;
  auth: AuthService;
  account: AccountService;
  health: HealthService;
  generate: GenerateService;
}

export class DashboardServer {
  private server: ReturnType<typeof createServer> | null = null;
  private dashboardHtml: string | null = null;

  constructor(
    private deps: DashboardDeps,
    private port = 9378
  ) {}

  async start(): Promise<void> {
    try {
      this.dashboardHtml = await readFile(join(__dirname, "index.html"), "utf-8");
    } catch {
      this.dashboardHtml = "<html><body><h1>Dashboard HTML not found</h1></body></html>";
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.on("error", reject);
      this.server?.listen(this.port, () => {
        process.stderr.write(`[camo-gemini] Dashboard: http://localhost:${this.port}\n`);
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === "/api/health" && method === "GET") {
        await this.handleHealth(res);
        return;
      }

      if (path === "/api/accounts" && method === "GET") {
        this.handleListAccounts(res);
        return;
      }

      if (/^\/api\/accounts\/\d+\/login$/.test(path) && method === "POST") {
        const idx = Number.parseInt(path.split("/")[3] ?? "", 10);
        await this.handleLogin(res, idx);
        return;
      }

      if (/^\/api\/accounts\/\d+\/logout$/.test(path) && method === "POST") {
        const idx = Number.parseInt(path.split("/")[3] ?? "", 10);
        await this.handleLogout(res, idx);
        return;
      }

      if (/^\/api\/accounts\/\d+$/.test(path) && method === "DELETE") {
        const idx = Number.parseInt(path.split("/")[3] ?? "", 10);
        await this.handleRemoveAccount(res, idx);
        return;
      }

      if (path === "/api/chat" && method === "POST") {
        await this.handleChat(req, res);
        return;
      }

      if (path.startsWith("/api/")) {
        this.jsonResponse(res, 404, { error: "Not found" });
        return;
      }

      if (method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.dashboardHtml);
        return;
      }

      this.jsonResponse(res, 404, { error: "Not found" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jsonResponse(res, 500, { error: msg });
    }
  }

  private async handleHealth(res: ServerResponse): Promise<void> {
    const result = await this.deps.health.checkAllAccounts();
    this.jsonResponse(res, 200, result);
  }

  private handleListAccounts(res: ServerResponse): void {
    const accounts = this.deps.account.listAccounts();
    this.jsonResponse(res, 200, { accounts });
  }

  private async handleLogin(res: ServerResponse, accountIndex: number): Promise<void> {
    try {
      const info = await this.deps.account.addAccount(accountIndex);
      this.jsonResponse(res, 200, info);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jsonResponse(res, 400, { error: msg });
    }
  }

  private async handleLogout(res: ServerResponse, accountIndex: number): Promise<void> {
    try {
      await this.deps.auth.logout(accountIndex);
      this.jsonResponse(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jsonResponse(res, 400, { error: msg });
    }
  }

  private async handleRemoveAccount(res: ServerResponse, accountIndex: number): Promise<void> {
    try {
      await this.deps.account.removeAccount(accountIndex);
      this.jsonResponse(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jsonResponse(res, 400, { error: msg });
    }
  }

  private async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await this.readBody(req);
    } catch {
      this.jsonResponse(res, 413, { error: "Request body too large" });
      return;
    }

    let parsed: { prompt?: unknown; accountIndex?: number };
    try {
      parsed = JSON.parse(body) as { prompt?: unknown; accountIndex?: number };
    } catch {
      this.jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const { prompt, accountIndex } = parsed;

    if (typeof prompt !== "string" || !prompt) {
      this.jsonResponse(res, 400, { error: "prompt is required" });
      return;
    }

    try {
      const result = await this.deps.generate.generate({ prompt, accountIndex });
      this.jsonResponse(res, 200, {
        text: result.output.candidates[result.output.chosenIndex]?.text ?? "",
        candidates: result.output.candidates
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jsonResponse(res, 500, { error: msg });
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const MAX_BODY = 1_048_576;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });
      req.on("error", reject);
    });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
