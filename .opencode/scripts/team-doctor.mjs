#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, "..");
const root = process.argv[2] && !process.argv[2].startsWith("-") ? path.resolve(process.argv[2]) : process.cwd();
const checks = [
  ["project dir", root],
  ["project team dir", path.join(root, ".opencode/team")],
  ["global plugin", path.join(RUNTIME_ROOT, "plugins/team-runtime.js")],
  ["global agents", path.join(RUNTIME_ROOT, "agents/chief-engineer.md")],
  ["project state", path.join(root, ".opencode/team/state.json")],
  ["project handoff", path.join(root, ".opencode/team/handoff.md")],
  ["project evidence", path.join(root, ".opencode/team/evidence.md")],
  ["project runtime config", path.join(root, ".opencode/team/runtime.config.json")],
  ["project task dag", path.join(root, ".opencode/team/task-dag.json")],
  ["global team runner", path.join(RUNTIME_ROOT, "scripts/team-runner.mjs")],
  ["global browser runner", path.join(RUNTIME_ROOT, "scripts/browser-runner.mjs")],
  ["global cloakbrowser mcp", path.join(RUNTIME_ROOT, "mcp/cloakbrowser-mcp.mjs")],
  ["global research runner", path.join(RUNTIME_ROOT, "scripts/research-runner.mjs")],
  ["global context runner", path.join(RUNTIME_ROOT, "scripts/context-runner.mjs")],
];
let ok = true;
for (const [name, file] of checks) {
  const good = fs.existsSync(file);
  const soft = name.startsWith("project ") && name !== "project dir";
  if (!good && !soft) ok = false;
  console.log(`${good ? "✓" : soft ? "!" : "✗"} ${name}: ${file}`);
}
for (const rel of [".opencode/team/state.json", ".opencode/team/runtime.config.json", ".opencode/team/task-dag.json", ".opencode/team/research/sources.json", ".opencode/team/research/claims.json", ".opencode/team/context/index.json", ".opencode/team/context/config.json"]) {
  const f = path.join(root, rel);
  if (fs.existsSync(f)) {
    try { JSON.parse(fs.readFileSync(f, "utf8") || "{}"); console.log(`✓ valid json: ${rel}`); }
    catch (e) { ok = false; console.log(`✗ invalid json: ${rel} ${e.message}`); }
  }
}
const hasOpencode = spawnSync("bash", ["-lc", "command -v opencode || true"], { encoding: "utf8" }).stdout.trim();
console.log(`${hasOpencode ? "✓" : "!"} opencode command: ${hasOpencode || "not found; dry-run still works"}`);
process.exitCode = ok ? 0 : 1;
