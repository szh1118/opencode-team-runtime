# P8.10 TTY Installer Fix

P8.10 fixes interactive installation under `curl | bash`.

When a script is piped into bash, stdin is the script stream, not the user terminal. Older installers treated that as non-interactive and skipped language selection, Context7 API key input, feature toggles, and the model wizard.

P8.10 reads prompts from `/dev/tty` when available, while still supporting non-interactive `--yes` mode and CI environments without a TTY.

Key behavior:

- `curl | bash` prompts language from `/dev/tty`.
- Context7 installation asks for an API key from `/dev/tty`.
- LSP/browser/model configuration prompts work after bootstrap re-exec.
- `--yes` remains non-interactive.
- No-TTY environments fall back to safe defaults.
