# P8.1 QA Fixes

This release is a compatibility and quality pass against the uploaded `opencode-dev` source tree and the current project docs.

## Source-aligned fixes

### 1. Plugin event hook compatibility

The earlier plugin attempted to register event names such as `session.created`, `session.idle`, `file.edited`, and `todo.updated` as top-level plugin hooks. The current opencode server plugin loader calls a single plugin `event({ event })` hook for bus events, while dedicated top-level hooks are reserved for specific hook names such as `tool.execute.before`, `tool.execute.after`, and `experimental.session.compacting`.

P8.1 now routes session/file/todo/LSP events through the single `event` hook and dispatches by `event.type` internally. This fixes durable state/event logging and the idle gate warning path.

### 2. MCP stdio framing

The earlier MCP servers mostly accepted newline-delimited JSON-RPC. The current opencode MCP client uses the MCP SDK stdio transport, which uses `Content-Length` framed messages.

P8.1 adds `Content-Length` framed input/output to all team MCP servers, while keeping newline JSON-RPC fallback for direct debugging.

### 3. MCP tool naming

OpenCode prefixes MCP tool names with the MCP server name. If an MCP server named `research` exposes `research_validate`, the model sees `research_research_validate`.

P8.1 changed MCP server-internal tool names to short names such as `validate`, `status`, `digest`, and `act_by_id`, so OpenCode exposes the intended names:

- `research_validate`
- `context_pack`
- `router_decide`
- `memory_record`
- `patch_propose`
- `overnight_run`
- `cloakbrowser_digest`
- `browser_bridge_digest`

## Checks performed

- `node --check` across all `.js` and `.mjs` files under `.opencode/`.
- `bash -n install.sh`.
- Fresh install smoke test into `/mnt/data/qa/smoke-p81`.
- Doctor commands for team, research, context, router, memory, patch, overnight, browser, and Chrome bridge modules.
- MCP framed protocol probe for every MCP server: `initialize` and `tools/list`.
- Manual source inspection of opencode plugin loading, config directory conventions, CLI run flags, MCP client transport, and agent markdown loading.

## Known limitations after QA

- Real `opencode run --execute` was not executed in the sandbox because the opencode binary is not installed here.
- Real CloakBrowser/Playwright headed browser execution was not executed in the sandbox because browser dependencies and GUI are not installed here.
- Real Chrome extension UI interaction was not executed in the sandbox because a graphical Chrome session is unavailable.
- Provider/model ids in `.opencode/team/router/model-registry.json` and `opencode.team.example.jsonc` remain placeholders and must be edited for the user's actual OpenAI/MiniMax/DeepSeek/Qwen endpoints.

## Suggested local validation

```bash
./install.sh /path/to/project
cd /path/to/project

./opencode-team-run doctor
./opencode-context ingest --all
./opencode-context pack "current goal evidence failures"
./opencode-router status
./opencode-research doctor
./opencode-overnight run "smoke test idea" --max-cycles 1

cd .opencode
npm install cloakbrowser playwright-core
cd ..
./opencode-browser manual https://example.com --mark

./opencode-chrome-bridge serve
# Load .opencode/browser-extension as an unpacked Chrome extension.
```
