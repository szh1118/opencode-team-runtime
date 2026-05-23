# Modules

## P0 — Plugin status layer

Implemented.

- state files
- handoff/evidence tools
- event hooks
- compaction context
- agents

## P1 — External team runtime

Implemented as `.opencode/scripts/team-runner.mjs`.

Responsibilities:

- keep `.opencode/team/task-dag.json`;
- bootstrap a raw idea into a recoverable task DAG;
- call `opencode run` with selected agent/model;
- provide dry-run mode;
- dispatch planning, A-zone work, testing, B-zone review, audit, and handoff;
- keep per-session stdout/stderr logs;
- provide status/doctor/manual mark commands;
- write runtime evidence.

Current P1 limitations:

- CLI-driven, not direct OpenCode server SDK yet;
- heuristic fallback transitions after agent runs;
- rotation thresholds configured but not fully token-accounting enforced.

## P2 — CloakBrowser/browser evidence

Implemented in this package.

Files:

- `.opencode/scripts/browser-runner.mjs`
- `.opencode/mcp/cloakbrowser-mcp.mjs`
- `.opencode/agents/browser-tester.md`
- `.opencode/team/browser/`

Responsibilities:

- open URLs with CloakBrowser/Playwright;
- click/type/wait/scroll with explicit action steps;
- collect screenshots;
- collect console logs, page errors, failed requests, and HTTP error responses;
- collect page text and interactive DOM summaries;
- write browser evidence to `.opencode/team/evidence.md` and `.opencode/team/state.json`;
- expose MCP tools to OpenCode.

Current P2 limitations:

- one-shot browser contexts, no long-lived browser session yet;
- no automatic hard gate for browser evidence yet;
- no CAPTCHA solving and no bypassing access controls.

## P3 — Deep research / claim-evidence service

Status: implemented in this package.

Adds:

- `.opencode/scripts/research-runner.mjs`;
- `.opencode/mcp/research-mcp.mjs`;
- `.opencode/agents/research-scout.md`;
- `.opencode/agents/research-reviewer.md`;
- `.opencode/agents/paper-digester.md`;
- `.opencode/agents/code-archaeologist.md`;
- `.opencode/team/research/sources.json`;
- `.opencode/team/research/claims.json`;
- `.opencode/team/research/chunks/*.json`;
- `.opencode/team/research/reports/*.md`.

Responsibilities:

- add primary sources;
- chunk source text;
- require each claim to cite `SOURCE_ID[#CHUNK_ID]`;
- validate claims as supported/weak/unsupported;
- generate reports that are marked NOT READY when unsupported or unvalidated claims remain;
- expose MCP tools for research agents.

Current limitations:

- validation is lexical and conservative, not full semantic entailment;
- browser-backed discovery delegates to P2/P2.6 runners;
- no source quality ranking beyond agent prompts yet.

## P4 — Context compression

Status: implemented in this package.

Adds:

- `.opencode/scripts/context-runner.mjs`;
- `.opencode/mcp/context-mcp.mjs`;
- `.opencode/agents/context-curator.md`;
- `.opencode/agents/log-compressor.md`;
- `.opencode/team/context/index.json`;
- `.opencode/team/context/current-pack.md`.

Responsibilities:

- compress shell/browser/research/session logs;
- index handoff, evidence, task DAG, events, browser artifacts, research ledger, and sessions;
- search local evidence deterministically;
- produce small context packs for MiniMax, review, and handoff.

## P5 — Model routing / budget / failure escalation

Status: implemented in this package.

Adds:

- `.opencode/scripts/router-runner.mjs`;
- `.opencode/mcp/router-mcp.mjs`;
- `.opencode/agents/model-router.md`;
- `.opencode/team/router/model-registry.json`;
- `.opencode/team/router/policy.json`;
- `.opencode/team/router/usage.json`;
- `.opencode/team/router/decisions.jsonl`.

Responsibilities:

- choose cheapest safe model for each role;
- route MiniMax failures to DeepSeek/Qwen or premium checkpoint models;
- keep GPT-5.5/Opus-style models for checkpoints and final audit;
- track premium-call budget and optional estimated costs;
- record route decisions and usage evidence.

Current limitations:

- token counts/costs are recorded when supplied or inferred as zero; provider-level usage parsing is future work;
- budget defaults are advisory unless you set hard limits in `policy.json`;
- exact model aliases must be edited to match your opencode provider names.

## P6 — Memory and self-improvement

Borrow hermes/GenericAgent ideas carefully:

- store successful/failed patterns;
- prompt improvement proposals;
- route-quality statistics;
- require reviewer/auditor approval before modifying runtime behavior.

## P2.5 — Browser Perception + Headed CloakBrowser

Status: implemented in this package.

Adds:

- Headed CloakBrowser by default (`CLOAKBROWSER_HEADLESS=false`).
- Persistent profile at `.opencode/team/browser/profile`.
- Manual user gate with browser overlay and Continue Agent button.
- `ScreenDigest` extraction for text-only models.
- `current-raw.json`, `current-reduced.json`, `current-digest.json` browser state files.
- Marked screenshots with element ids.
- Safe id-based actions through `cloakbrowser_act_by_id`.
- New agents: `browser-perception`, `browser-actor`, `visual-reviewer`.

This is intentionally not a full native Chrome extension bridge yet. It implements the core codex-chrome-inspired concept with a simpler CloakBrowser/Playwright path first.


## P2.6 Browser Bridge

Adds a Chrome extension + localhost bridge server for inspecting and controlling the user's real Chrome tabs. It reuses ScreenDigest, element ids, manual intervention, screenshots, and evidence logging. Native messaging host scaffolding is included but localhost polling is the default.


## P4 Context Compression / Evidence Retrieval

P4 adds `.opencode/scripts/context-runner.mjs`, `.opencode/mcp/context-mcp.mjs`, `context-curator`, and `log-compressor`. It indexes handoff/evidence/browser/research/session artifacts and produces `.opencode/team/context/current-pack.md` for review, handoff, and weak-model task execution. Use `./opencode-context ingest --all` then `./opencode-context pack "current goal evidence failures next task"`.

## P6 — Memory / self-improvement / route quality

Status: implemented in this package.

Adds:

- `.opencode/scripts/memory-runner.mjs`;
- `.opencode/mcp/memory-mcp.mjs`;
- `.opencode/agents/memory-curator.md`;
- `.opencode/agents/improvement-reviewer.md`;
- `.opencode/team/memory/events.jsonl`;
- `.opencode/team/memory/model-scorecard.json`;
- `.opencode/team/memory/suggestions.json`;
- `.opencode/team/memory/prompt-notes.md`.

Responsibilities:

- record successes, failures, lessons, and repeated model failure modes;
- learn from evidence, router decisions, and task DAG status;
- compute model/agent/agent-model scorecards;
- generate advisory prompt, route, browser, research, and context suggestions;
- export compact memory packs for chief/reviewer/auditor;
- require approval before any suggestion is treated as actionable.

Current limitations:

- it is intentionally advisory-only;
- it does not automatically patch prompts, skills, router policy, or runtime code;
- simple pattern buckets are deterministic and conservative, not semantic clustering.

## P7 — Reviewed patch workflow

Status: implemented in this package.

Adds:

- `.opencode/scripts/patch-runner.mjs`;
- `.opencode/mcp/patch-mcp.mjs`;
- `.opencode/agents/patch-planner.md`;
- `.opencode/agents/patch-reviewer.md`;
- `.opencode/agents/patch-applier.md`;
- `.opencode/team/patches/config.json`;
- `.opencode/team/patches/queue.json`.

Responsibilities:

- convert memory suggestions or user requests into small patch proposals;
- validate patches against an explicit safe patch surface;
- generate unified diffs and reviewer checklists;
- require approval before applying;
- apply with rollback backups;
- reject or rollback unsafe changes.

Default policy:

- allows prompt, skill, router/memory config, docs, README, and example config edits;
- blocks scripts, plugins, MCP servers, browser extension code, installers, secrets, `.git`, and `node_modules`;
- does not auto-apply anything.

Use:

```bash
./opencode-patch doctor
./opencode-patch propose --title "..." --target .opencode/agents/reviewer.md --kind append --text "..."
./opencode-patch review patch-xxxx
./opencode-patch approve patch-xxxx --by user
./opencode-patch apply patch-xxxx
```

## P8 — End-to-end overnight mode

P8 composes all previous modules into a supervised overnight loop:

- P1 task DAG and OpenCode dispatch
- P2/P2.5/P2.6 browser evidence and manual takeover
- P3 claim-evidence research
- P4 context packing
- P5 routing and escalation
- P6 memory and scorecards
- P7 reviewed patch workflow

Primary files:

```text
.opencode/scripts/overnight-runner.mjs
.opencode/mcp/overnight-mcp.mjs
.opencode/agents/overnight-supervisor.md
.opencode/team/overnight.config.json
.opencode/team/overnight/state.json
.opencode/team/overnight/events.jsonl
```

Main command:

```bash
./opencode-overnight run "idea" --max-cycles 12 --execute
```

Dry-run remains the default.
