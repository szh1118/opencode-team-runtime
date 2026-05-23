#!/usr/bin/env node
/**
 * opencode-team-runtime P8.10 global CLI.
 *
 * Installed once into the OpenCode global config directory. Project state is
 * created lazily under each project's .opencode/team directory.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.11.3-p8.7";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, "..");
const PROJECT_DEFAULT = process.cwd();
const OPENCODE_CONFIG_FILE = path.join(RUNTIME_ROOT, "opencode.jsonc");

const RUNNERS = {
  desktop: "desktop-doctor.mjs",
  doctor: "desktop-doctor.mjs",
  team: "team-runner.mjs",
  run: "team-runner.mjs",
  browser: "browser-runner.mjs",
  chrome: "browser-bridge-server.mjs",
  "chrome-bridge": "browser-bridge-server.mjs",
  research: "research-runner.mjs",
  context: "context-runner.mjs",
  router: "router-runner.mjs",
  memory: "memory-runner.mjs",
  patch: "patch-runner.mjs",
  overnight: "overnight-runner.mjs",
};

function usage() {
  console.log(`opencode-team-runtime ${VERSION}

Global install model:
  install.sh installs runtime once into the OpenCode global config directory.
  Every project gets team state lazily under .opencode/team when tools run.

Usage:
  opencode-team doctor [--project DIR]
  opencode-team init [DIR]
  opencode-team paths
  opencode-team configure-models
  opencode-team install-lsp [--profile common|node|python|go|rust|all] [--yes]
  opencode-team install-browser-deps
  opencode-team browser ...
  opencode-team chrome-bridge serve
  opencode-team research ...
  opencode-team context ...
  opencode-team router ...
  opencode-team memory ...
  opencode-team patch ...
  opencode-team overnight ...
  opencode-team run ...        # alias for team runner

Desktop usage:
  Open any project in OpenCode Desktop and run /team-overnight, /team-plan,
  /team-step, /team-review, /team-handoff, /team-audit, /team-browser, etc.

Examples:
  opencode-team configure-models
  opencode-team install-lsp --profile common --yes
  opencode-team init /home/a/code/my-project
  opencode-team browser manual https://example.com --mark
  opencode-team chrome-bridge serve
  opencode-team overnight status
`);
}

function parseProject(args) {
  let project = PROJECT_DEFAULT;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--project", "--dir", "-C"].includes(a)) project = path.resolve(args[++i]);
    else rest.push(a);
  }
  return { project, rest };
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeIfMissing(file, text) { if (!fs.existsSync(file)) { mkdirp(path.dirname(file)); fs.writeFileSync(file, text); } }
function writeJsonIfMissing(file, value) { writeIfMissing(file, JSON.stringify(value, null, 2) + "\n"); }
function readJson(file, fallback = {}) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; } catch { return fallback; } }
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }

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
function readJsonc(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    return raw ? JSON.parse(stripJsonc(raw)) : fallback;
  } catch (err) {
    console.error(`Could not parse ${file}: ${err.message}`);
    return fallback;
  }
}
function writeJsonc(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }

function defaultRegistry() {
  return {
    version: VERSION,
    models: {
      "minimax-m2.7": { label: "MiniMax M2.7", opencodeModel: "minimax/minimax-m2.7", tier: "cheap", capabilities: ["text", "coding", "bulk-edit"], contextBudgetTokens: 120000, softRotationRatio: 0.55, hardRotationRatio: 0.70 },
      "deepseek-v4-pro": { label: "DeepSeek V4 Pro", opencodeModel: "deepseek/deepseek-v4-pro", tier: "strong", capabilities: ["text", "coding", "planning", "review"], contextBudgetTokens: 600000, softRotationRatio: 0.60, hardRotationRatio: 0.72 },
      "qwen3.7-max": { label: "Qwen3.7 Max", opencodeModel: "qwen/qwen3.7-max", tier: "strong", capabilities: ["text", "long-context", "handoff", "planning"], contextBudgetTokens: 700000, softRotationRatio: 0.70, hardRotationRatio: 0.80 },
      "gpt-5.5": { label: "GPT-5.5", opencodeModel: "openai/gpt-5.5", tier: "premium", capabilities: ["text", "review", "audit", "hard-debug", "vision"], contextBudgetTokens: 200000, softRotationRatio: 0.75, hardRotationRatio: 0.83 },
    },
  };
}
function defaultPolicy() {
  return {
    version: VERSION,
    budget: { dailySoftLimit: 0, dailyHardLimit: 0, premiumCallsSoftLimit: 8, premiumCallsHardLimit: 20, requireExplicitExecuteForPremium: true },
    roles: {
      "chief-engineer": { defaultModel: "deepseek-v4-pro", fallbackModels: ["qwen3.7-max", "gpt-5.5"], premiumAllowed: true },
      "minimax-coder": { defaultModel: "minimax-m2.7", fallbackModels: ["deepseek-v4-pro"], premiumAllowed: false },
      tester: { defaultModel: "minimax-m2.7", fallbackModels: ["deepseek-v4-pro"], premiumAllowed: false },
      reviewer: { defaultModel: "deepseek-v4-pro", fallbackModels: ["qwen3.7-max", "gpt-5.5"], premiumAllowed: true },
      auditor: { defaultModel: "gpt-5.5", fallbackModels: ["qwen3.7-max", "deepseek-v4-pro"], premiumAllowed: true, checkpointOnly: true },
      "handoff-writer": { defaultModel: "qwen3.7-max", fallbackModels: ["deepseek-v4-pro"], premiumAllowed: false },
    },
    escalation: { afterFailures: 2, maxMiniMaxAttempts: 2, premiumEscalationReasons: ["final-audit", "repeated-failure", "claimed-but-missing"] },
    routingRules: [],
  };
}
function globalRegistryFile() { return path.join(RUNTIME_ROOT, "team", "router", "model-registry.json"); }
function globalPolicyFile() { return path.join(RUNTIME_ROOT, "team", "router", "policy.json"); }
function getGlobalRegistry() { return readJson(globalRegistryFile(), defaultRegistry()); }
function getGlobalPolicy() { return readJson(globalPolicyFile(), defaultPolicy()); }

function initProject(project) {
  project = path.resolve(project || PROJECT_DEFAULT);
  mkdirp(path.join(project, ".opencode", "team", "sessions"));
  mkdirp(path.join(project, ".opencode", "team", "browser"));
  mkdirp(path.join(project, ".opencode", "team", "research", "chunks"));
  mkdirp(path.join(project, ".opencode", "team", "research", "reports"));
  mkdirp(path.join(project, ".opencode", "team", "research", "artifacts"));
  mkdirp(path.join(project, ".opencode", "team", "context", "packs"));
  mkdirp(path.join(project, ".opencode", "team", "router", "checkpoints"));
  mkdirp(path.join(project, ".opencode", "team", "memory", "approvals"));
  mkdirp(path.join(project, ".opencode", "team", "memory", "packs"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "proposals"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "reviews"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "backups"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "applied"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "rejected"));
  mkdirp(path.join(project, ".opencode", "team", "patches", "logs"));
  mkdirp(path.join(project, ".opencode", "team", "overnight", "runs"));

  writeJsonIfMissing(path.join(project, ".opencode", "team", "state.json"), { version: VERSION, phase: "INIT", activeGoal: "", tasks: [], evidence: [], rotation: { pending: false } });
  writeIfMissing(path.join(project, ".opencode", "team", "handoff.md"), "# Handoff\n\nNo handoff has been written yet.\n");
  writeIfMissing(path.join(project, ".opencode", "team", "evidence.md"), "# Evidence Log\n\n");
  writeJsonIfMissing(path.join(project, ".opencode", "team", "task-dag.json"), { version: VERSION, goal: "", phase: "INIT", tasks: [], history: [] });
  writeJsonIfMissing(path.join(project, ".opencode", "team", "research", "sources.json"), { version: VERSION, sources: [] });
  writeJsonIfMissing(path.join(project, ".opencode", "team", "research", "claims.json"), { version: VERSION, claims: [] });
  writeJsonIfMissing(path.join(project, ".opencode", "team", "context", "index.json"), { version: VERSION, chunks: [] });
  writeJsonIfMissing(path.join(project, ".opencode", "team", "router", "model-registry.json"), getGlobalRegistry());
  writeJsonIfMissing(path.join(project, ".opencode", "team", "router", "policy.json"), getGlobalPolicy());

  const gitignore = path.join(project, ".gitignore");
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, "");
  const block = `\n# opencode-team-runtime project artifacts\n.opencode/team/sessions/\n.opencode/team/browser/\n.opencode/team/context/packs/\n.opencode/team/patches/backups/\n.opencode/team/patches/logs/\n.opencode/team/overnight/runs/\n`;
  const current = fs.readFileSync(gitignore, "utf8");
  if (!current.includes("opencode-team-runtime project artifacts")) fs.appendFileSync(gitignore, block);

  console.log(`Initialized lightweight project state: ${path.join(project, ".opencode", "team")}`);
  console.log("No project-local runtime copy was installed. Commands/MCP/plugins are global.");
}

function runRunner(name, args) {
  const runner = RUNNERS[name];
  if (!runner) { console.error(`Unknown command: ${name}`); usage(); process.exit(2); }
  const { project, rest } = parseProject(args);
  const script = path.join(RUNTIME_ROOT, "scripts", runner);
  if (!fs.existsSync(script)) { console.error(`Runtime script missing: ${script}`); process.exit(1); }
  const needsProject = name !== "chrome" && name !== "chrome-bridge";
  const finalArgs = [...rest];
  if (needsProject && !finalArgs.includes("--project") && !finalArgs.includes("--dir") && !finalArgs.includes("-C")) finalArgs.push("--project", project);
  const res = spawnSync(process.execPath, [script, ...finalArgs], { cwd: project, stdio: "inherit", env: { ...process.env, OPENCODE_TEAM_RUNTIME_ROOT: RUNTIME_ROOT } });
  process.exit(res.status ?? (res.error ? 1 : 0));
}

function printPaths() {
  const home = process.env.HOME || "";
  const xdg = process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : "");
  console.log(JSON.stringify({ version: VERSION, runtimeRoot: RUNTIME_ROOT, globalConfig: path.resolve(RUNTIME_ROOT), configFile: OPENCODE_CONFIG_FILE, project: process.cwd(), projectState: path.join(process.cwd(), ".opencode", "team"), expectedConfigHome: xdg ? path.join(xdg, "opencode") : null }, null, 2));
}

function installBrowserDeps() {
  console.log(`Installing optional browser dependencies into ${RUNTIME_ROOT}`);
  const res = spawnSync("npm", ["install", "cloakbrowser", "playwright-core"], { cwd: RUNTIME_ROOT, stdio: "inherit", env: process.env });
  process.exit(res.status ?? (res.error ? 1 : 0));
}

function installPackages(command, args, opts = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const res = spawnSync(command, args, { cwd: RUNTIME_ROOT, stdio: "inherit", env: process.env, ...opts });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: res.status === 0, status: res.status };
}

function parseSimpleArgs(args) {
  const out = { profile: "common", yes: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile") out.profile = args[++i];
    else if (["--yes", "-y"].includes(args[i])) out.yes = true;
  }
  return out;
}

function installLsp(args = []) {
  const { profile } = parseSimpleArgs(args);
  const npmCommon = [
    "typescript",
    "typescript-language-server",
    "pyright",
    "bash-language-server",
    "vscode-langservers-extracted",
    "yaml-language-server",
    "dockerfile-language-server-nodejs",
    "@tailwindcss/language-server",
  ];
  const npmNode = ["typescript", "typescript-language-server", "vscode-langservers-extracted", "yaml-language-server", "@tailwindcss/language-server", "eslint", "prettier"];
  const npmPython = ["pyright"];
  const profiles = {
    common: npmCommon,
    node: npmNode,
    python: npmPython,
    all: [...new Set([...npmCommon, ...npmNode, "intelephense", "svelte-language-server", "@astrojs/language-server", "@vue/language-server", "prisma"])]
  };
  const packages = profiles[profile] || profiles.common;
  console.log(`Installing common LSP npm packages for profile '${profile}' globally.`);
  installPackages("npm", ["install", "-g", ...packages]);

  if (["go", "all", "common"].includes(profile)) {
    if (spawnSync("go", ["version"], { stdio: "ignore" }).status === 0) installPackages("go", ["install", "golang.org/x/tools/gopls@latest"]);
    else console.log("go not found; skipping gopls. Install Go to enable OpenCode gopls support.");
  }
  if (["rust", "all", "common"].includes(profile)) {
    if (spawnSync("rustup", ["--version"], { stdio: "ignore" }).status === 0) installPackages("rustup", ["component", "add", "rust-analyzer"]);
    else console.log("rustup not found; skipping rust-analyzer. Install rustup to enable Rust LSP support.");
  }
  console.log("LSP packages installation finished. Some OpenCode built-ins still require language toolchains such as .NET, Java 21+, Dart, Elixir, Swift, Nix, OCaml, Julia, etc.");
}

async function configureModels() {
  console.log("\nConfigure model IDs for opencode-team-runtime.");
  console.log("Use OpenCode model IDs exactly as they appear in your OpenCode provider setup, e.g. openai/gpt-5.5 or minimax/minimax-m2.7.");
  const pipedAnswers = process.stdin.isTTY ? null : fs.readFileSync(0, "utf8").split(/\r?\n/);
  let pipedIndex = 0;
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (question, def = "") => {
    if (pipedAnswers) {
      const raw = pipedAnswers[pipedIndex++] ?? "";
      console.log(`${question}${def ? ` [${def}]` : ""}: ${raw}`);
      return (String(raw || "").trim() || def).trim();
    }
    const answer = await new Promise((resolve) => rl.question(`${question}${def ? ` [${def}]` : ""}: `, resolve));
    return (String(answer || "").trim() || def).trim();
  };
  const registry = getGlobalRegistry();
  const current = registry.models || defaultRegistry().models;
  const minimax = await ask("MiniMax coder model", current["minimax-m2.7"]?.opencodeModel || "minimax/minimax-m2.7");
  const deepseek = await ask("DeepSeek/Qwen/strong planner model", current["deepseek-v4-pro"]?.opencodeModel || "deepseek/deepseek-v4-pro");
  const qwen = await ask("Long-context handoff model", current["qwen3.7-max"]?.opencodeModel || "qwen/qwen3.7-max");
  const premium = await ask("Premium auditor/checkpoint model", current["gpt-5.5"]?.opencodeModel || "openai/gpt-5.5");
  if (rl) rl.close();
  registry.models = {
    ...current,
    "minimax-m2.7": { ...(current["minimax-m2.7"] || {}), label: "MiniMax coder", opencodeModel: minimax, tier: "cheap" },
    "deepseek-v4-pro": { ...(current["deepseek-v4-pro"] || {}), label: "Strong planner/reviewer", opencodeModel: deepseek, tier: "strong" },
    "qwen3.7-max": { ...(current["qwen3.7-max"] || {}), label: "Long-context handoff", opencodeModel: qwen, tier: "strong" },
    "gpt-5.5": { ...(current["gpt-5.5"] || {}), label: "Premium checkpoint/auditor", opencodeModel: premium, tier: "premium" },
  };
  writeJson(globalRegistryFile(), registry);
  writeJson(globalPolicyFile(), getGlobalPolicy());

  const cfg = readJsonc(OPENCODE_CONFIG_FILE, { $schema: "https://opencode.ai/config.json" });
  cfg.$schema ||= "https://opencode.ai/config.json";
  cfg.agent ||= {};
  const setAgent = (name, model) => { cfg.agent[name] = { ...(cfg.agent[name] || {}), model }; };
  setAgent("chief-engineer", deepseek);
  setAgent("overnight-supervisor", deepseek);
  setAgent("research-scout", deepseek);
  setAgent("research-reviewer", deepseek);
  setAgent("minimax-coder", minimax);
  setAgent("tester", minimax);
  setAgent("browser-actor", minimax);
  setAgent("browser-perception", deepseek);
  setAgent("reviewer", deepseek);
  setAgent("auditor", premium);
  setAgent("visual-reviewer", premium);
  setAgent("handoff-writer", qwen);
  writeJsonc(OPENCODE_CONFIG_FILE, cfg);

  console.log(`\nSaved global model registry: ${globalRegistryFile()}`);
  console.log(`Updated OpenCode global config agent overrides: ${OPENCODE_CONFIG_FILE}`);
  console.log("New projects initialized with opencode-team init will inherit this model registry.");
}

const [cmd = "help", ...args] = process.argv.slice(2);
if (["help", "--help", "-h"].includes(cmd)) usage();
else if (cmd === "paths") printPaths();
else if (cmd === "init") initProject(args[0] || process.cwd());
else if (cmd === "install-browser-deps") installBrowserDeps();
else if (cmd === "install-lsp") installLsp(args);
else if (cmd === "configure-models") await configureModels();
else runRunner(cmd, args);
