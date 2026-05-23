#!/usr/bin/env node
/**
 * opencode-team-runtime P8.1 agent registry & mailbox runner
 *
 * Logical agent coördination: register IDs, heartbeat, metrics, messaging.
 * No third-party dependencies.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const VERSION = "0.2.0-pa1"
const TEAM_DIR = [".opencode", "team"]

function now() { return new Date().toISOString() }
function teamPath(project, ...parts) { return path.join(project, ...TEAM_DIR, ...parts) }

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return JSON.parse(JSON.stringify(fallback))
    const raw = fs.readFileSync(file, "utf8").trim()
    if (!raw) return JSON.parse(JSON.stringify(fallback))
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`)
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
}

function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(obj) + "\n")
}

function truncate(value, max = 4000) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n...<truncated ${s.length - max} chars>`
}

function defaultCapabilities(role) {
  const map = {
    "a-zone-coder": ["implement", "test"],
    "coder": ["implement", "test"],
    "reviewer": ["review"],
    "auditor": ["audit"],
    "chief-engineer": ["plan", "coordinate"],
    "browser-actor": ["browser"],
    "research-scout": ["research"],
    "handoff-writer": ["handoff"],
  }
  return map[role] || []
}

function defaultRegistry() {
  return { agents: [] }
}

function ensureAgentFiles(project) {
  fs.mkdirSync(teamPath(project), { recursive: true })
  const agentsFile = teamPath(project, "agents.json")
  const messagesFile = teamPath(project, "messages.jsonl")
  if (!fs.existsSync(agentsFile)) writeJson(agentsFile, defaultRegistry())
  if (!fs.existsSync(messagesFile)) { fs.mkdirSync(path.dirname(messagesFile), { recursive: true }); fs.writeFileSync(messagesFile, "") }
  return { agentsFile, messagesFile }
}

function usage() {
  console.log(`opencode-team-runtime agent-registry ${VERSION}

Usage:
  node .opencode/scripts/agent-registry-runner.mjs doctor [--project DIR]
  node .opencode/scripts/agent-registry-runner.mjs register --id AGENT --role ROLE [--capabilities cap1,cap2] [--mode desktop-subagent|cli-session|manual]
  node .opencode/scripts/agent-registry-runner.mjs list [--project DIR] [--json]
  node .opencode/scripts/agent-registry-runner.mjs heartbeat --id AGENT [--project DIR]
  node .opencode/scripts/agent-registry-runner.mjs metric --id AGENT --status passed|failed [--duration-ms N] [--project DIR]
  node .opencode/scripts/agent-registry-runner.mjs send --to AGENT [--from AGENT] --type TYPE [--payload TEXT] [--project DIR]
  node .opencode/scripts/agent-registry-runner.mjs poll [--to AGENT] [--limit N] [--project DIR] [--json]
  node .opencode/scripts/agent-registry-runner.mjs status [--project DIR] [--json]

Notes:
  - Agents are stored in .opencode/team/agents.json
  - Messages are appended to .opencode/team/messages.jsonl
  - Delivery is tracked via marker lines in the same log
`)
}

function parseArgs(argv) {
  const args = [...argv]
  const opts = {
    command: args.shift() || "help",
    project: process.cwd(),
    id: "",
    role: "",
    capabilities: "",
    mode: "",
    status: "",
    to: "",
    from: "",
    type: "",
    payload: "",
    agent_status: "",
    durationMs: 0,
    limit: null,
    json: false,
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (["--project", "--dir", "-C"].includes(a)) opts.project = path.resolve(args[++i])
    else if (a === "--id") opts.id = args[++i]
    else if (a === "--role") opts.role = args[++i]
    else if (a === "--capabilities") opts.capabilities = args[++i]
    else if (a === "--mode") opts.mode = args[++i]
    else if (a === "--status") opts.status = args[++i]
    else if (a === "--to") opts.to = args[++i]
    else if (a === "--from") opts.from = args[++i]
    else if (a === "--type") opts.type = args[++i]
    else if (a === "--payload") opts.payload = args[++i]
    else if (a === "--agent-status" || a === "--agent_status") opts.agent_status = args[++i]
    else if (a === "--duration-ms" || a === "--durationMs") opts.durationMs = Number(args[++i])
    else if (a === "--limit") opts.limit = Number(args[++i])
    else if (a === "--json") opts.json = true
  }
  return opts
}

function doctor(project) {
  ensureAgentFiles(project)
  const agentsFile = teamPath(project, "agents.json")
  const messagesFile = teamPath(project, "messages.jsonl")
  const checks = []
  const add = (name, ok, note = "") => checks.push({ name, ok, note })
  add("team dir", fs.existsSync(teamPath(project)), "")
  add("agents.json", fs.existsSync(agentsFile), "")
  add("messages.jsonl", fs.existsSync(messagesFile), "")
  let ok = true
  for (const c of checks) {
    ok = ok && c.ok
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`)
  }
  process.exitCode = ok ? 0 : 1
}

function register(project, opts) {
  if (!opts.id) throw new Error("register requires --id AGENT")
  if (!opts.role) throw new Error("register requires --role ROLE")

  const file = teamPath(project, "agents.json")
  ensureAgentFiles(project)
  const registry = readJson(file, { agents: [] })

  const existing = registry.agents.find(a => a.id === opts.id)
  if (existing) {
    existing.role = opts.role || existing.role
    existing.capabilities = opts.capabilities ? opts.capabilities.split(",").map(s => s.trim()).filter(Boolean) : existing.capabilities
    existing.mode = opts.mode || existing.mode
    existing.status = "idle"
    existing.lastActive = now()
    writeJson(file, registry)
    if (opts.json) console.log(JSON.stringify({ ok: true, agent: existing, updated: true }, null, 2))
    else console.log(`Agent ${opts.id} updated.`)
    return
  }

  const agent = {
    id: opts.id,
    role: opts.role,
    capabilities: opts.capabilities ? opts.capabilities.split(",").map(s => s.trim()).filter(Boolean) : defaultCapabilities(opts.role),
    mode: opts.mode || "desktop-subagent",
    status: "idle",
    lastActive: now(),
    successRate: null,
  }
  registry.agents.push(agent)
  writeJson(file, registry)
  if (opts.json) console.log(JSON.stringify({ ok: true, agent }, null, 2))
  else console.log(`Agent ${agent.id} registered (${agent.role}).`)
}

function list(project, opts) {
  const file = teamPath(project, "agents.json")
  const registry = readJson(file, { agents: [] })
  if (opts.json) {
    console.log(JSON.stringify(registry, null, 2))
  } else {
    if (registry.agents.length === 0) {
      console.log("No agents registered.")
    } else {
      for (const a of registry.agents) {
        const caps = (a.capabilities || []).join(",")
        console.log(`${a.id.padEnd(18)} ${(a.role || "").padEnd(16)} ${(a.mode || "").padEnd(18)} ${(a.status || "").padEnd(8)} ${caps.padEnd(30)} ${a.lastActive || "-"}`)
      }
    }
  }
}

function heartbeat(project, opts) {
  if (!opts.id) throw new Error("heartbeat requires --id AGENT")

  const file = teamPath(project, "agents.json")
  const registry = readJson(file, { agents: [] })
  const agent = registry.agents.find(a => a.id === opts.id)
  if (!agent) throw new Error(`Agent ${opts.id} not found. Register first.`)

  agent.lastActive = now()
  writeJson(file, registry)

  if (opts.json) console.log(JSON.stringify({ ok: true, id: agent.id, lastActive: agent.lastActive }, null, 2))
  else console.log(`Heartbeat: ${agent.id} at ${agent.lastActive}`)
}

function metric(project, opts) {
  if (!opts.id) throw new Error("metric requires --id AGENT")
  if (!opts.status) throw new Error("metric requires --status passed|failed")

  const file = teamPath(project, "agents.json")
  const registry = readJson(file, { agents: [] })
  const agent = registry.agents.find(a => a.id === opts.id)
  if (!agent) throw new Error(`Agent ${opts.id} not found. Register first.`)

  agent.lastActive = now()
  const passed = opts.status === "passed" ? 1 : 0
  if (agent.successRate !== null && agent.successRate !== undefined) {
    agent.successRate = 0.8 * agent.successRate + 0.2 * passed
  } else {
    agent.successRate = passed
  }

  writeJson(file, registry)
  if (opts.json) console.log(JSON.stringify({ ok: true, id: agent.id, successRate: agent.successRate, lastActive: agent.lastActive }, null, 2))
  else console.log(`Metric recorded: ${agent.id} successRate=${agent.successRate.toFixed(2)}`)
}

function send(project, opts) {
  if (!opts.to) throw new Error("send requires --to AGENT")
  if (!opts.type) throw new Error("send requires --type TYPE")

  const file = teamPath(project, "messages.jsonl")
  ensureAgentFiles(project)

  const msg = {
    id: `msg-${crypto.randomBytes(4).toString("hex")}`,
    from: opts.from || "system",
    to: opts.to,
    type: opts.type,
    payload: opts.payload || "",
    timestamp: now(),
  }
  appendLine(file, msg)

  if (opts.json) console.log(JSON.stringify({ ok: true, message: msg }, null, 2))
  else console.log(`Message ${msg.id} sent to ${opts.to}.`)
}

function poll(project, opts) {
  const file = teamPath(project, "messages.jsonl")
  const limit = opts.limit || 10

  let allLines = []
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8").trim()
      if (raw) {
        allLines = raw.split("\n").map(l => {
          try { return JSON.parse(l) } catch { return null }
        }).filter(Boolean)
      }
    }
  } catch (err) {
    throw new Error(`Failed to read messages: ${err.message}`)
  }

  const messages = allLines.filter(l => l.id && !l.marker)
  const deliveryIds = new Set(allLines.filter(l => l.marker === "delivered").map(l => l.messageId))

  const undelivered = messages.filter(m => !deliveryIds.has(m.id))
  let filtered = undelivered
  if (opts.to) filtered = undelivered.filter(m => m.to === opts.to)

  const batch = filtered.slice(0, limit)

  for (const msg of batch) {
    appendLine(file, { marker: "delivered", messageId: msg.id, deliveredAt: now() })
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, count: batch.length, messages: batch }, null, 2))
  } else {
    if (batch.length === 0) console.log("No messages.")
    else {
      for (const m of batch) {
        console.log(`[${m.timestamp}] ${m.from} → ${m.to} [${m.type}] ${truncate(m.payload || "", 200)}`)
      }
    }
  }
}

function statusCmd(project, opts) {
  const agentsFile = teamPath(project, "agents.json")
  const messagesFile = teamPath(project, "messages.jsonl")

  const registry = readJson(agentsFile, { agents: [] })

  let pendingMessages = 0
  try {
    if (fs.existsSync(messagesFile)) {
      const raw = fs.readFileSync(messagesFile, "utf8").trim()
      if (raw) {
        const allLines = raw.split("\n").map(l => {
          try { return JSON.parse(l) } catch { return null }
        }).filter(Boolean)
        const messages = allLines.filter(l => l.id && !l.marker)
        const deliveryIds = new Set(allLines.filter(l => l.marker === "delivered").map(l => l.messageId))
        pendingMessages = messages.filter(m => !deliveryIds.has(m.id)).length
      }
    }
  } catch {
    pendingMessages = 0
  }

  const out = {
    version: VERSION,
    agentCount: registry.agents.length,
    agents: registry.agents.map(a => ({
      id: a.id,
      role: a.role,
      mode: a.mode,
      status: a.status,
      lastActive: a.lastActive,
      successRate: a.successRate,
    })),
    pendingMessages,
  }

  if (opts.json) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(`Agent Registry ${VERSION}`)
    console.log(`Agents: ${out.agentCount}`)
    console.log(`Pending messages: ${out.pendingMessages}`)
    if (out.agents.length) {
      for (const a of out.agents) {
        const sr = a.successRate !== null && a.successRate !== undefined ? a.successRate.toFixed(2) : "-"
        console.log(`  ${a.id.padEnd(18)} ${(a.role || "").padEnd(16)} ${(a.status || "").padEnd(8)} sr=${sr}`)
      }
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const project = path.resolve(opts.project)
  try {
    switch (opts.command) {
      case "help": case "--help": case "-h": usage(); break
      case "doctor": doctor(project); break
      case "register": register(project, opts); break
      case "list": ensureAgentFiles(project); list(project, opts); break
      case "heartbeat": heartbeat(project, opts); break
      case "metric": metric(project, opts); break
      case "send": send(project, opts); break
      case "poll": poll(project, opts); break
      case "status": statusCmd(project, opts); break
      default: usage(); process.exitCode = 1
    }
  } catch (err) {
    console.error(`agent-registry error: ${err.message}`)
    process.exitCode = 1
  }
}

main()
