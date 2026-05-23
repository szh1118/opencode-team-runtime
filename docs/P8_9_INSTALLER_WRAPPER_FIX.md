# P8.9 Installer Wrapper Fix

P8.9 fixes a wrapper generation failure seen on Linux systems during `curl | bash` installation:

```text
/home/a/.local/share/opencode-team-runtime/install.sh: line 393: /home/a/.local/bin/opencode-team-run: No such file or directory
```

Changes:

- Replaced shell here-doc wrapper generation with a Node-based writer.
- The writer creates the CLI wrapper directory with `fs.mkdirSync(..., { recursive: true })`.
- Wrapper files are written atomically via temporary files and `renameSync`.
- The installer checks that `global-cli.mjs` exists before creating wrappers.
- Version strings were synchronized to P8.9.

Smoke-tested with a missing `~/.local/bin` equivalent and `--skip-clone --yes --skip-npm`.
