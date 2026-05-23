---
description: Review proposed prompt/skill/router patch safely
agent: patch-reviewer
---

Review proposed opencode-team-runtime patches.

Scope:

$ARGUMENTS

Rules:
- Only prompt/skill/router/config/docs safe surfaces may be approved.
- Runtime core scripts/plugins/MCP/browser-extension changes must be rejected unless the user explicitly asks for manual engineering work.
- Check diff, risk, rollback path, and evidence.
