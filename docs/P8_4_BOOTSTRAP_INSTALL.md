# P8.5 GitHub Bootstrap Install

P8.5 changes distribution from a local zip workflow to a GitHub-first workflow.

## User install command

After pushing the repository to GitHub, users can install with:

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

The script detects whether it is running from a real checkout. If not, it clones or updates:

```text
~/.local/share/opencode-team-runtime
```

Then it re-executes the checked-out `install.sh` from that directory.

## What the installer does

- Detects the OpenCode global config/runtime directory.
- Copies reusable runtime files to the global config directory:
  - `agents/`
  - `command/`
  - `plugins/`
  - `mcp/`
  - `scripts/`
  - `skills/`
  - `browser-extension/`
- Installs runtime npm dependencies such as `@opencode-ai/plugin`.
- Merges MCP entries into `opencode.jsonc`.
- Optionally enables Context7 MCP.
- Optionally enables LSP and installs common LSP packages.
- Optionally installs CloakBrowser/Playwright browser dependencies.
- Optionally runs the model configuration wizard.

## OpenCode config path detection

Resolution order:

1. `OPENCODE_CONFIG_DIR`
2. `--config-dir DIR`
3. Existing `$XDG_CONFIG_HOME/opencode`
4. Existing `~/.config/opencode`
5. Existing `~/Library/Application Support/opencode`
6. Default `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`

## Context7

The installer writes this config when Context7 is enabled:

```jsonc
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true,
      "headers": {
        "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
      }
    }
  }
}
```

The `headers` block is only added if `CONTEXT7_API_KEY` exists at install time.

## LSP

The installer can set:

```jsonc
{
  "lsp": true,
  "permission": {
    "lsp": "allow"
  }
}
```

It also runs:

```bash
opencode-team install-lsp --profile common --yes
```

Common packages include TypeScript, Pyright, Bash language server, JSON/CSS/HTML/ESLint language servers, YAML, Dockerfile, and Tailwind language server. If `go` or `rustup` are available, it also attempts to install `gopls` and `rust-analyzer`.

Some OpenCode built-ins still need external toolchains such as .NET SDK, Java 21+, Dart, Elixir, Swift/Xcode, Nix, OCaml, Julia, and language-specific project dependencies.

## Model wizard

Run anytime:

```bash
opencode-team configure-models
```

It asks for:

- MiniMax coder model
- Strong planner/reviewer model
- Long-context handoff model
- Premium auditor/checkpoint model

It writes:

```text
~/.config/opencode/team/router/model-registry.json
~/.config/opencode/team/router/policy.json
~/.config/opencode/opencode.jsonc
```

New projects initialized with `opencode-team init` inherit the global model registry.

## Non-interactive install

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash -s -- --yes --no-configure-models
```

Useful options:

```text
--repo-url URL
--branch REF
--install-root DIR
--config-dir DIR
--bin-dir DIR
--context7 / --no-context7
--lsp / --no-lsp
--browser-deps / --no-browser-deps
--configure-models / --no-configure-models
```
