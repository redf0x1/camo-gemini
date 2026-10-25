import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { CamofoxClient } from "../client/camofox-client.js";
import type { Config } from "../types.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("CamofoxClient.closeTab HTTP contract", () => {
  it("sends userId in the JSON body and preserves encoded path, query, and auth", async () => {
    const tabId = "tab/with ? reserved";
    const userId = "acct /+?owner";
    const apiKey = "fixture-api-key";
    let requestObserved: { method?: string; url?: string; body?: unknown; authorization?: string; apiKey?: string } = {};

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestObserved = {
          method: request.method,
          url: request.url,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          authorization: request.headers.authorization,
          apiKey: request.headers["x-api-key"]
        };
        response.writeHead(204).end();
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind a TCP port");

    const client = new CamofoxClient({
      camofoxUrl: `http://127.0.0.1:${address.port}`,
      requestTimeout: 1_000,
      camofoxApiKey: apiKey
    } as Config);

    await client.closeTab(tabId, userId);

    expect(requestObserved).toEqual({
      method: "DELETE",
      url: `/tabs/${encodeURIComponent(tabId)}?userId=${encodeURIComponent(userId)}`,
      body: { userId },
      authorization: `Bearer ${apiKey}`,
      apiKey
    });
  });
});
