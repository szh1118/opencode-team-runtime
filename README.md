# opencode-team-runtime

> P8.10 安装器修复：安装脚本现在支持 `curl | bash` 场景下从 `/dev/tty` 读取交互输入，语言选择、Context7 API Key、功能选择和模型向导不会再被 stdin 管道跳过。 P8.10

**opencode-team-runtime** 是一个面向 OpenCode Desktop 的团队式 agent runtime。它的目标不是让一个模型独自死磕，而是把便宜模型、强模型、浏览器工具、研究工具、上下文压缩、证据审计和 handoff 流程组织起来：

- MiniMax / 便宜模型：做细粒度编码、重复编辑、粗活。
- DeepSeek / Qwen / 强文本模型：做总工规划、普通 review、handoff、长上下文整理。
- GPT / Claude / 其他高端模型：只在最终审计、失败升级、复杂问题诊断时调用。
- CloakBrowser / Chrome Bridge：提供真实浏览器观察、操作、截图、console/network 证据和人工接管。
- Context7 / LSP / Evidence Ledger / Handoff：让 agent 少猜、多查、多验收。

P8.10 是 **全局安装一次 + Desktop-first + GitHub bootstrap + 中英文交互安装 + Context7 Key + LSP/browser deps + 模型配置向导** 版本。

---

## 快速安装

当前仓库默认分支是 `master`，所以安装命令是：

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

也可以先 clone 再安装：

```bash
git clone https://github.com/szh1118/opencode-team-runtime.git
cd opencode-team-runtime
./install.sh
```

安装脚本开头会让用户选择语言：

```text
1) 中文
2) English
```

随后会交互询问：

- 是否启用 Context7 MCP；选择是后必须输入 Context7 API Key。
- 是否启用 OpenCode LSP 并安装常用语言服务器。
- 是否安装 CloakBrowser / Playwright 浏览器依赖。
- 是否运行模型配置向导。

安装器会自动 clone/update 仓库到：

```text
~/.local/share/opencode-team-runtime
```

并把 runtime 安装到 OpenCode 全局配置目录，通常是：

```text
~/.config/opencode
```

如果旧缓存仓库因为 force push 或分支变更出现分叉，P8.10 会强制对齐远端 `master`，必要时自动重建缓存目录。

---

## 常用安装参数

```bash
./install.sh --lang zh
./install.sh --lang en
./install.sh --yes
./install.sh --no-context7
./install.sh --no-lsp
./install.sh --no-browser-deps
./install.sh --configure-models
./install.sh --no-configure-models
./install.sh --branch master
./install.sh --config-dir ~/.config/opencode
./install.sh --install-root ~/.local/share/opencode-team-runtime
```

非交互安装示例：

```bash
CONTEXT7_API_KEY=你的_key \
  curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh \
  | bash -s -- --yes
```

说明：

- 交互模式下，用户可以逐项选择是否安装 Context7 / LSP / browser deps。
- 选择启用 Context7 时，安装脚本会要求输入 Context7 API Key。
- `--yes` 适合无人值守安装，会保留默认启用项，但跳过模型配置向导，避免 stdin 卡住。
- 不想安装某项功能时使用 `--no-context7`、`--no-lsp`、`--no-browser-deps`。

---

## OpenCode Desktop 用法

安装完成后，不需要每个项目再装一遍。打开 OpenCode Desktop，进入任意项目，直接使用 slash command：

```text
/team-overnight 你的 idea
```

也可以分步执行：

```text
/team-plan 你的 idea
/team-step 继续一个小任务
/team-review 检查当前 diff 和 evidence
/team-handoff 更新 handoff，准备清上下文/开新会话
/team-audit 最终审计
/team-browser 浏览器观察/验收
/team-research 做带证据的研究
```

项目自己的状态仍然保存在当前项目目录里：

```text
PROJECT/.opencode/team/
```

这里会保存：

- `handoff.md`
- `evidence.md`
- `task-dag.json`
- `events.jsonl`
- browser artifacts
- research ledger
- context packs
- router decisions
- memory lessons
- patch proposals
- overnight logs

这样 A 项目的证据和 B 项目的证据不会互相污染。

---

## 全局安装目录结构

P8.10 将可复用 runtime 安装到 OpenCode 全局配置目录：

```text
~/.config/opencode/
├── agents/
├── command/
├── commands/
├── plugins/
├── mcp/
├── scripts/
├── skills/
├── browser-extension/
├── team/
└── opencode.jsonc
```

安装器会合并配置，不会删除用户已有的 OpenCode 全局目录。P8.10 会显式把全局插件写入 `opencode.jsonc`：

```json
{
  "plugin": ["/home/you/.config/opencode/plugins/team-runtime.js"]
}
```

同时会合并本项目的 MCP server 配置。

---

## 模型配置向导

安装时可以选择运行模型配置向导，也可以之后手动运行：

```bash
opencode-team configure-models
```

向导会实时读取当前 OpenCode 全局配置：

```text
~/.config/opencode/opencode.jsonc
```

并从里面提取候选模型：

- `model`
- `agent.*.model`
- `provider.*.models`

然后让用户为不同功能选择模型：

```text
cheap worker / 粗活编码
chief engineer / 总工规划
reviewer / 普通审核
handoff / 长上下文整理
premium auditor / 高端审计
deep research / 深度研究
browser perception / 浏览器感知
browser actor / 浏览器动作
tester / 测试
visual reviewer / UI/视觉审核
```

用户可以从候选列表选择，也可以手动输入自定义 `provider/model` ID。

模型配置会写入：

```text
~/.config/opencode/team/router/model-registry.json
~/.config/opencode/team/router/policy.json
~/.config/opencode/opencode.jsonc
```

---

## Context7

安装时选择启用 Context7 后，脚本会要求输入 API Key，并写入全局 OpenCode MCP 配置：

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true,
      "headers": {
        "CONTEXT7_API_KEY": "你的_key"
      }
    }
  }
}
```

如果使用非交互安装，可以先设置环境变量：

```bash
export CONTEXT7_API_KEY=你的_key
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash -s -- --yes
```

不想启用 Context7：

```bash
./install.sh --no-context7
```

---

## LSP

安装时选择启用 LSP 后，安装器会：

1. 在 `opencode.jsonc` 中启用：

```json
{
  "lsp": true,
  "permission": {
    "lsp": "allow"
  }
}
```

2. 尝试安装常用语言服务器，包括但不限于：

```text
TypeScript / JavaScript
Pyright
Bash language server
JSON / HTML / CSS / ESLint / YAML / Dockerfile / Tailwind
Go gopls（系统有 go 时）
Rust rust-analyzer（系统有 rustup 时）
```

如果只想之后手动装：

```bash
opencode-team install-lsp --profile common --yes
opencode-team install-lsp --profile node --yes
opencode-team install-lsp --profile python --yes
opencode-team install-lsp --profile all --yes
```

---

## 浏览器能力

本项目提供两条浏览器路线。

### 1. CloakBrowser / Playwright

适合：

- 本地 web app 测试
- 自动化验收
- console/network 检查
- 截图证据
- 有头浏览器 + 用户手动处理 CAPTCHA / 登录 / 风控

安装依赖：

```bash
opencode-team install-browser-deps
```

常用命令：

```bash
opencode-team browser doctor
opencode-team browser manual https://example.com --mark
opencode-team browser digest https://example.com --mark
opencode-team browser observe http://localhost:3000 --mode all --mark
```

### 2. Chrome Bridge

适合：

- 使用用户真实 Chrome 登录态
- 内部后台、SaaS、已登录网站
- 用户手动接管复杂验证

启动 bridge：

```bash
opencode-team chrome-bridge serve
```

然后在 Chrome 里打开：

```text
chrome://extensions
```

启用 Developer mode，Load unpacked：

```text
~/.config/opencode/browser-extension
```

---

## Deep Research / Claim Evidence

P3 研究模块会把研究过程落成证据账本：

```text
.opencode/team/research/sources.json
.opencode/team/research/claims.json
.opencode/team/research/chunks/*.json
.opencode/team/research/reports/*.md
```

每条 claim 必须绑定 evidence id。没有证据的结论不应该进入最终计划或报告。

常用命令：

```bash
opencode-team research doctor
opencode-team research add-source https://example.com/docs --title "Example docs"
opencode-team research validate
opencode-team research report --topic "Example research"
```

---

## Context Compression

P4 上下文模块会索引并压缩：

```text
handoff.md
evidence.md
task-dag.json
events.jsonl
sessions/*
browser/*
research/*
```

常用命令：

```bash
opencode-team context ingest --all
opencode-team context search "failed browser login test console error"
opencode-team context pack "changed files tests failures review evidence" --max-chars 16000
```

目标是避免主会话直接吞 raw DOM、raw logs、raw transcripts。

---

## Router / Memory / Patch Workflow

### Router

模型路由：

```bash
opencode-team router status
opencode-team router decide --role minimax-coder --attempts 0 --reason "small edit"
opencode-team router checkpoint --kind final-audit --reason "before-done"
```

### Memory

记录失败模式和模型表现：

```bash
opencode-team memory record --kind failure --agent minimax-coder --model minimax-m2.7 --text "claimed complete but implementation missing"
opencode-team memory learn --from all
opencode-team memory suggestions
```

### Patch Workflow

把自我改进建议变成可审查 patch：

```bash
opencode-team patch propose --title "Tighten reviewer evidence rule" --target .opencode/agents/reviewer.md --kind append --text "..."
opencode-team patch validate patch-xxxx
opencode-team patch review patch-xxxx
opencode-team patch approve patch-xxxx --by user
opencode-team patch apply patch-xxxx
```

默认不允许 patch 修改 runtime 核心脚本、插件、MCP、`.env`、`.git`、`node_modules` 等高风险路径。

---

## 模块总览

| 模块 | 作用 |
|---|---|
| P0 Plugin State Layer | OpenCode 插件、状态、证据、handoff、gate |
| P1 Team Runner | task DAG、A/B 区执行与 review 的外部 runner |
| P2 CloakBrowser | 浏览器测试、截图、console/network 证据 |
| P2.5 Browser Perception | raw/reduced/ScreenDigest、元素 ID 动作、人工接管 |
| P2.6 Chrome Bridge | codex-chrome 风格真实 Chrome bridge |
| P3 Deep Research | source/chunk/claim/evidence 研究账本 |
| P4 Context Compression | 上下文索引、压缩、context pack |
| P5 Router | 模型路由、预算、失败升级 |
| P6 Memory | 失败模式、模型质量、改进建议 |
| P7 Patch Workflow | 可审查 patch、自我改进安全闸 |
| P8 Overnight Mode | plan → work → review → evidence → handoff → audit 总流程 |
| P8.10 Installer | master 分支、一键 bootstrap、缓存强制对齐、交互安装 |

---

## 安全边界

默认策略：

- 不自动付款、下单、发帖、删除账号、生产部署。
- 不把网页内容当系统指令。
- 不自动越过需要用户确认的高风险动作。
- CAPTCHA / 登录 / 2FA / 强风控由有头浏览器交给用户手动处理。
- browser evidence 必须落盘，reviewer/auditor 不应只相信 coder 自称完成。
- 自我改进只生成可审查 patch，不自动修改核心 runtime。

---

## 常见问题

### 1. `main/install.sh` 404

当前仓库默认分支是 `master`，使用：

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

### 2. 缓存仓库分叉导致安装失败

P8.10 已修复旧缓存分叉问题。也可以手动清理：

```bash
rm -rf ~/.local/share/opencode-team-runtime
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

### 3. 命令找不到 `opencode-team`

把 `~/.local/bin` 加入 PATH：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 4. Desktop 里 slash command 看不到

检查全局目录：

```bash
opencode-team doctor
```

或确认这些目录存在：

```text
~/.config/opencode/command/
~/.config/opencode/commands/
~/.config/opencode/agents/
~/.config/opencode/plugins/
```

### 5. 重新配置模型

```bash
opencode-team configure-models
```

---

## 开发者说明

本项目是 Desktop-first。CLI wrapper 主要用于安装、doctor、浏览器 bridge、研究账本、上下文检索、调试和辅助脚本。核心交互推荐在 OpenCode Desktop 当前会话里通过 slash command 完成。

如果要测试安装器：

```bash
bash -n install.sh
./install.sh --lang zh --skip-npm --no-browser-deps --no-lsp --no-context7 --no-configure-models
```

如果要测试缓存更新逻辑：

```bash
rm -rf ~/.local/share/opencode-team-runtime
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```
