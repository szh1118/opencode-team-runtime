# P8 — End-to-End Overnight Mode

P8 composes P1-P7 into one supervised workflow. It is a coordinator, not a new agent brain.

```text
idea
  -> preflight doctor checks
  -> plan / task DAG
  -> optional research
  -> repeated cycles:
       context ingest + pack
       A-zone work step
       browser evidence when relevant
       periodic B-zone review
       periodic handoff
       memory recording on failures
  -> final review + audit + handoff
  -> memory learning + improvement suggestions
```

## Commands

```bash
./opencode-overnight doctor
./opencode-overnight run "your idea" --max-cycles 12
./opencode-overnight run "your idea" --max-cycles 12 --execute
./opencode-overnight resume --max-cycles 6 --execute
./opencode-overnight step --execute
./opencode-overnight final --execute
./opencode-overnight stop --reason "manual pause"
./opencode-overnight status --json
```

Dry-run is the default. Dry-run limits the loop to one cycle to avoid noisy fake progress.

## Safety

P8 blocks high-risk ideas by default if they contain keywords for purchases, payments, production deploys, or destructive external side effects. Edit `.opencode/team/overnight.config.json` only if you understand the risk.

P8 does not automatically apply patch suggestions. It can generate memory suggestions and patch proposals through P6/P7, but applying patches remains a reviewed workflow.

## Browser behavior

P8 reuses P2.5/P2.6:

- CloakBrowser headed/manual mode for repeatable automated testing.
- Browser Bridge for the user's real Chrome/login state.
- Manual Continue-agent overlay for CAPTCHA, 2FA, login, or strong anti-bot challenges.

## Files

```text
.opencode/team/overnight.config.json
.opencode/team/overnight/state.json
.opencode/team/overnight/events.jsonl
.opencode/team/overnight/runs/<run-id>/
```

## Tuning

Key knobs in `.opencode/team/overnight.config.json`:

- `mode.defaultMaxCycles`
- `mode.stopAfterConsecutiveFailures`
- `phases.reviewEveryCycles`
- `phases.handoffEveryCycles`
- `phases.researchHeuristics`
- `phases.browserHeuristics`
- `safety.highRiskKeywords`

