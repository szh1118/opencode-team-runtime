# P4 Context Compression / Evidence Retrieval

P4 adds a deterministic context layer for opencode-team-runtime.

The goal is to stop long sessions from feeding raw logs, raw browser artifacts, or raw research chunks directly into weak/cheap models. P4 builds a local index and produces compact context packs that can be consumed by chief/reviewer/coder agents.

## Files

```text
.opencode/scripts/context-runner.mjs      # CLI runner
.opencode/mcp/context-mcp.mjs             # MCP tools
.opencode/agents/context-curator.md       # subagent prompt
.opencode/agents/log-compressor.md        # subagent prompt
.opencode/team/context/index.json         # local retrieval index
.opencode/team/context/config.json        # compression config
.opencode/team/context/current-pack.md    # latest generated context pack
.opencode/team/context/packs/*.md         # archived packs
```

## CLI

Refresh the index:

```bash
./opencode-context ingest --all
```

Search relevant context:

```bash
./opencode-context search "failed browser login test console error" --limit 8
```

Generate a pack for a task/review/handoff:

```bash
./opencode-context pack "current goal failed attempts next task evidence" --max-chars 16000
```

Generate a full project snapshot:

```bash
./opencode-context snapshot
```

Compress a noisy log:

```bash
./opencode-context compact-shell --file .opencode/team/sessions/some-run.log --max-chars 8000
```

## MCP tools

- `context_status`
- `context_ingest`
- `context_search`
- `context_pack`
- `context_compress_text`
- `context_add_text`

## Design

P4 indexes these artifacts:

- `.opencode/team/handoff.md`
- `.opencode/team/evidence.md`
- `.opencode/team/state.json`
- `.opencode/team/task-dag.json`
- `.opencode/team/events.jsonl`
- `.opencode/team/sessions/*`
- `.opencode/team/browser/*`
- `.opencode/team/research/*`

It uses deterministic rules:

1. Prune JSON to important keys.
2. Keep important shell/browser/research lines.
3. Chunk compressed documents.
4. Score chunks using lexical overlap plus kind-specific boosts.
5. Render retrieved snippets into `.opencode/team/context/current-pack.md`.

P4 intentionally does **not** claim semantic certainty. It is a retrieval/compression layer, not a verifier. Completion still requires P0/P3 evidence gates.

## Recommended usage in agents

Before review:

```text
context_ingest(all=true)
context_pack(query="changed files tests failures review evidence", maxChars=16000)
```

Before handoff/rotation:

```text
context_ingest(all=true)
context_pack(query="goal current state done failed attempts next task blockers", maxChars=20000)
```

When a weak coder needs context:

```text
context_pack(query="only the files and errors relevant to task TASK-ID", maxChars=8000)
```

Never give MiniMax raw logs when a context pack or compressed log is available.
