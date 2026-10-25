import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRequire } from "node:module";
import { createServer } from "../server.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

describe("published MCP contract", () => {
  it("advertises package version and all 15 compatible tools through SDK initialization", async () => {
    const app = createServer({
      camofoxUrl: "http://127.0.0.1:9377",
      userId: "metadata-fixture",
      requestTimeout: 1000,
      dashboardEnabled: false,
      dashboardPort: 3123,
      AUTO_DELETE_CHAT: true
    });
    const client = new Client({ name: "metadata-fixture", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await app.server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getServerVersion()).toEqual({ name: "camo-gemini", version });
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(15);
      expect(tools.tools.find(tool => tool.name === "gemini_stream")?.description).toContain("buffered");
    } finally {
      await client.close();
      await app.server.close();
      app.shutdown();
    }
  });
});
