#!/usr/bin/env node
/**
 * opencode-team-runtime P4 context runner
 *
 * Deterministic context compression and local evidence retrieval for long
 * OpenCode team sessions. It turns noisy team artifacts into compact,
 * searchable context packs so weak/cheap models do not need to read raw logs.
 *
 * No third-party dependencies are required.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "0.6.0-p4";
const TEAM_DIR = [".opencode", "team"];
const CONTEXT_DIR = [".opencode", "team", "context"];
const DEFAULT_INDEX = { version: VERSION, createdAt: null, updatedAt: null, chunks: [] };
const DEFAULT_CONFIG = {
  version: VERSION,
  maxChunkChars: 2200,
  chunkOverlapChars: 200,
  maxStoredTextChars: 5000,
  defaultSearchLimit: 12,
  defaultPackMaxChars: 16000,
  includeKindsInPack: ["handoff", "evidence", "task", "research", "browser", "session", "source", "note", "diagnostic"],
  noiseLinePatterns: [
    "^\\s*$",
    "^\\s*(downloaded|fetching|installing|resolved|progress|info:)\\b",
    "^\\s*[.]{3,}$",
    "^\\s*\\[[=\\-#> ]+\\]\\s*\\d+%",
    "^\\s*node_modules/",
    "^\\s*packages/.*/node_modules/"
  ],
  importantLinePatterns: [
    "error", "exception", "traceback", "failed", "failure", "fail:", "panic", "fatal", "segfault", "assert",
    "warning", "warn", "todo", "fixme", "blocked", "unsupported", "needs review", "review", "audit",
    "passed", "success", "ok", "test", "coverage", "console", "network", "404", "500", "timeout",
    "modified", "created", "deleted", "changed", "diff", "commit", "file:", "path:", "url:", "selector", "screenshot"
  ]
};

function now() { return new Date().toISOString(); }
function sha1(text) { return crypto.createHash("sha1").update(String(text)).digest("hex"); }
function shortId(prefix, text) { return `${prefix}-${sha1(text).slice(0, 12)}`; }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readText(file, fallback = "") { try { return fs.readFileSync(file, "utf8"); } catch { return fallback; } }
function writeText(file, text) { mkdirp(path.dirname(file)); fs.writeFileSync(file, text); }
function appendText(file, text) { mkdirp(path.dirname(file)); fs.appendFileSync(file, text); }
function readJson(file, fallback) { try { const s = readText(file, "").trim(); return s ? JSON.parse(s) : structuredClone(fallback); } catch { return structuredClone(fallback); } }
function writeJson(file, obj) { writeText(file, JSON.stringify(obj, null, 2) + "\n"); }
function rel(project, file) { try { return path.relative(project, file) || file; } catch { return file; } }
function tpath(project, ...parts) { return path.join(project, ...TEAM_DIR, ...parts); }
function cpath(project, ...parts) { return path.join(project, ...CONTEXT_DIR, ...parts); }
function truncate(text, max = 4000) { text = String(text ?? ""); return text.length <= max ? text : text.slice(0, max) + `\n...<truncated ${text.length - max} chars>`; }
function safeJson(x, max = 6000) { try { return truncate(JSON.stringify(x, null, 2), max); } catch { return truncate(String(x), max); } }

function usage() {
  console.log(`opencode-team-runtime context ${VERSION}

Usage:
  opencode-context init [--project DIR]
  opencode-context doctor [--project DIR]
  opencode-context status [--project DIR]
  opencode-context ingest [--project DIR] [--all] [--team] [--research] [--browser] [--sessions] [--events]
  opencode-context ingest-file FILE [--project DIR] [--kind KIND] [--title TITLE] [--tags a,b]
  opencode-context add-text "TEXT" [--project DIR] [--kind KIND] [--title TITLE] [--tags a,b]
  opencode-context search "QUERY" [--project DIR] [--limit N] [--kind KIND]
  opencode-context pack "QUERY" [--project DIR] [--limit N] [--max-chars N] [--out FILE]
  opencode-context snapshot [--project DIR] [--out FILE] [--max-chars N]
  opencode-context compress [--project DIR] [--file FILE | --text TEXT] [--kind shell|browser|research|json|generic] [--max-chars N]
  opencode-context compact-shell --file FILE [--project DIR] [--max-chars N]

Purpose:
  Build a deterministic local index from handoff/evidence/browser/research/session artifacts,
  retrieve only relevant snippets, and generate compact context packs for chief/reviewer/coder agents.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const opts = {
    command,
    project: process.cwd(),
    _: [],
    all: false,
    team: false,
    research: false,
    browser: false,
    sessions: false,
    events: false,
    kind: "note",
    title: "",
    tags: "",
    limit: null,
    maxChars: null,
    out: "",
    file: "",
    text: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" || a === "--dir" || a === "-C") opts.project = path.resolve(args[++i]);
    else if (a === "--all") opts.all = true;
    else if (a === "--team") opts.team = true;
    else if (a === "--research") opts.research = true;
    else if (a === "--browser") opts.browser = true;
    else if (a === "--sessions") opts.sessions = true;
    else if (a === "--events") opts.events = true;
    else if (a === "--kind") opts.kind = args[++i] || "note";
    else if (a === "--title") opts.title = args[++i] || "";
    else if (a === "--tags") opts.tags = args[++i] || "";
    else if (a === "--limit") opts.limit = Number(args[++i]);
    else if (a === "--max-chars") opts.maxChars = Number(args[++i]);
    else if (a === "--out") opts.out = args[++i] || "";
    else if (a === "--file") opts.file = args[++i] || "";
    else if (a === "--text") opts.text = args[++i] || "";
    else opts._.push(a);
  }
  opts.query = opts._.join(" ").trim();
  return opts;
}

function ensure(project) {
  mkdirp(cpath(project));
  mkdirp(cpath(project, "packs"));
  mkdirp(cpath(project, "artifacts"));
  const idx = cpath(project, "index.json");
  const cfg = cpath(project, "config.json");
  if (!fs.existsSync(idx)) writeJson(idx, { ...DEFAULT_INDEX, createdAt: now(), updatedAt: now() });
  if (!fs.existsSync(cfg)) writeJson(cfg, DEFAULT_CONFIG);
}

function loadConfig(project) { ensure(project); return { ...DEFAULT_CONFIG, ...readJson(cpath(project, "config.json"), DEFAULT_CONFIG) }; }
function loadIndex(project) { ensure(project); return readJson(cpath(project, "index.json"), DEFAULT_INDEX); }
function saveIndex(project, idx) { idx.version = VERSION; idx.updatedAt = now(); if (!idx.createdAt) idx.createdAt = now(); writeJson(cpath(project, "index.json"), idx); }

function tokenize(text) {
  return Array.from(new Set(String(text || "").toLowerCase()
    .replace(/[\u0000-\u001f]+/g, " ")
    .split(/[^\p{L}\p{N}_.$/#:-]+/u)
    .filter(t => t.length >= 2 && t.length <= 80)));
}

function splitChunks(text, maxChars = 2200, overlap = 200) {
  text = String(text || "").replace(/\r\n/g, "\n");
  const paras = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (!cur) cur = p;
    else if ((cur + "\n\n" + p).length <= maxChars) cur += "\n\n" + p;
    else { chunks.push(cur); cur = p; }
  }
  if (cur) chunks.push(cur);
  if (!chunks.length && text.trim()) {
    for (let i = 0; i < text.length; i += Math.max(200, maxChars - overlap)) chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function addDocument(project, doc) {
  ensure(project);
  const cfg = loadConfig(project);
  const idx = loadIndex(project);
  const sourcePath = doc.sourcePath || "";
  const sourceKey = `${doc.kind || "note"}|${sourcePath}|${doc.title || ""}`;
  const rawDocText = String(doc.text || "");
  // Preserve already-curated artifacts such as handoff, evidence, research reports,
  // and source chunks unless they are extremely large. Noisy logs/browser/session
  // artifacts are compressed before indexing.
  const noisyKinds = new Set(["session", "browser", "diagnostic"]);
  const shouldCompress = noisyKinds.has(doc.kind || "") || rawDocText.length > 60000;
  const clean = shouldCompress
    ? compressText(rawDocText, { kind: doc.kind || "generic", maxChars: Math.max(cfg.maxStoredTextChars * 4, 12000), config: cfg }).text
    : rawDocText;
  const chunks = splitChunks(clean, cfg.maxChunkChars, cfg.chunkOverlapChars);
  let added = 0;
  for (let i = 0; i < chunks.length; i++) {
    const rawText = chunks[i];
    const text = truncate(rawText, cfg.maxStoredTextChars);
    const id = shortId("ctx", `${sourceKey}|${i}|${text}`);
    const existing = idx.chunks.find(c => c.id === id);
    const chunk = {
      id,
      kind: doc.kind || "note",
      title: doc.title || sourcePath || id,
      sourcePath,
      sourceUrl: doc.sourceUrl || "",
      tags: Array.from(new Set([...(doc.tags || []), ...(doc.kind ? [doc.kind] : [])].filter(Boolean))),
      index: i,
      text,
      hash: sha1(text),
      tokens: tokenize(`${doc.title || ""} ${sourcePath} ${text}`).slice(0, 300),
      chars: text.length,
      createdAt: now(),
      updatedAt: now(),
    };
    if (existing) Object.assign(existing, { ...chunk, createdAt: existing.createdAt || chunk.createdAt });
    else { idx.chunks.push(chunk); added++; }
  }
  saveIndex(project, idx);
  return { added, totalChunks: idx.chunks.length, chunks: chunks.length };
}

function readJsonl(file, limit = 2000) {
  const text = readText(file, "");
  const lines = text.split(/\n/).filter(Boolean);
  const start = Math.max(0, lines.length - limit);
  const out = [];
  for (const line of lines.slice(start)) {
    try { out.push(JSON.parse(line)); } catch { out.push({ raw: line }); }
  }
  return out;
}

function listFiles(dir, opts = {}) {
  const out = [];
  const maxFiles = opts.maxFiles ?? 500;
  const exts = opts.exts || null;
  function walk(d) {
    if (out.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) break;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".git", "profile"].includes(e.name)) continue;
        walk(p);
      } else if (!exts || exts.some(x => e.name.endsWith(x))) out.push(p);
    }
  }
  walk(dir);
  return out;
}

function summarizeState(project) {
  const state = readJson(tpath(project, "state.json"), {});
  const dag = readJson(tpath(project, "task-dag.json"), {});
  const summary = {
    phase: state.phase || dag.phase || "unknown",
    activeGoal: state.activeGoal || dag.goal || "",
    rotation: state.rotation || {},
    tasks: (state.tasks || dag.tasks || []).slice(-30),
    changedFiles: (state.changedFiles || []).slice(-50),
    recentEvidence: (state.evidence || []).slice(-50),
    blockers: (state.blockers || []).slice(-20),
    counters: state.counters || {},
    dagHistory: (dag.history || []).slice(-30),
  };
  return safeJson(summary, 16000);
}

function ingestTeam(project) {
  const results = [];
  const handoff = tpath(project, "handoff.md");
  const evidence = tpath(project, "evidence.md");
  if (fs.existsSync(handoff)) results.push(addDocument(project, { kind: "handoff", title: "Team handoff", sourcePath: rel(project, handoff), text: readText(handoff), tags: ["handoff", "continuation"] }));
  if (fs.existsSync(evidence)) results.push(addDocument(project, { kind: "evidence", title: "Team evidence ledger", sourcePath: rel(project, evidence), text: readText(evidence), tags: ["evidence", "verification"] }));
  const stateSummary = summarizeState(project);
  results.push(addDocument(project, { kind: "task", title: "Team state and task DAG summary", sourcePath: ".opencode/team/state.json + task-dag.json", text: stateSummary, tags: ["state", "task", "dag"] }));
  return results;
}

function ingestResearch(project) {
  const results = [];
  const researchDir = tpath(project, "research");
  if (!fs.existsSync(researchDir)) return results;
  const sources = readJson(path.join(researchDir, "sources.json"), { sources: [] });
  const claims = readJson(path.join(researchDir, "claims.json"), { claims: [] });
  results.push(addDocument(project, { kind: "research", title: "Research sources and claims summary", sourcePath: ".opencode/team/research", text: safeJson({ sources: sources.sources || [], claims: claims.claims || [] }, 24000), tags: ["research", "claims", "sources"] }));
  for (const file of listFiles(path.join(researchDir, "reports"), { exts: [".md", ".txt"], maxFiles: 100 })) {
    results.push(addDocument(project, { kind: "research", title: `Research report: ${path.basename(file)}`, sourcePath: rel(project, file), text: readText(file), tags: ["research", "report"] }));
  }
  for (const file of listFiles(path.join(researchDir, "chunks"), { exts: [".json"], maxFiles: 120 })) {
    const data = readJson(file, null);
    if (!data) continue;
    const source = data.source || {};
    const chunks = (data.chunks || []).slice(0, 80).map(c => `# ${source.title || source.id} ${c.id}\n${c.text}`).join("\n\n---\n\n");
    results.push(addDocument(project, { kind: "source", title: `Research chunks: ${source.title || path.basename(file)}`, sourcePath: rel(project, file), sourceUrl: source.url || "", text: chunks, tags: ["research", "source"] }));
  }
  return results;
}

function ingestBrowser(project) {
  const results = [];
  const browserDir = tpath(project, "browser");
  if (!fs.existsSync(browserDir)) return results;
  const priority = ["current-digest.json", "current-reduced.json", "current-raw.json"];
  for (const name of priority) {
    const file = path.join(browserDir, name);
    if (fs.existsSync(file)) results.push(addDocument(project, { kind: "browser", title: `Browser ${name}`, sourcePath: rel(project, file), text: safeJson(readJson(file, {}), 22000), tags: ["browser", "screen", "digest"] }));
  }
  for (const file of listFiles(browserDir, { exts: [".json", ".md", ".txt", ".log"], maxFiles: 120 })) {
    if (priority.some(p => file.endsWith(p))) continue;
    results.push(addDocument(project, { kind: "browser", title: `Browser artifact: ${path.basename(file)}`, sourcePath: rel(project, file), text: file.endsWith(".json") ? safeJson(readJson(file, {}), 16000) : readText(file), tags: ["browser", "artifact"] }));
  }
  return results;
}

function ingestSessions(project) {
  const results = [];
  const dir = tpath(project, "sessions");
  if (!fs.existsSync(dir)) return results;
  for (const file of listFiles(dir, { exts: [".json", ".jsonl", ".log", ".txt"], maxFiles: 120 })) {
    const raw = readText(file);
    const compressed = compressText(raw, { kind: "shell", maxChars: 24000, config: loadConfig(project) }).text;
    results.push(addDocument(project, { kind: "session", title: `Session log: ${path.basename(file)}`, sourcePath: rel(project, file), text: compressed, tags: ["session", "opencode", "log"] }));
  }
  return results;
}

function ingestEvents(project) {
  const file = tpath(project, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  const events = readJsonl(file, 1000);
  const slim = events.map(e => {
    const type = e.type || e.event || "event";
    const payload = e.payload || e;
    return { ts: e.ts || e.createdAt, type, payload: JSON.parse(safeJson(payload, 1000)) };
  });
  return [addDocument(project, { kind: "diagnostic", title: "Recent team event stream", sourcePath: rel(project, file), text: safeJson(slim, 24000), tags: ["events", "diagnostic"] })];
}

function ingestAll(project, opts = {}) {
  ensure(project);
  const selected = opts.all || (!opts.team && !opts.research && !opts.browser && !opts.sessions && !opts.events);
  const batches = [];
  if (selected || opts.team) batches.push(...ingestTeam(project));
  if (selected || opts.research) batches.push(...ingestResearch(project));
  if (selected || opts.browser) batches.push(...ingestBrowser(project));
  if (selected || opts.sessions) batches.push(...ingestSessions(project));
  if (selected || opts.events) batches.push(...ingestEvents(project));
  appendText(tpath(project, "evidence.md"), `\n## ${now()} — context: index refreshed\n\n- status: recorded\n- chunks: ${loadIndex(project).chunks.length}\n- batches: ${batches.length}\n\n`);
  return { batches: batches.length, indexChunks: loadIndex(project).chunks.length, results: batches };
}

function lineMatches(line, patterns) {
  const lower = line.toLowerCase();
  return patterns.some(p => {
    try { return new RegExp(p, "i").test(line); } catch { return lower.includes(String(p).toLowerCase()); }
  });
}

function compressJsonLike(text, maxChars) {
  try {
    const obj = JSON.parse(text);
    const slim = pruneJson(obj, 0);
    return truncate(JSON.stringify(slim, null, 2), maxChars);
  } catch { return null; }
}

function pruneJson(value, depth) {
  if (depth > 5) return "<max-depth>";
  if (value == null || typeof value !== "object") {
    if (typeof value === "string") return truncate(value, 700);
    return value;
  }
  if (Array.isArray(value)) {
    const arr = value.slice(-80).map(x => pruneJson(x, depth + 1));
    if (value.length > arr.length) arr.unshift(`<omitted ${value.length - arr.length} older items>`);
    return arr;
  }
  const keepKeys = [
    "id", "type", "title", "status", "phase", "goal", "activeGoal", "task", "tasks", "changedFiles", "evidence", "tests", "browserChecks",
    "url", "path", "file", "command", "summary", "error", "errors", "warning", "warnings", "console", "network", "claims", "sources",
    "visible_text", "human_visible_summary", "interactive_elements", "technical_health", "suggested_next_actions"
  ];
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (keepKeys.includes(k) || /error|warn|fail|status|summary|text|selector|url|path|file|claim|evidence/i.test(k)) out[k] = pruneJson(v, depth + 1);
  }
  if (!Object.keys(out).length) {
    for (const [k, v] of Object.entries(value).slice(0, 20)) out[k] = pruneJson(v, depth + 1);
  }
  return out;
}

function compressText(text, { kind = "generic", maxChars = 12000, config = DEFAULT_CONFIG } = {}) {
  text = String(text || "").replace(/\r\n/g, "\n");
  const json = kind === "json" || /^[\s\n]*[\[{]/.test(text) ? compressJsonLike(text, maxChars) : null;
  if (json) return { text: json, originalChars: text.length, compressedChars: json.length, ratio: json.length / Math.max(1, text.length), method: "json-prune" };

  const lines = text.split(/\n/);
  const importantPatterns = config.importantLinePatterns || DEFAULT_CONFIG.importantLinePatterns;
  const noisePatterns = config.noiseLinePatterns || DEFAULT_CONFIG.noiseLinePatterns;
  const kept = [];
  const contextRadius = kind === "shell" ? 1 : 2;
  const important = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineMatches(line, importantPatterns)) {
      for (let j = Math.max(0, i - contextRadius); j <= Math.min(lines.length - 1, i + contextRadius); j++) important.add(j);
    }
  }

  if (important.size === 0) {
    const head = lines.slice(0, 80);
    const tail = lines.length > 120 ? lines.slice(-40) : [];
    kept.push(...head, ...(tail.length ? ["...<middle omitted>", ...tail] : []));
  } else {
    let last = -2;
    for (const i of Array.from(important).sort((a, b) => a - b)) {
      const line = lines[i];
      if (lineMatches(line, noisePatterns)) continue;
      if (i > last + 1) kept.push(`...<omitted ${i - last - 1} line(s)>`);
      kept.push(truncate(line, 1000));
      last = i;
    }
  }

  let out = kept.join("\n").replace(/\n{4,}/g, "\n\n\n");
  out = truncate(out, maxChars);
  return { text: out, originalChars: text.length, compressedChars: out.length, ratio: out.length / Math.max(1, text.length), method: kind === "shell" ? "important-lines" : "selective-lines" };
}

function scoreChunk(chunk, queryTokens, opts = {}) {
  const tokens = new Set(chunk.tokens || tokenize(`${chunk.title} ${chunk.text}`));
  let score = 0;
  for (const q of queryTokens) {
    if (tokens.has(q)) score += 3;
    else if ([...tokens].some(t => t.includes(q) || q.includes(t))) score += 0.8;
  }
  const lower = `${chunk.title}\n${chunk.sourcePath}\n${chunk.text}`.toLowerCase();
  const qlower = opts.queryLower || "";
  if (qlower && lower.includes(qlower)) score += 8;
  if (opts.kind && chunk.kind === opts.kind) score += 5;
  if (/error|fail|bug|test|review|audit|block|todo/.test(qlower) && /error|fail|test|review|audit|block|todo/.test(lower)) score += 3;
  if (/browser|ui|page|screen|click|selector|console|network/.test(qlower) && chunk.kind === "browser") score += 4;
  if (/research|paper|source|citation|claim/.test(qlower) && ["research", "source"].includes(chunk.kind)) score += 4;
  if (/handoff|continue|next|state|progress/.test(qlower) && ["handoff", "task"].includes(chunk.kind)) score += 4;
  return score;
}

function search(project, query, opts = {}) {
  ensure(project);
  const cfg = loadConfig(project);
  const idx = loadIndex(project);
  const qTokens = tokenize(query);
  const limit = opts.limit || cfg.defaultSearchLimit;
  const queryLower = String(query || "").toLowerCase();
  const scored = idx.chunks
    .filter(c => !opts.kind || c.kind === opts.kind)
    .map(c => ({ ...c, score: scoreChunk(c, qTokens, { queryLower, kind: opts.kind }) }))
    .filter(c => c.score > 0 || !query.trim())
    .sort((a, b) => b.score - a.score || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, limit);
  return scored;
}

function renderSearchResults(results, { includeText = true } = {}) {
  if (!results.length) return "No matching context chunks found.";
  return results.map((r, i) => {
    const header = `### ${i + 1}. ${r.title}\n\n- id: ${r.id}\n- kind: ${r.kind}\n- score: ${Number(r.score || 0).toFixed(2)}\n- source: ${r.sourcePath || r.sourceUrl || "unknown"}`;
    return includeText ? `${header}\n\n${r.text}` : header;
  }).join("\n\n---\n\n");
}

function renderPack(project, query, opts = {}) {
  ensure(project);
  const cfg = loadConfig(project);
  const maxChars = opts.maxChars || cfg.defaultPackMaxChars;
  const limit = opts.limit || cfg.defaultSearchLimit;
  const results = search(project, query, { limit, kind: opts.kind });
  const status = summarizeState(project);
  const handoff = truncate(readText(tpath(project, "handoff.md"), ""), 3500);
  const body = renderSearchResults(results, { includeText: true });
  let pack = `# Context Pack\n\n- generatedAt: ${now()}\n- query: ${query || "<empty>"}\n- chunks: ${results.length}\n\n## Current Team Snapshot\n\n\`\`\`json\n${truncate(status, 4500)}\n\`\`\`\n\n## Handoff Excerpt\n\n${handoff}\n\n## Retrieved Context\n\n${body}\n\n## Use Rules\n\n- Treat this pack as a retrieval aid, not as proof of completion.\n- Claims still need evidence in .opencode/team/evidence.md or .opencode/team/research/claims.json.\n- Do not repeat failed attempts listed in handoff or retrieved context.\n- If the pack is insufficient, call context_search/context_pack with a narrower query.\n`;
  pack = truncate(pack, maxChars);
  return { pack, results };
}

function writePack(project, query, opts = {}) {
  const { pack, results } = renderPack(project, query, opts);
  const out = opts.out ? path.resolve(project, opts.out) : cpath(project, "packs", `pack-${Date.now()}.md`);
  writeText(out, pack);
  writeText(cpath(project, "current-pack.md"), pack);
  appendText(tpath(project, "evidence.md"), `\n## ${now()} — context: pack generated\n\n- status: recorded\n- query: ${query || "<empty>"}\n- chunks: ${results.length}\n- path: ${rel(project, out)}\n\n`);
  return { out, current: cpath(project, "current-pack.md"), chunks: results.length, chars: pack.length };
}

function status(project) {
  ensure(project);
  const idx = loadIndex(project);
  const byKind = {};
  for (const c of idx.chunks) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return {
    version: VERSION,
    contextDir: rel(project, cpath(project)),
    chunks: idx.chunks.length,
    byKind,
    updatedAt: idx.updatedAt,
    currentPack: fs.existsSync(cpath(project, "current-pack.md")) ? rel(project, cpath(project, "current-pack.md")) : null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (["help", "--help", "-h"].includes(opts.command)) return usage();
  const project = path.resolve(opts.project);
  ensure(project);

  if (opts.command === "init") {
    console.log(JSON.stringify(status(project), null, 2));
    return;
  }
  if (opts.command === "doctor" || opts.command === "status") {
    console.log(JSON.stringify(status(project), null, 2));
    return;
  }
  if (opts.command === "ingest") {
    const result = ingestAll(project, opts);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (opts.command === "ingest-file") {
    const file = opts.file || opts.query;
    if (!file) throw new Error("ingest-file requires FILE");
    const abs = path.resolve(project, file);
    const result = addDocument(project, { kind: opts.kind, title: opts.title || path.basename(abs), sourcePath: rel(project, abs), text: readText(abs), tags: opts.tags ? opts.tags.split(",").map(s => s.trim()).filter(Boolean) : [] });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (opts.command === "add-text") {
    const text = opts.text || opts.query;
    if (!text) throw new Error("add-text requires TEXT or --text");
    const result = addDocument(project, { kind: opts.kind, title: opts.title || "Ad hoc context", sourcePath: "adhoc", text, tags: opts.tags ? opts.tags.split(",").map(s => s.trim()).filter(Boolean) : [] });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (opts.command === "search") {
    const results = search(project, opts.query, { limit: opts.limit || undefined, kind: opts.kind !== "note" ? opts.kind : undefined });
    console.log(renderSearchResults(results));
    return;
  }
  if (opts.command === "pack") {
    const result = writePack(project, opts.query, { limit: opts.limit || undefined, maxChars: opts.maxChars || undefined, out: opts.out || "" });
    console.log(JSON.stringify({ ...result, out: rel(project, result.out), current: rel(project, result.current) }, null, 2));
    return;
  }
  if (opts.command === "snapshot") {
    ingestAll(project, { all: true });
    const query = opts.query || "current goal handoff evidence tasks failures browser research next steps";
    const result = writePack(project, query, { limit: opts.limit || 24, maxChars: opts.maxChars || 24000, out: opts.out || ".opencode/team/context/PROJECT_CONTEXT_PACK.md" });
    console.log(JSON.stringify({ ...result, out: rel(project, result.out), current: rel(project, result.current) }, null, 2));
    return;
  }
  if (opts.command === "compress" || opts.command === "compact-shell") {
    const file = opts.file || (opts.command === "compact-shell" ? opts.query : "");
    const text = opts.text || (file ? readText(path.resolve(project, file)) : opts.query);
    const kind = opts.command === "compact-shell" ? "shell" : opts.kind;
    const result = compressText(text, { kind, maxChars: opts.maxChars || 12000, config: loadConfig(project) });
    console.log(result.text);
    return;
  }
  throw new Error(`Unknown command: ${opts.command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`[opencode-context] ${err.stack || err.message}`);
    process.exit(1);
  });
}

export { ensure, ingestAll, search, renderPack, writePack, compressText, status, addDocument };
