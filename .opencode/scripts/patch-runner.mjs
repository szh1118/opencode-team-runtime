#!/usr/bin/env node
/**
 * opencode-team-runtime P7 patch runner
 *
 * Reviewed patch workflow for safe, auditable self-improvement.
 * This module intentionally defaults to prompt/config/skill patches only.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const VERSION = "0.9.0-p7";
const TEAM = [".opencode", "team"];

function now() { return new Date().toISOString(); }
function id(prefix = "patch") { return `${prefix}-${crypto.randomBytes(4).toString("hex")}`; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function teamPath(project, ...parts) { return path.join(project, ...TEAM, ...parts); }
function patchPath(project, ...parts) { return teamPath(project, "patches", ...parts); }
function memPath(project, ...parts) { return teamPath(project, "memory", ...parts); }
function rel(project, file) { return path.relative(project, file).split(path.sep).join("/"); }
function normRel(p) { return String(p || "").replace(/\\/g, "/").replace(/^\.\//, ""); }
function readText(file, fallback = "") { try { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback; } catch { return fallback; } }
function writeText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(text)); }
function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    const raw = fs.readFileSync(file, "utf8").trim();
    return raw ? JSON.parse(raw) : clone(fallback);
  } catch (err) { throw new Error(`Failed to read JSON ${file}: ${err.message}`); }
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function appendJsonl(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + "\n"); }
function readJsonl(file) { return readText(file, "").split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); }
function appendEvidence(project, type, status, body) {
  const file = teamPath(project, "evidence.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `\n## ${now()} — ${type} — ${status}\n\n${String(body || "").trim()}\n`);
}
function sha256(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }

function defaultConfig() {
  return {
    version: VERSION,
    autoApply: false,
    requireApproval: true,
    requireValidation: true,
    allowCoreRuntimePatch: false,
    maxPatchBytes: 200000,
    allowedPathPrefixes: [
      ".opencode/agents/",
      ".opencode/skills/",
      ".opencode/team/router/",
      ".opencode/team/memory/",
      ".opencode/team/config.json",
      ".opencode/team/runtime.config.json",
      "docs/",
      "README.md",
      "opencode.team.example.jsonc"
    ],
    blockedPathPrefixes: [
      ".git/",
      ".env",
      ".ssh/",
      ".opencode/scripts/",
      ".opencode/plugins/",
      ".opencode/mcp/",
      ".opencode/browser-extension/",
      ".opencode/team/browser/",
      ".opencode/team/sessions/",
      "node_modules/",
      "install.sh",
      "package.json"
    ],
    allowedOperations: ["write", "append", "replace"],
    requiredReviewers: ["patch-reviewer", "auditor"],
    protectedNote: "P7 only applies reviewed prompt/skill/config/docs patches by default. Core runtime changes must be manual."
  };
}
function defaultQueue() { return { version: VERSION, proposals: [] }; }

export function ensure(project) {
  for (const dir of ["proposals", "reviews", "backups", "applied", "rejected", "logs"]) fs.mkdirSync(patchPath(project, dir), { recursive: true });
  const cfg = patchPath(project, "config.json");
  const queue = patchPath(project, "queue.json");
  if (!fs.existsSync(cfg)) writeJson(cfg, defaultConfig());
  if (!fs.existsSync(queue)) writeJson(queue, defaultQueue());
  return { ok: true, root: patchPath(project), version: VERSION };
}
function config(project) { ensure(project); return readJson(patchPath(project, "config.json"), defaultConfig()); }
function queue(project) { ensure(project); return readJson(patchPath(project, "queue.json"), defaultQueue()); }
function saveQueue(project, q) { writeJson(patchPath(project, "queue.json"), q); }
function proposalFile(project, patchId) { return patchPath(project, "proposals", `${patchId}.json`); }
function reviewFile(project, patchId) { return patchPath(project, "reviews", `${patchId}.md`); }
function patchDiffFile(project, patchId) { return patchPath(project, "proposals", `${patchId}.diff`); }
function appliedFile(project, patchId) { return patchPath(project, "applied", `${patchId}.json`); }
function rejectFile(project, patchId) { return patchPath(project, "rejected", `${patchId}.json`); }

function projectFile(project, target) {
  const safe = normRel(target);
  if (!safe || safe.startsWith("../") || safe.includes("/../") || path.isAbsolute(safe)) throw new Error(`Unsafe target path: ${target}`);
  return path.join(project, safe);
}
function pathAllowed(project, target, cfg = config(project)) {
  const safe = normRel(target);
  const blocked = (cfg.blockedPathPrefixes || []).some(prefix => safe === normRel(prefix).replace(/\/$/, "") || safe.startsWith(normRel(prefix)));
  const allowed = (cfg.allowedPathPrefixes || []).some(prefix => safe === normRel(prefix).replace(/\/$/, "") || safe.startsWith(normRel(prefix)));
  if (blocked && !cfg.allowCoreRuntimePatch) return { ok: false, reason: `blocked path prefix: ${safe}` };
  if (!allowed) return { ok: false, reason: `not in allowed patch surface: ${safe}` };
  return { ok: true };
}
function readSuggestion(project, suggestionId) {
  const suggestions = readJson(memPath(project, "suggestions.json"), { suggestions: [] }).suggestions || [];
  return suggestions.find(s => s.id === suggestionId) || null;
}
function makeOperationFromArgs(project, args) {
  const type = args.kind || args.type || (args.search ? "replace" : "write");
  const target = args.target || args.path;
  if (!target) throw new Error("Missing --target");
  let content = args.content;
  if (args.contentFile) content = readText(path.resolve(args.contentFile));
  if (args.stdin) content = fs.readFileSync(0, "utf8");
  if (type === "replace") {
    const search = args.search ?? readText(path.resolve(args.searchFile || ""), "");
    let replacement = args.replacement;
    if (args.replacementFile) replacement = readText(path.resolve(args.replacementFile));
    if (!search) throw new Error("replace operation requires --search or --search-file");
    if (replacement === undefined) throw new Error("replace operation requires --replacement or --replacement-file");
    return { type, path: normRel(target), search, replacement, replaceAll: !!args.all };
  }
  if (content === undefined) content = args.text || "";
  return { type, path: normRel(target), content: String(content) };
}
function applyOpToText(before, op) {
  if (op.type === "write") return String(op.content ?? "");
  if (op.type === "append") return before + String(op.content ?? "");
  if (op.type === "replace") {
    const search = String(op.search ?? "");
    if (!before.includes(search)) throw new Error(`search text not found in ${op.path}`);
    return op.replaceAll ? before.split(search).join(String(op.replacement ?? "")) : before.replace(search, String(op.replacement ?? ""));
  }
  throw new Error(`Unsupported operation: ${op.type}`);
}
function targetBeforeAfter(project, proposal) {
  const byPath = new Map();
  for (const op of proposal.operations || []) {
    const target = normRel(op.path);
    const file = projectFile(project, target);
    const current = byPath.has(target) ? byPath.get(target).after : readText(file, "");
    const after = applyOpToText(current, op);
    byPath.set(target, { path: target, absolute: file, before: byPath.has(target) ? byPath.get(target).before : readText(file, ""), after });
  }
  return [...byPath.values()];
}
function unifiedDiffForFile(label, before, after) {
  if (before === after) return "";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otr-patch-"));
  const a = path.join(tmp, "a");
  const b = path.join(tmp, "b");
  fs.writeFileSync(a, before);
  fs.writeFileSync(b, after);
  const res = spawnSync("diff", ["-u", `--label=a/${label}`, `--label=b/${label}`, a, b], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return res.stdout || "";
}
function renderDiff(project, proposal) {
  let out = "";
  for (const item of targetBeforeAfter(project, proposal)) out += unifiedDiffForFile(item.path, item.before, item.after);
  return out || `# No textual diff for ${proposal.id}\n`;
}
function loadProposal(project, patchId) {
  const file = proposalFile(project, patchId);
  if (!fs.existsSync(file)) throw new Error(`Unknown patch proposal: ${patchId}`);
  return readJson(file, {});
}
function saveProposal(project, proposal) {
  proposal.updatedAt = now();
  writeJson(proposalFile(project, proposal.id), proposal);
  writeText(patchDiffFile(project, proposal.id), renderDiff(project, proposal));
  const q = queue(project);
  const idx = q.proposals.findIndex(p => p.id === proposal.id);
  const summary = { id: proposal.id, title: proposal.title, status: proposal.status, kind: proposal.kind, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt, targets: [...new Set((proposal.operations || []).map(op => op.path))] };
  if (idx >= 0) q.proposals[idx] = summary; else q.proposals.push(summary);
  saveQueue(project, q);
  return proposal;
}

export function status(project) {
  ensure(project);
  const q = queue(project);
  const byStatus = {};
  for (const p of q.proposals || []) byStatus[p.status || "unknown"] = (byStatus[p.status || "unknown"] || 0) + 1;
  return { version: VERSION, root: patchPath(project), totals: byStatus, proposals: (q.proposals || []).slice(-20) };
}
export function list(project, args = {}) {
  const q = queue(project);
  let items = q.proposals || [];
  if (args.status) items = items.filter(p => p.status === args.status);
  return { proposals: items.slice(-(args.limit || 50)) };
}
export function propose(project, args = {}) {
  ensure(project);
  let proposal;
  if (args.spec || args.specFile) {
    const raw = args.spec ? String(args.spec) : readText(path.resolve(args.specFile));
    proposal = JSON.parse(raw);
    proposal.id ||= id("patch");
    proposal.createdAt ||= now();
    proposal.status ||= "draft";
  } else if (args.suggestion || args.suggestionId) {
    const sid = args.suggestion || args.suggestionId;
    const sug = readSuggestion(project, sid);
    if (!sug) throw new Error(`Suggestion not found: ${sid}`);
    proposal = {
      id: id("patch"),
      version: VERSION,
      createdAt: now(),
      status: "needs-human-spec",
      kind: "suggestion",
      title: args.title || `Implement memory suggestion ${sid}`,
      reason: sug.rationale || sug.text || sug.title || "Memory suggestion",
      sourceSuggestion: sid,
      operations: [],
      notes: ["This proposal was created from memory. Add explicit operations before validation/apply."],
      originalSuggestion: sug
    };
  } else {
    proposal = {
      id: id("patch"),
      version: VERSION,
      createdAt: now(),
      status: "draft",
      kind: args.kind || args.type || "write",
      title: args.title || "Untitled reviewed patch",
      reason: args.reason || "Manual P7 patch proposal",
      operations: [makeOperationFromArgs(project, args)],
      approvals: [],
      reviews: [],
      notes: args.note ? [args.note] : []
    };
  }
  proposal.operations ||= [];
  proposal.risk ||= assessRisk(project, proposal);
  const validation = validate(project, proposal);
  proposal.validation = validation;
  if (validation.ok && proposal.status === "draft") proposal.status = "proposed";
  saveProposal(project, proposal);
  appendJsonl(patchPath(project, "logs", "events.jsonl"), { ts: now(), event: "proposed", id: proposal.id, status: proposal.status, targets: (proposal.operations || []).map(o => o.path) });
  appendEvidence(project, "patch-proposal", proposal.status, `Created ${proposal.id}: ${proposal.title}\nTargets: ${(proposal.operations || []).map(o => o.path).join(", ") || "none"}`);
  return { id: proposal.id, status: proposal.status, validation, diff: patchDiffFile(project, proposal.id), proposal: proposalFile(project, proposal.id) };
}
function assessRisk(project, proposal) {
  const targets = [...new Set((proposal.operations || []).map(op => normRel(op.path)))];
  let level = "low";
  const reasons = [];
  if (targets.some(t => t.includes("router/policy.json") || t.includes("model-registry.json"))) { level = "medium"; reasons.push("router policy/model change"); }
  if (targets.some(t => t.startsWith(".opencode/team/runtime.config"))) { level = "medium"; reasons.push("runtime config change"); }
  if ((proposal.operations || []).some(op => String(op.content || op.replacement || "").length > 50000)) { level = "medium"; reasons.push("large generated content"); }
  if (targets.some(t => t.startsWith(".opencode/scripts/") || t.startsWith(".opencode/plugins/") || t.startsWith(".opencode/mcp/"))) { level = "high"; reasons.push("core runtime path"); }
  return { level, reasons };
}
export function validate(project, proposalOrId) {
  ensure(project);
  const proposal = typeof proposalOrId === "string" ? loadProposal(project, proposalOrId) : proposalOrId;
  const cfg = config(project);
  const issues = [];
  const warnings = [];
  if (!proposal.operations || proposal.operations.length === 0) issues.push("proposal has no operations");
  const totalBytes = JSON.stringify(proposal.operations || []).length;
  if (totalBytes > cfg.maxPatchBytes) issues.push(`patch too large: ${totalBytes} > ${cfg.maxPatchBytes}`);
  for (const op of proposal.operations || []) {
    if (!cfg.allowedOperations.includes(op.type)) issues.push(`unsupported operation: ${op.type}`);
    if (!op.path) issues.push("operation missing path");
    const allowed = pathAllowed(project, op.path, cfg);
    if (!allowed.ok) issues.push(`${op.path}: ${allowed.reason}`);
    try {
      const file = projectFile(project, op.path);
      if (op.type === "replace" && !fs.existsSync(file)) issues.push(`${op.path}: replace target does not exist`);
      if (op.type === "replace" && fs.existsSync(file) && !readText(file).includes(String(op.search ?? ""))) issues.push(`${op.path}: search text not found`);
      if (op.type === "append" && !fs.existsSync(file)) warnings.push(`${op.path}: append target does not exist; will create file`);
    } catch (err) { issues.push(err.message); }
  }
  const risk = assessRisk(project, proposal);
  return { ok: issues.length === 0, issues, warnings, risk, checkedAt: now(), configNote: cfg.protectedNote };
}
export function diff(project, patchId) {
  const proposal = loadProposal(project, patchId);
  const text = renderDiff(project, proposal);
  writeText(patchDiffFile(project, patchId), text);
  return { id: patchId, diff: text, diffFile: patchDiffFile(project, patchId) };
}
export function review(project, patchId, args = {}) {
  const proposal = loadProposal(project, patchId);
  const validation = validate(project, proposal);
  const diffText = renderDiff(project, proposal);
  const checklist = `# Patch Review: ${proposal.id}\n\n` +
    `Title: ${proposal.title}\n\nStatus: ${proposal.status}\nRisk: ${validation.risk.level} ${validation.risk.reasons?.join(", ") || ""}\n\n` +
    `## Validation\n\n- ok: ${validation.ok}\n- issues: ${validation.issues.length ? validation.issues.join("; ") : "none"}\n- warnings: ${validation.warnings.length ? validation.warnings.join("; ") : "none"}\n\n` +
    `## Required reviewer checks\n\n` +
    `- [ ] Patch only touches allowed prompt/skill/config/docs paths.\n` +
    `- [ ] The change is supported by memory/evidence or explicit user instruction.\n` +
    `- [ ] The patch does not weaken safety, evidence, review, routing, or browser gates.\n` +
    `- [ ] The patch does not modify core runtime scripts/plugins/MCP unless manually approved outside P7.\n` +
    `- [ ] The diff is understandable and reversible.\n\n` +
    `## Diff\n\n\`\`\`diff\n${diffText.slice(0, 80000)}\n\`\`\`\n`;
  writeText(reviewFile(project, patchId), checklist);
  proposal.validation = validation;
  proposal.reviews ||= [];
  proposal.reviews.push({ ts: now(), reviewer: args.by || "patch-reviewer", kind: "generated-checklist", file: rel(project, reviewFile(project, patchId)), validationOk: validation.ok });
  if (proposal.status === "proposed") proposal.status = "reviewing";
  saveProposal(project, proposal);
  appendEvidence(project, "patch-review", validation.ok ? "pending-review" : "blocked", `Generated review checklist for ${patchId}: ${rel(project, reviewFile(project, patchId))}`);
  return { id: patchId, status: proposal.status, validation, reviewFile: reviewFile(project, patchId) };
}
export function approve(project, patchId, args = {}) {
  const proposal = loadProposal(project, patchId);
  const validation = validate(project, proposal);
  if (!validation.ok && !args.force) throw new Error(`Cannot approve invalid patch without force: ${validation.issues.join("; ")}`);
  proposal.approvals ||= [];
  proposal.approvals.push({ ts: now(), by: args.by || "user", note: args.note || "approved" });
  proposal.validation = validation;
  proposal.status = "approved";
  saveProposal(project, proposal);
  appendEvidence(project, "patch-approval", "approved", `${patchId} approved by ${args.by || "user"}: ${args.note || ""}`);
  return { id: patchId, status: proposal.status, approvals: proposal.approvals };
}
export function reject(project, patchId, args = {}) {
  const proposal = loadProposal(project, patchId);
  proposal.status = "rejected";
  proposal.rejectedAt = now();
  proposal.rejection = { by: args.by || "user", reason: args.reason || args.note || "rejected" };
  saveProposal(project, proposal);
  writeJson(rejectFile(project, patchId), proposal);
  appendEvidence(project, "patch-rejection", "rejected", `${patchId}: ${proposal.rejection.reason}`);
  return { id: patchId, status: proposal.status, rejection: proposal.rejection };
}
export function apply(project, patchId, args = {}) {
  const proposal = loadProposal(project, patchId);
  const cfg = config(project);
  const validation = validate(project, proposal);
  if (cfg.requireValidation && !validation.ok && !args.force) throw new Error(`Cannot apply invalid patch: ${validation.issues.join("; ")}`);
  if (cfg.requireApproval && proposal.status !== "approved" && !args.force) throw new Error(`Patch ${patchId} is not approved. Current status: ${proposal.status}`);
  const snapshots = targetBeforeAfter(project, proposal);
  const backupDir = patchPath(project, "backups", patchId);
  fs.mkdirSync(backupDir, { recursive: true });
  const manifest = { id: patchId, appliedAt: now(), title: proposal.title, targets: [], diffSha256: sha256(renderDiff(project, proposal)) };
  for (const item of snapshots) {
    const backupName = Buffer.from(item.path).toString("base64url") + ".bak";
    writeText(path.join(backupDir, backupName), item.before);
    writeText(item.absolute, item.after);
    manifest.targets.push({ path: item.path, backup: rel(project, path.join(backupDir, backupName)), beforeSha256: sha256(item.before), afterSha256: sha256(item.after) });
  }
  writeJson(appliedFile(project, patchId), manifest);
  proposal.status = "applied";
  proposal.appliedAt = manifest.appliedAt;
  proposal.applyManifest = rel(project, appliedFile(project, patchId));
  saveProposal(project, proposal);
  appendEvidence(project, "patch-apply", "applied", `Applied ${patchId}: ${proposal.title}\nTargets: ${manifest.targets.map(t => t.path).join(", ")}`);
  return { id: patchId, status: "applied", manifest };
}
export function rollback(project, patchId, args = {}) {
  const manifestFile = appliedFile(project, patchId);
  if (!fs.existsSync(manifestFile)) throw new Error(`No applied manifest for ${patchId}`);
  const manifest = readJson(manifestFile, {});
  for (const t of manifest.targets || []) {
    const backup = path.join(project, t.backup);
    if (!fs.existsSync(backup)) throw new Error(`Missing backup: ${t.backup}`);
    writeText(projectFile(project, t.path), readText(backup));
  }
  const proposal = loadProposal(project, patchId);
  proposal.status = "rolled-back";
  proposal.rolledBackAt = now();
  proposal.rollback = { by: args.by || "user", reason: args.reason || "manual rollback" };
  saveProposal(project, proposal);
  appendEvidence(project, "patch-rollback", "rolled-back", `${patchId}: ${proposal.rollback.reason}`);
  return { id: patchId, status: "rolled-back", restored: (manifest.targets || []).map(t => t.path) };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { args._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}
function print(x, json = false) { process.stdout.write(json ? JSON.stringify(x, null, 2) + "\n" : (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n"); }
function usage() {
  return `opencode-patch P7 reviewed patch workflow\n\nCommands:\n  doctor\n  status [--json]\n  list [--status proposed|reviewing|approved|applied|rejected]\n  propose --title TITLE --target PATH --kind write|append|replace [--content-file FILE|--text TEXT|--stdin]\n  propose --suggestion SUGGESTION_ID\n  validate PATCH_ID\n  diff PATCH_ID\n  review PATCH_ID\n  approve PATCH_ID [--by NAME] [--note NOTE]\n  reject PATCH_ID [--reason REASON]\n  apply PATCH_ID\n  rollback PATCH_ID [--reason REASON]\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift() || "help";
  const args = parseArgs(argv);
  const project = path.resolve(args.project || process.env.TEAM_PROJECT_ROOT || process.cwd());
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return print(usage());
  if (cmd === "doctor") return print({ ok: true, ...ensure(project), config: config(project) }, !!args.json);
  if (cmd === "status") return print(status(project), !!args.json);
  if (cmd === "list") return print(list(project, args), !!args.json);
  if (cmd === "propose") return print(propose(project, args), !!args.json);
  if (cmd === "validate") return print(validate(project, args._[0]), !!args.json);
  if (cmd === "diff") return print(diff(project, args._[0]).diff);
  if (cmd === "review") return print(review(project, args._[0], args), !!args.json);
  if (cmd === "approve") return print(approve(project, args._[0], args), !!args.json);
  if (cmd === "reject") return print(reject(project, args._[0], args), !!args.json);
  if (cmd === "apply") return print(apply(project, args._[0], args), !!args.json);
  if (cmd === "rollback") return print(rollback(project, args._[0], args), !!args.json);
  throw new Error(`Unknown command: ${cmd}\n${usage()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`opencode-patch: ${err.message}`); process.exit(1); });
}
