#!/usr/bin/env bash
set -euo pipefail

VERSION="P8.10"
DEFAULT_REPO_URL="https://github.com/szh1118/opencode-team-runtime.git"
REPO_URL="${OPENCODE_TEAM_REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${OPENCODE_TEAM_BRANCH:-master}"
INSTALL_ROOT="${OPENCODE_TEAM_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode-team-runtime}"
BIN_DIR="${OPENCODE_TEAM_BIN:-$HOME/.local/bin}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
GLOBAL_CONFIG="${OPENCODE_CONFIG_DIR:-}"
YES=0
INSTALL_LSP=1
INSTALL_BROWSER_DEPS=1
CONFIGURE_MODELS=auto
SKIP_CLONE=0
SKIP_NPM="${OPENCODE_TEAM_SKIP_NPM:-0}"
LANG_CHOICE="${OPENCODE_TEAM_LANG:-auto}"
LSP_EXPLICIT=0
BROWSER_EXPLICIT=0
MODELS_EXPLICIT=0

usage() {
  cat <<EOF
opencode-team-runtime installer $VERSION

Usage:
  ./install.sh [options]
  curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash

Options:
  --yes, -y                    Non-interactive mode: keep default installs, skip model wizard
  --lang zh|en                 Installer language. Default: ask in interactive mode
  --repo-url URL               Git repo URL. Default: $DEFAULT_REPO_URL
  --branch REF                 Git branch/tag/ref. Default: master
  --install-root DIR           Clone/update repo here when bootstrap mode is used
  --config-dir DIR             OpenCode global config/runtime dir. Default: auto-detect
  --bin-dir DIR                CLI wrapper dir. Default: ~/.local/bin
  --lsp / --no-lsp             Enable/disable LSP config and common LSP dependency install. Default: enabled
  --browser-deps / --no-browser-deps
                               Install/skip CloakBrowser + Playwright deps. Default: enabled
  --configure-models / --no-configure-models
                                Run/skip workflow and role model configuration after install
  --skip-npm                   Do not run npm install; useful for offline packaging tests
  --help                       Show this help

Environment:
  OPENCODE_CONFIG_DIR          Override OpenCode global config dir
  OPENCODE_TEAM_REPO_URL       Override clone URL
  OPENCODE_TEAM_BRANCH         Override branch/ref
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --lang|--repo-url|--branch|--install-root|--config-dir|--bin-dir)
      if [[ $# -lt 2 || "${2:-}" == --* ]]; then
        echo "Missing value for option: $1" >&2
        usage
        exit 2
      fi
      case "$1" in
        --lang) LANG_CHOICE="$2" ;;
        --repo-url) REPO_URL="$2" ;;
        --branch) BRANCH="$2" ;;
        --install-root) INSTALL_ROOT="$2" ;;
        --config-dir) GLOBAL_CONFIG="$2" ;;
        --bin-dir) BIN_DIR="$2" ;;
      esac
      shift
      ;;
    --lsp) INSTALL_LSP=1; LSP_EXPLICIT=1 ;;
    --no-lsp) INSTALL_LSP=0; LSP_EXPLICIT=1 ;;
    --browser-deps) INSTALL_BROWSER_DEPS=1; BROWSER_EXPLICIT=1 ;;
    --no-browser-deps) INSTALL_BROWSER_DEPS=0; BROWSER_EXPLICIT=1 ;;
    --configure-models) CONFIGURE_MODELS=1; MODELS_EXPLICIT=1 ;;
    --no-configure-models) CONFIGURE_MODELS=0; MODELS_EXPLICIT=1 ;;
    --skip-clone) SKIP_CLONE=1 ;;
    --skip-npm) SKIP_NPM=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

have() { command -v "$1" >/dev/null 2>&1; }

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

select_option() {
  local prompt="$1"; local __var="$2"; local default="${3:-1}"; shift 3 || true
  if ! tty_available; then printf -v "$__var" '%s' "$default"; return 0; fi
  printf "%s\n" "$prompt" >&9
  local i=1
  for opt in "$@"; do printf "  %s) %s\n" "$i" "$opt" >&9; i=$((i+1)); done
  local answer
  read_tty_line answer "  [$default] " || true
  printf -v "$__var" '%s' "${answer:-$default}"
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
  local ans
  select_option "请选择安装语言 / Select installer language:" ans "1" "中文" "English"
  case "${ans:-1}" in
    2) LANG_CHOICE="en" ;;
    *) LANG_CHOICE="zh" ;;
  esac
  echo "" >&9
}

msg() {
  local zh="$1" en="${2:-$1}"
  if [[ "$LANG_CHOICE" == "en" ]]; then echo "$en"; else echo "$zh"; fi
}

choose_language

# Bootstrap mode: when this script is executed through curl|bash, .opencode will not exist next to it.
RAW_SRC="${BASH_SOURCE[0]:-$0}"
SRC_DIR="$(cd "$(dirname "$RAW_SRC")" 2>/dev/null && pwd 2>/dev/null || pwd)"
if [[ ! -d "$SRC_DIR/.opencode" && "$SKIP_CLONE" != "1" ]]; then
  if ! have git; then
    echo "git is required to clone $REPO_URL" >&2
    exit 1
  fi
  clone_fresh() {
    rm -rf "$INSTALL_ROOT"
    msg "正在克隆 $REPO_URL#$BRANCH 到 $INSTALL_ROOT" "Cloning $REPO_URL#$BRANCH into $INSTALL_ROOT"
    if ! git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_ROOT"; then
      msg "分支/引用 '$BRANCH' 不存在，改用仓库默认分支重试。" "Branch/ref '$BRANCH' not found; retrying repository default branch." >&2
      rm -rf "$INSTALL_ROOT"
      git clone --depth 1 "$REPO_URL" "$INSTALL_ROOT"
    fi
  }

  if [[ -d "$INSTALL_ROOT/.git" ]]; then
    msg "正在更新已有缓存仓库：$INSTALL_ROOT" "Updating existing checkout: $INSTALL_ROOT"
    git -C "$INSTALL_ROOT" remote set-url origin "$REPO_URL" || true
    if git -C "$INSTALL_ROOT" fetch origin "$BRANCH" --depth 1 --tags --prune; then
      git -C "$INSTALL_ROOT" checkout -B "$BRANCH" FETCH_HEAD
      git -C "$INSTALL_ROOT" reset --hard FETCH_HEAD
      git -C "$INSTALL_ROOT" clean -fd
    else
      msg "缓存仓库无法获取目标分支，正在重建缓存。" "Cached checkout cannot fetch target ref; rebuilding cache."
      clone_fresh
    fi
  else
    clone_fresh
  fi

  if [[ ! -f "$INSTALL_ROOT/install.sh" || ! -d "$INSTALL_ROOT/.opencode" ]]; then
    msg "缓存仓库缺少 install.sh 或 .opencode，正在重建缓存。" "Cached checkout is missing install.sh or .opencode; rebuilding cache."
    clone_fresh
  fi

  if [[ ! -f "$INSTALL_ROOT/install.sh" ]]; then
    msg "错误：checkout 后仍然找不到 $INSTALL_ROOT/install.sh" "Error: $INSTALL_ROOT/install.sh is still missing after checkout." >&2
    exit 1
  fi

  REEXEC_ARGS=(--skip-clone --repo-url "$REPO_URL" --branch "$BRANCH" --install-root "$INSTALL_ROOT" --bin-dir "$BIN_DIR" --lang "$LANG_CHOICE")
  [[ "$YES" == "1" ]] && REEXEC_ARGS+=(--yes)
  if [[ "$LSP_EXPLICIT" == "1" ]]; then [[ "$INSTALL_LSP" == "1" ]] && REEXEC_ARGS+=(--lsp) || REEXEC_ARGS+=(--no-lsp); fi
  if [[ "$BROWSER_EXPLICIT" == "1" ]]; then [[ "$INSTALL_BROWSER_DEPS" == "1" ]] && REEXEC_ARGS+=(--browser-deps) || REEXEC_ARGS+=(--no-browser-deps); fi
  if [[ "$MODELS_EXPLICIT" == "1" ]]; then [[ "$CONFIGURE_MODELS" == "1" ]] && REEXEC_ARGS+=(--configure-models) || REEXEC_ARGS+=(--no-configure-models); fi
  [[ -n "${GLOBAL_CONFIG:-}" ]] && REEXEC_ARGS+=(--config-dir "$GLOBAL_CONFIG")
  [[ "$SKIP_NPM" == "1" ]] && REEXEC_ARGS+=(--skip-npm)
  exec bash "$INSTALL_ROOT/install.sh" "${REEXEC_ARGS[@]}"
fi

if [[ ! -d "$SRC_DIR/.opencode" ]]; then
  echo "Could not find runtime sources at $SRC_DIR/.opencode" >&2
  exit 1
fi

# Auto-detect OpenCode global config/runtime path.
if [[ -z "${GLOBAL_CONFIG:-}" ]]; then
  candidates=(
    "$CONFIG_HOME/opencode"
    "$HOME/.config/opencode"
    "$HOME/.local/share/opencode"
    "$HOME/Library/Application Support/opencode"
  )
  for c in "${candidates[@]}"; do
    if [[ -d "$c" || -f "$c/opencode.json" || -f "$c/opencode.jsonc" ]]; then
      GLOBAL_CONFIG="$c"
      break
    fi
  done
  GLOBAL_CONFIG="${GLOBAL_CONFIG:-$CONFIG_HOME/opencode}"
fi

mkdir -p "$GLOBAL_CONFIG"
if [[ -e "$BIN_DIR" && ! -d "$BIN_DIR" ]]; then
  echo "ERROR: CLI wrapper path exists but is not a directory: $BIN_DIR" >&2
  exit 1
fi
mkdir -p "$BIN_DIR"

echo "Installing opencode-team-runtime $VERSION"
echo "Source: $SRC_DIR"
echo "OpenCode global config/runtime: $GLOBAL_CONFIG"
echo "CLI wrappers: $BIN_DIR"

for required in \
  "$SRC_DIR/.opencode/scripts/global-cli.mjs" \
  "$SRC_DIR/.opencode/plugins/team-runtime.js" \
  "$SRC_DIR/.opencode/mcp/overnight-mcp.mjs" \
  "$SRC_DIR/.opencode/agents/a-zone-coder.md" \
  "$SRC_DIR/.opencode/agents/chief-engineer.md"; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: required runtime file is missing: $required" >&2
    echo "The checkout/cache is incomplete. Remove $INSTALL_ROOT and retry." >&2
    exit 1
  fi
done

if ! have node; then
  echo "Node.js is required. Install Node.js 18+ first." >&2
  exit 1
fi
if ! have npm; then
  echo "npm is required. Install npm first." >&2
  exit 1
fi

copy_dir_merge() {
  local name="$1"
  [[ -d "$SRC_DIR/.opencode/$name" ]] || return 0
  mkdir -p "$GLOBAL_CONFIG/$name"
  cp -R "$SRC_DIR/.opencode/$name/." "$GLOBAL_CONFIG/$name/"
}

# Merge namespaced runtime files without deleting user-owned global OpenCode files.
# OpenCode supports both singular and plural dirs, but plural is preferred in docs.
for d in agents command commands plugins mcp scripts skills browser-extension; do
  copy_dir_merge "$d"
done

mkdir -p "$GLOBAL_CONFIG/opencode-team-runtime-docs"
cp -R "$SRC_DIR/docs/." "$GLOBAL_CONFIG/opencode-team-runtime-docs/"
cp "$SRC_DIR/.opencode/package.json" "$GLOBAL_CONFIG/package.json"

# Install required runtime dependency. Optional browser deps are handled below.
if [[ "$SKIP_NPM" == "1" ]]; then
  echo "Skipping npm install because --skip-npm or OPENCODE_TEAM_SKIP_NPM=1 was set."
else
  echo "Installing runtime npm dependencies..."
  npm --prefix "$GLOBAL_CONFIG" install --omit=optional >/dev/null
fi

if can_prompt; then
  if [[ "$LSP_EXPLICIT" != "1" ]]; then
    ans_lsp=""
    msg "是否启用 OpenCode LSP 并安装常用语言服务器？" "Enable OpenCode LSP and install common language servers?" >&9
    if [[ "$LANG_CHOICE" == "en" ]]; then
      select_option "" ans_lsp "1" "Yes (recommended)" "No"
    else
      select_option "" ans_lsp "1" "是 (推荐)" "否"
    fi
    INSTALL_LSP=$([[ "$ans_lsp" == "2" ]] && echo "0" || echo "1")
  fi
  if [[ "$BROWSER_EXPLICIT" != "1" ]]; then
    ans_browser=""
    msg "是否安装 CloakBrowser / Playwright 浏览器依赖？" "Install CloakBrowser / Playwright browser dependencies?" >&9
    if [[ "$LANG_CHOICE" == "en" ]]; then
      select_option "" ans_browser "1" "Yes (recommended)" "No"
    else
      select_option "" ans_browser "1" "是 (推荐)" "否"
    fi
    INSTALL_BROWSER_DEPS=$([[ "$ans_browser" == "2" ]] && echo "0" || echo "1")
  fi
fi

if [[ "$CONFIGURE_MODELS" == "auto" ]] && can_prompt; then
  ans_cfg=""
  msg "现在配置团队工作流和各岗位使用的模型？" "Configure team workflow mode and role models now?" >&9
  if [[ "$LANG_CHOICE" == "en" ]]; then
    select_option "" ans_cfg "2" "Yes" "No (skip)"
  else
    select_option "" ans_cfg "2" "是" "否 (跳过)"
  fi
  CONFIGURE_MODELS=$([[ "$ans_cfg" == "1" ]] && echo "1" || echo "0")
fi

CONFIG_FILE="$GLOBAL_CONFIG/opencode.jsonc"
if [[ -f "$CONFIG_FILE" ]]; then
  cp "$CONFIG_FILE" "$CONFIG_FILE.bak.$(date +%Y%m%d%H%M%S)"
fi

INSTALL_LSP="$INSTALL_LSP" node --input-type=module - "$CONFIG_FILE" "$GLOBAL_CONFIG" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [configFile, globalConfig] = process.argv.slice(2);
const installLsp = process.env.INSTALL_LSP === '1';
function stripJsonc(input) {
  let out = '', inString = false, quote = '', esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (inString) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) inString = false; continue; }
    if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < input.length && input[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
function readConfig(file) {
  if (!fs.existsSync(file)) return { $schema: 'https://opencode.ai/config.json' };
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return { $schema: 'https://opencode.ai/config.json' };
  try { return JSON.parse(stripJsonc(raw)); }
  catch (err) {
    const broken = `${file}.unparsed.${Date.now()}`;
    fs.copyFileSync(file, broken);
    console.error(`Could not parse ${file}; saved copy to ${broken} and replacing with managed JSONC. Error: ${err.message}`);
    return { $schema: 'https://opencode.ai/config.json' };
  }
}
const cfg = readConfig(configFile);
cfg.$schema ||= 'https://opencode.ai/config.json';
cfg.plugin ||= [];
const teamPlugin = path.join(globalConfig, 'plugins', 'team-runtime.js');
if (!cfg.plugin.some((item) => (Array.isArray(item) ? item[0] : item) === teamPlugin)) cfg.plugin.push(teamPlugin);
cfg.mcp ||= {};
const nodeCmd = 'node';
const mcp = (file, env = {}) => ({
  type: 'local',
  command: [nodeCmd, path.join(globalConfig, 'mcp', file)],
  enabled: true,
  environment: { TEAM_PROJECT_ROOT: '.', OPENCODE_TEAM_RUNTIME_ROOT: globalConfig, ...env },
});
cfg.mcp.cloakbrowser = mcp('cloakbrowser-mcp.mjs', {
  CLOAKBROWSER_HEADLESS: 'false',
  CLOAKBROWSER_HUMANIZE: 'true',
  CLOAKBROWSER_PROFILE_DIR: '.opencode/team/browser/profile',
  CLOAKBROWSER_MANUAL_TIMEOUT_MS: '600000',
});
cfg.mcp['browser-bridge'] = mcp('browser-bridge-mcp.mjs', { OPENCODE_BROWSER_BRIDGE_PORT: '37987', OPENCODE_BROWSER_BRIDGE_TOKEN: 'dev-local' });
cfg.mcp.research = mcp('research-mcp.mjs');
cfg.mcp.context = mcp('context-mcp.mjs');
cfg.mcp.router = mcp('router-mcp.mjs');
cfg.mcp.memory = mcp('memory-mcp.mjs');
cfg.mcp.patch = mcp('patch-mcp.mjs');
cfg.mcp.overnight = mcp('overnight-mcp.mjs');
if (installLsp) {
  cfg.lsp = cfg.lsp === false ? true : (cfg.lsp ?? true);
  cfg.permission ||= {};
  cfg.permission.lsp ||= 'allow';
}
fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n');
NODE

# Generate CLI wrappers using Node instead of shell redirection.
# This avoids fragile here-doc failures when ~/.local/bin is missing,
# a broken symlink, or recreated during installation.
BIN_DIR="$BIN_DIR" GLOBAL_CONFIG="$GLOBAL_CONFIG" node --input-type=module <<'NODE_WRAPPERS'
import fs from 'node:fs';
import path from 'node:path';

const binDir = process.env.BIN_DIR;
const globalConfig = process.env.GLOBAL_CONFIG;
if (!binDir) throw new Error('BIN_DIR is empty');
if (!globalConfig) throw new Error('GLOBAL_CONFIG is empty');

if (fs.existsSync(binDir)) {
  const st = fs.lstatSync(binDir);
  if (!st.isDirectory()) {
    throw new Error(`CLI wrapper path exists but is not a directory: ${binDir}`);
  }
}
fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });

const cli = path.join(globalConfig, 'scripts', 'global-cli.mjs');
if (!fs.existsSync(cli)) {
  throw new Error(`Missing global CLI entrypoint: ${cli}`);
}

const wrappers = [
  ['opencode-team', ''],
  ['opencode-desktop-doctor', 'doctor'],
  ['opencode-team-run', 'run'],
  ['opencode-browser', 'browser'],
  ['opencode-chrome-bridge', 'chrome-bridge'],
  ['opencode-research', 'research'],
  ['opencode-context', 'context'],
  ['opencode-router', 'router'],
  ['opencode-memory', 'memory'],
  ['opencode-patch', 'patch'],
  ['opencode-overnight', 'overnight'],
];

for (const [name, subcmd] of wrappers) {
  const target = path.join(binDir, name);
  const body = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `exec node ${JSON.stringify(cli)}${subcmd ? ` ${subcmd}` : ''} "$@"`,
    '',
  ].join('\n');
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, body, { mode: 0o755 });
  fs.renameSync(tmp, target);
  fs.chmodSync(target, 0o755);
}
NODE_WRAPPERS

cat > "$GLOBAL_CONFIG/opencode-team-runtime.env" <<EOF_ENV
OPENCODE_TEAM_VERSION=$VERSION
OPENCODE_TEAM_GLOBAL_CONFIG=$GLOBAL_CONFIG
OPENCODE_TEAM_BIN=$BIN_DIR
OPENCODE_TEAM_REPO_URL=$REPO_URL
OPENCODE_TEAM_BRANCH=$BRANCH
EOF_ENV

if [[ "$INSTALL_BROWSER_DEPS" == "1" ]]; then
  node "$GLOBAL_CONFIG/scripts/global-cli.mjs" install-browser-deps
fi
if [[ "$INSTALL_LSP" == "1" ]]; then
  if [[ "$SKIP_NPM" == "1" ]]; then
    echo "Skipping common LSP package install because --skip-npm or OPENCODE_TEAM_SKIP_NPM=1 was set. OpenCode LSP config is still enabled."
  else
    node "$GLOBAL_CONFIG/scripts/global-cli.mjs" install-lsp --yes || true
  fi
fi
if [[ "$CONFIGURE_MODELS" == "1" ]]; then
  echo "" >&9
  wf_mode="all-in-one" ans_wf=""
  msg "选择工作流模式:" "Select workflow mode:" >&9
  if [[ "$LANG_CHOICE" == "en" ]]; then
    select_option "" ans_wf "1" "All in one - Desktop one-click entrusted (recommended)" "Lean - lighter process" "Research-heavy - enhanced research"
  else
    select_option "" ans_wf "1" "All in one - Desktop 一键托管 (推荐)" "Lean - 精简流程" "Research-heavy - 强化研究"
  fi
  case "${ans_wf:-1}" in
    2) wf_mode="lean" ;;
    3) wf_mode="research-heavy" ;;
    *) wf_mode="all-in-one" ;;
  esac

  worker_model="" supervisor_model="" handoff_model="" checkpoint_model=""
  read_tty_line worker_model "A-zone 编码模型 [minimax/minimax-m2.7]: " || true
  worker_model="${worker_model:-minimax/minimax-m2.7}"
  read_tty_line supervisor_model "总工/审核模型 [deepseek/deepseek-v4-pro]: " || true
  supervisor_model="${supervisor_model:-deepseek/deepseek-v4-pro}"
  read_tty_line handoff_model "长上下文交接/研究综合模型 [qwen/qwen3.7-max]: " || true
  handoff_model="${handoff_model:-qwen/qwen3.7-max}"
  read_tty_line checkpoint_model "最终审计模型 [openai/gpt-5.5]: " || true
  checkpoint_model="${checkpoint_model:-openai/gpt-5.5}"

  printf '%s\n%s\n%s\n%s\n%s\n' "$wf_mode" "$worker_model" "$supervisor_model" "$handoff_model" "$checkpoint_model" | node "$GLOBAL_CONFIG/scripts/global-cli.mjs" configure-models || true
fi

PATH_OK=0
IFS=':' read -ra PATH_PARTS <<< "${PATH:-}"
for p in "${PATH_PARTS[@]}"; do [[ "$p" == "$BIN_DIR" ]] && PATH_OK=1; done

echo ""
echo "Installed opencode-team-runtime $VERSION globally."
echo "Global OpenCode config/runtime: $GLOBAL_CONFIG"
echo "Global CLI wrappers: $BIN_DIR"
echo "Updated: $CONFIG_FILE"
echo ""
echo "Desktop usage: open any project in OpenCode Desktop and run /team-overnight or /team-plan."
echo "One-time workflow/model wizard: opencode-team configure-models"
echo "Project state, when needed: opencode-team init /path/to/project"
echo "Chrome bridge: opencode-team chrome-bridge serve, then load $GLOBAL_CONFIG/browser-extension in Chrome."
if [[ "$INSTALL_LSP" == "1" ]]; then
  echo "LSP note: OpenCode lsp=true is configured. For the experimental lsp tool, launch OpenCode with OPENCODE_EXPERIMENTAL_LSP_TOOL=true."
fi
if [[ "$PATH_OK" != "1" ]]; then
  echo ""
  echo "NOTE: $BIN_DIR is not in PATH. Add this to your shell rc if needed:"
  echo "  export PATH="$BIN_DIR:\$PATH""
fi
