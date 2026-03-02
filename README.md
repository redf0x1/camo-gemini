# CamoGemini

Gemini AI MCP Server — Access Google Gemini through AI agents via CamoFox anti-detection browser.

> **Zero API keys. Zero third-party dependencies.** Uses browser-based protocol execution (IBPE) — your requests go through a real browser session, not API endpoints.

## Quick Start

### Prerequisites

CamoFox browser must be running:

```bash
docker run -d -p 9377:9377 --name camofox ghcr.io/redf0x1/camofox-browser:latest
```

> Don't have Docker? See [CamoFox installation guide](https://github.com/redf0x1/camofox-browser#quick-start-for-agents).

### AI Auto-Setup (Recommended)

Paste this prompt into your AI assistant (Copilot, Claude, Cursor, etc.) and it will set up everything automatically:

<details>
<summary><b>Copy this prompt</b></summary>

```text
Set up CamoGemini MCP server for me. Follow these steps:

1. Check if Docker is available. If yes, check if a container named "camofox" is running:
  - If not running, start it: docker run -d -p 9377:9377 --name camofox ghcr.io/redf0x1/camofox-browser:latest
  - If already running, skip this step

2. Test CamoFox is reachable:
  - curl http://localhost:9377/health
  - If not reachable, wait 5 seconds and retry (CamoFox takes a moment to start)

3. Add the CamoGemini MCP server to my editor config:
  - For VS Code: create/update .vscode/mcp.json with:
    {"servers":{"camo-gemini":{"type":"stdio","command":"npx","args":["-y","camo-gemini@latest"],"env":{"CAMOFOX_URL":"http://localhost:9377"}}}}
  - For Claude Desktop: update ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\Claude\claude_desktop_config.json (Windows)
  - For Cursor: update ~/.cursor/mcp.json
  - For Windsurf: update ~/.codeium/windsurf/mcp_config.json
  Use "mcpServers" key instead of "servers" for non-VS Code editors (and omit "type":"stdio").

4. After config is saved, tell me to restart my editor to load the new MCP server.

5. Once restarted, verify the setup by calling these MCP tools in order:
  - gemini_health — should show CamoFox is connected
  - gemini_login — authenticate with Google (account 0)
  - gemini_generate with prompt "Say hello" — should return a response

Report the result of each step.
```

</details>

### Install

#### Option A: npx (Recommended)

No installation needed — add directly to your MCP client config:

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "camo-gemini": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "camo-gemini@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "camo-gemini": {
      "command": "npx",
      "args": ["-y", "camo-gemini@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```

Config location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "camo-gemini": {
      "command": "npx",
      "args": ["-y", "camo-gemini@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```
</details>

<details>
<summary><b>Windsurf</b></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "camo-gemini": {
      "command": "npx",
      "args": ["-y", "camo-gemini@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```
</details>

#### Option B: From Source

```bash
git clone https://github.com/redf0x1/camo-gemini.git
cd camo-gemini
npm install
npm run build
```

Then use the full path in your MCP config:

```json
{
  "servers": {
    "camo-gemini": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/camo-gemini/dist/index.js"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```

### Setup Wizard

Run the interactive setup wizard to verify your installation:

```bash
npx camo-gemini-setup
```

### Verify Installation

Paste this into your AI agent to verify everything works:

```
Verify my CamoGemini setup:
1) Call gemini_health — is CamoFox connected?
2) Call gemini_login to authenticate with Google
3) Call gemini_generate with prompt "Say hello in 5 words"
Report pass/fail for each step.
```

## MCP Tools (15)

1. `gemini_login` — Connect to existing CamoFox browser session (session-based, not credential-based)
2. `gemini_logout` — Disconnect and clean up session
3. `gemini_auth_status` — Check authentication status
4. `gemini_health` — Health check across all accounts
5. `gemini_generate` — Text generation (with auto-delete)
6. `gemini_generate_image` — Image generation (with multi-account failover + auto-delete)
7. `gemini_chat` — Multi-turn chat conversation
8. `gemini_stream` — Streaming text generation (with auto-delete)
9. `gemini_list_gems` — List all Gems (custom + system)
10. `gemini_create_gem` — Create a custom Gem
11. `gemini_update_gem` — Update an existing Gem
12. `gemini_delete_gem` — Delete a Gem
13. `gemini_upload_file` — Upload a file (base64)
14. `gemini_list_accounts` — List configured accounts
15. `gemini_add_account` — Add and authenticate a new account

## Environment Variables

Complete runtime environment variables from `src/config.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `CAMOFOX_URL` | — | Full CamoFox URL (overrides `CAMOFOX_HOST` + `CAMOFOX_PORT`) |
| `CAMOFOX_HOST` | `localhost` | CamoFox host |
| `CAMOFOX_PORT` | `9377` | CamoFox port |
| `CAMOFOX_API_KEY` | — | API key forwarded to CamoFox when enabled on CamoFox server |
| `CAMOGEMINI_USER_ID` | `camo-gemini` | Base CamoFox userId namespace |
| `CAMOGEMINI_LOG_LEVEL` | `INFO` | Log level for stderr operational logs (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
| `CAMOGEMINI_REQUEST_TIMEOUT` | `30000` | Request timeout in milliseconds |
| `CAMOGEMINI_AUTO_DELETE_CHAT` | `true` | Auto-delete chat after one-shot operations |
| `CAMOGEMINI_DASHBOARD` | `false` | Enable dashboard server |
| `CAMOGEMINI_DASHBOARD_ENABLED` | — | Alternative/legacy env toggle for dashboard |
| `CAMOGEMINI_DASHBOARD_PORT` | `9378` | Dashboard HTTP port |

## Multi-Account Setup & Failover

- Supports up to **10 accounts** (`accountIndex` 0-9)
- Automatic failover when active account hits retryable limits/errors
- Image generation daily-limit conditions fail over to next healthy account
- Session isolation per account via distinct CamoFox user/browser context

## Architecture (IBPE)

```text
MCP Client -> CamoGemini -> CamoFox Browser -> Gemini Web APIs
```

- All API calls are executed through CamoFox browser context
- Primary request pattern: `page.evaluate(() => fetch(url, { credentials: 'include' }))`
- Anti-detection is handled at browser engine level (C++ fingerprint spoofing)
- No direct Gemini HTTP client libraries in CamoGemini

## Auto-Delete Chat Behavior

- One-shot tools (`gemini_generate`, `gemini_stream`, `gemini_generate_image`) auto-delete conversations by default
- Per-call override: pass `autoDelete: false`
- Global override: set `CAMOGEMINI_AUTO_DELETE_CHAT=false`
- Multi-turn `gemini_chat` does **not** auto-delete by design

## Testing

```bash
npm test          # Run all tests
npm run build     # TypeScript build
```

## Docker

`Dockerfile` is included.

```bash
docker build -t camo-gemini .
docker run --rm -it -e CAMOFOX_HOST=host.docker.internal -e CAMOFOX_PORT=9377 camo-gemini
```

Optional dashboard:

```bash
docker run --rm -it -p 9378:9378 -e CAMOGEMINI_DASHBOARD=true camo-gemini
```

## License

MIT
