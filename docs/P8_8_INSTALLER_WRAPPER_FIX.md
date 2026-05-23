# P8.9 Installer Wrapper Fix

P8.9 fixes the installer failure:

```text
/home/a/.local/share/opencode-team-runtime/install.sh: 行 370: /home/a/.local/bin/opencode-team-run: 没有那个文件或目录
```

Changes:

- Create `$BIN_DIR` before writing CLI wrappers.
- Validate that `$BIN_DIR` is not an existing regular file.
- Validate required runtime files before npm/dependency installation.
- Keep default branch as `master`.
- Keep force-reset checkout behavior for bootstrap cache updates.
