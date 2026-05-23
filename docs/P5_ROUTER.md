# P5 Model Router / Budget / Failure Escalation

P5 turns the model-split idea into a deterministic local policy.

## Files

- `.opencode/scripts/router-runner.mjs` — CLI router.
- `.opencode/mcp/router-mcp.mjs` — MCP tools for agents.
- `.opencode/agents/model-router.md` — routing assistant prompt.
- `.opencode/team/router/model-registry.json` — model aliases and opencode model IDs.
- `.opencode/team/router/policy.json` — role routing, budget, escalation, checkpoint rules.
- `.opencode/team/router/usage.json` — call counts, premium-call counts, optional token/cost totals.
- `.opencode/team/router/decisions.jsonl` — append-only route decision log.

## Core policy

MiniMax is default for narrow coding and bulk work. DeepSeek/Qwen are default for supervision, handoff, research review, and normal review. GPT-5.5/Opus-style premium models are used only for high-leverage checkpoints:

- final audit;
- repeated failure;
- claimed-but-missing implementation;
- security risk;
- complex algorithm;
- visual UI review;
- large architecture review.

## Commands

```bash
./opencode-router doctor
./opencode-router models
./opencode-router status
./opencode-router budget
./opencode-router decide --role minimax-coder --attempts 0 --reason "small atomic edit"
./opencode-router decide --role minimax-coder --attempts 2 --reason "repeated-failure" --json
./opencode-router escalate --role minimax-coder --attempts 2 --reason "claimed-but-missing"
./opencode-router checkpoint --kind final-audit --reason "before-done"
./opencode-router record --agent reviewer --model gpt-5.5 --status passed --input-tokens 12000 --output-tokens 3000 --cost 0
```

## MCP tools

- `router_status`
- `router_models`
- `router_decide`
- `router_record_usage`
- `router_escalate`
- `router_checkpoint`
- `router_budget`

## Integration with team-runner

When `./opencode-team-run ... --execute` calls `opencode run` without an explicit `--model`, P5 asks the router for a model. The router may also change the effective agent for escalation cases, such as MiniMax exceeding its cheap attempt limit.

To disable this behavior:

```json
{
  "runtime": {
    "router": {
      "enabled": false
    }
  }
}
```

## Customizing model IDs

Edit `.opencode/team/router/model-registry.json`:

```json
{
  "models": {
    "minimax-m2.7": {
      "opencodeModel": "minimax/minimax-m2.7"
    },
    "gpt-5.5": {
      "opencodeModel": "openai/gpt-5.5"
    }
  }
}
```

The alias is what the router uses. `opencodeModel` is what gets passed to `opencode run --model`.

## Budget behavior

By default, cost fields are zero because providers differ in how they report token usage. You can still use the router as a premium-call limiter.

Set hard limits in `.opencode/team/router/policy.json`:

```json
{
  "budget": {
    "premiumCallsHardLimit": 20,
    "dailyHardLimit": 5.0
  }
}
```

Hard limits cause premium routes to fall back when a safe fallback exists. Soft limits only appear as warnings.
