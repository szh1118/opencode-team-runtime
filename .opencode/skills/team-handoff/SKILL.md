---
description: Preserve long-running multi-agent work by updating evidence and handoff before context rotation.
---

# Team Handoff Skill

Use this when a session is noisy, near context limits, stuck, or about to stop.

Procedure:
1. Run `team_status`.
2. Run `team_gate`.
3. Record missing evidence or blockers with `team_evidence`.
4. Replace `.opencode/team/handoff.md` through `team_handoff`.
5. Call `team_rotate action=request` if a fresh session should continue.

The handoff must include:
- goal;
- current state;
- task DAG status;
- files in flight;
- evidence;
- failed attempts;
- open questions;
- next atomic task;
- stop conditions;
- reviewer notes.

Never use handoff to launder uncertainty into certainty. If a feature is not verified, say it is not verified.
