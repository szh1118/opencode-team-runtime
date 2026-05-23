#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.resolve(__dirname, '..');

function argProject() {
  const i = process.argv.findIndex((a) => a === '--project' || a === '--dir' || a === '-C');
  return path.resolve(i >= 0 ? process.argv[i + 1] : process.cwd());
}
function exists(p) { return fs.existsSync(p); }
const project = argProject();
const checks = [];
function add(name, ok, note = '') { checks.push({ name, ok, note }); }

add('project exists', exists(project), project);
add('global runtime root', exists(RUNTIME_ROOT), RUNTIME_ROOT);
add('global team runtime plugin', exists(path.join(RUNTIME_ROOT, 'plugins', 'team-runtime.js')), 'global plugins/team-runtime.js');
add('global commands directory', exists(path.join(RUNTIME_ROOT, 'command')), 'global command/');
const commands = ['team-overnight','team-plan','team-step','team-review','team-audit','team-handoff','team-research','team-browser','team-context','team-memory','team-patch-review'];
for (const c of commands) add(`global command ${c}`, exists(path.join(RUNTIME_ROOT, 'command', `${c}.md`)), `command/${c}.md`);
const agents = ['chief-engineer','a-zone-coder','tester','reviewer','auditor','handoff-writer','research-scout','browser-tester','browser-perception','browser-actor','visual-reviewer','overnight-supervisor'];
for (const a of agents) add(`global agent ${a}`, exists(path.join(RUNTIME_ROOT, 'agents', `${a}.md`)), `agents/${a}.md`);
const mcp = ['cloakbrowser-mcp.mjs','browser-bridge-mcp.mjs','research-mcp.mjs','context-mcp.mjs','router-mcp.mjs','memory-mcp.mjs','patch-mcp.mjs','overnight-mcp.mjs'];
for (const m of mcp) add(`global mcp ${m}`, exists(path.join(RUNTIME_ROOT, 'mcp', m)), `mcp/${m}`);
add('project team state dir', exists(path.join(project, '.opencode', 'team')), 'created lazily or by opencode-team init');
add('project handoff', exists(path.join(project, '.opencode', 'team', 'handoff.md')), 'created lazily');
add('project evidence', exists(path.join(project, '.opencode', 'team', 'evidence.md')), 'created lazily');

let ok = true;
for (const c of checks) {
  if (!['project team state dir','project handoff','project evidence'].includes(c.name)) ok = ok && c.ok;
  const soft = ['project team state dir','project handoff','project evidence'].includes(c.name);
  console.log(`${c.ok ? '✓' : soft ? '!' : '✗'} ${c.name}${c.note ? ` — ${c.note}` : ''}`);
}
console.log('\nDesktop flow: open this project in OpenCode Desktop and run /team-overnight or /team-plan.');
console.log('If project state is missing, run: opencode-team init');
process.exitCode = ok ? 0 : 1;
