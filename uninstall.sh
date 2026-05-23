#!/usr/bin/env bash
set -euo pipefail

VERSION="P8.10"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
GLOBAL_CONFIG="${OPENCODE_CONFIG_DIR:-${CONFIG_HOME}/opencode}"
BIN_DIR="${OPENCODE_TEAM_BIN:-$HOME/.local/bin}"
INSTALL_ROOT="${OPENCODE_TEAM_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode-team-runtime}"
YES=0
CLEAN_ALL_PROJECTS=0
REMOVE_CLONE=0
REMOVE_DEPS=0
LANG_CHOICE="${OPENCODE_TEAM_LANG:-auto}"

usage() {
  cat <<EOF
opencode-team-runtime uninstaller $VERSION

Usage:
  ./uninstall.sh [options]

Options:
  --yes, -y                    Skip confirmation prompts
  --lang zh|en                 Language. Default: ask
  --config-dir DIR             OpenCode global config dir
  --bin-dir DIR                CLI wrapper directory
  --install-root DIR           Cloned repo directory
  --project-state-repo DIR     Look under this repo root for project .opencode/team/ state
  --remove-project-state       Remove .opencode/team/ dirs from all projects found under \$HOME/code
  --remove-clone               Also remove the cloned repo at --install-root
  --remove-deps                Also uninstall npm global runtime deps
  --help                       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --lang) LANG_CHOICE="$2"; shift ;;
    --config-dir) GLOBAL_CONFIG="$2"; shift ;;
    --bin-dir) BIN_DIR="$2"; shift ;;
    --install-root) INSTALL_ROOT="$2"; shift ;;
    --remove-project-state) CLEAN_ALL_PROJECTS=1 ;;
    --remove-clone) REMOVE_CLONE=1 ;;
    --remove-deps) REMOVE_DEPS=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

TTY_DEVICE="${OPENCODE_TEAM_TTY:-/dev/tty}"
TTY_FD_OPEN=0
if [[ -r "$TTY_DEVICE" && -w "$TTY_DEVICE" ]]; then
  { exec 9<>"$TTY_DEVICE"; } 2>/dev/null && TTY_FD_OPEN=1 || TTY_FD_OPEN=0
fi
tty_available() { [[ "$TTY_FD_OPEN" == "1" ]]; }
can_prompt() { [[ "$YES" != "1" ]] && tty_available; }

read_tty_line() {
  local __var="$1" prompt="${2:-}" answer=""
  if ! tty_available; then
    printf -v "$__var" '%s' ""
    return 1
  fi
  [[ -n "$prompt" ]] && printf "%s" "$prompt" >&9
  IFS= read -r -u 9 answer || answer=""
  printf -v "$__var" '%s' "$answer"
}

ask_yes_no() {
  local question="$1" default="${2:-N}" answer
  if ! can_prompt; then
    [[ "$default" =~ ^[Yy]$ ]] && return 0 || return 1
  fi
  read_tty_line answer "$question [$default] " || true
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

msg() {
  local zh="$1" en="${2:-$1}"
  if [[ "$LANG_CHOICE" == "en" ]]; then echo "$en"; else echo "$zh"; fi
}

choose_language() {
  if [[ "$LANG_CHOICE" != "auto" ]]; then
    case "$LANG_CHOICE" in
      zh|zh-CN|cn) LANG_CHOICE="zh" ;;
      en|en-US) LANG_CHOICE="en" ;;
      *) LANG_CHOICE="zh" ;;
    esac
    return 0
  fi
  if ! can_prompt; then
    LANG_CHOICE="zh"
    return 0
  fi
  printf "请选择语言 / Select language:\n  1) 中文\n  2) English\n" >&9
  local answer
  read_tty_line answer "> " || true
  case "${answer:-1}" in
    2|en|EN|English|english) LANG_CHOICE="en" ;;
    *) LANG_CHOICE="zh" ;;
  esac
}

choose_language

CONFIG_FILE="$GLOBAL_CONFIG/opencode.jsonc"
CONFIG_JSON="$GLOBAL_CONFIG/opencode.json"
CFG_FILE=""
if [[ -f "$CONFIG_FILE" ]]; then CFG_FILE="$CONFIG_FILE"
elif [[ -f "$CONFIG_JSON" ]]; then CFG_FILE="$CONFIG_JSON"
fi

echo "============================================"
msg "opencode-team-runtime 卸载器 $VERSION" "opencode-team-runtime uninstaller $VERSION"
echo "============================================"
echo ""

# --- Summary ---
msg "全局配置目录: $GLOBAL_CONFIG" "Global config dir: $GLOBAL_CONFIG"
msg "CLI 包装器目录: $BIN_DIR" "CLI wrapper dir: $BIN_DIR"
[[ "$REMOVE_CLONE" == "1" ]] && msg "也将删除克隆仓库: $INSTALL_ROOT" "Will also remove cloned repo: $INSTALL_ROOT"
[[ "$CLEAN_ALL_PROJECTS" == "1" ]] && msg "也将清理所有项目下的 .opencode/team/" "Will also clean .opencode/team/ under all projects"
echo ""

ask_yes_no_i18n() {
  local zh="$1" en="$2" default="${3:-N}"
  if [[ "$YES" == "1" ]]; then return 0; fi
  if [[ "$LANG_CHOICE" == "en" ]]; then
    ask_yes_no "$en" "$default"
  else
    ask_yes_no "$zh" "$default"
  fi
}

if ! ask_yes_no_i18n "确认卸载 opencode-team-runtime？此操作不可撤销。" "Confirm uninstall of opencode-team-runtime? This cannot be undone." "N"; then
  msg "已取消。" "Cancelled."
  exit 0
fi

removed=0

# --- 1. Remove CLI wrappers ---
if [[ -d "$BIN_DIR" ]]; then
  WRAPPERS=("opencode-team" "opencode-desktop-doctor" "opencode-team-run" "opencode-browser" "opencode-chrome-bridge" "opencode-research" "opencode-context" "opencode-router" "opencode-memory" "opencode-patch" "opencode-overnight")
  for w in "${WRAPPERS[@]}"; do
    if [[ -f "$BIN_DIR/$w" ]]; then
      rm -f "$BIN_DIR/$w"
      removed=$((removed + 1))
      echo "  removed $BIN_DIR/$w"
    fi
  done
fi

# --- 2. Remove runtime directories from global config ---
RUNTIME_DIRS=("agents" "command" "commands" "plugins" "mcp" "scripts" "skills" "browser-extension" "opencode-team-runtime-docs")
for d in "${RUNTIME_DIRS[@]}"; do
  if [[ -d "$GLOBAL_CONFIG/$d" ]]; then
    rm -rf "$GLOBAL_CONFIG/$d"
    echo "  removed $GLOBAL_CONFIG/$d"
  fi
done

if [[ -d "$GLOBAL_CONFIG/team" ]]; then
  rm -rf "$GLOBAL_CONFIG/team"
  echo "  removed $GLOBAL_CONFIG/team"
fi

if [[ -f "$GLOBAL_CONFIG/package.json" ]]; then
  if grep -q "opencode-team-runtime" "$GLOBAL_CONFIG/package.json" 2>/dev/null; then
    rm -f "$GLOBAL_CONFIG/package.json"
    echo "  removed $GLOBAL_CONFIG/package.json"
  fi
fi

if [[ -f "$GLOBAL_CONFIG/opencode-team-runtime.env" ]]; then
  rm -f "$GLOBAL_CONFIG/opencode-team-runtime.env"
  echo "  removed $GLOBAL_CONFIG/opencode-team-runtime.env"
fi

# --- 3. Clean opencode.jsonc ---
if [[ -n "${CFG_FILE:-}" ]] && [[ -f "$CFG_FILE" ]]; then
  echo ""
  msg "清理 $CFG_FILE..." "Cleaning $CFG_FILE..."

  node --input-type=module - "$CFG_FILE" "$GLOBAL_CONFIG" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [cfgFile, globalConfig] = process.argv.slice(2);

function stripJsonc(input) {
  let out = "", inString = false, quote = "", esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (inString) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === quote) inString = false; continue; }
    if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < input.length && input[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

if (!fs.existsSync(cfgFile)) { console.log("Config file not found, skipping cleanup."); process.exit(0); }
const raw = fs.readFileSync(cfgFile, "utf8").trim();
if (!raw) { console.log("Config empty, skipping."); process.exit(0); }

let cfg;
try { cfg = JSON.parse(stripJsonc(raw)); }
catch (err) {
  console.error(`Could not parse ${cfgFile}: ${err.message}. Skipping config cleanup.`);
  process.exit(0);
}

let changed = false;

// Remove team-runtime plugin reference
if (Array.isArray(cfg.plugin)) {
  const teamPlugin = path.join(globalConfig, "plugins", "team-runtime.js");
  const before = cfg.plugin.length;
  cfg.plugin = cfg.plugin.filter((item) => {
    const entry = Array.isArray(item) ? item[0] : item;
    return entry !== teamPlugin && !String(entry).includes("team-runtime");
  });
  if (cfg.plugin.length !== before) { changed = true; console.log("  removed team-runtime plugin entry"); }
  if (!cfg.plugin.length) delete cfg.plugin;
}

// Remove team MCP server entries
const teamMcpKeys = ["cloakbrowser", "browser-bridge", "research", "context", "router", "memory", "patch", "overnight", "context7"];
if (cfg.mcp) {
  for (const key of teamMcpKeys) {
    if (cfg.mcp[key] !== undefined) {
      delete cfg.mcp[key];
      changed = true;
      console.log(`  removed mcp.${key}`);
    }
  }
  if (!Object.keys(cfg.mcp).length) delete cfg.mcp;
}

// Remove team agent overrides
const teamAgents = ["chief-engineer", "overnight-supervisor", "research-scout", "research-reviewer", "a-zone-coder", "minimax-coder", "tester", "browser-actor", "browser-perception", "browser-tester", "browser-bridge-tester", "reviewer", "auditor", "visual-reviewer", "handoff-writer", "model-router", "context-curator", "log-compressor", "memory-curator", "code-archaeologist", "paper-digester", "patch-planner", "patch-reviewer", "patch-applier", "improvement-reviewer"];
if (cfg.agent) {
  for (const key of teamAgents) {
    if (cfg.agent[key] !== undefined) {
      // Only remove if it was set by team-runtime (has model, not just disable)
      if (cfg.agent[key].model || cfg.agent[key].mode) {
        delete cfg.agent[key];
        changed = true;
        console.log(`  removed agent.${key}`);
      }
    }
  }
}

if (cfg.lsp !== undefined && cfg.lsp === true) {
  // Only remove if it was likely set by team-runtime installer
  // (check if permission.lsp exists too)
  if (cfg.permission?.lsp === "allow") {
    delete cfg.permission.lsp;
    if (!Object.keys(cfg.permission).length) delete cfg.permission;
  }
  delete cfg.lsp;
  changed = true;
  console.log("  removed lsp/permission.lsp entries");
}

if (changed) {
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`  saved cleaned ${cfgFile}`);
} else {
  console.log("  no team-runtime entries found in config, skipped");
}
NODE
fi

# --- 4. Remove cloned repo ---
if [[ "$REMOVE_CLONE" == "1" ]] && [[ -d "$INSTALL_ROOT" ]]; then
  rm -rf "$INSTALL_ROOT"
  echo ""
  msg "已删除克隆仓库: $INSTALL_ROOT" "Removed cloned repo: $INSTALL_ROOT"
fi

# --- 5. Remove per-project .opencode/team/ ---
if [[ "$CLEAN_ALL_PROJECTS" == "1" ]]; then
  HOME_CODE="${HOME:-~}/code"
  if [[ -d "$HOME_CODE" ]]; then
    echo ""
    msg "搜索并清理 $HOME_CODE 下的 .opencode/team/ ..." "Searching and cleaning .opencode/team/ under $HOME_CODE ..."
    while IFS= read -r -d '' dir; do
      if [[ -d "$dir" ]]; then
        rm -rf "$dir"
        echo "  removed $dir"
      fi
    done < <(find "$HOME_CODE" -maxdepth 5 -type d -path "*/.opencode/team" -print0 2>/dev/null || true)
  fi
fi

# --- 6. Remove npm global deps if asked ---
if [[ "$REMOVE_DEPS" == "1" ]]; then
  echo ""
  msg "卸载 CloakBrowser / Playwright npm 依赖..." "Uninstalling CloakBrowser / Playwright npm deps..."
  npm uninstall -g cloakbrowser playwright-core 2>/dev/null || true
  echo "  done"
fi

echo ""
msg "============================================" "============================================"
msg "卸载完成。以下内容已清理:" "Uninstall complete. The following were cleaned:"
msg "  - CLI 包装器" "  - CLI wrappers"
msg "  - 全局运行时文件 (agents/commands/mcp/plugins/scripts/skills/docs)" "  - Global runtime files"
msg "  - opencode.jsonc 中的团队配置条目" "  - Team config entries in opencode.jsonc"
[[ "$REMOVE_CLONE" == "1" ]] && msg "  - 克隆仓库" "  - Cloned repo"
[[ "$CLEAN_ALL_PROJECTS" == "1" ]] && msg "  - 项目下的 .opencode/team/" "  - Per-project .opencode/team/"
[[ "$REMOVE_DEPS" == "1" ]] && msg "  - npm 全局浏览器依赖" "  - npm global browser deps"
msg "" ""
msg "未删除的内容:" "What was NOT removed:"
msg "  - 你的 OpenCode 主配置 (除团队条目外)" "  - Your main OpenCode config (except team entries)"
msg "  - 你的 provider/api key 配置" "  - Your provider/api key config"
msg "  - 你的个人 agent/skill/command 定义" "  - Your personal agent/skill/command definitions"
msg "  - Context7 API key (如果你在环境变量里保存的话)" "  - Context7 API key (if stored in env vars)"
msg "  - 项目代码本身" "  - Your project code"
msg "============================================" "============================================"
