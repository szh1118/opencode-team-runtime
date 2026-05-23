#!/usr/bin/env node
/**
 * opencode-team-runtime skill-pack loader
 *
 * Discovers and indexes skill packs from .claude-plugin/plugin.json
 * and SKILL.md files. Supports CLI listing, loading, and search.
 *
 * No third-party dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const VERSION = "0.2.0-pa1";
const TEAM = [".opencode", "team"];

function now() { return new Date().toISOString(); }
function id(prefix = "pkg") { return `${prefix}-${crypto.randomBytes(4).toString("hex")}`; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function teamPath(project, ...parts) { return path.join(project, ...TEAM, ...parts); }

function readText(file, fallback = "") {
  try { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback; } catch { return fallback; }
}

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    const raw = fs.readFileSync(file, "utf8").trim();
    return raw ? JSON.parse(raw) : clone(fallback);
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function mkdirpSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultRegistry() {
  return { version: VERSION, updatedAt: null, packs: [] };
}

function registryPath(project) {
  return teamPath(project, "skill-packs.json");
}

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return fm;
}

function scanPack(packRoot) {
  const pluginFile = path.join(packRoot, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(pluginFile)) return null;
  const plugin = readJson(pluginFile, null);
  if (!plugin || !plugin.name) return null;

  const skills = [];
  const skillsDir = path.join(packRoot, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const text = readText(skillMd);
      const fm = parseFrontmatter(text);
      skills.push({
        name: entry.name,
        description: fm.description || plugin.name + " / " + entry.name,
        path: path.relative(packRoot, skillMd),
      });
    }
  }

  return { name: plugin.name, root: path.resolve(packRoot), skills };
}

export function buildIndex(project) {
  const reg = readJson(registryPath(project), defaultRegistry());
  const packs = [];
  const allSkills = [];
  for (const p of reg.packs || []) {
    const scanned = scanPack(p.root);
    if (scanned) {
      packs.push({ name: scanned.name, root: scanned.root, skills: scanned.skills });
      for (const s of scanned.skills) {
        allSkills.push({ pack: scanned.name, packRoot: scanned.root, ...s });
      }
    }
  }
  return { packs, skills: allSkills };
}

export function cmdInit(project) {
  const file = registryPath(project);
  mkdirpSync(path.dirname(file));
  if (!fs.existsSync(file)) writeJson(file, defaultRegistry());
  return { ok: true, registry: file, version: VERSION };
}

export function cmdDoctor(project) {
  const index = buildIndex(project);
  const reg = readJson(registryPath(project), defaultRegistry());
  const issues = [];
  for (const p of reg.packs || []) {
    if (!fs.existsSync(p.root)) issues.push(`Pack root missing: ${p.name} -> ${p.root}`);
    else if (!fs.existsSync(path.join(p.root, ".claude-plugin", "plugin.json")))
      issues.push(`Missing .claude-plugin/plugin.json in ${p.name}`);
  }
  return { ok: issues.length === 0, packs: reg.packs.length, skills: index.skills.length, issues };
}

export function cmdListPacks(project, opts = {}) {
  const index = buildIndex(project);
  return index.packs.map(p => ({
    name: p.name,
    root: p.root,
    skillCount: p.skills.length,
    skills: p.skills.map(s => s.name),
  }));
}

export function cmdListSkills(project, opts = {}) {
  const index = buildIndex(project);
  return index.skills.map(s => ({
    name: s.name,
    pack: s.pack,
    description: s.description,
    path: s.path,
  }));
}

export function cmdLoad(project, name) {
  const index = buildIndex(project);
  const skill = index.skills.find(s => s.name === name);
  if (!skill) throw new Error(`Skill not found: ${name}`);
  const fullPath = path.join(skill.packRoot, skill.path);
  const text = readText(fullPath);
  const fm = parseFrontmatter(text);
  return {
    name: skill.name,
    pack: skill.pack,
    path: skill.path,
    description: fm.description || "",
    content: text,
  };
}

export function cmdSearch(project, query) {
  const index = buildIndex(project);
  const q = (query || "").toLowerCase();
  if (!q) return index.skills.map(s => ({ name: s.name, pack: s.pack, description: s.description }));
  const results = index.skills.filter(
    s =>
      s.name.toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q)
  );
  return results.map(s => ({ name: s.name, pack: s.pack, description: s.description }));
}

export function cmdAddPack(project, packPath, name = null) {
  const absPath = path.resolve(packPath);
  if (!fs.existsSync(absPath)) throw new Error(`Pack path does not exist: ${absPath}`);
  const scanned = scanPack(absPath);
  if (!scanned) throw new Error(`No valid .claude-plugin/plugin.json found in ${absPath}`);

  const reg = readJson(registryPath(project), defaultRegistry());
  const existing = reg.packs.find(p => p.root === absPath || p.name === (name || scanned.name));
  if (existing) throw new Error(`Pack already registered: ${existing.name}`);

  reg.packs.push({ name: name || scanned.name, root: absPath, installedAt: now() });
  reg.updatedAt = now();
  writeJson(registryPath(project), reg);
  return { ok: true, added: scanned.name, skillsFound: scanned.skills.length };
}

export function cmdRemovePack(project, name) {
  const reg = readJson(registryPath(project), defaultRegistry());
  const idx = reg.packs.findIndex(p => p.name === name);
  if (idx === -1) throw new Error(`Pack not found: ${name}`);
  reg.packs.splice(idx, 1);
  reg.updatedAt = now();
  writeJson(registryPath(project), reg);
  return { ok: true, removed: name };
}

export function indexes(project) {
  return buildIndex(project);
}

function usage() {
  console.log(`opencode-team-runtime skill-pack-loader ${VERSION}

Usage:
  opencode-skill-pack init [--project DIR]
  opencode-skill-pack doctor [--project DIR]
  opencode-skill-pack list-packs [--project DIR] [--json]
  opencode-skill-pack list-skills [--project DIR] [--json]
  opencode-skill-pack load SKILL_NAME [--project DIR] [--json]
  opencode-skill-pack search KEYWORD [--project DIR] [--json]
  opencode-skill-pack add-pack PATH [--name NAME] [--project DIR]
  opencode-skill-pack remove-pack NAME [--project DIR]

MCP-compatible server tools:
  skill_pack_list  — list installed packs
  skill_list       — list all known skills with descriptions
  skill_load       — load full SKILL.md for one skill
  skill_search     — search descriptions for keyword
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    command: args.shift() || "help",
    project: process.cwd(),
    json: false,
    name: "",
    _: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--project", "--dir", "-C"].includes(a)) opts.project = path.resolve(args[++i]);
    else if (a === "--json") opts.json = true;
    else if (a === "--name") opts.name = args[++i];
    else opts._.push(a);
  }
  return opts;
}

function print(value, json = false) {
  if (json || typeof value !== "string") console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const project = path.resolve(opts.project);

  if (opts.command === "help" || opts.command === "--help" || opts.command === "-h") return usage();
  if (opts.command === "init") return print(cmdInit(project), opts.json);
  if (opts.command === "doctor") return print(cmdDoctor(project), opts.json);
  if (opts.command === "list-packs") return print(cmdListPacks(project, opts), opts.json);
  if (opts.command === "list-skills") return print(cmdListSkills(project, opts), opts.json);
  if (opts.command === "load") return print(cmdLoad(project, opts._[0] || ""), opts.json);
  if (opts.command === "search") return print(cmdSearch(project, opts._.join(" ") || ""), opts.json);
  if (opts.command === "add-pack") return print(cmdAddPack(project, opts._[0] || "", opts.name), opts.json);
  if (opts.command === "remove-pack") return print(cmdRemovePack(project, opts._[0] || ""), opts.json);
  throw new Error(`Unknown command: ${opts.command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`skill-pack-loader error: ${err.message}`);
    process.exit(1);
  });
}
