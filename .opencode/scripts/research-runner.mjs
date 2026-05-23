#!/usr/bin/env node
/**
 * opencode-team-runtime P3 research runner
 *
 * Evidence-first research ledger:
 * - Sources are saved to .opencode/team/research/sources.json
 * - Text is chunked and stored under .opencode/team/research/chunks/*.json
 * - Claims must cite source/chunk evidence ids
 * - validate flags weak/unsupported claims before they can enter reports/plans
 *
 * No third-party dependencies are required. Browser-backed verification is
 * delegated to the existing CloakBrowser / Chrome Bridge runners when requested.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, "..");

const VERSION = "0.6.0-p4";
const TEAM_DIR = [".opencode", "team"];
const RESEARCH_DIR = [".opencode", "team", "research"];
const DEFAULT_SOURCES = { version: VERSION, createdAt: null, updatedAt: null, sources: [] };
const DEFAULT_CLAIMS = { version: VERSION, createdAt: null, updatedAt: null, claims: [] };

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomBytes(5).toString("hex")}`; }
function usage() {
  console.log(`opencode-team-runtime research ${VERSION}

Usage:
  opencode-research init [--project DIR]
  opencode-research status [--project DIR]
  opencode-research add-source URL [--title TITLE] [--project DIR] [--fetch] [--browser none|cloak|bridge]
  opencode-research add-text --title TITLE [--url URL] --file FILE [--project DIR]
  opencode-research claim "CLAIM" --evidence SOURCE_ID[#CHUNK_ID],... [--kind fact|inference|uncertain] [--confidence 0.8] [--project DIR]
  opencode-research validate [--project DIR] [--min-score 0.18]
  opencode-research report [--topic TOPIC] [--out FILE] [--project DIR]
  opencode-research search "QUERY" [--browser cloak|bridge|none] [--project DIR]
  opencode-research run "QUESTION" [--execute] [--project DIR]
  opencode-research doctor [--project DIR]

The runner is deterministic. It does not claim a source supports a statement unless
that claim cites a source/chunk and validate marks it as supported or weak.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const opts = { command, project: process.cwd(), _: [], title: "", url: "", file: "", out: "", topic: "", evidence: "", kind: "fact", confidence: null, fetch: true, browser: "none", minScore: 0.18, execute: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" || a === "--dir" || a === "-C") opts.project = path.resolve(args[++i]);
    else if (a === "--title") opts.title = args[++i] || "";
    else if (a === "--url") opts.url = args[++i] || "";
    else if (a === "--file") opts.file = args[++i] || "";
    else if (a === "--out") opts.out = args[++i] || "";
    else if (a === "--topic") opts.topic = args[++i] || "";
    else if (a === "--evidence") opts.evidence = args[++i] || "";
    else if (a === "--kind") opts.kind = args[++i] || "fact";
    else if (a === "--confidence") opts.confidence = Number(args[++i]);
    else if (a === "--no-fetch") opts.fetch = false;
    else if (a === "--fetch") opts.fetch = true;
    else if (a === "--browser") opts.browser = args[++i] || "none";
    else if (a === "--min-score") opts.minScore = Number(args[++i]);
    else if (a === "--execute" || a === "--yes") opts.execute = true;
    else opts._.push(a);
  }
  opts.text = opts._.join(" ").trim();
  return opts;
}

function rpath(project, ...parts) { return path.join(project, ...RESEARCH_DIR, ...parts); }
function tpath(project, ...parts) { return path.join(project, ...TEAM_DIR, ...parts); }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readText(file, fallback = "") { try { return fs.readFileSync(file, "utf8"); } catch { return fallback; } }
function writeText(file, text) { mkdirp(path.dirname(file)); fs.writeFileSync(file, text); }
function readJson(file, fallback) { try { if (!fs.existsSync(file)) return structuredClone(fallback); const s = fs.readFileSync(file, "utf8").trim(); return s ? JSON.parse(s) : structuredClone(fallback); } catch (e) { throw new Error(`Failed reading JSON ${file}: ${e.message}`); } }
function writeJson(file, obj) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n"); }
function appendText(file, text) { mkdirp(path.dirname(file)); fs.appendFileSync(file, text); }

function ensure(project) {
  mkdirp(rpath(project));
  mkdirp(rpath(project, "chunks"));
  mkdirp(rpath(project, "reports"));
  mkdirp(rpath(project, "artifacts"));
  const sources = rpath(project, "sources.json");
  const claims = rpath(project, "claims.json");
  if (!fs.existsSync(sources)) writeJson(sources, { ...DEFAULT_SOURCES, createdAt: now(), updatedAt: now() });
  if (!fs.existsSync(claims)) writeJson(claims, { ...DEFAULT_CLAIMS, createdAt: now(), updatedAt: now() });
  const evidence = tpath(project, "evidence.md");
  if (!fs.existsSync(evidence)) writeText(evidence, "# Team Evidence\n\n");
}

function loadSources(project) { return readJson(rpath(project, "sources.json"), DEFAULT_SOURCES); }
function saveSources(project, db) { db.updatedAt = now(); writeJson(rpath(project, "sources.json"), db); }
function loadClaims(project) { return readJson(rpath(project, "claims.json"), DEFAULT_CLAIMS); }
function saveClaims(project, db) { db.updatedAt = now(); writeJson(rpath(project, "claims.json"), db); }

function decodeHtml(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

function stripHtml(html) {
  const title = decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim());
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|h1|h2|h3|h4|li|tr|table|main|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeHtml(text).replace(/[ \t\f\v]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

function normalizeText(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function truncate(s, n = 5000) { s = String(s || ""); return s.length <= n ? s : s.slice(0, n) + `\n...<truncated ${s.length - n} chars>`; }

function chunkText(text, maxChars = 1800, overlap = 180) {
  const paras = text.split(/\n{2,}/).map(p => normalizeText(p)).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (!cur) cur = p;
    else if ((cur + "\n\n" + p).length <= maxChars) cur += "\n\n" + p;
    else { chunks.push(cur); cur = p; }
  }
  if (cur) chunks.push(cur);
  if (!chunks.length && text.trim()) {
    for (let i = 0; i < text.length; i += maxChars - overlap) chunks.push(text.slice(i, i + maxChars));
  }
  return chunks.map((text, idx) => ({ id: `c${String(idx + 1).padStart(4, "0")}`, index: idx, text, chars: text.length }));
}

async function fetchUrl(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "opencode-team-runtime-research/0.5" } });
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  return { contentType, body, finalUrl: res.url };
}

async function readSourceContent(opts) {
  if (opts.file) return { title: opts.title || path.basename(opts.file), url: opts.url || `file://${path.resolve(opts.project, opts.file)}`, text: readText(path.resolve(opts.project, opts.file)), contentType: "text/plain", fetched: false };
  const source = opts.url || opts.text;
  if (!source) throw new Error("URL or text/file required");
  if (/^https?:\/\//i.test(source)) {
    const fetched = await fetchUrl(source);
    const stripped = /html/i.test(fetched.contentType) ? stripHtml(fetched.body) : { title: opts.title || fetched.finalUrl, text: fetched.body };
    return { title: opts.title || stripped.title || fetched.finalUrl, url: fetched.finalUrl, text: stripped.text, contentType: fetched.contentType, fetched: true };
  }
  if (/^file:\/\//i.test(source)) {
    const p = new URL(source);
    const text = readText(p.pathname);
    return { title: opts.title || path.basename(p.pathname), url: source, text, contentType: "text/plain", fetched: false };
  }
  const possibleFile = path.resolve(opts.project, source);
  if (fs.existsSync(possibleFile)) return { title: opts.title || path.basename(possibleFile), url: `file://${possibleFile}`, text: readText(possibleFile), contentType: "text/plain", fetched: false };
  throw new Error(`Unsupported source: ${source}`);
}

function recordTeamEvidence(project, entry) {
  const file = tpath(project, "evidence.md");
  const md = `\n## ${entry.title}\n\n- time: ${now()}\n- type: ${entry.type || "source"}\n${entry.url ? `- url: ${entry.url}\n` : ""}${entry.path ? `- path: ${entry.path}\n` : ""}${entry.status ? `- status: ${entry.status}\n` : ""}\n${entry.summary ? `\n${entry.summary}\n` : ""}\n`;
  appendText(file, md);
}

function addSource(project, data) {
  ensure(project);
  const db = loadSources(project);
  const sid = id("src");
  const chunks = chunkText(data.text || "");
  const chunkFile = rpath(project, "chunks", `${sid}.json`);
  const source = {
    id: sid,
    title: data.title || data.url || sid,
    url: data.url || "",
    contentType: data.contentType || "text/plain",
    addedAt: now(),
    fetched: !!data.fetched,
    textChars: (data.text || "").length,
    chunkCount: chunks.length,
    chunkFile: path.relative(project, chunkFile),
    notes: data.notes || "",
  };
  writeJson(chunkFile, { version: VERSION, source, chunks });
  db.sources.push(source);
  saveSources(project, db);
  recordTeamEvidence(project, { type: "source", title: `Research source added: ${source.title}`, url: source.url, path: source.chunkFile, status: "recorded", summary: `Stored ${chunks.length} chunks (${source.textChars} chars). Source id: ${sid}` });
  return { source, chunks: chunks.slice(0, 3), chunkFile };
}

function loadChunkDb(project, sourceId) {
  const db = loadSources(project);
  const source = db.sources.find(s => s.id === sourceId);
  if (!source) throw new Error(`Unknown source id: ${sourceId}`);
  const file = path.resolve(project, source.chunkFile);
  const chunks = readJson(file, { chunks: [] }).chunks || [];
  return { source, chunks };
}

function parseEvidenceRefs(str) {
  return String(str || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean).map(ref => {
    const [sourceId, chunkId] = ref.split("#");
    return { sourceId, chunkId: chunkId || null, ref };
  });
}

function addClaim(project, opts) {
  ensure(project);
  const text = opts.text;
  if (!text) throw new Error("claim text required");
  const evidence = parseEvidenceRefs(opts.evidence);
  if (!evidence.length) throw new Error("--evidence SOURCE_ID[#CHUNK_ID] is required");
  // Ensure source ids exist.
  for (const ev of evidence) loadChunkDb(project, ev.sourceId);
  const db = loadClaims(project);
  const claim = {
    id: id("claim"),
    text,
    kind: ["fact", "inference", "uncertain"].includes(opts.kind) ? opts.kind : "fact",
    confidence: Number.isFinite(opts.confidence) ? opts.confidence : null,
    evidence,
    status: "unvalidated",
    validation: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.claims.push(claim);
  saveClaims(project, db);
  recordTeamEvidence(project, { type: "source", title: `Research claim recorded: ${claim.id}`, status: "recorded", summary: `${claim.text}\n\nEvidence refs: ${evidence.map(e => e.ref).join(", ")}` });
  return claim;
}

const STOP = new Set("a an and are as at be by for from has have he her his i in is it its of on or she that the their they this to was were will with you your we our not but into than then there here can could should would may might about over under after before also if so such using use used via vs does do did done make makes made more most less least only same different because while when where who which what how why".split(/\s+/));
function tokens(s) {
  return normalizeText(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(t => t.length > 2 && !STOP.has(t));
}
function scoreSupport(claimText, evidenceText) {
  const c = Array.from(new Set(tokens(claimText)));
  const e = new Set(tokens(evidenceText));
  if (!c.length) return 0;
  const hit = c.filter(t => e.has(t)).length;
  const base = hit / c.length;
  const phraseBonus = normalizeText(evidenceText).toLowerCase().includes(normalizeText(claimText).toLowerCase().slice(0, 80)) ? 0.3 : 0;
  return Math.min(1, base + phraseBonus);
}

function evidenceTexts(project, claim) {
  const out = [];
  for (const ev of claim.evidence || []) {
    const { source, chunks } = loadChunkDb(project, ev.sourceId);
    const selected = ev.chunkId ? chunks.filter(c => c.id === ev.chunkId) : chunks;
    for (const chunk of selected.slice(0, ev.chunkId ? 1 : 8)) out.push({ ref: `${source.id}#${chunk.id}`, source, chunk, text: chunk.text });
  }
  return out;
}

function validateClaims(project, minScore = 0.18) {
  ensure(project);
  const db = loadClaims(project);
  const results = [];
  for (const claim of db.claims) {
    const evs = evidenceTexts(project, claim);
    const scored = evs.map(ev => ({ ref: ev.ref, sourceTitle: ev.source.title, url: ev.source.url, score: scoreSupport(claim.text, ev.text), snippet: truncate(ev.text, 420) })).sort((a,b) => b.score - a.score);
    const best = scored[0]?.score || 0;
    const status = best >= Math.max(minScore, 0.35) ? "supported" : best >= minScore ? "weak" : "unsupported";
    claim.status = status;
    claim.validation = { validatedAt: now(), minScore, bestScore: Number(best.toFixed(3)), evidence: scored.slice(0, 5), note: status === "supported" ? "Lexical support found. Human/model reviewer should still verify meaning." : status === "weak" ? "Some overlap found but evidence may not support the full claim." : "No adequate lexical support found." };
    claim.updatedAt = now();
    results.push({ id: claim.id, text: claim.text, status, bestScore: claim.validation.bestScore, bestEvidence: scored[0] || null });
  }
  saveClaims(project, db);
  const unsupported = results.filter(r => r.status === "unsupported").length;
  const weak = results.filter(r => r.status === "weak").length;
  recordTeamEvidence(project, { type: "review", title: "Research claim validation", status: unsupported ? "failed" : weak ? "recorded" : "passed", summary: `Validated ${results.length} claims. supported=${results.filter(r => r.status === "supported").length}, weak=${weak}, unsupported=${unsupported}.` });
  return { ok: unsupported === 0, supported: results.filter(r => r.status === "supported").length, weak, unsupported, results };
}

function generateReport(project, opts = {}) {
  ensure(project);
  const sources = loadSources(project).sources;
  const claims = loadClaims(project).claims;
  const topic = opts.topic || "Research Report";
  const out = opts.out ? path.resolve(project, opts.out) : rpath(project, "reports", `research-report-${Date.now()}.md`);
  const unsupported = claims.filter(c => c.status === "unsupported" || c.status === "unvalidated");
  let md = `# ${topic}\n\nGenerated: ${now()}\n\n`;
  md += `## Gate Status\n\n`;
  md += unsupported.length ? `**NOT READY**: ${unsupported.length} claims are unvalidated or unsupported. Do not use this as final research.\n\n` : `**PASS**: all recorded claims are at least weakly supported by cited evidence.\n\n`;
  md += `## Claims\n\n`;
  for (const c of claims) {
    md += `### ${c.id}: ${c.kind} / ${c.status}\n\n${c.text}\n\n`;
    if (c.validation?.bestScore != null) md += `Best support score: ${c.validation.bestScore}\n\n`;
    md += `Evidence:\n`;
    const evs = c.validation?.evidence?.length ? c.validation.evidence : evidenceTexts(project, c).slice(0, 3).map(e => ({ ref: e.ref, sourceTitle: e.source.title, url: e.source.url, score: null, snippet: truncate(e.text, 300) }));
    for (const ev of evs) md += `- ${ev.ref}${ev.sourceTitle ? ` — ${ev.sourceTitle}` : ""}${ev.score != null ? ` (score ${ev.score.toFixed ? ev.score.toFixed(3) : ev.score})` : ""}${ev.url ? ` — ${ev.url}` : ""}\n  > ${String(ev.snippet || "").replace(/\n/g, "\n  > ")}\n`;
    md += `\n`;
  }
  md += `## Sources\n\n`;
  for (const s of sources) md += `- ${s.id}: ${s.title}${s.url ? ` — ${s.url}` : ""} (${s.chunkCount} chunks)\n`;
  writeText(out, md);
  recordTeamEvidence(project, { type: "source", title: "Research report generated", path: path.relative(project, out), status: unsupported.length ? "blocked" : "passed", summary: `Report topic: ${topic}. Claims: ${claims.length}. Unsupported/unvalidated: ${unsupported.length}.` });
  return { ok: unsupported.length === 0, path: path.relative(project, out), unsupported: unsupported.map(c => c.id), claimCount: claims.length, sourceCount: sources.length };
}

function runBrowserSearch(project, query, browser) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  if (browser === "cloak") {
    const runner = path.join(project, ".opencode", "scripts", "browser-runner.mjs");
    const res = spawnSync(process.execPath, [runner, "digest", url, "--project", project, "--mark", "--manual"], { cwd: project, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, env: process.env });
    return { browser, url, status: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  if (browser === "bridge") {
    const runner = path.join(project, ".opencode", "scripts", "browser-bridge-server.mjs");
    const res = spawnSync(process.execPath, [runner, "digest", url, "--project", project, "--mark"], { cwd: project, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, env: process.env });
    return { browser, url, status: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  return { browser: "none", url, note: "Open this URL with CloakBrowser/Chrome Bridge or pass --browser cloak|bridge." };
}

function runResearchAgent(project, question, execute) {
  const prompt = `You are research-scout. Research this question using the research MCP and browser tools when available.\n\nQuestion: ${question}\n\nRules:\n- Prefer primary sources.\n- Add every source with research_add_source or opencode-research add-source.\n- Record claims with research_add_claim.\n- Run research_validate before writing conclusions.\n- Unsupported claims must be marked as unsupported, not hidden.\n- Browser evidence should use CloakBrowser or Browser Bridge when dynamic pages matter.`;
  const args = ["run", prompt, "--agent", "research-scout", "--dir", project, "--format", "json"];
  if (!execute) return { ok: true, dryRun: true, command: ["opencode", ...args] };
  const res = spawnSync("opencode", args, { cwd: project, encoding: "utf8", maxBuffer: 100 * 1024 * 1024, env: process.env });
  const log = rpath(project, "artifacts", `research-agent-${Date.now()}.log`);
  writeText(log, `# command\n${["opencode", ...args].join(" ")}\n\n# status\n${res.status}\n\n# stdout\n${res.stdout}\n\n# stderr\n${res.stderr}\n`);
  return { ok: res.status === 0, status: res.status, log: path.relative(project, log), stdout: truncate(res.stdout, 3000), stderr: truncate(res.stderr, 3000) };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const project = path.resolve(opts.project);
  if (["help", "--help", "-h"].includes(opts.command)) return usage();
  ensure(project);

  if (opts.command === "init") return console.log(JSON.stringify({ ok: true, project, researchDir: path.relative(project, rpath(project)) }, null, 2));
  if (opts.command === "doctor") {
    const out = { ok: true, version: VERSION, project, files: { sources: fs.existsSync(rpath(project, "sources.json")), claims: fs.existsSync(rpath(project, "claims.json")), cloakRunner: fs.existsSync(path.join(RUNTIME_ROOT, "scripts", "browser-runner.mjs")), bridgeRunner: fs.existsSync(path.join(RUNTIME_ROOT, "scripts", "browser-bridge-server.mjs")) } };
    return console.log(JSON.stringify(out, null, 2));
  }
  if (opts.command === "status") {
    const out = { ok: true, sources: loadSources(project).sources.length, claims: loadClaims(project).claims.length, researchDir: path.relative(project, rpath(project)), unsupported: loadClaims(project).claims.filter(c => c.status === "unsupported" || c.status === "unvalidated").length };
    return console.log(JSON.stringify(out, null, 2));
  }
  if (opts.command === "add-source") {
    const url = opts.text || opts.url;
    if (!url) throw new Error("URL required");
    const data = opts.fetch ? await readSourceContent({ ...opts, url, project }) : { title: opts.title || url, url, text: "", contentType: "", fetched: false };
    return console.log(JSON.stringify(addSource(project, data), null, 2));
  }
  if (opts.command === "add-text") {
    if (!opts.file) throw new Error("--file required");
    const data = await readSourceContent({ ...opts, project, url: opts.url || opts.file });
    return console.log(JSON.stringify(addSource(project, data), null, 2));
  }
  if (opts.command === "claim") return console.log(JSON.stringify(addClaim(project, opts), null, 2));
  if (opts.command === "validate") return console.log(JSON.stringify(validateClaims(project, opts.minScore), null, 2));
  if (opts.command === "report") return console.log(JSON.stringify(generateReport(project, opts), null, 2));
  if (opts.command === "search") {
    if (!opts.text) throw new Error("query required");
    return console.log(JSON.stringify(runBrowserSearch(project, opts.text, opts.browser), null, 2));
  }
  if (opts.command === "run") {
    if (!opts.text) throw new Error("question required");
    return console.log(JSON.stringify(runResearchAgent(project, opts.text, opts.execute), null, 2));
  }
  throw new Error(`Unknown command: ${opts.command}`);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, stack: process.env.DEBUG ? err.stack : undefined }, null, 2));
  process.exit(1);
});
