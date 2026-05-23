# P7 — Reviewed Patch Workflow

P7 turns advisory memory suggestions and explicit user requests into small, auditable patch proposals.
It is designed for safe self-improvement: generate a patch, review it, approve it, apply it, and keep a rollback backup.

## Why this exists

P6 can discover repeated failures and generate improvement suggestions. Applying those suggestions automatically is dangerous.
P7 adds a gate:

```text
memory suggestion / user request
  -> patch proposal
  -> validation against safe patch surface
  -> unified diff
  -> reviewer checklist
  -> approval
  -> apply with backup
  -> rollback if needed
```

## Default safe patch surface

Allowed by default:

- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/team/router/`
- `.opencode/team/memory/`
- `.opencode/team/config.json`
- `.opencode/team/runtime.config.json`
- `docs/`
- `README.md`
- `opencode.team.example.jsonc`

Blocked by default:

- `.opencode/scripts/`
- `.opencode/plugins/`
- `.opencode/mcp/`
- `.opencode/browser-extension/`
- `.env`, `.ssh`, `.git`, `node_modules`
- `install.sh`, `package.json`

Core runtime changes should be implemented manually by a developer, not by the self-improvement loop.

## CLI examples

Create a write patch from a file:

```bash
./opencode-patch propose \
  --title "Tighten MiniMax premature-done rule" \
  --target .opencode/agents/minimax-coder.md \
  --kind write \
  --content-file /tmp/minimax-coder-new.md
```

Create an append patch:

```bash
./opencode-patch propose \
  --title "Add reviewer note" \
  --target .opencode/agents/reviewer.md \
  --kind append \
  --text $'\n- Treat missing browser evidence as not done.\n'
```

Create a replace patch:

```bash
./opencode-patch propose \
  --title "Change MiniMax soft rotation" \
  --target .opencode/team/router/policy.json \
  --kind replace \
  --search '"softRotation": 0.70' \
  --replacement '"softRotation": 0.60'
```

Review and apply:

```bash
./opencode-patch validate patch-xxxx
./opencode-patch diff patch-xxxx
./opencode-patch review patch-xxxx
./opencode-patch approve patch-xxxx --by user --note "Looks safe"
./opencode-patch apply patch-xxxx
```

Rollback:

```bash
./opencode-patch rollback patch-xxxx --reason "Regression in prompt behavior"
```

## MCP tools

- `patch_status`
- `patch_list`
- `patch_propose`
- `patch_validate`
- `patch_diff`
- `patch_review`
- `patch_approve`
- `patch_reject`
- `patch_apply`
- `patch_rollback`

## Recommended agent flow

```text
memory-curator
  -> improvement-reviewer
  -> patch-planner
  -> patch-reviewer
  -> user/authorized reviewer approval
  -> patch-applier
  -> auditor checks result
```

Do not let patch-planner apply its own patches.
