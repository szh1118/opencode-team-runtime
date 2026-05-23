# P3 Deep Research / Claim-Evidence Module

P3 adds an evidence-first research ledger. It is deliberately stricter than a normal LLM research summary:

- sources are explicitly added;
- source text is chunked and stored;
- claims must cite source/chunk evidence ids;
- validation flags weak or unsupported claims;
- reports are marked NOT READY when unsupported or unvalidated claims exist.

This is not a replacement for a strong reviewer. It is a hard floor that prevents research agents from writing unsupported conclusions into the team plan.

## Files

```text
.opencode/scripts/research-runner.mjs
.opencode/mcp/research-mcp.mjs
.opencode/agents/research-scout.md
.opencode/agents/research-reviewer.md
.opencode/agents/paper-digester.md
.opencode/agents/code-archaeologist.md
.opencode/team/research/
```

Research artifacts:

```text
.opencode/team/research/sources.json
.opencode/team/research/claims.json
.opencode/team/research/chunks/*.json
.opencode/team/research/reports/*.md
.opencode/team/research/artifacts/*.log
```

## CLI examples

Initialize/check:

```bash
./opencode-research doctor
./opencode-research status
```

Add sources:

```bash
./opencode-research add-source https://example.com/docs --title "Example docs"
./opencode-research add-text --title "Local paper notes" --file docs/paper-notes.md --url https://arxiv.org/abs/....
```

Record a claim with evidence:

```bash
./opencode-research claim "The project exposes a local MCP tool for browser evidence." --evidence src-abc123#c0002 --kind fact
```

Validate and generate report:

```bash
./opencode-research validate
./opencode-research report --topic "Browser tool research"
```

Browser discovery:

```bash
./opencode-research search "OpenAI computer use API browser screenshot action loop" --browser bridge
./opencode-research search "Anthropic computer use tool screenshot mouse keyboard" --browser cloak
```

Agent-driven research dry-run/execute:

```bash
./opencode-research run "Research browser agents for text-only LLMs"
./opencode-research run "Research browser agents for text-only LLMs" --execute
```

## MCP tools

P3 exposes these MCP tools:

- `research_status`
- `research_add_source`
- `research_add_text`
- `research_add_claim`
- `research_validate`
- `research_report`
- `research_search_browser`
- `research_run_agent`

Use these from `research-scout`, `paper-digester`, and `code-archaeologist`.

## Research gate

A claim has one of these states:

- `unvalidated`: evidence refs exist but validation has not run;
- `supported`: cited chunks overlap enough with the claim to pass the lexical support threshold;
- `weak`: some overlap exists, but it needs reviewer attention;
- `unsupported`: cited evidence does not support the claim.

Reports remain blocked when any claim is `unvalidated` or `unsupported`.

The validator is intentionally simple. It is not semantic entailment. It is designed to catch the common failure mode where an LLM records a source URL but the source does not actually contain the claim. Stronger model review can be added later.

## Recommended workflow for research agents

1. Discover candidate sources through browser/search/local repo inspection.
2. Add only useful primary sources.
3. Make small claims with exact evidence references.
4. Run validation.
5. Ask `research-reviewer` to inspect weak/unsupported claims.
6. Only then use conclusions in `chief-engineer` planning.
