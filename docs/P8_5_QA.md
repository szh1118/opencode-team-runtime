# P8.5 QA Notes

P8.5 was adjusted after checking the uploaded `opencode-dev` source tree.

Key fixes:

- Global install now merges files into `~/.config/opencode` instead of deleting existing `agents/`, `commands/`, `plugins/`, `mcp/`, `scripts/`, or `skills/` directories.
- Slash commands are installed under both `command/` and `commands/`; OpenCode supports both, while docs prefer plural directories.
- The installer now explicitly adds the server plugin path to global `opencode.jsonc` via the `plugin` array. Auto-discovery alone is not enough for all load paths.
- Config path detection includes the legacy `~/.local/share/opencode` path mentioned in troubleshooting docs.
- Context7 remains configured as a remote MCP server at `https://mcp.context7.com/mcp` with optional `CONTEXT7_API_KEY` header.
- LSP remains enabled through OpenCode config and optional dependency installation. OpenCode itself can auto-download several built-in LSP servers unless `OPENCODE_DISABLE_LSP_DOWNLOAD=true` is set.

Desktop users still install once globally:

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

Then run commands inside OpenCode Desktop:

```text
/team-overnight your idea
/team-plan your idea
/team-step
/team-review
/team-handoff
/team-audit
```
