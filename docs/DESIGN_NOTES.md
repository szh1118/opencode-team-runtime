# Design notes

## Why plugin first, then runtime

OpenCode already has primary agents, subagents, per-agent models, permissions, custom tools, and plugin hooks. P0 uses those directly instead of creating a separate framework too early.

P1 adds an external runner because autonomous multi-session work needs a durable process outside a single model context:

- detect premature stops;
- rotate sessions;
- call A-zone and B-zone agents separately;
- keep logs outside chat context;
- recover from failed model calls;
- manually inspect/patch state.

## Why not full swarm yet

The first failure mode for multi-agent coding is ungrounded conversation. P0/P1 force important claims into task DAG, state, evidence, and handoff files before adding heavier orchestration.

## Evidence-driven completion

A task is not complete because a model says so. It is complete only when:

- task exists;
- implementation evidence exists;
- tests/checks/browser evidence exists where relevant;
- reviewer/auditor evidence exists after file changes;
- handoff is updated;
- `team_gate` passes or warnings are explicitly accepted by the chief.

## Context rotation

P0 records rotation requests through `team_rotate`. P1 can dispatch `handoff-writer`, but exact token-based enforcement is still future work.

Suggested thresholds:

- MiniMax coder: soft 55%, hard 70%.
- DeepSeek coordinator: soft 60%, hard 72%.
- Qwen handoff: soft 70%, hard 80%.
- GPT-5.5 reviewer/auditor: soft ~180k tokens, hard ~200k tokens if your observed window is ~240k.

## Reference influence

- ECC/OpenCode plugins: event hooks, custom tools, changed-file tracking.
- Superpowers/OpenCode plugin: skills/bootstrap pattern.
- Claude/Codex-style hooks: stop/compaction/handoff concept.
- rtk/caveman: future shell-output compression.
- gpt-researcher: future research lifecycle, but with stricter evidence validation.
- ralph/hermes/GenericAgent/ruflo: future scheduler/memory/swarm ideas, not copied wholesale.
