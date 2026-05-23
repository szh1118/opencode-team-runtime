# P6 — Memory / Self-Improvement / Route Quality

P6 adds an advisory memory layer for opencode-team-runtime.

It is intentionally conservative: it records what happened, computes model/agent scorecards, proposes route/prompt/skill improvements, and requires review before anything changes. It does **not** auto-modify runtime code.

## Files

```text
.opencode/scripts/memory-runner.mjs
.opencode/mcp/memory-mcp.mjs
.opencode/agents/memory-curator.md
.opencode/agents/improvement-reviewer.md
.opencode/team/memory/
  config.json
  events.jsonl
  lessons.jsonl
  model-scorecard.json
  suggestions.json
  prompt-notes.md
  approvals/
  packs/
```

## CLI

```bash
./opencode-memory doctor
./opencode-memory status
./opencode-memory record --kind failure --agent minimax-coder --model minimax-m2.7 --text "claimed complete but feature missing" --tags premature_done
./opencode-memory learn --from all
./opencode-memory analyze --json
./opencode-memory suggestions
./opencode-memory pack "what should the reviewer know about repeated failures"
./opencode-memory approve sug-xxxx --note "safe prompt-only change"
./opencode-memory reject sug-yyyy --note "not enough evidence"
```

## MCP tools

- `memory_status`
- `memory_record`
- `memory_learn`
- `memory_analyze`
- `memory_suggestions`
- `memory_pack`
- `memory_approve_suggestion`

## What gets learned

P6 scans:

- `.opencode/team/evidence.md`
- `.opencode/team/router/decisions.jsonl`
- `.opencode/team/task-dag.json`
- manually recorded memory events

It groups repeated issues into buckets:

- `premature_done`
- `test_failure`
- `browser_failure`
- `context_noise`
- `research_unsupported`
- `permission_safety`
- `dependency_install`

Then it updates:

- model scorecards;
- agent scorecards;
- agent/model pair scorecards;
- repeated failure patterns;
- advisory suggestions.

## Safety model

P6 is advisory-only by default.

Rules:

1. It may write memory files under `.opencode/team/memory/`.
2. It may generate prompt notes.
3. It may mark suggestions approved/rejected.
4. It must not auto-edit `.opencode/scripts/`, `.opencode/plugins/`, or `.opencode/mcp/`.
5. Any prompt/skill change should be reviewed by `improvement-reviewer`.
6. Any runtime code change requires explicit human instruction and normal review/audit.

This is deliberate. Self-improving agents can easily turn a bad observation into a worse permanent rule. P6 records evidence first and leaves the final decision to a reviewer/human.

## Recommended loop

After a run:

```bash
./opencode-memory learn --from all
./opencode-memory suggestions
./opencode-memory pack "current route quality and repeated failures"
```

Before changing prompts:

1. Ask `memory-curator` to summarize active suggestions.
2. Ask `improvement-reviewer` to approve/reject them.
3. Only then ask a coder to edit a specific prompt/skill file.
4. Run reviewer/auditor again.

## Integration with router

P6 does not automatically change `.opencode/team/router/policy.json`.

Instead it emits route suggestions such as:

```text
Consider rerouting minimax-coder away from minimax-m2.7 for repeated browser_failure/premature_done failures.
```

A future P7 can add an explicit, reviewed patch workflow that modifies router policy after approval.
