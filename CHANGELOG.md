# Changelog

## [0.2.2] - 2026-10-25

### Fixed
- Process distinct concurrent prompts for one chat session in order instead of returning the first prompt's result to every caller.
- Cancel queued work when local sessions/accounts are cleared and prevent in-flight results from recreating cleared local history. Independent accounts/sessions remain isolated.
- Track only outstanding account requests for logout cleanup, and pin multi-turn chat to its selected account so failover cannot misattribute conversation ownership. One-shot generation keeps automatic failover.
- Parse newline-delimited RPC responses while preserving RPC envelopes for generation and batch-response parsing; retain framed and direct-JSON compatibility.
- Return the existing friendly parse-error message and advertise the package's actual version in MCP initialization.
- Preserve the published 15-tool contract and existing account/profile namespace. Clarify that `gemini_stream` is a buffered compatibility alias, not incremental streaming.

## [0.2.1] - 2026-10-25

### Fixed
- Include the required `userId` JSON body when closing a browser tab, while preserving the existing encoded tab path, ownership query, and API-key authentication.
- Update the MCP SDK to 1.32.2, Zod to 4.6.7, and affected transitive dependencies to patched same-major releases. Production dependency audit reports no known vulnerabilities.
- Require Node.js 20+ to match the patched SDK dependency tree. Upgrade Node before installing on a Node 18 host.

## [0.1.0] - 2026-03-02

### Added
- 15 MCP tools for Gemini AI interaction
- IBPE architecture (In-Browser Protocol Execution) via CamoFox
- Multi-account support with automatic failover (up to 10 accounts)
- Auto-delete chat history after one-shot operations
- Cookie rotation for session persistence
- Health monitoring with periodic checks
- Dashboard (optional, disabled by default)
- Image generation with multi-account failover
- Gem CRUD operations (create, read, update, delete)
- File upload support
- Streaming text generation
- Session-based authentication (via CamoFox browser profiles)

### Ecosystem
- Requires [CamoFox Browser](https://github.com/redf0x1/camofox-browser) running on port 9377
- Optional [CamoFox MCP](https://github.com/redf0x1/camofox-mcp) for browser tools
