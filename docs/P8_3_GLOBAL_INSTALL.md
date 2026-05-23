# P8.5 Global Install

P8.5 changes the install model from project-local to global-first.

## Install once

```bash
./install.sh
```

The installer copies reusable runtime files to the OpenCode global config directory:

```text
~/.config/opencode/
├── agents/
├── command/
├── plugins/
├── mcp/
├── scripts/
├── skills/
└── browser-extension/
```

It also patches `~/.config/opencode/opencode.jsonc` with the MCP entries needed by the runtime.

OpenCode loads global config, global agents, global commands, global skills, and plugin files from this directory. Project state is still written under the current project:

```text
PROJECT/.opencode/team/
```

That keeps handoff, evidence, browser artifacts, research ledgers, router usage, memory, patches, and overnight logs isolated per repository.

## Desktop workflow

After global installation, open any project in OpenCode Desktop and run:

```text
/team-overnight your idea
```

Or use smaller commands:

```text
/team-plan your idea
/team-step
/team-review
/team-handoff
/team-audit
/team-browser http://localhost:3000
/team-research your question
```

No project-local runtime copy is required.

## Optional project init

Project state is created lazily when tools run. If you want to create the folders and `.gitignore` entries ahead of time:

```bash
opencode-team init /path/to/project
```

This only creates `.opencode/team/` state folders. It does not copy scripts, MCP servers, plugins, agents, or commands into the project.

## Global helper CLI

```bash
opencode-team doctor
opencode-team paths
opencode-team install-browser-deps
opencode-team browser manual https://example.com --mark
opencode-team chrome-bridge serve
opencode-team overnight status
```

Compatibility wrappers are also installed into `~/.local/bin` by default:

```text
opencode-browser
opencode-chrome-bridge
opencode-research
opencode-context
opencode-router
opencode-memory
opencode-patch
opencode-overnight
opencode-desktop-doctor
```

## Browser dependencies

CloakBrowser/Playwright are optional. Install them globally into the runtime directory:

```bash
opencode-team install-browser-deps
```

## Chrome bridge

Start the bridge:

```bash
opencode-team chrome-bridge serve
```

Then load this extension directory in Chrome:

```text
~/.config/opencode/browser-extension
```

The extension can use the user's existing Chrome login state. For CAPTCHA, 2FA, or strong anti-bot flows, use manual mode so the user can take over and click **Continue agent**.

## Upgrading

Run the new package's installer again:

```bash
./install.sh
```

The installer overwrites the managed global runtime files, preserves project state, and backs up the global `opencode.jsonc` before merging MCP entries.
