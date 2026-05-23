---
description: All in one Desktop托管入口: plan, work, review, audit, and handoff through opencode-team-runtime
agent: overnight-supervisor
---

Run opencode-team-runtime in **All in one Desktop mode**.

User request / idea:

$ARGUMENTS

This is the normal one-click entrusted workflow for OpenCode Desktop users.

Process contract:
1. Treat this session as the mother session.
2. Use installed MCP/plugin tools directly; do not ask the user to run terminal commands.
3. Start with `overnight_status`, `team_status`, and relevant doctor/status checks.
4. Create or refresh a durable task DAG and handoff if needed.
5. Run small cycles: plan -> context pack -> A-zone work -> evidence -> B-zone review -> handoff.
6. Use B-zone reviewer/auditor subagents to catch premature "done" claims; do not over-constrain the A-zone worker with extra bureaucracy.
7. For web/UI work, require CloakBrowser or Browser Bridge evidence.
8. If review/audit/handoff evidence is missing, stop in a blocked state and write the next recovery step instead of claiming completion.
9. High-risk external side effects require explicit user confirmation.

Begin the all-in-one cycle now. Keep the user-facing summary short and factual.
