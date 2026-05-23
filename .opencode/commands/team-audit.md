---
description: Final audit for claimed completion
agent: auditor
---

Perform a final audit for claimed completion.

Scope / optional instruction:

$ARGUMENTS

Rules:
- Compare user goal, task DAG, handoff, evidence, tests, browser evidence, and actual diff.
- Look specifically for claimed-but-missing implementation.
- Unsupported claims must fail the audit.
- Record audit evidence and update handoff.
- Only say complete if all gates pass.
