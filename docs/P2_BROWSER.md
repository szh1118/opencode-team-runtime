# P2 Browser Evidence Module

P2 gives the team a browser evidence path without forcing every model to hold screenshots, full DOM, and console logs in context.

## Components

```text
.opencode/scripts/browser-runner.mjs   # human/agent CLI
.opencode/mcp/cloakbrowser-mcp.mjs     # local MCP server
.opencode/agents/browser-tester.md     # browser evidence agent
.opencode/team/browser/                # screenshots/json artifacts
```

## Browser runner

Examples:

```bash
./opencode-browser visit https://example.com --text Example
./opencode-browser snapshot https://example.com --dom
./opencode-browser interact http://localhost:3000 --steps .opencode/team/browser/steps.json --text Dashboard
```

A steps file is a JSON array:

```json
[
  { "action": "click", "selector": "button[data-testid='login']" },
  { "action": "type", "selector": "input[name='email']", "text": "demo@example.com" },
  { "action": "press", "key": "Enter" },
  { "action": "wait", "ms": 1000 }
]
```

Supported actions:

- `goto`
- `click`
- `type`
- `press`
- `wait`
- `waitForSelector`
- `scroll`

## MCP server

Add to `opencode.json`:

```jsonc
{
  "mcp": {
    "cloakbrowser": {
      "type": "local",
      "command": ["node", "./.opencode/mcp/cloakbrowser-mcp.mjs"],
      "enabled": true,
      "environment": {
        "TEAM_PROJECT_ROOT": ".",
        "CLOAKBROWSER_HEADLESS": "true",
        "CLOAKBROWSER_HUMANIZE": "true"
      }
    }
  }
}
```

Tools exposed:

- `cloakbrowser_visit(url, text?, notText?, selector?, screenshot?, waitMs?, timeoutMs?)`
- `cloakbrowser_snapshot(url, dom?, screenshot?, waitMs?, timeoutMs?)`
- `cloakbrowser_interact(url, steps, text?, selector?, screenshot?, waitMs?, timeoutMs?)`
- `cloakbrowser_doctor()`

## Evidence output

Every successful or failed run writes:

- JSON result under `.opencode/team/browser/`
- screenshot under `.opencode/team/browser/` unless disabled with `--screenshot none`
- markdown summary under `.opencode/team/evidence.md`
- state entry in `.opencode/team/state.json`

## Safety boundary

Use this for legitimate development testing, research page rendering, and source verification. Do not use it to bypass access controls, solve CAPTCHAs, scrape private data, or violate site rules.

## P2.5 update

P2.5 changes the default browser posture:

- Browser runs headed by default.
- Persistent profile is enabled by default.
- Manual intervention is supported through `--manual` / `cloakbrowser_manual`.
- `observe`, `digest`, and `act` commands provide text-first browser perception.

Use `docs/P2_5_BROWSER_PERCEPTION.md` for the current browser workflow.
