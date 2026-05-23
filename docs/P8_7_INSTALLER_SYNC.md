# P8.7 Installer / README Sync

P8.7 synchronizes the package README and installer behavior.

Key points:

- Default branch is `master`.
- Remote install URL uses `https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh`.
- Bootstrap checkout is force-aligned to the remote branch to recover from diverged local cache repositories.
- Interactive installer starts with language selection.
- Users can choose Context7, LSP, browser dependencies, and model configuration.
- If Context7 is enabled interactively, the installer asks for a Context7 API key.
- Model wizard reads current OpenCode config and lets the user choose which model handles each runtime function.
