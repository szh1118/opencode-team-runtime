#!/usr/bin/env node
/**
 * opencode-team-runtime P1 external scheduler
 *
 * This runner is intentionally conservative:
 * - it stores durable task state in .opencode/team/task-dag.json
 * - it drives OpenCode through `opencode run` when --execute is supplied
 * - it keeps a dry-run path so setup can be validated without spending tokens
 * - it assumes P0 plugin tools are installed and prompts agents to use them
 *
 * No third-party npm dependencies are required.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, "..");
function runtimeScript(name) { return path.join(RUNTIME_ROOT, "scripts", name); }

const VERSION = "0.7.0-p5";
const TEAM_DIR = [".opencode", "team"];
const DEFAULT_DAG = {
  version: VERSION,
  goal: "",
  phase: "INIT",
  createdAt: null,
  updatedAt: null,
  tasks: [],
  history: [],
};

const STATUS_ORDER = [
  "open",
  "working",
  "claimed_done",
  "testing",
  "reviewing",
  "failed",
  "blocked",
  "passed",
  "done",
];

function now() {
  return new Date().toISOString();
}

function usage() {
  console.log(`opencode-team-runtime ${VERSION}

Usage:
  node .opencode/scripts/team-runner.mjs init [--project DIR]
  node .opencode/scripts/team-runner.mjs run "IDEA" [--project DIR] [--max-steps N] [--execute]
  node .opencode/scripts/team-runner.mjs step [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs plan "IDEA" [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs review [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs audit [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs handoff [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs browser [URL-or-instruction] [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs research [QUESTION] [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs perceive [URL-or-instruction] [--project DIR] [--execute]
  node .opencode/scripts/team-runner.mjs status [--project DIR]
  node .opencode/scripts/team-runner.mjs doctor [--project DIR]
  node .opencode/scripts/team-runner.mjs router [--project DIR]

Important:
  By default this runner is dry-run only. Add --execute to call opencode run.
  Configure models in .opencode/team/runtime.config.json.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const opts = {
    command,
    project: process.cwd(),
    execute: false,
    maxSteps: null,
    idea: "",
    agent: "",
    model: "",
    attach: "",
    title: "",
    json: false,
    dangerouslySkipPermissions: false,
    _: [],
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" || a === "--dir" || a === "-C") opts.project = path.resolve(args[++i]);
    else if (a === "--execute" || a === "--yes") opts.execute = true;
    else if (a === "--dry-run") opts.execute = false;
    else if (a === "--max-steps") opts.maxSteps = Number(args[++i]);
    else if (a === "--agent") opts.agent = args[++i];
    else if (a === "--model" || a === "-m") opts.model = args[++i];
    else if (a === "--attach") opts.attach = args[++i];
    else if (a === "--title") opts.title = args[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--dangerously-skip-permissions") opts.dangerouslySkipPermissions = true;
    else opts._.push(a);
  }
  opts.idea = opts._.join(" ").trim();
  return opts;
}

function teamPath(project, ...parts) {
  return path.join(project, ...TEAM_DIR, ...parts);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback);
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function appendText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}

function ensureFiles(project) {
  fs.mkdirSync(teamPath(project), { recursive: true });
  fs.mkdirSync(teamPath(project, "sessions"), { recursive: true });

  const dagFile = teamPath(project, "task-dag.json");
  if (!fs.existsSync(dagFile)) writeJson(dagFile, DEFAULT_DAG);

  const stateFile = teamPath(project, "state.json");
  if (!fs.existsSync(stateFile)) {
    writeJson(stateFile, {
      version: VERSION,
      phase: "INIT",
      activeGoal: "",
      sessions: {},
      tasks: [],
      changedFiles: [],
      evidence: [],
      tests: [],
      browserChecks: [],
      blockers: [],
      rotation: { pending: false, reason: "", requestedAt: null, softThreshold: 0.65, hardThreshold: 0.8 },
      gates: { requireEvidence: true, requireReview: true, requireHandoff: true, requireCleanGitStatus: false },
      counters: { events: 0, tools: 0, edits: 0, todos: 0 },
      lastEvent: null,
    });
  }

  const runtimeConfig = teamPath(project, "runtime.config.json");
  if (!fs.existsSync(runtimeConfig)) {
    writeJson(runtimeConfig, {
      version: VERSION,
      runtime: {
        opencodeCommand: "opencode",
        defaultMaxSteps: 8,
        requireExecuteFlag: true,
        sessionLogDir: ".opencode/team/sessions",
        useJsonFormat: true,
        attachUrl: "",
        dangerouslySkipPermissions: false,
        models: {
          "chief-engineer": "",
          "a-zone-coder": "",
          "minimax-coder": "",
          tester: "",
          reviewer: "",
          auditor: "",
          "handoff-writer": "",
          "research-scout": "",
          "browser-tester": "",
        },
      },
    });
  }

  const handoff = teamPath(project, "handoff.md");
  if (!fs.existsSync(handoff)) fs.writeFileSync(handoff, "# Handoff\n\nNo handoff has been written yet.\n");

  const evidence = teamPath(project, "evidence.md");
  if (!fs.existsSync(evidence)) fs.writeFileSync(evidence, "# Evidence Log\n\n");
}

function loadRuntimeConfig(project) {
  const cfg = readJson(teamPath(project, "runtime.config.json"), { runtime: {} });
  return cfg.runtime || cfg;
}

function loadDag(project) {
  return readJson(teamPath(project, "task-dag.json"), DEFAULT_DAG);
}

function saveDag(project, dag) {
  dag.updatedAt = now();
  if (!dag.createdAt) dag.createdAt = dag.updatedAt;
  writeJson(teamPath(project, "task-dag.json"), dag);
}

function loadState(project) {
  return readJson(teamPath(project, "state.json"), {});
}

function saveState(project, state) {
  writeJson(teamPath(project, "state.json"), state);
}

function logRuntime(project, event) {
  appendText(teamPath(project, "runtime-events.jsonl"), JSON.stringify({ time: now(), ...event }) + "\n");
}

function appendEvidence(project, type, status, body) {
  const entry = `\n## ${now()} — ${type} — ${status}\n\n${body.trim()}\n`;
  appendText(teamPath(project, "evidence.md"), entry);
  const state = loadState(project);
  if (!Array.isArray(state.evidence)) state.evidence = [];
  state.evidence.push({ id: `ev-${Date.now()}`, type, status, note: body.slice(0, 500), at: now(), source: "team-runner" });
  saveState(project, state);
}

function appendStepTrace(project, entry) {
  const file = teamPath(project, "trace.jsonl")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + "\n")
}

function taskId(prefix = "T") {
  return `${prefix}-${crypto.randomBytes(3).toString("hex")}`;
}

function bootstrapDag(project, idea) {
  const dag = loadDag(project);
  const ts = now();
  if (!dag.goal && idea) dag.goal = idea;
  if (!dag.createdAt) dag.createdAt = ts;
  dag.updatedAt = ts;
  dag.phase = dag.tasks.length ? dag.phase : "PLANNED_BOOTSTRAP";
  if (!Array.isArray(dag.history)) dag.history = [];
  if (!Array.isArray(dag.tasks)) dag.tasks = [];

  if (dag.tasks.length === 0) {
    const ids = {
      plan: taskId("PLAN"),
      first: taskId("A"),
      test: taskId("TEST"),
      review: taskId("B"),
      audit: taskId("AUDIT"),
    };
    dag.tasks.push(
      {
        id: ids.plan,
        title: "Turn the raw idea into a verified task DAG and acceptance criteria",
        status: "open",
        zone: "mother",
        agent: "chief-engineer",
        attempts: 0,
        dependsOn: [],
        acceptanceCriteria: [
          ".opencode/team/task-dag.json contains concrete atomic tasks",
          ".opencode/team/handoff.md contains goal/current state/next task",
          "No implementation is claimed complete at planning stage",
        ],
        notes: idea || "No idea supplied.",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: ids.first,
        title: "Implement the first atomic task selected by chief-engineer",
        status: "blocked",
        zone: "A",
        agent: "a-zone-coder",
        attempts: 0,
        dependsOn: [ids.plan],
        acceptanceCriteria: ["Smallest viable edit is made", "Changed files are recorded", "Implementation evidence is recorded"],
        notes: "Unblock after chief-engineer creates/refines the actual first task.",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: ids.test,
        title: "Run the narrowest relevant checks for the implemented task",
        status: "blocked",
        zone: "A/B",
        agent: "tester",
        attempts: 0,
        dependsOn: [ids.first],
        acceptanceCriteria: ["Test/check command and output are recorded", "Failures become repair tasks"],
        notes: "Unblock after implementation is claimed_done.",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: ids.review,
        title: "Review actual diff and evidence against acceptance criteria",
        status: "blocked",
        zone: "B",
        agent: "reviewer",
        attempts: 0,
        dependsOn: [ids.test],
        acceptanceCriteria: ["Reviewer inspects diff", "Reviewer records pass/fail evidence", "Failures become repair tasks"],
        notes: "Unblock after tests/checks produce evidence.",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: ids.audit,
        title: "Final anti-hallucination audit before declaring completion",
        status: "blocked",
        zone: "B",
        agent: "auditor",
        attempts: 0,
        dependsOn: [ids.review],
        acceptanceCriteria: ["team_gate passes", "handoff is up to date", "No claimed-but-missing feature remains"],
        notes: "Run only near completion.",
        createdAt: ts,
        updatedAt: ts,
      }
    );
    dag.history.push({ at: ts, event: "bootstrap", idea });
  }
  saveDag(project, dag);
  syncDagToState(project, dag);
  return dag;
}

function syncDagToState(project, dag) {
  const state = loadState(project);
  state.activeGoal = dag.goal || state.activeGoal || "";
  state.phase = dag.phase || state.phase || "INIT";
  state.tasks = dag.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    zone: t.zone,
    agent: t.agent,
    attempts: t.attempts || 0,
    acceptanceCriteria: t.acceptanceCriteria || [],
    updatedAt: t.updatedAt || now(),
  }));
  saveState(project, state);
}

function markTask(project, id, status, note = "") {
  const dag = loadDag(project);
  const t = dag.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`No task ${id}`);
  t.status = status;
  t.updatedAt = now();
  if (note) t.notes = `${t.notes || ""}\n${now()}: ${note}`.trim();
  if (!Array.isArray(dag.history)) dag.history = [];
  dag.history.push({ at: now(), event: "task_status", task: id, status, note });
  saveDag(project, dag);
  syncDagToState(project, dag);
  return t;
}

function dependencyDone(dag, id) {
  const dep = dag.tasks.find((t) => t.id === id);
  return dep && ["done", "passed"].includes(dep.status);
}

function unblockReadyTasks(project) {
  const dag = loadDag(project);
  let changed = false;
  for (const t of dag.tasks) {
    if (t.status === "blocked" && Array.isArray(t.dependsOn) && t.dependsOn.every((d) => dependencyDone(dag, d))) {
      t.status = "open";
      t.updatedAt = now();
      changed = true;
      dag.history.push({ at: now(), event: "unblocked", task: t.id });
    }
  }
  if (changed) {
    saveDag(project, dag);
    syncDagToState(project, dag);
  }
  return changed;
}

function pickNextTask(project) {
  unblockReadyTasks(project);
  const dag = loadDag(project);
  const rank = { failed: 0, open: 1, claimed_done: 2, testing: 3, reviewing: 4, working: 5, blocked: 9, passed: 10, done: 11 };
  const candidates = dag.tasks
    .filter((t) => !["done", "passed", "blocked"].includes(t.status))
    .sort((a, b) => (rank[a.status] ?? 8) - (rank[b.status] ?? 8));
  return candidates[0] || null;
}

function compact(obj, max = 4000) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...<truncated ${s.length - max} chars>`;
}

function readHandoff(project) {
  const file = teamPath(project, "handoff.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function buildPrompt(kind, project, extra = {}) {
  const dag = loadDag(project);
  const state = loadState(project);
  const handoff = readHandoff(project);
  const common = `You are running under opencode-team-runtime ${VERSION}.

Project goal:
${dag.goal || state.activeGoal || "<unset>"}

Current task DAG:
${compact(dag, 9000)}

Current team state:
${compact(state, 6000)}

Current handoff:
${compact(handoff, 7000)}

Global rules:
- Use team_status before decisions.
- Record evidence with team_evidence.
- Update task status with team_task where possible.
- Do not claim done unless team_gate passes or you explicitly state why it does not.
- Keep output concise and factual.
`;

  if (kind === "plan") {
    return `${common}
User idea:
${extra.idea || dag.goal || "<none>"}

Task:
Create or refine a practical task DAG for this project. Use team_task to create/update atomic tasks. Update team_handoff with goal, current state, first next atomic task, and stop conditions. Do not edit implementation files. End by saying exactly which A-zone task should run next.`;
  }

  if (kind === "work") {
    return `${common}
Selected task:
${compact(extra.task, 5000)}

A-zone implementation task:
Do exactly this task, with the smallest safe code change. Inspect only relevant files. Run the narrowest relevant check if possible. Record implementation/test evidence. Mark the task claimed_done, not done. If impossible, mark it failed or blocked and explain the smallest repair path.`;
  }

  if (kind === "test") {
    return `${common}
Selected task:
${compact(extra.task, 5000)}

Testing task:
Run the narrowest relevant test/check for the selected implementation. Record command, result, and short output via team_evidence type test. If the check fails, create or update a repair task and mark the relevant task failed.`;
  }

  if (kind === "review") {
    return `${common}
Selected task:
${compact(extra.task, 5000)}

B-zone review task:
Review actual git diff, changed files, task acceptance criteria, and evidence. Do not edit files. Record team_evidence type review with status passed or failed. If failed, create a precise repair task. If passed, mark the reviewed task passed or done only if team_gate allows it.`;
  }

  if (kind === "audit") {
    return `${common}
Final audit task:
Look for claimed-but-not-implemented features, missing tests, stale handoff, hidden TODOs/stubs, and unrelated edits. Do not edit files. Record team_evidence type audit with status passed or failed. Completion is allowed only if team_gate passes or all warnings are explicitly documented.`;
  }

  if (kind === "handoff") {
    return `${common}
Handoff task:
Rewrite .opencode/team/handoff.md using team_handoff action=replace. Required sections: Goal, Current State, Task DAG Status, Files in Flight, Evidence, Failed Attempts, Open Questions, Next Atomic Task, Stop Conditions, Reviewer Notes. Do not implement. Do not produce long transcript summaries.`;
  }

  if (kind === "browser") {
    return `${common}
Browser evidence task:
${extra.instruction || "Verify the current web/UI behavior with CloakBrowser."}

Use CloakBrowser MCP tools if available: cloakbrowser_digest, cloakbrowser_observe, cloakbrowser_act_by_id, cloakbrowser_manual, cloakbrowser_visit, cloakbrowser_snapshot, cloakbrowser_interact, cloakbrowser_doctor. Use headed/manual mode when login/CAPTCHA/challenge/user action is needed. If MCP tools are unavailable, use node .opencode/scripts/browser-runner.mjs directly. Record browser evidence with team_evidence type browser. Include screenshot/json/digest artifact paths. Do not edit implementation files.`;
  }

  if (kind === "research") {
    return `${common}
Evidence-first research task:
${extra.question || "Research the current project question."}

Use research MCP tools if available: research_status, research_add_source, research_add_text, research_add_claim, research_validate, research_report, research_search_browser. Use browser_bridge or cloakbrowser tools for dynamic or logged-in pages. Add sources before claims. Every important claim must cite SOURCE_ID[#CHUNK_ID]. Run research_validate before giving conclusions. Unsupported claims must remain marked unsupported and must not become implementation assumptions. Do not edit implementation files.`;
  }

  return common;
}

function runRouter(project, args) {
  const script = runtimeScript("router-runner.mjs");
  if (!fs.existsSync(script)) return null;
  const result = spawnSync("node", [script, ...args, "--project", project, "--json"], {
    cwd: project,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    logRuntime(project, { event: "router_error", args, stderr: (result.stderr || result.stdout || "").slice(0, 2000) });
    return null;
  }
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch {
    return null;
  }
}

function routeModel(project, runtime, agent, override = "", meta = {}) {
  if (override) return { agent, model: override, decision: null, modelAlias: override };
  const routerEnabled = runtime.router?.enabled !== false;
  if (routerEnabled) {
    const args = ["decide", "--role", agent];
    if (meta.kind) args.push("--kind", meta.kind);
    if (meta.taskId) args.push("--task", meta.taskId);
    if (meta.attempts !== undefined && meta.attempts !== null) args.push("--attempts", String(meta.attempts));
    if (meta.reason) args.push("--reason", meta.reason);
    if (meta.execute) args.push("--execute");
    const decision = runRouter(project, args);
    if (decision?.opencodeModel) {
      return {
        agent: decision.routedRole || agent,
        model: decision.opencodeModel,
        decision,
        modelAlias: decision.modelAlias || decision.opencodeModel,
      };
    }
  }
  if (runtime.models && runtime.models[agent]) return { agent, model: runtime.models[agent], decision: null, modelAlias: runtime.models[agent] };
  return { agent, model: "", decision: null, modelAlias: "" };
}

function recordRouterUsage(project, { agent, modelAlias, taskId, status, reason }) {
  if (!modelAlias) return;
  runRouter(project, [
    "record",
    "--agent", agent || "unknown-agent",
    "--model", modelAlias,
    ...(taskId ? ["--task", taskId] : []),
    "--status", status || "unknown",
    "--reason", reason || "team-runner dispatch",
  ]);
}

function sessionLogPaths(project, agent, title = "session") {
  const dir = teamPath(project, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40) || "session";
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${agent}-${safeTitle}-${crypto.randomBytes(2).toString("hex")}`;
  return {
    id,
    stdout: path.join(dir, `${id}.stdout.log`),
    stderr: path.join(dir, `${id}.stderr.log`),
    meta: path.join(dir, `${id}.json`),
  };
}

function runOpenCode(project, { agent, model, prompt, title, execute, attach, dangerouslySkipPermissions, kind = "", taskId = "", attempts = null, reason = "" }) {
  const runtime = loadRuntimeConfig(project);
  const opencode = runtime.opencodeCommand || "opencode";
  const useJsonFormat = runtime.useJsonFormat !== false;
  const attachUrl = attach || runtime.attachUrl || "";
  const skipPerms = Boolean(dangerouslySkipPermissions || runtime.dangerouslySkipPermissions);
  const route = routeModel(project, runtime, agent, model, { kind, taskId, attempts, reason: reason || title || kind, execute });
  const effectiveAgent = route.agent || agent;
  const resolvedModel = route.model || "";
  const logs = sessionLogPaths(project, effectiveAgent, title || "run");
  const args = ["run", "--dir", project, "--agent", effectiveAgent, "--title", title || `team:${effectiveAgent}`];
  if (resolvedModel) args.push("--model", resolvedModel);
  if (useJsonFormat) args.push("--format", "json");
  if (attachUrl) args.push("--attach", attachUrl);
  if (skipPerms) args.push("--dangerously-skip-permissions");
  args.push(prompt);

  const meta = { id: logs.id, at: now(), requestedAgent: agent, agent: effectiveAgent, model: resolvedModel, modelAlias: route.modelAlias || resolvedModel, routing: route.decision || null, title, execute, command: opencode, args: args.map((x, idx) => idx === args.length - 1 ? "<prompt>" : x), promptPreview: prompt.slice(0, 2000) };
  writeJson(logs.meta, meta);

  logRuntime(project, { event: execute ? "opencode_start" : "dry_run", requestedAgent: agent, agent: effectiveAgent, model: resolvedModel, modelAlias: route.modelAlias || resolvedModel, title, log: logs.meta, routing: route.decision || null });

  if (!execute) {
    fs.writeFileSync(logs.stdout, `[DRY RUN]\n${opencode} ${args.slice(0, -1).join(" ")} <prompt>\n\nPrompt:\n${prompt}\n`);
    fs.writeFileSync(logs.stderr, "");
    return { ok: true, dryRun: true, code: 0, logs, routing: route.decision || null };
  }

  const result = spawnSync(opencode, args, {
    cwd: project,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  });

  fs.writeFileSync(logs.stdout, result.stdout || "");
  fs.writeFileSync(logs.stderr, result.stderr || "");

  const ok = result.status === 0;
  logRuntime(project, { event: "opencode_end", requestedAgent: agent, agent: effectiveAgent, model: resolvedModel, modelAlias: route.modelAlias || resolvedModel, ok, code: result.status, stdout: logs.stdout, stderr: logs.stderr });
  appendEvidence(project, "runtime", ok ? "passed" : "failed", `Requested agent: ${agent}\nEffective agent: ${effectiveAgent}\nModel: ${resolvedModel || "<config/default>"}\nModel alias: ${route.modelAlias || ""}\nTitle: ${title}\nExit: ${result.status}\nLogs:\n- ${path.relative(project, logs.stdout)}\n- ${path.relative(project, logs.stderr)}`);
  recordRouterUsage(project, { agent: effectiveAgent, modelAlias: route.modelAlias || resolvedModel, taskId, status: ok ? "passed" : "failed", reason: title || kind || "team-runner" });

  return { ok, dryRun: false, code: result.status, logs, error: result.error, routing: route.decision || null };
}

function printStatus(project) {
  const dag = loadDag(project);
  const state = loadState(project);
  console.log(`Project: ${project}`);
  console.log(`Version: ${VERSION}`);
  console.log(`Goal: ${dag.goal || state.activeGoal || "<unset>"}`);
  console.log(`Phase: ${dag.phase || state.phase || "INIT"}`);
  console.log("\nTasks:");
  if (!dag.tasks.length) console.log("  <none>");
  for (const t of dag.tasks) {
    console.log(`  ${t.id.padEnd(12)} ${String(t.status).padEnd(13)} ${String(t.agent || "").padEnd(16)} ${t.title}`);
  }
  console.log("\nRecent evidence:");
  const ev = Array.isArray(state.evidence) ? state.evidence.slice(-5) : [];
  if (!ev.length) console.log("  <none>");
  for (const e of ev) console.log(`  ${e.at || ""} ${e.type || ""}/${e.status || ""}: ${e.note || e.summary || ""}`.slice(0, 240));
  const next = pickNextTask(project);
  console.log(`\nNext: ${next ? `${next.id} ${next.status} ${next.agent} — ${next.title}` : "none"}`);
}

function doctor(project) {
  ensureFiles(project);
  const checks = [];
  function check(name, ok, note = "") {
    checks.push({ name, ok, note });
  }
  check("project exists", fs.existsSync(project), project);
  check("project .opencode exists", fs.existsSync(path.join(project, ".opencode")), "created lazily for .opencode/team state");
  check("global runtime root", fs.existsSync(RUNTIME_ROOT), RUNTIME_ROOT);
  check("global P0 plugin exists", fs.existsSync(path.join(RUNTIME_ROOT, "plugins", "team-runtime.js")), "");
  check("global browser runner exists", fs.existsSync(runtimeScript("browser-runner.mjs")), "");
  check("global router runner exists", fs.existsSync(runtimeScript("router-runner.mjs")), "");
  check("global cloakbrowser mcp exists", fs.existsSync(path.join(RUNTIME_ROOT, "mcp", "cloakbrowser-mcp.mjs")), "");
  check("runtime config exists", fs.existsSync(teamPath(project, "runtime.config.json")), "");
  check("task dag exists", fs.existsSync(teamPath(project, "task-dag.json")), "");
  check("handoff exists", fs.existsSync(teamPath(project, "handoff.md")), "");
  check("evidence exists", fs.existsSync(teamPath(project, "evidence.md")), "");
  const which = spawnSync("bash", ["-lc", "command -v opencode || true"], { encoding: "utf8" });
  const opencodeFound = Boolean(which.stdout.trim());
  let ok = true;
  for (const c of checks) {
    ok = ok && c.ok;
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`);
  }
  console.log(`${opencodeFound ? "✓" : "!"} opencode command found — ${which.stdout.trim() || "not found; dry-run still works, --execute will fail until installed"}`);
  process.exitCode = ok ? 0 : 1;
}

function plan(project, idea, opts) {
  ensureFiles(project);
  if (!idea) throw new Error("plan requires an IDEA string");
  const dag = bootstrapDag(project, idea);
  dag.goal = idea;
  dag.phase = "PLANNING";
  dag.history.push({ at: now(), event: "plan_requested", idea });
  saveDag(project, dag);
  syncDagToState(project, dag);

  const prompt = buildPrompt("plan", project, { idea });
  const result = runOpenCode(project, {
    agent: opts.agent || "chief-engineer",
    model: opts.model,
    prompt,
    title: opts.title || "team-plan",
    kind: "plan",
    reason: "initial planning checkpoint",
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });

  if (result.ok) {
    markTask(project, dag.tasks[0].id, opts.execute ? "claimed_done" : "open", opts.execute ? "Planner ran; review task DAG/handoff." : "Dry-run only; planner not executed.");
  }
  return result;
}

function runTaskStep(project, opts) {
  ensureFiles(project);
  const v = validateDag(project)
  for (const w of v.warnings) console.log(`[DAG WARN] ${w}`)
  const task = pickNextTask(project);
  if (!task) {
    console.log("No runnable tasks. Consider `audit` or create a new plan.");
    return { ok: true, none: true };
  }

  let kind = "work";
  let agent = task.agent || "a-zone-coder";
  let nextStatus = "working";

  if (task.agent === "chief-engineer" || task.zone === "mother") {
    kind = "plan";
    agent = "chief-engineer";
    nextStatus = "working";
  } else if (task.status === "claimed_done" || task.status === "testing") {
    kind = "test";
    agent = "tester";
    nextStatus = "testing";
  } else if (task.status === "reviewing" || task.zone === "B") {
    kind = "review";
    agent = task.agent || "reviewer";
    nextStatus = "reviewing";
  } else if (task.status === "failed") {
    kind = "work";
    agent = ["a-zone-coder", "minimax-coder"].includes(task.agent) && (task.attempts || 0) >= 2 ? "chief-engineer" : (task.agent || "a-zone-coder");
    nextStatus = "working";
  }

  task.attempts = (task.attempts || 0) + 1;
  markTask(project, task.id, nextStatus, `P1 dispatch to ${agent} as ${kind}; attempt ${task.attempts}`);

  const prompt = buildPrompt(kind, project, { task });
  const result = runOpenCode(project, {
    agent,
    model: opts.model,
    prompt,
    title: opts.title || `team-${kind}-${task.id}`,
    kind,
    taskId: task.id,
    attempts: task.attempts || 0,
    reason: `${kind} ${task.status} ${task.title}`,
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });

  if (!result.ok) {
    markTask(project, task.id, "failed", `OpenCode run failed. See ${path.relative(project, result.logs.stderr)}.`);
    return result;
  }

  if (!opts.execute) {
    markTask(project, task.id, task.status === "working" ? "open" : task.status, "Dry-run dispatch only.");
  } else {
    // Leave final status to agent tools when possible, but ensure the state does not stay invisible.
    const refreshed = loadDag(project).tasks.find((t) => t.id === task.id);
    if (refreshed && refreshed.status === nextStatus) {
      const fallbackStatus = kind === "test" ? "reviewing" : kind === "review" ? "passed" : "claimed_done";
      markTask(project, task.id, fallbackStatus, `Runner fallback transition after ${agent} completed. Verify with evidence before trusting this status.`);
    }
  }
  return result;
}

function review(project, opts) {
  ensureFiles(project);
  const dag = loadDag(project);
  let task = dag.tasks.find((t) => t.status === "claimed_done") || dag.tasks.find((t) => t.status === "reviewing") || dag.tasks.find((t) => t.zone === "B" && t.status === "open");
  if (!task) {
    task = {
      id: taskId("B"),
      title: "Ad-hoc review of current diff and evidence",
      status: "reviewing",
      zone: "B",
      agent: "reviewer",
      attempts: 0,
      dependsOn: [],
      acceptanceCriteria: ["Actual git diff is inspected", "Review evidence is recorded"],
      notes: "Created by P1 review command.",
      createdAt: now(),
      updatedAt: now(),
    };
    dag.tasks.push(task);
    saveDag(project, dag);
    syncDagToState(project, dag);
  }
  markTask(project, task.id, "reviewing", "Manual review command dispatched.");
  return runOpenCode(project, {
    agent: opts.agent || "reviewer",
    model: opts.model,
    prompt: buildPrompt("review", project, { task }),
    title: opts.title || `team-review-${task.id}`,
    kind: "review",
    taskId: task.id,
    attempts: task.attempts || 0,
    reason: `review ${task.title}`,
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });
}

function browser(project, opts) {
  ensureFiles(project);
  bootstrapDag(project, opts.idea || "");
  const instruction = opts.idea || "Use CloakBrowser to verify current web/UI behavior and record evidence.";
  return runOpenCode(project, {
    agent: opts.agent || "browser-tester",
    model: opts.model,
    prompt: buildPrompt("browser", project, { instruction }),
    title: opts.title || "team-browser-evidence",
    kind: "browser",
    reason: instruction,
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });
}


function research(project, opts) {
  ensureFiles(project);
  bootstrapDag(project, opts.idea || "");
  const question = opts.idea || "Research the current project goal and record evidence-backed claims.";
  return runOpenCode(project, {
    agent: opts.agent || "research-scout",
    model: opts.model,
    prompt: buildPrompt("research", project, { question }),
    title: opts.title || "team-research",
    kind: "research",
    reason: question,
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });
}

function audit(project, opts) {
  ensureFiles(project);
  return runOpenCode(project, {
    agent: opts.agent || "auditor",
    model: opts.model,
    prompt: buildPrompt("audit", project, {}),
    title: opts.title || "team-final-audit",
    kind: "final-audit",
    reason: "final-audit",
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });
}

function handoff(project, opts) {
  ensureFiles(project);
  const state = loadState(project);
  state.rotation = state.rotation || {};
  state.rotation.pending = true;
  state.rotation.reason = "P1 handoff command";
  state.rotation.requestedAt = now();
  saveState(project, state);
  const result = runOpenCode(project, {
    agent: opts.agent || "handoff-writer",
    model: opts.model,
    prompt: buildPrompt("handoff", project, {}),
    title: opts.title || "team-handoff",
    kind: "handoff",
    reason: state.rotation?.reason || "handoff",
    execute: opts.execute,
    attach: opts.attach,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
  });
  if (result.ok && opts.execute) {
    const nextState = loadState(project);
    nextState.rotation = nextState.rotation || {};
    nextState.rotation.pending = false;
    nextState.rotation.completedAt = now();
    saveState(project, nextState);
  }
  return result;
}

function validateDag(project) {
  const dag = loadDag(project)
  const errors = []
  const warnings = []
  const taskMap = new Map()
  for (const t of dag.tasks) taskMap.set(t.id, t)
  const inDegree = new Map()
  const adj = new Map()
  for (const t of dag.tasks) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0)
    if (!adj.has(t.id)) adj.set(t.id, [])
    for (const dep of (t.dependsOn || [])) {
      if (!inDegree.has(dep)) inDegree.set(dep, 0)
      if (!adj.has(dep)) adj.set(dep, [])
      inDegree.set(t.id, inDegree.get(t.id) + 1)
      adj.get(dep).push(t.id)
    }
  }
  const queue = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  let sorted = 0
  while (queue.length > 0) {
    const node = queue.shift()
    sorted++
    for (const neighbor of (adj.get(node) || [])) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1)
      if (inDegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }
  if (sorted !== dag.tasks.length) errors.push("Cycle detected in task DAG dependencies")
  for (const t of dag.tasks) {
    for (const dep of (t.dependsOn || [])) {
      if (!taskMap.has(dep)) errors.push(`Task ${t.id} depends on missing task ${dep}`)
    }
  }
  for (const t of dag.tasks) {
    const isReviewOrAudit = t.zone === "B" || t.agent === "reviewer" || t.agent === "auditor"
    if (!isReviewOrAudit && (!Array.isArray(t.acceptanceCriteria) || t.acceptanceCriteria.length === 0)) errors.push(`Task ${t.id} has no acceptance criteria`)
  }
  for (const t of dag.tasks) {
    if (t.title && t.title.length > 200) warnings.push(`Task ${t.id} title exceeds 200 chars (${t.title.length})`)
  }
  for (const t of dag.tasks) {
    if (t.status === "blocked" && Array.isArray(t.dependsOn) && t.dependsOn.length > 0) {
      if (t.dependsOn.every((d) => dependencyDone(dag, d))) warnings.push(`Task ${t.id} is blocked but all dependencies are done`)
    }
  }
  return { ok: errors.length === 0, errors, warnings, taskCount: dag.tasks.length }
}

function runLoop(project, idea, opts) {
  ensureFiles(project);
  const runtime = loadRuntimeConfig(project);
  const requestedMaxSteps = opts.maxSteps || runtime.defaultMaxSteps || 8;
  const maxSteps = opts.execute ? requestedMaxSteps : Math.min(requestedMaxSteps, 1);
  if (idea) bootstrapDag(project, idea);
  if (!loadDag(project).tasks.length) throw new Error("No task DAG exists. Run plan \"IDEA\" first.");

  console.log(`${opts.execute ? "EXECUTE" : "DRY-RUN"} run: maxSteps=${maxSteps}${opts.execute ? "" : " (dry-run limits loop to one dispatch)"}`);
  for (let i = 0; i < maxSteps; i++) {
    const state = loadState(project);
    if (state.rotation?.pending) {
      console.log(`Step ${i + 1}: rotation pending; dispatching handoff-writer`);
      handoff(project, opts);
      continue;
    }

    const next = pickNextTask(project);
    if (!next) {
      console.log(`Step ${i + 1}: no normal tasks; dispatching final audit`);
      audit(project, opts);
      break;
    }
    console.log(`Step ${i + 1}: ${next.id} ${next.status} ${next.agent} — ${next.title}`);
    const result = runTaskStep(project, opts);
    const dv = validateDag(project)
    if (dv.errors.length) console.log(`[DAG ERR] ${dv.errors.join("; ")}`)
    if (!result.ok) {
      console.log(`Step ${i + 1}: failed; stopping loop. Inspect .opencode/team/sessions/`);
      break;
    }
  }
  printStatus(project);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const project = path.resolve(opts.project);

  try {
    switch (opts.command) {
      case "help":
      case "--help":
      case "-h":
        usage();
        break;
      case "init":
        ensureFiles(project);
        console.log(`Initialized team runtime in ${teamPath(project)}`);
        break;
      case "doctor":
        doctor(project);
        break;
      case "status":
        ensureFiles(project);
        printStatus(project);
        break;
      case "plan":
        plan(project, opts.idea, opts);
        printStatus(project);
        break;
      case "step": {
        const res = runTaskStep(project, opts);
        appendStepTrace(project, { kind: "step", ok: res.ok, at: now() })
        printStatus(project);
        break;
      }
      case "run":
        runLoop(project, opts.idea, opts);
        break;
      case "review": {
        const res = review(project, opts);
        appendStepTrace(project, { kind: "review", ok: res.ok, at: now() })
        printStatus(project);
        break;
      }
      case "audit": {
        const res = audit(project, opts);
        appendStepTrace(project, { kind: "audit", ok: res.ok, at: now() })
        printStatus(project);
        break;
      }
      case "browser":
      case "webtest":
        browser(project, opts);
        printStatus(project);
        break;
      case "research":
        research(project, opts);
        printStatus(project);
        break;
      case "router": {
        const out = runRouter(project, ["status"]);
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case "handoff":
      case "rotate": {
        const res = handoff(project, opts);
        appendStepTrace(project, { kind: "handoff", ok: res.ok, at: now() })
        printStatus(project);
        break;
      }
      case "mark": {
        const [id, status, ...note] = opts._;
        if (!id || !status || !STATUS_ORDER.includes(status)) throw new Error(`Usage: mark TASK_ID STATUS. Status: ${STATUS_ORDER.join(", ")}`);
        markTask(project, id, status, note.join(" "));
        printStatus(project);
        break;
      }
      default:
        usage();
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`team-runner error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
