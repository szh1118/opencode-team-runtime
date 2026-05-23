# P1 runtime design

## Why external runtime

OpenCode plugins are excellent for events, custom tools, compaction context, and safety gates. Long-running orchestration is easier to reason about outside the plugin:

- shell process lifecycle is explicit;
- logs are easy to preserve;
- task DAG can be edited/recovered manually;
- `opencode run` can be called from scripts;
- future versions can swap CLI calls for OpenCode server/API calls.

## Main files

```text
.opencode/team/runtime.config.json
.opencode/team/task-dag.json
.opencode/team/state.json
.opencode/team/handoff.md
.opencode/team/evidence.md
.opencode/team/runtime-events.jsonl
.opencode/team/sessions/
```

## Dispatch policy

- `chief-engineer`: planning and coordination, no direct implementation.
- `minimax-coder`: one small A-zone implementation task.
- `tester`: narrow command/browser checks and evidence.
- `reviewer`: read-only B-zone diff/evidence review.
- `auditor`: final anti-hallucination pass.
- `handoff-writer`: session rotation handoff.

## Status policy

The runner recognizes these task states:

```text
open -> working -> claimed_done -> testing -> reviewing -> passed/done
failed -> repair/open
blocked -> open after dependencies pass
```

Agents should update tasks through `team_task` when possible. The runner also writes fallback transitions so a session cannot disappear without leaving a trail.

## Running safely

Start with dry-runs:

```bash
./opencode-team-run doctor
./opencode-team-run plan "idea"
./opencode-team-run run "idea" --max-steps 3
```

Then execute:

```bash
./opencode-team-run plan "idea" --execute
./opencode-team-run run --max-steps 8 --execute
```

Do not enable `dangerouslySkipPermissions` globally unless you are inside a disposable sandbox.
