#!/usr/bin/env node
/**
 * opencode-team-runtime P8 overnight orchestrator
 *
 * This runner composes P1-P7 into an end-to-end supervised workflow.
 * It intentionally shells out to existing runners instead of importing private
 * functions, so every module remains independently usable.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, "..");
function runtimeCommand(script) { return `${process.execPath} ${path.join(RUNTIME_ROOT, "scripts", script)}`; }

const VERSION = "0.9.0-p8";
const TEAM = [".opencode", "team"];

function now() { return new Date().toISOString(); }
function id(prefix = "run") { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`; }
function projectPath(project, ...parts) { return path.join(project, ...parts); }
function teamPath(project, ...parts) { return path.join(project, ...TEAM, ...parts); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function exists(p) { return fs.existsSync(p); }
function readText(file, fallback = "") { try { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback; } catch { return fallback; } }
function writeText(file, text) { mkdirp(path.dirname(file)); fs.writeFileSync(file, text); }
function appendText(file, text) { mkdirp(path.dirname(file)); fs.appendFileSync(file, text); }
function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback);
    const raw = fs.readFileSync(file, "utf8").trim();
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }

const DEFAULT_CONFIG = {
  version: VERSION,
  mode: {
    defaultMaxCycles: 12,
    defaultPhaseStepBudget: 1,
    stopAfterConsecutiveFailures: 3,
    stopWhenAllTasksTerminal: true,
    dryRunLimitsCyclesTo: 1,
    requireExecuteFlag: true
  },
  phases: {
    planOnStart: true,
    contextBeforeEveryCycle: true,
    researchOnStart: true,
    researchHeuristics: ["research", "paper", "论文", "调查", "查", "源码", "github", "blog", "docs", "文档"],
    browserEvidence: true,
    browserHeuristics: ["web", "browser", "ui", "frontend", "前端", "网页", "网站", "浏览器", "登录", "captcha", "风控"],
    reviewEveryCycles: 2,
    handoffEveryCycles: 4,
    auditWhenNoRunnableTasks: true,
    memoryLearnAtEnd: true,
    patchSuggestAtEnd: true
  },
  safety: {
    requireHumanForPatchApply: true,
    requireHumanForDangerousPermissions: true,
    allowAutoPatchApply: false,
    allowDangerouslySkipPermissions: false,
    stopBeforeExternalSideEffects: true,
    highRiskKeywords: ["payment", "purchase", "delete account", "prod", "production", "deploy", "付款", "购买", "删除账号", "生产环境", "部署到生产"]
  },
  commands: {
    team: runtimeCommand("team-runner.mjs"),
    context: runtimeCommand("context-runner.mjs"),
    research: runtimeCommand("research-runner.mjs"),
    browser: runtimeCommand("browser-runner.mjs"),
    router: runtimeCommand("router-runner.mjs"),
    memory: runtimeCommand("memory-runner.mjs"),
    patch: runtimeCommand("patch-runner.mjs")
  }
};

const DEFAULT_STATE = {
  version: VERSION,
  activeRunId: null,
  phase: "IDLE",
  cycles: 0,
  consecutiveFailures: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastCommand: null,
  currentIdea: "",
  decisions: [],
  warnings: [],
  checkpoints: []
};

function usage() {
  console.log(`opencode-team-runtime ${VERSION} overnight mode

Usage:
  opencode-overnight doctor [--project DIR]
  opencode-overnight init [--project DIR]
  opencode-overnight status [--project DIR] [--json]
  opencode-overnight run "IDEA" [--project DIR] [--max-cycles N] [--execute]
  opencode-overnight resume [--project DIR] [--max-cycles N] [--execute]
  opencode-overnight step [--project DIR] [--execute]
  opencode-overnight stop [--project DIR] [--reason TEXT]
  opencode-overnight final [--project DIR] [--execute]

Defaults:
  Dry-run unless --execute is supplied.
  Dry-run limits the loop to one cycle.
  High-risk external side effects are not auto-approved.
`);
}

function parse(argv) {
  const args = [...argv];
  const opts = {
    command: args.shift() || "help",
    project: process.cwd(),
    execute: false,
    maxCycles: null,
    reason: "",
    json: false,
    skipResearch: false,
    skipBrowser: false,
    skipMemory: false,
    dangerouslySkipPermissions: false,
    ideaParts: []
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--project", "--dir", "-C"].includes(a)) opts.project = path.resolve(args[++i]);
    else if (["--execute", "--yes"].includes(a)) opts.execute = true;
    else if (a === "--dry-run") opts.execute = false;
    else if (a === "--max-cycles") opts.maxCycles = Number(args[++i]);
    else if (a === "--reason") opts.reason = args[++i] || "";
    else if (a === "--json") opts.json = true;
    else if (a === "--skip-research") opts.skipResearch = true;
    else if (a === "--skip-browser") opts.skipBrowser = true;
    else if (a === "--skip-memory") opts.skipMemory = true;
    else if (a === "--dangerously-skip-permissions") opts.dangerouslySkipPermissions = true;
    else opts.ideaParts.push(a);
  }
  opts.idea = opts.ideaParts.join(" ").trim();
  return opts;
}

function configFile(project) { return teamPath(project, "overnight.config.json"); }
function stateFile(project) { return teamPath(project, "overnight", "state.json"); }
function logFile(project) { return teamPath(project, "overnight", "events.jsonl"); }
function runDir(project, runId) { return teamPath(project, "overnight", "runs", runId); }

function ensure(project) {
  mkdirp(teamPath(project, "overnight", "runs"));
  if (!exists(configFile(project))) writeJson(configFile(project), DEFAULT_CONFIG);
  if (!exists(stateFile(project))) writeJson(stateFile(project), DEFAULT_STATE);
  if (!exists(teamPath(project, "task-dag.json"))) {
    mkdirp(teamPath(project));
    writeJson(teamPath(project, "task-dag.json"), { version: VERSION, goal: "", phase: "INIT", createdAt: null, updatedAt: null, tasks: [], history: [] });
  }
  if (!exists(teamPath(project, "state.json"))) writeJson(teamPath(project, "state.json"), { version: VERSION, phase: "INIT", activeGoal: "", tasks: [], evidence: [], rotation: { pending: false } });
  if (!exists(teamPath(project, "handoff.md"))) writeText(teamPath(project, "handoff.md"), "# Handoff\n\nNo handoff has been written yet.\n");
  if (!exists(teamPath(project, "evidence.md"))) writeText(teamPath(project, "evidence.md"), "# Evidence Log\n\n");
}

function cfg(project) { ensure(project); return readJson(configFile(project), DEFAULT_CONFIG); }
function st(project) { ensure(project); return readJson(stateFile(project), DEFAULT_STATE); }
function saveState(project, s) { s.version = VERSION; writeJson(stateFile(project), s); }
function log(project, event) { appendText(logFile(project), JSON.stringify({ at: now(), ...event }) + "\n"); }
function evidence(project, kind, status, body) {
  appendText(teamPath(project, "evidence.md"), `\n## ${now()} — overnight:${kind} — ${status}\n\n${body.trim()}\n`);
}

function splitCommand(command) {
  // The configured commands are controlled by local config, not user input.
  // Keep this simple and POSIX-friendly.
  return command.split(/\s+/).filter(Boolean);
}

function runConfigured(project, name, args, opts = {}) {
  const c = cfg(project);
  const command = c.commands?.[name];
  if (!command) throw new Error(`No command configured for ${name}`);
  const [bin, ...baseArgs] = splitCommand(command);
  const finalArgs = [...baseArgs, ...args, "--project", project];
  const s = st(project);
  const rid = s.activeRunId || "adhoc";
  const dir = runDir(project, rid);
  mkdirp(dir);
  const safeName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}-${args[0] || "cmd"}-${crypto.randomBytes(2).toString("hex")}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const stdoutFile = path.join(dir, `${safeName}.stdout.log`);
  const stderrFile = path.join(dir, `${safeName}.stderr.log`);
  const metaFile = path.join(dir, `${safeName}.json`);

  const meta = { at: now(), command: name, bin, args: finalArgs, cwd: project, execute: opts.execute ?? false, note: opts.note || "" };
  writeJson(metaFile, meta);
  log(project, { event: "command_start", command: name, args, meta: path.relative(project, metaFile) });

  const res = spawnSync(bin, finalArgs, { cwd: project, encoding: "utf8", maxBuffer: 96 * 1024 * 1024, env: { ...process.env } });
  writeText(stdoutFile, res.stdout || "");
  writeText(stderrFile, res.stderr || "");
  const ok = res.status === 0;
  log(project, { event: "command_end", command: name, ok, code: res.status, stdout: path.relative(project, stdoutFile), stderr: path.relative(project, stderrFile) });
  return { ok, code: res.status, stdout: res.stdout || "", stderr: res.stderr || "", stdoutFile, stderrFile, metaFile, error: res.error };
}

function runTeam(project, command, args = [], opts = {}) {
  const cli = [command, ...args];
  if (opts.execute) cli.push("--execute");
  if (opts.dangerouslySkipPermissions) cli.push("--dangerously-skip-permissions");
  return runConfigured(project, "team", cli, opts);
}
function runContext(project, command, args = [], opts = {}) { return runConfigured(project, "context", [command, ...args], opts); }
function runResearch(project, command, args = [], opts = {}) { return runConfigured(project, "research", [command, ...args], opts); }
function runBrowser(project, command, args = [], opts = {}) { return runConfigured(project, "browser", [command, ...args], opts); }
function runRouter(project, command, args = [], opts = {}) { return runConfigured(project, "router", [command, ...args], opts); }
function runMemory(project, command, args = [], opts = {}) { return runConfigured(project, "memory", [command, ...args], opts); }
function runPatch(project, command, args = [], opts = {}) { return runConfigured(project, "patch", [command, ...args], opts); }

function readDag(project) { return readJson(teamPath(project, "task-dag.json"), { tasks: [], goal: "", phase: "INIT" }); }
function terminalTasks(dag) { return (dag.tasks || []).filter((t) => ["done", "passed"].includes(t.status)).length; }
function runnableTasks(dag) { return (dag.tasks || []).filter((t) => !["done", "passed", "blocked"].includes(t.status)); }
function failedTasks(dag) { return (dag.tasks || []).filter((t) => ["failed", "blocked"].includes(t.status)); }
function hasTasks(dag) { return Array.isArray(dag.tasks) && dag.tasks.length > 0; }
function ideaHasAny(idea, words) {
  const lower = String(idea || "").toLowerCase();
  return words.some((w) => lower.includes(String(w).toLowerCase()));
}
function highRisk(idea, conf) { return ideaHasAny(idea, conf.safety?.highRiskKeywords || []); }

function startRun(project, idea, opts) {
  ensure(project);
  const s = st(project);
  const rid = id("overnight");
  s.activeRunId = rid;
  s.phase = "STARTING";
  s.cycles = 0;
  s.consecutiveFailures = 0;
  s.lastStartedAt = now();
  s.lastFinishedAt = null;
  s.currentIdea = idea || s.currentIdea || "";
  s.decisions = [];
  s.warnings = [];
  s.checkpoints = [];
  saveState(project, s);
  mkdirp(runDir(project, rid));
  writeText(path.join(runDir(project, rid), "idea.txt"), idea || "");
  log(project, { event: "run_start", runId: rid, execute: opts.execute, idea: idea.slice(0, 1000) });
  evidence(project, "run-start", opts.execute ? "executing" : "dry-run", `Run: ${rid}\nExecute: ${opts.execute}\nIdea:\n${idea}`);
  return rid;
}

function updatePhase(project, phase, extra = {}) {
  const s = st(project);
  s.phase = phase;
  s.lastCommand = { at: now(), phase, ...extra };
  saveState(project, s);
  log(project, { event: "phase", phase, ...extra });
}

function recordDecision(project, decision) {
  const s = st(project);
  if (!Array.isArray(s.decisions)) s.decisions = [];
  s.decisions.push({ at: now(), ...decision });
  saveState(project, s);
  log(project, { event: "decision", ...decision });
}

function recordWarning(project, warning) {
  const s = st(project);
  if (!Array.isArray(s.warnings)) s.warnings = [];
  s.warnings.push({ at: now(), warning });
  saveState(project, s);
  log(project, { event: "warning", warning });
}

function traceFile(project, runId) { return path.join(runDir(project, runId), "trace.json") }

function loadTrace(project, runId) {
  return readJson(traceFile(project, runId), { runId, steps: [] })
}

function recordStepTrace(project, trace) {
  const s = st(project)
  const rid = s.activeRunId || "adhoc"
  const file = traceFile(project, rid)
  const existing = loadTrace(project, rid)
  existing.steps.push(trace)
  existing.updatedAt = now()
  writeJson(file, existing)
}

function safeToProceed(project, idea, opts) {
  const c = cfg(project);
  if (opts.dangerouslySkipPermissions && !c.safety?.allowDangerouslySkipPermissions) {
    recordWarning(project, "Refusing --dangerously-skip-permissions because overnight.config.json safety.allowDangerouslySkipPermissions=false");
    return { ok: false, reason: "dangerously-skip-permissions not allowed by overnight safety config" };
  }
  if (highRisk(idea, c) && c.safety?.stopBeforeExternalSideEffects !== false) {
    recordWarning(project, "High-risk keywords detected. Overnight mode will not auto-run high-risk external side effects.");
    return { ok: false, reason: "high-risk idea requires manual supervision" };
  }
  return { ok: true, reason: "" };
}

function preflight(project, opts) {
  updatePhase(project, "PREFLIGHT");
  const commands = [
    ["team", "doctor", [], {}],
    ["router", "doctor", [], {}],
    ["context", "doctor", [], {}],
    ["memory", "doctor", [], {}],
    ["patch", "doctor", [], {}]
  ];
  let ok = true;
  for (const [name, command, args, extra] of commands) {
    const res = name === "team" ? runTeam(project, command, args, extra) : name === "router" ? runRouter(project, command, args, extra) : name === "context" ? runContext(project, command, args, extra) : name === "memory" ? runMemory(project, command, args, extra) : runPatch(project, command, args, extra);
    ok = ok && res.ok;
  }
  evidence(project, "preflight", ok ? "passed" : "failed", `Preflight ${ok ? "passed" : "failed"}. Logs are under .opencode/team/overnight/runs/.`);
  return ok;
}

function maybeResearch(project, idea, opts) {
  const startedAt = now()
  const c = cfg(project);
  if (opts.skipResearch || c.phases?.researchOnStart === false) {
    recordStepTrace(project, { phase: "RESEARCH", startedAt, endedAt: null, durationMs: null, skipped: true, reason: "disabled" })
    return { skipped: true, reason: "disabled" }
  }
  if (!ideaHasAny(idea, c.phases?.researchHeuristics || [])) {
    recordStepTrace(project, { phase: "RESEARCH", startedAt, endedAt: null, durationMs: null, skipped: true, reason: "heuristic did not match" })
    return { skipped: true, reason: "heuristic did not match" }
  }
  updatePhase(project, "RESEARCH");
  runContext(project, "ingest", ["--all"]);
  const res = runTeam(project, "research", [idea || "Research the current project goal and collect evidence-backed claims."], { execute: opts.execute });
  runResearch(project, "validate", []);
  runResearch(project, "report", ["--topic", "overnight-start-research"]);
  recordStepTrace(project, { phase: "RESEARCH", startedAt, endedAt: null, durationMs: null, skipped: false, reason: "completed" })
  return res;
}

function maybeBrowser(project, idea, opts, cycle) {
  const startedAt = now()
  const c = cfg(project);
  if (opts.skipBrowser || c.phases?.browserEvidence === false) {
    recordStepTrace(project, { phase: "BROWSER_EVIDENCE", startedAt, endedAt: null, durationMs: null, skipped: true, reason: "disabled" })
    return { skipped: true, reason: "disabled" }
  }
  if (!ideaHasAny(idea, c.phases?.browserHeuristics || [])) {
    recordStepTrace(project, { phase: "BROWSER_EVIDENCE", startedAt, endedAt: null, durationMs: null, skipped: true, reason: "heuristic did not match" })
    return { skipped: true, reason: "heuristic did not match" }
  }
  if (cycle > 1 && cycle % 3 !== 0) {
    recordStepTrace(project, { phase: "BROWSER_EVIDENCE", startedAt, endedAt: null, durationMs: null, skipped: true, reason: "not browser cycle" })
    return { skipped: true, reason: "not browser cycle" }
  }
  updatePhase(project, "BROWSER_EVIDENCE", { cycle });
  const res = runTeam(project, "browser", [idea || "Collect browser evidence for current web/UI behavior. Use headed/manual mode if user action is required."], { execute: opts.execute });
  recordStepTrace(project, { phase: "BROWSER_EVIDENCE", startedAt, endedAt: null, durationMs: null, skipped: false, reason: "completed" })
  return res;
}

function contextPack(project, label = "current overnight state") {
  const startedAt = now()
  recordStepTrace(project, { phase: "CONTEXT_PACK", startedAt, endedAt: null, durationMs: null, label })
  updatePhase(project, "CONTEXT_PACK", { label });
  runContext(project, "ingest", ["--all"]);
  return runContext(project, "pack", [label, "--max-chars", "20000"]);
}

function reviewIfDue(project, opts, cycle) {
  const c = cfg(project);
  const every = Number(c.phases?.reviewEveryCycles || 0);
  if (!every || cycle % every !== 0) return { skipped: true };
  updatePhase(project, "REVIEW", { cycle });
  contextPack(project, "review current diff evidence tests failures");
  return runTeam(project, "review", [], { execute: opts.execute });
}

function handoffIfDue(project, opts, cycle) {
  const c = cfg(project);
  const every = Number(c.phases?.handoffEveryCycles || 0);
  if (!every || cycle % every !== 0) return { skipped: true };
  updatePhase(project, "HANDOFF", { cycle });
  contextPack(project, "handoff goal current state done failed attempts next task");
  return runTeam(project, "handoff", [], { execute: opts.execute });
}

function runCycle(project, idea, opts, cycle) {
  const startedAt = now()
  updatePhase(project, "CYCLE", { cycle });
  contextPack(project, `cycle ${cycle} current task context`);
  const work = runTeam(project, "step", [], { execute: opts.execute, dangerouslySkipPermissions: opts.dangerouslySkipPermissions });
  recordStepTrace(project, { phase: "CYCLE", cycle, startedAt, endedAt: null, durationMs: null, teamOk: work.ok })
  maybeBrowser(project, idea, opts, cycle);
  reviewIfDue(project, opts, cycle);
  handoffIfDue(project, opts, cycle);
  runContext(project, "ingest", ["--all"]);
  return work;
}

function finalPass(project, opts) {
  updatePhase(project, "FINAL_PASS");
  contextPack(project, "final audit current state all evidence failures handoff");
  const review = runTeam(project, "review", [], { execute: opts.execute });
  const audit = runTeam(project, "audit", [], { execute: opts.execute });
  const handoff = runTeam(project, "handoff", [], { execute: opts.execute });
  if (!opts.skipMemory) {
    runMemory(project, "learn", ["--from", "all"]);
    runMemory(project, "suggestions", []);
  }
  const ok = Boolean(review.ok && audit.ok && handoff.ok);
  evidence(project, "final-gate", ok ? "passed" : "blocked", `Review: ${review.ok}\nAudit: ${audit.ok}\nHandoff: ${handoff.ok}\nA run may only be marked FINISHED when this gate passes.`);
  return { ok, review, audit, handoff };
}

function stopRun(project, reason = "manual stop") {
  const s = st(project);
  s.phase = "STOPPED";
  s.lastFinishedAt = now();
  s.checkpoints = s.checkpoints || [];
  s.checkpoints.push({ at: now(), kind: "stop", reason });
  saveState(project, s);
  log(project, { event: "run_stop", reason, runId: s.activeRunId });
  evidence(project, "run-stop", "stopped", reason);
  console.log(`Stopped overnight run: ${reason}`);
}

function runOvernight(project, idea, opts, resume = false) {
  ensure(project);
  const c = cfg(project);
  let s = st(project);
  const effectiveIdea = idea || s.currentIdea || readDag(project).goal || "";
  if (!effectiveIdea) throw new Error("run/resume requires an IDEA string or existing DAG goal");

  const safety = safeToProceed(project, effectiveIdea, opts);
  if (!safety.ok) {
    console.error(`Safety stop: ${safety.reason}`);
    evidence(project, "safety", "blocked", safety.reason);
    return { ok: false, reason: safety.reason };
  }

  if (!resume || !s.activeRunId) startRun(project, effectiveIdea, opts);
  s = st(project);
  const requestedCycles = opts.maxCycles || Number(c.mode?.defaultMaxCycles || 12);
  const maxCycles = opts.execute ? requestedCycles : Math.min(requestedCycles, Number(c.mode?.dryRunLimitsCyclesTo || 1));

  preflight(project, opts);

  const dag = readDag(project);
  if (c.phases?.planOnStart !== false && (!hasTasks(dag) || !resume)) {
    updatePhase(project, "PLAN");
    runTeam(project, "plan", [effectiveIdea], { execute: opts.execute });
  }

  maybeResearch(project, effectiveIdea, opts);

  for (let i = 1; i <= maxCycles; i++) {
    s = st(project);
    s.cycles = (s.cycles || 0) + 1;
    saveState(project, s);
    const before = readDag(project);
    const noRunnable = hasTasks(before) && runnableTasks(before).length === 0;
    if (noRunnable && c.mode?.stopWhenAllTasksTerminal !== false) {
      recordDecision(project, { kind: "no-runnable-tasks", cycle: i, terminal: terminalTasks(before), total: before.tasks.length });
      if (c.phases?.auditWhenNoRunnableTasks !== false) {
        const final = finalPass(project, opts);
        if (!final.ok) {
          updatePhase(project, "FINAL_GATE_BLOCKED", { cycle: i });
          break;
        }
      }
      break;
    }

    const res = runCycle(project, effectiveIdea, opts, i);
    s = st(project)
    const trace = loadTrace(project, s.activeRunId || "adhoc")
    const cycEntry = trace.steps.findLast(e => e.phase === "CYCLE" && e.cycle === i)
    if (cycEntry) {
      cycEntry.endedAt = now()
      cycEntry.durationMs = new Date(cycEntry.endedAt) - new Date(cycEntry.startedAt)
      writeJson(traceFile(project, s.activeRunId || "adhoc"), trace)
    }
    recordStepTrace(project, { phase: "CYCLE_COMPLETE", cycle: i, startedAt: now(), endedAt: null, durationMs: null })
    const after = readDag(project);
    const failed = !res.ok || failedTasks(after).length > failedTasks(before).length;
    s = st(project);
    s.consecutiveFailures = failed ? (s.consecutiveFailures || 0) + 1 : 0;
    saveState(project, s);

    if (failed) {
      recordDecision(project, { kind: "failure-detected", cycle: i, consecutiveFailures: s.consecutiveFailures });
      runMemory(project, "record", ["--kind", "failure", "--agent", "overnight", "--model", "runtime", "--text", `cycle ${i} failed or increased failed tasks`, "--tags", "overnight,cycle-failure"]);
      if (s.consecutiveFailures >= Number(c.mode?.stopAfterConsecutiveFailures || 3)) {
        updatePhase(project, "FAILURE_STOP", { cycle: i });
        runTeam(project, "handoff", [], { execute: opts.execute });
        evidence(project, "failure-stop", "failed", `Stopped after ${s.consecutiveFailures} consecutive failures.`);
        break;
      }
    }
  }

  const final = finalPass(project, opts);
  s = st(project);
  s.phase = final.ok ? "FINISHED" : "FINAL_GATE_BLOCKED";
  s.lastFinishedAt = now();
  saveState(project, s);
  log(project, { event: "run_finish", runId: s.activeRunId, cycles: s.cycles });
  evidence(project, "run-finish", final.ok ? (opts.execute ? "completed" : "dry-run") : "blocked", `Run ${s.activeRunId} ${final.ok ? "finished" : "stopped before completion because final gate failed"} after ${s.cycles} recorded cycles.`);
  return { ok: final.ok, runId: s.activeRunId, blocked: !final.ok };
}

function printStatus(project, json = false) {
  ensure(project);
  const s = st(project);
  const d = readDag(project);
  const summary = {
    version: VERSION,
    project,
    activeRunId: s.activeRunId,
    phase: s.phase,
    cycles: s.cycles,
    consecutiveFailures: s.consecutiveFailures,
    currentIdea: s.currentIdea,
    goal: d.goal,
    tasks: (d.tasks || []).map((t) => ({ id: t.id, status: t.status, agent: t.agent, title: t.title })),
    warnings: (s.warnings || []).slice(-5),
    decisions: (s.decisions || []).slice(-5),
    events: logFile(project)
  };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Overnight ${VERSION}`);
    console.log(`Project: ${project}`);
    console.log(`Run: ${summary.activeRunId || "<none>"}`);
    console.log(`Phase: ${summary.phase}`);
    console.log(`Cycles: ${summary.cycles}; consecutive failures: ${summary.consecutiveFailures}`);
    console.log(`Goal: ${summary.goal || summary.currentIdea || "<unset>"}`);
    console.log("\nTasks:");
    if (!summary.tasks.length) console.log("  <none>");
    for (const t of summary.tasks) console.log(`  ${String(t.id).padEnd(12)} ${String(t.status).padEnd(13)} ${String(t.agent || "").padEnd(18)} ${t.title}`);
    if (summary.warnings.length) {
      console.log("\nWarnings:");
      for (const w of summary.warnings) console.log(`  ${w.at || ""} ${w.warning}`);
    }
    console.log(`\nLog: ${path.relative(project, logFile(project))}`);
  }
}

function doctor(project) {
  ensure(project);
  const checks = [];
  const add = (name, ok, note = "") => checks.push({ name, ok, note });
  add("project exists", exists(project), project);
  add("overnight config", exists(configFile(project)), path.relative(project, configFile(project)));
  add("overnight state", exists(stateFile(project)), path.relative(project, stateFile(project)));
  add("global runtime root", exists(RUNTIME_ROOT), RUNTIME_ROOT);
  for (const f of [
    "team-runner.mjs",
    "context-runner.mjs",
    "research-runner.mjs",
    "browser-runner.mjs",
    "router-runner.mjs",
    "memory-runner.mjs",
    "patch-runner.mjs"
  ]) add(`global script ${f}`, exists(path.join(RUNTIME_ROOT, "scripts", f)));
  const which = spawnSync("bash", ["-lc", "command -v opencode || true"], { encoding: "utf8" });
  add("opencode command", Boolean(which.stdout.trim()), which.stdout.trim() || "not found; --execute will fail until installed");
  let ok = true;
  for (const c of checks) {
    if (c.name !== "opencode command") ok = ok && c.ok;
    console.log(`${c.ok ? "✓" : c.name === "opencode command" ? "!" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`);
  }
  process.exitCode = ok ? 0 : 1;
}

function main() {
  const opts = parse(process.argv.slice(2));
  const project = path.resolve(opts.project);
  try {
    switch (opts.command) {
      case "help": case "--help": case "-h": usage(); break;
      case "init": ensure(project); console.log(`Initialized overnight mode in ${teamPath(project, "overnight")}`); break;
      case "doctor": doctor(project); break;
      case "status": printStatus(project, opts.json); break;
      case "run": runOvernight(project, opts.idea, opts, false); printStatus(project, opts.json); break;
      case "resume": runOvernight(project, opts.idea, opts, true); printStatus(project, opts.json); break;
      case "step": {
        ensure(project);
        const idea = opts.idea || st(project).currentIdea || readDag(project).goal || "";
        runCycle(project, idea, opts, (st(project).cycles || 0) + 1);
        printStatus(project, opts.json);
        break;
      }
      case "final": finalPass(project, opts); printStatus(project, opts.json); break;
      case "stop": stopRun(project, opts.reason || opts.idea || "manual stop"); break;
      default: usage(); process.exitCode = 1;
    }
  } catch (err) {
    console.error(`overnight-runner error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
