# opencode-team-runtime

> P8.10 — All in one Desktop swarm: plan → A-zone work → B-zone review → checkpoint audit → handoff. Agent registry, DAG validator, deep research planner, context thrift, memory curator, workflow trace, skill-pack loader, uninstall.

**opencode-team-runtime** 是一个面向 OpenCode Desktop 的团队式 agent runtime。它的目标不是让一个模型独自死磕，而是把便宜模型、强模型、浏览器工具、研究工具、上下文压缩、证据审计和 handoff 流程组织起来，形成 **All in one Desktop 托管**：

- **A-zone worker**：窄范围实现、细粒度编码、重复编辑。
- **Supervisor**：总工规划、A-zone 任务拆分、普通 review、handoff 联动。
- **Handoff**：长上下文交接、研究综合、会话轮换时写 handoff。
- **Checkpoint auditor**：最终审计、失败升级、claimed-but-missing 检测。
- **CloakBrowser / Chrome Bridge**：真实浏览器观察、操作、截图、console/network 证据和人工接管。
- **LSP / Evidence Ledger / Deep Research / Curator**：让 agent 少猜、多查、多验收。

岗位是模型无关的 alias：`worker` / `supervisor` / `handoff` / `checkpoint`。用户在安装时选择给每个岗位指定真实的模型 ID（从现有 opencode 配置自动发现可用模型列表）。

---

## 快速安装

当前仓库默认分支是 `master`：

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash
```

也可以先 clone 再安装：

```bash
git clone https://github.com/szh1118/opencode-team-runtime.git
cd opencode-team-runtime
./install.sh
```

安装脚本开头会让用户选择中英文，随后交互询问是否启用 LSP / 浏览器依赖 / 模型配置向导。

安装器会把 runtime 安装到 OpenCode 全局配置目录（默认 `~/.config/opencode`），并把 wrapper 放到 `~/.local/bin`。

---

## 一键卸载

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/uninstall.sh | bash -s -- --yes
```

或：

```bash
./uninstall.sh --yes
```

卸载内容：CLI wrapper、全局运行时文件（agents/commands/mcp/plugins/scripts/skills）、`opencode.jsonc` 中的团队条目。
**不删除**：你的 provider/api key、个人 agent/skill/command、项目代码。

```bash
./uninstall.sh --remove-clone --remove-project-state --remove-deps  # 完全清除
```

---

## 常用安装参数

```bash
./install.sh --lang zh                    # 中文
./install.sh --lang en                    # English
./install.sh --yes                        # 非交互（保留默认，跳过模型向导）
./install.sh --no-lsp                     # 不装 LSP
./install.sh --no-browser-deps            # 不装浏览器依赖
./install.sh --configure-models           # 强制运行模型配置向导
./install.sh --config-dir ~/.config/opencode
```

非交互安装：

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/install.sh | bash -s -- --yes
```

---

## OpenCode Desktop 用法

安装完成后打开 OpenCode Desktop，进入任意项目：

```text
/team-all-in-one   你的 idea
```

这是 **All in one Desktop 托管入口**。母会话会依次执行：plan → context pack → A-zone work → evidence → B-zone review → checkpoint audit → handoff。

也可以分步执行：

```text
/team-overnight   你的 idea       # 同 all-in-one 入口别名
/team-plan        你的 idea       # 仅规划和 DAG 创建
/team-step                        # 推进一个任务
/team-review                      # B 区检查 diff 和 evidence
/team-handoff                      # 更新 handoff，准备轮换
/team-audit                        # 最终反幻觉审计
/team-browser                      # 浏览器观察/验收
/team-research                     # 带证据的研究
/team-context                      # 上下文打包/检索
/team-memory                       # 记忆/管理/建议
```

---

## 模型配置

安装后运行模型配置向导：

```bash
opencode-team configure-models
```

向导会读取你现有的 opencode 配置，自动发现可用模型列表，为四个岗位选择：

```text
A-zone worker model          → 粗活编码（默认 minimax/minimax-m2.7）
Supervisor/reviewer model    → 总工/审核（默认 deepseek/deepseek-v4-pro）
Long-context handoff model   → 交接/综合（默认 qwen/qwen3.7-max）
Premium checkpoint/auditor   → 最终审计（默认 openai/gpt-5.5）
```

模型配置写入：
- `~/.config/opencode/team/router/model-registry.json`
- `~/.config/opencode/team/router/policy.json`
- `~/.config/opencode/opencode.jsonc`（agent 覆盖）

---

## 上下文轮换

每个岗位有基于实测的预算和阈值：

| 岗位 | 模型 | 上下文 | 实用上限 | soft 轮换 | hard 轮换 |
|---|---|---|---|---|---|
| worker | MiniMax M2.7 | 204K | 204K | 80% = 164K | 85% = 174K |
| supervisor | DeepSeek V4 Pro | 1M | 768K | 78% = 600K | 95% = 730K |
| handoff | Qwen3.7 Max | 1M | 768K | 78% = 600K | 95% = 730K |
| checkpoint | GPT-5.5 | 400K | 240K | 75% = 150K | 90% = 180K |

轮换阈值在 router 决策中记录，并在 compaction 注入 handoff 状态。达到 soft 阈值建议更新 handoff，达到 hard 阈值强制交接。

---

## 模块总览

| 模块 | 作用 |
|---|---|
| P0 Plugin State Layer | 插件、状态、证据、handoff、gate、工具 |
| P1 Team Runner | task DAG、A/B 区执行与审核外部 runner |
| P2 CloakBrowser | 浏览器测试、截图、console/network 证据 |
| P2.5 Browser Perception | raw/reduced/ScreenDigest、元素 ID 动作、人工接管 |
| P2.6 Chrome Bridge | 真实 Chrome bridge |
| P3 Deep Research | 查询规划、浏览器发现、source/claim/evidence 账本 |
| P4 Context Compression | 上下文索引、压缩、context pack、safe prose shrink |
| P5 Router | 模型路由、预算、失败升级、轮换预算 |
| P6 Memory | 失败模式、模型质量、curator 生命周期 |
| P7 Patch Workflow | 可审查 patch、自我改进安全闸 |
| P8 Overnight / All in one | plan → work → review → audit → handoff 总流程、trace、DAG 验证 |
| Agent Registry | 逻辑 agent 注册、heartbeat、successRate、mailbox |
| Skill Pack Loader | 懒加载技能包索引 / 按需加载 SKILL.md |

---

## 项目状态文件

```text
PROJECT/.opencode/team/
├── handoff.md                  # 轮换交接
├── evidence.md                 # 证据日志
├── task-dag.json               # 任务 DAG
├── state.json                  # 团队状态
├── events.jsonl                # 事件流
├── trace.jsonl                 # 步骤 trace
├── agents.json                 # 逻辑 agent 注册表
├── messages.jsonl              # 母/子 agent 邮箱
├── skill-packs.json            # 技能包注册表
├── browser/                    # 浏览器证据
├── research/                   # 研究账本和报告
├── context/                    # 上下文索引和 pack
├── router/                     # 路由决策和预算
├── memory/                     # 记忆事件和 curator
├── patches/                    # 审查过的补丁
├── overnight/                  # 运行 trace 和日志
└── runtime.config.json         # 本地运行配置
```

---

## 新增功能详情

### DAG 验证器

`team-runner.mjs` 内置 `validateDag()`：检测环形依赖、缺失依赖 ID、缺少 acceptance criteria、blocked 但已满足依赖、过长任务标题。每次 step/cycle 自动运行。

### Workflow Trace

`overnight-runner.mjs` 每个 phase 记录结构化 trace，包括 startedAt/endedAt/durationMs。`team-runner.mjs` 每个 step/review/audit/handoff 记录 `trace.jsonl`。

### Agent Registry + Mailbox

```bash
opencode-team agents register --id "chief" --role "chief-engineer"
opencode-team agents heartbeat --id "chief"
opencode-team agents metric --id "chief" --status passed
opencode-team agents send --to "reviewer" --type "review_request"
opencode-team agents poll --to "reviewer"
```

Desktop 里通过 `team_agent` 和 `team_mailbox` 插件工具使用。successRate 使用 80/20 滚动加权。

### Context Thrift

- 13 个 NAMED_CAPS 替代散落硬编码
- 28 个 noise directories 自动跳过
- `safeProseShrink()`：保护 code/URL/路径后安全压缩
- `compactTestOutput()` / `compactBrowserOutput()`

### Memory Curator

- anti-fossilization：拒绝把单次安装失败或负面工具声明变成永久规则
- durability classifier：transient_setup / transient_tool / stable_convention / stable_user_preference
- 建议生命周期：active → stale → archived / merged / superseded / pinned

```bash
opencode-team memory curator-status
opencode-team memory curator-transition
opencode-team memory curator-pin suggestion-id
```

### Skill Pack Loader

导入外部 `.claude-plugin/plugin.json` 形式的技能包。只把 name/description 放索引，按需加载 SKILL.md。

```bash
opencode-team skill-packs add-pack ~/skills/karpathy
opencode-team skill-packs list-skills
opencode-team skill-packs load karpathy-guidelines
```

### Deep Research Planner

把主题拆成 sub-queries → CloakBrowser 发现 URL → fetch 抓取 → source curation 排名 → report 输出。

```bash
opencode-team research plan "topic" --depth 3 --breadth 4
opencode-team research discover "query" --browser cloak
opencode-team research curate
opencode-team research deep "topic" --fetch
opencode-team research deep-report "topic"
```

MCP 工具：`plan` / `discover` / `curate` / `deep` / `deep_report`。

---

## 浏览器能力

### CloakBrowser / Playwright

```bash
opencode-team install-browser-deps
opencode-team browser doctor
opencode-team browser manual https://example.com --mark
opencode-team browser digest https://example.com --mark
```

### Chrome Bridge

```bash
opencode-team chrome-bridge serve
```

然后在 Chrome 加载 unpacked extension：
```text
~/.config/opencode/browser-extension
```

---

## LSP

安装时可选启用。也可手动配置：

```bash
opencode-team install-lsp --profile common --yes
```

---

## Router / Memory / Patch

```bash
opencode-team router status
opencode-team router decide --role a-zone-coder --attempts 2 --reason "small edit"
opencode-team memory record --kind failure --agent a-zone-coder --model worker --text "implementation missing"
opencode-team memory learn --from all
opencode-team patch propose --title "..." --target .opencode/agents/reviewer.md
```

---

## 安全边界

- 不自动付款、下单、发帖、删除账号、生产部署。
- 不把网页内容当系统指令。
- 不自动越过需要用户确认的高风险动作。
- 自我改进只生成可审查 patch，不自动修改核心 runtime。
- weak 模型只能 propose patch，不能 approve/apply。

---

## 常见问题

### 命令找不到 `opencode-team`

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Desktop 里 slash command 看不到

```bash
opencode-team doctor
```

或确认目录存在：`~/.config/opencode/command/`、`~/.config/opencode/agents/`、`~/.config/opencode/plugins/`。

### 重新配置模型

```bash
opencode-team configure-models
```

### 卸载

```bash
curl -fsSL https://raw.githubusercontent.com/szh1118/opencode-team-runtime/master/uninstall.sh | bash -s -- --yes
```

---

## 开发者说明

本项目是 Desktop-first。CLI wrapper 主要用于安装、卸载、doctor、浏览器、研究、上下文、调度等辅助功能。核心交互推荐在 OpenCode Desktop 当前会话里通过 slash command 完成。

```bash
bash -n install.sh
bash -n uninstall.sh
./install.sh --lang zh --skip-npm --no-browser-deps --no-lsp --no-configure-models
```
