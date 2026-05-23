#!/usr/bin/env node
/**
 * opencode-team-runtime P5 router runner
 *
 * Deterministic model routing, budget accounting, and failure escalation.
 * No third-party dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const VERSION = "0.11.0-p8.4";
const TEAM_DIR = [".opencode", "team"];

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function rel(project, file) { return path.relative(project, file); }
function teamPath(project, ...parts) { return path.join(project, ...TEAM_DIR, ...parts); }
function routerPath(project, ...parts) { return teamPath(project, "router", ...parts); }

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return clone(fallback);
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}
function appendEvidence(project, type, status, body) {
  const file = teamPath(project, "evidence.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `\n## ${now()} — ${type} — ${status}\n\n${String(body || "").trim()}\n`);
}

function builtinRegistry() {
  return {
    version: VERSION,
    models: {
      worker: { label: "A-zone worker (MiniMax M2.7 204K)", opencodeModel: "minimax/minimax-m2.7", tier: "budget", capabilities: ["text", "coding", "bulk-edit"], contextBudgetTokens: 204800, softRotationRatio: 0.80, hardRotationRatio: 0.85 },
      supervisor: { label: "Supervisor/reviewer (DeepSeek V4 Pro 1M→768K usable)", opencodeModel: "deepseek/deepseek-v4-pro", tier: "strong", capabilities: ["text", "coding", "planning", "review"], contextBudgetTokens: 768000, softRotationRatio: 0.78, hardRotationRatio: 0.95 },
      handoff: { label: "Handoff/research (Qwen3.7 Max 1M→768K usable)", opencodeModel: "qwen/qwen3.7-max", tier: "strong", capabilities: ["text", "long-context", "handoff", "planning"], contextBudgetTokens: 768000, softRotationRatio: 0.78, hardRotationRatio: 0.95 },
      checkpoint: { label: "Checkpoint auditor (GPT-5.5 400K→200K rotate)", opencodeModel: "openai/gpt-5.5", tier: "premium", capabilities: ["text", "review", "audit", "hard-debug", "vision"], contextBudgetTokens: 200000, softRotationRatio: 0.75, hardRotationRatio: 0.90 },
    },
  };
}
function defaultRegistry() {
  const runtimeRoot = process.env.OPENCODE_TEAM_RUNTIME_ROOT || "";
  const globalRegistry = runtimeRoot ? path.join(runtimeRoot, "team", "router", "model-registry.json") : "";
  if (globalRegistry && fs.existsSync(globalRegistry)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(globalRegistry, "utf8"));
      if (parsed?.models) return parsed;
    } catch {}
  }
  return builtinRegistry();
}
function defaultPolicy() {
  return {
    version: VERSION,
    budget: { dailySoftLimit: 0, dailyHardLimit: 0, premiumCallsSoftLimit: 8, premiumCallsHardLimit: 20, requireExplicitExecuteForPremium: true },
    roles: {
      "chief-engineer": { defaultModel: "supervisor", fallbackModels: ["handoff", "checkpoint"], premiumAllowed: true },
      "a-zone-coder": { defaultModel: "worker", fallbackModels: ["supervisor"], premiumAllowed: false },
      "minimax-coder": { defaultModel: "worker", fallbackModels: ["supervisor"], premiumAllowed: false },
      tester: { defaultModel: "worker", fallbackModels: ["supervisor"], premiumAllowed: false },
      reviewer: { defaultModel: "supervisor", fallbackModels: ["handoff", "checkpoint"], premiumAllowed: true },
      auditor: { defaultModel: "checkpoint", fallbackModels: ["handoff", "supervisor"], premiumAllowed: true, checkpointOnly: true },
      "handoff-writer": { defaultModel: "handoff", fallbackModels: ["supervisor"], premiumAllowed: false },
    },
    escalation: { afterFailures: 2, maxMiniMaxAttempts: 2, premiumEscalationReasons: ["final-audit", "repeated-failure", "claimed-but-missing"] },
    routingRules: [],
  };
}
function defaultUsage() {
  return { version: VERSION, totals: { calls: 0, premiumCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 }, byModel: {}, byAgent: {}, byDay: {} };
}

function ensureRouter(project) {
  fs.mkdirSync(routerPath(project), { recursive: true });
  fs.mkdirSync(routerPath(project, "checkpoints"), { recursive: true });
  const registryFile = routerPath(project, "model-registry.json");
  const policyFile = routerPath(project, "policy.json");
  const usageFile = routerPath(project, "usage.json");
  const decisionsFile = routerPath(project, "decisions.jsonl");
  if (!fs.existsSync(registryFile)) writeJson(registryFile, defaultRegistry());
  if (!fs.existsSync(policyFile)) writeJson(policyFile, defaultPolicy());
  if (!fs.existsSync(usageFile)) writeJson(usageFile, defaultUsage());
  if (!fs.existsSync(decisionsFile)) fs.writeFileSync(decisionsFile, "");
  return { registryFile, policyFile, usageFile, decisionsFile };
}

function loadRuntimeConfig(project) {
  return readJson(teamPath(project, "runtime.config.json"), { runtime: {} });
}
function loadRouter(project) {
  ensureRouter(project);
  return {
    registry: readJson(routerPath(project, "model-registry.json"), defaultRegistry()),
    policy: readJson(routerPath(project, "policy.json"), defaultPolicy()),
    usage: readJson(routerPath(project, "usage.json"), defaultUsage()),
  };
}
function readDag(project) { return readJson(teamPath(project, "task-dag.json"), { tasks: [] }); }
function readState(project) { return readJson(teamPath(project, "state.json"), {}); }

function usage() {
  console.log(`opencode-team-runtime router ${VERSION}

Usage:
  node .opencode/scripts/router-runner.mjs doctor [--project DIR]
  node .opencode/scripts/router-runner.mjs status [--project DIR]
  node .opencode/scripts/router-runner.mjs models [--project DIR] [--json]
  node .opencode/scripts/router-runner.mjs policy [--project DIR] [--json]
  node .opencode/scripts/router-runner.mjs decide --role ROLE [--project DIR] [--kind work] [--task TASK_ID] [--attempts N] [--reason TEXT] [--execute] [--json]
  node .opencode/scripts/router-runner.mjs record --agent AGENT --model MODEL [--task TASK_ID] [--status passed|failed] [--input-tokens N] [--output-tokens N] [--cost N]
  node .opencode/scripts/router-runner.mjs budget [--project DIR] [--json]
  node .opencode/scripts/router-runner.mjs escalate --role ROLE --reason TEXT [--attempts N] [--json]
  node .opencode/scripts/router-runner.mjs checkpoint --kind final-audit|initial-plan|stuck [--reason TEXT] [--json]

Notes:
  - Edit .opencode/team/router/model-registry.json to map aliases to your real opencode model IDs.
  - Edit .opencode/team/router/policy.json to set premium call limits and escalation rules.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = { command: args.shift() || "help", project: process.cwd(), role: "", agent: "", model: "", task: "", kind: "work", reason: "", status: "", attempts: null, inputTokens: 0, outputTokens: 0, cost: 0, execute: false, json: false, _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--project", "--dir", "-C"].includes(a)) opts.project = path.resolve(args[++i]);
    else if (a === "--role") opts.role = args[++i];
    else if (a === "--agent") opts.agent = args[++i];
    else if (a === "--model") opts.model = args[++i];
    else if (a === "--task") opts.task = args[++i];
    else if (a === "--kind") opts.kind = args[++i];
    else if (a === "--reason") opts.reason = args[++i];
    else if (a === "--status") opts.status = args[++i];
    else if (a === "--attempts") opts.attempts = Number(args[++i]);
    else if (a === "--input-tokens") opts.inputTokens = Number(args[++i]);
    else if (a === "--output-tokens") opts.outputTokens = Number(args[++i]);
    else if (a === "--cost") opts.cost = Number(args[++i]);
    else if (a === "--execute" || a === "--yes") opts.execute = true;
    else if (a === "--json") opts.json = true;
    else opts._.push(a);
  }
  if (!opts.reason && opts._.length) opts.reason = opts._.join(" ");
  return opts;
}

function inferTask(project, taskId) {
  const dag = readDag(project);
  if (!taskId) return null;
  return (dag.tasks || []).find((t) => t.id === taskId) || null;
}

function dailyUsage(usage) {
  const d = today();
  return usage.byDay?.[d] || { calls: 0, premiumCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
}

function isPremiumModel(registry, alias) {
  const m = registry.models?.[alias];
  return m?.tier === "premium";
}

function rolePolicy(policy, role) {
  return policy.roles?.[role] || policy.roles?.["chief-engineer"] || { defaultModel: "supervisor", fallbackModels: [] };
}

function matchRule(rule, input) {
  const m = rule.match || {};
  if (m.role && m.role !== input.role) return false;
  if (m.kind && m.kind !== input.kind) return false;
  if (m.attemptsAtLeast !== undefined && Number(input.attempts || 0) < Number(m.attemptsAtLeast)) return false;
  if (m.reasonIncludes && !String(input.reason || "").toLowerCase().includes(String(m.reasonIncludes).toLowerCase())) return false;
  return true;
}

function chooseByBudget(project, registry, policy, usage, alias, allowPremium, execute) {
  const model = registry.models?.[alias];
  const warnings = [];
  if (!model) return { alias, allowed: false, warnings: [`Unknown model alias: ${alias}`] };
  const premium = model.tier === "premium";
  const budget = policy.budget || {};
  const day = dailyUsage(usage);
  if (premium && !allowPremium) warnings.push(`Role does not normally allow premium model ${alias}.`);
  if (premium && budget.premiumCallsHardLimit > 0 && day.premiumCalls >= budget.premiumCallsHardLimit) warnings.push(`Daily premium hard limit reached: ${day.premiumCalls}/${budget.premiumCallsHardLimit}.`);
  if (budget.dailyHardLimit > 0 && day.estimatedCost >= budget.dailyHardLimit) warnings.push(`Daily cost hard limit reached: ${day.estimatedCost}/${budget.dailyHardLimit}.`);
  if (premium && budget.requireExplicitExecuteForPremium && !execute) warnings.push("Premium route selected in dry-run; add --execute when intentionally spending tokens.");
  const hardBlocked = warnings.some((w) => w.includes("hard limit"));
  return { alias, allowed: !hardBlocked, warnings };
}

function decide(project, input = {}) {
  const { registry, policy, usage } = loadRouter(project);
  const dagTask = inferTask(project, input.task);
  const role = input.role || dagTask?.agent || "chief-engineer";
  const attempts = input.attempts ?? dagTask?.attempts ?? 0;
  const reason = input.reason || "";
  const kind = input.kind || "work";

  let routedRole = role;
  let forcedModel = "";
  const reasons = [];
  const warnings = [];

  for (const rule of policy.routingRules || []) {
    if (matchRule(rule, { role, kind, attempts, reason })) {
      if (rule.routeToRole) routedRole = rule.routeToRole;
      if (rule.forceModel) forcedModel = rule.forceModel;
      reasons.push(rule.reason || `Matched routing rule for ${role}`);
      break;
    }
  }

  const rp = rolePolicy(policy, routedRole);
  let alias = forcedModel || rp.defaultModel;
  const allCandidates = [alias, ...(rp.fallbackModels || [])].filter(Boolean);

  // Cheap-model failure escalation.
  const esc = policy.escalation || {};
    if (!forcedModel && ["a-zone-coder", "minimax-coder"].includes(role) && attempts >= (esc.maxMiniMaxAttempts ?? 2)) {
    routedRole = "chief-engineer";
    const erp = rolePolicy(policy, routedRole);
    alias = erp.defaultModel || alias;
      reasons.push(`A-zone worker attempts ${attempts} exceeded maxMiniMaxAttempts; escalate to ${routedRole}.`);
  }

  const premiumReasons = esc.premiumEscalationReasons || [];
  const reasonLower = String(reason).toLowerCase();
  const premiumTrigger = premiumReasons.some((x) => reasonLower.includes(String(x).toLowerCase())) || kind === "final-audit" || kind === "checkpoint";
  if (!forcedModel && premiumTrigger && rp.premiumAllowed !== false) {
    const premiumCandidate = allCandidates.find((x) => isPremiumModel(registry, x));
    if (premiumCandidate) {
      alias = premiumCandidate;
      reasons.push(`Premium checkpoint triggered by ${kind || reason || "policy"}.`);
    }
  }

  let budgetCheck = chooseByBudget(project, registry, policy, usage, alias, rp.premiumAllowed !== false, Boolean(input.execute));
  warnings.push(...budgetCheck.warnings);

  if (!budgetCheck.allowed) {
    const fallback = allCandidates.find((x) => x !== alias && chooseByBudget(project, registry, policy, usage, x, true, Boolean(input.execute)).allowed);
    if (fallback) {
      warnings.push(`Falling back from ${alias} to ${fallback}.`);
      alias = fallback;
      budgetCheck = chooseByBudget(project, registry, policy, usage, alias, true, Boolean(input.execute));
    }
  }

  const model = registry.models?.[alias] || { opencodeModel: alias, tier: "unknown" };
  const decision = {
    id: `route-${crypto.randomBytes(4).toString("hex")}`,
    at: now(),
    role,
    routedRole,
    kind,
    task: dagTask ? { id: dagTask.id, title: dagTask.title, status: dagTask.status, attempts: dagTask.attempts || 0 } : input.task || null,
    attempts,
    reason,
    modelAlias: alias,
    opencodeModel: model.opencodeModel || alias,
    modelTier: model.tier || "unknown",
    capabilities: model.capabilities || [],
    contextBudgetTokens: model.contextBudgetTokens || null,
    softRotationRatio: model.softRotationRatio || null,
    hardRotationRatio: model.hardRotationRatio || null,
    reasons: reasons.length ? reasons : [`Default route for ${routedRole}.`],
    warnings,
    allowed: budgetCheck.allowed,
  };
  appendLine(routerPath(project, "decisions.jsonl"), decision);
  return decision;
}

function record(project, input) {
  ensureRouter(project);
  const { registry, usage } = loadRouter(project);
  const agent = input.agent || input.role || "unknown-agent";
  const modelAlias = input.model || "unknown-model";
  const model = registry.models?.[modelAlias] || { tier: modelAlias.includes("gpt") || modelAlias.includes("opus") ? "premium" : "unknown" };
  const premium = model.tier === "premium";
  const day = today();
  const cost = Number(input.cost || 0);
  const inTok = Number(input.inputTokens || 0);
  const outTok = Number(input.outputTokens || 0);

  function bump(obj, key) {
    obj[key] ||= { calls: 0, premiumCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0, passed: 0, failed: 0 };
    obj[key].calls += 1;
    if (premium) obj[key].premiumCalls += 1;
    obj[key].inputTokens += inTok;
    obj[key].outputTokens += outTok;
    obj[key].estimatedCost += cost;
    if (input.status === "passed") obj[key].passed += 1;
    if (input.status === "failed") obj[key].failed += 1;
  }

  usage.totals ||= { calls: 0, premiumCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  usage.totals.calls += 1;
  if (premium) usage.totals.premiumCalls += 1;
  usage.totals.inputTokens += inTok;
  usage.totals.outputTokens += outTok;
  usage.totals.estimatedCost += cost;
  usage.byModel ||= {};
  usage.byAgent ||= {};
  usage.byDay ||= {};
  bump(usage.byModel, modelAlias);
  bump(usage.byAgent, agent);
  bump(usage.byDay, day);
  usage.updatedAt = now();
  writeJson(routerPath(project, "usage.json"), usage);

  const entry = { at: now(), event: "usage_recorded", agent, modelAlias, premium, task: input.task || null, status: input.status || "unknown", inputTokens: inTok, outputTokens: outTok, cost, reason: input.reason || "" };
  appendLine(routerPath(project, "decisions.jsonl"), entry);
  appendEvidence(project, "router", input.status || "recorded", `Agent: ${agent}\nModel: ${modelAlias}\nPremium: ${premium}\nTask: ${input.task || "<none>"}\nInput tokens: ${inTok}\nOutput tokens: ${outTok}\nEstimated cost: ${cost}\nReason: ${input.reason || ""}`);
  return usage;
}

function checkpoint(project, input) {
  const kind = input.kind || input.commandKind || "checkpoint";
  const reason = input.reason || kind;
  let role = "reviewer";
  if (kind.includes("final") || reason.includes("final")) role = "auditor";
  if (kind.includes("visual") || reason.includes("visual")) role = "visual-reviewer";
  const decision = decide(project, { role, kind: "checkpoint", reason, execute: input.execute });
  const file = routerPath(project, "checkpoints", `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}.json`);
  writeJson(file, { at: now(), kind, reason, decision });
  appendEvidence(project, "router-checkpoint", "requested", `Kind: ${kind}\nReason: ${reason}\nAgent: ${decision.routedRole}\nModel: ${decision.opencodeModel}\nRecord: ${rel(project, file)}`);
  return { kind, reason, decision, file: rel(project, file) };
}

function printStatus(project, json = false) {
  const { registry, policy, usage } = loadRouter(project);
  const day = dailyUsage(usage);
  const out = {
    version: VERSION,
    project,
    models: Object.keys(registry.models || {}).length,
    roles: Object.keys(policy.roles || {}).length,
    totals: usage.totals || {},
    today: day,
    budget: policy.budget || {},
    files: {
      registry: rel(project, routerPath(project, "model-registry.json")),
      policy: rel(project, routerPath(project, "policy.json")),
      usage: rel(project, routerPath(project, "usage.json")),
      decisions: rel(project, routerPath(project, "decisions.jsonl")),
    },
  };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Router: ${VERSION}`);
    console.log(`Project: ${project}`);
    console.log(`Models: ${out.models}`);
    console.log(`Roles: ${out.roles}`);
    console.log(`Total calls: ${out.totals.calls || 0}, premium: ${out.totals.premiumCalls || 0}, estimated cost: ${out.totals.estimatedCost || 0}`);
    console.log(`Today calls: ${day.calls || 0}, premium: ${day.premiumCalls || 0}, estimated cost: ${day.estimatedCost || 0}`);
    console.log(`Premium limit: ${out.budget.premiumCallsSoftLimit || 0}/${out.budget.premiumCallsHardLimit || 0}`);
    console.log(`Policy: ${out.files.policy}`);
  }
}

function printModels(project, json = false) {
  const { registry } = loadRouter(project);
  if (json) return console.log(JSON.stringify(registry, null, 2));
  for (const [alias, m] of Object.entries(registry.models || {})) {
    console.log(`${alias.padEnd(18)} ${String(m.tier || "").padEnd(8)} ${m.opencodeModel || alias}`);
    console.log(`  capabilities: ${(m.capabilities || []).join(", ")}`);
    console.log(`  context: ${m.contextBudgetTokens || "?"}, soft/hard: ${m.softRotationRatio ?? "?"}/${m.hardRotationRatio ?? "?"}`);
  }
}

function doctor(project) {
  ensureRouter(project);
  const checks = [];
  const add = (name, ok, note = "") => checks.push({ name, ok, note });
  add("router dir", fs.existsSync(routerPath(project)), rel(project, routerPath(project)));
  add("model registry", fs.existsSync(routerPath(project, "model-registry.json")), "");
  add("policy", fs.existsSync(routerPath(project, "policy.json")), "");
  add("usage", fs.existsSync(routerPath(project, "usage.json")), "");
  add("decisions log", fs.existsSync(routerPath(project, "decisions.jsonl")), "");
  const { registry, policy } = loadRouter(project);
  const missing = [];
  for (const [role, rp] of Object.entries(policy.roles || {})) {
    if (rp.defaultModel && !registry.models?.[rp.defaultModel]) missing.push(`${role}:${rp.defaultModel}`);
  }
  add("role default models known", missing.length === 0, missing.join(", "));
  let ok = true;
  for (const c of checks) {
    ok = ok && c.ok;
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`);
  }
  process.exitCode = ok ? 0 : 1;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const project = path.resolve(opts.project);
  try {
    switch (opts.command) {
      case "help": case "--help": case "-h": usage(); break;
      case "doctor": doctor(project); break;
      case "status": ensureRouter(project); printStatus(project, opts.json); break;
      case "models": ensureRouter(project); printModels(project, opts.json); break;
      case "policy": {
        ensureRouter(project);
        const p = readJson(routerPath(project, "policy.json"), defaultPolicy());
        if (opts.json) console.log(JSON.stringify(p, null, 2));
        else console.log(fs.readFileSync(routerPath(project, "policy.json"), "utf8"));
        break;
      }
      case "budget": {
        const { usage, policy } = loadRouter(project);
        const out = { totals: usage.totals || {}, today: dailyUsage(usage), budget: policy.budget || {} };
        if (opts.json) console.log(JSON.stringify(out, null, 2));
        else {
          console.log(`Total calls: ${out.totals.calls || 0}, premium: ${out.totals.premiumCalls || 0}, estimated cost: ${out.totals.estimatedCost || 0}`);
          console.log(`Today calls: ${out.today.calls || 0}, premium: ${out.today.premiumCalls || 0}, estimated cost: ${out.today.estimatedCost || 0}`);
        }
        break;
      }
      case "decide": {
        if (!opts.role && !opts.task) throw new Error("decide requires --role ROLE or --task TASK_ID");
        const d = decide(project, { role: opts.role, kind: opts.kind, task: opts.task, attempts: opts.attempts, reason: opts.reason, execute: opts.execute });
        if (opts.json) console.log(JSON.stringify(d, null, 2));
        else {
          console.log(`${d.routedRole} → ${d.modelAlias} (${d.opencodeModel}) [${d.modelTier}]`);
          for (const r of d.reasons) console.log(`- ${r}`);
          for (const w of d.warnings) console.log(`! ${w}`);
        }
        break;
      }
      case "record": {
        if (!opts.agent || !opts.model) throw new Error("record requires --agent AGENT --model MODEL");
        const u = record(project, opts);
        if (opts.json) console.log(JSON.stringify(u, null, 2));
        else printStatus(project, false);
        break;
      }
      case "escalate": {
        if (!opts.role) throw new Error("escalate requires --role ROLE");
        const d = decide(project, { role: opts.role, kind: "escalation", attempts: opts.attempts ?? 99, reason: opts.reason || "repeated-failure", execute: opts.execute });
        appendEvidence(project, "router-escalation", "requested", `Role: ${opts.role}\nReason: ${opts.reason || "repeated-failure"}\nRouted role: ${d.routedRole}\nModel: ${d.opencodeModel}`);
        if (opts.json) console.log(JSON.stringify(d, null, 2));
        else console.log(`${opts.role} escalated to ${d.routedRole} using ${d.opencodeModel}`);
        break;
      }
      case "checkpoint": {
        const kind = opts.kind || opts.reason || "checkpoint";
        const out = checkpoint(project, { kind, reason: opts.reason, execute: opts.execute });
        if (opts.json) console.log(JSON.stringify(out, null, 2));
        else console.log(`Checkpoint ${out.kind}: ${out.decision.routedRole} → ${out.decision.opencodeModel}\n${out.file}`);
        break;
      }
      default: usage(); process.exitCode = 1;
    }
  } catch (err) {
    console.error(`router-runner error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
