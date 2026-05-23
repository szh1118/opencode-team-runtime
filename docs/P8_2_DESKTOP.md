# P8.2 Desktop Mode Notes

This package supports two control modes:

1. **CLI/orchestrator mode**: helper scripts call `opencode run` and can create separate sessions automatically.
2. **Desktop/in-session mode**: OpenCode Desktop is the UI; the current session acts as the mother session and uses project commands, agents, plugins, and MCP tools.

For a Desktop-only user, use Desktop/in-session mode.

## Why P8.1 was not desktop-first

OpenCode Desktop starts a local sidecar server with a random Basic Auth password. The renderer receives that password internally, but a separate external script generally cannot discover it. Therefore a script like `opencode-overnight run --execute`, which was designed around `opencode run`, is not a reliable default for Desktop users.

The fix in P8.2 is to expose a Desktop-friendly command layer in `.opencode/command/`:

- `team-overnight`
- `team-plan`
- `team-step`
- `team-review`
- `team-audit`
- `team-handoff`
- `team-research`
- `team-browser`
- `team-context`
- `team-memory`
- `team-patch-review`

These commands run inside the Desktop session and instruct the selected agent to use the installed MCP tools directly.

## Installation for Desktop

Run the installer once:

```bash
./install.sh /path/to/project
```

Then open the project in OpenCode Desktop. If your project already had `opencode.json` or `opencode.jsonc`, merge the MCP/plugin sections from `opencode.desktop.example.jsonc`.

OpenCode supports project-level plugins in `.opencode/plugins/`, project-level agents in `.opencode/agents/`, and markdown commands in `.opencode/command/` or `.opencode/commands/`.

## How to use in Desktop

In the Desktop chat, invoke or paste one of these commands depending on the UI command palette support:

```text
/team-overnight Build the plugin from this idea and keep evidence/handoff updated.
```

or:

```text
/team-plan <idea>
/team-step continue one cycle
/team-review review current diff and evidence
/team-handoff update handoff before I clear context
/team-audit final audit
```

If command discovery is not visible in your Desktop build, ask the current session directly:

```text
Use opencode-team-runtime Desktop mode. Act as the mother session. Use the team/context/router/research/browser/memory/patch/overnight MCP tools directly. Plan this idea, create/update the task DAG and handoff, run one small cycle, collect evidence, and stop before high-risk side effects.
```

## What Desktop mode can do

Desktop mode can:

- use all local MCP tools;
- record durable state under `.opencode/team/`;
- use browser/CloakBrowser/Chrome bridge tools;
- run research with claim-evidence ledger;
- build context packs;
- route model choices through router policy as advisory state;
- learn failure patterns;
- create reviewed patch proposals;
- coordinate subagents from the current mother session.

## What Desktop mode cannot guarantee yet

Desktop mode cannot reliably do fully external session spawning unless one of these is true:

- you also install/use the OpenCode CLI;
- you run a separate `opencode serve` with known credentials and point Desktop to it;
- OpenCode Desktop exposes an official automation/auth endpoint in a future release.

For now, Desktop mode is an **in-session orchestrator**. The mother session stays alive and delegates through subagents/tools. Context rotation is done via handoff and manual `/clear` or new Desktop session, not by an external script secretly controlling Desktop.

## Recommended Desktop workflow

1. Start a Desktop session in the project.
2. Run `/team-overnight <idea>` or paste the equivalent instruction.
3. Let it create/update `.opencode/team/task-dag.json` and `.opencode/team/handoff.md`.
4. When context gets noisy, run `/team-handoff`.
5. Start a fresh Desktop session and say: `Read .opencode/team/handoff.md and continue via team-runtime Desktop mode.`

This follows the handoff/clear workflow without requiring CLI automation.
