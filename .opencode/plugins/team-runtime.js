/**
 * opencode-team-runtime P8.1 plugin
 *
 * Evidence-driven team coordination layer for OpenCode.
 * - Records session/tool/file/todo events into .opencode/team/state.jsonl + state.json
 * - Provides custom tools for handoff, evidence, task status, and quality gates
 * - Injects team state into compaction so long sessions can rotate safely
 * - Blocks a small set of obviously dangerous commands by default
 *
 * This is intentionally a plugin shim, not the full external scheduler.
 * The later runtime can consume the same .opencode/team files.
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { tool } from "@opencode-ai/plugin"

const SERVICE = "opencode-team-runtime"
const VERSION = "0.10.0-p8.1"

function now() {
  return new Date().toISOString()
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readText(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return fallback
  }
}

function writeTextAtomic(file, text) {
  mkdirp(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

function readJson(file, fallback) {
  const text = readText(file, "")
  if (!text.trim()) return fallback
  return safeJsonParse(text, fallback)
}

function writeJson(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

function stableId(prefix = "id") {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`
}

function truncate(value, max = 4000) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n...<truncated ${s.length - max} chars>`
}

function getArgObject(input) {
  if (!input || typeof input !== "object") return {}
  const raw = input.args ?? input.params ?? input.input ?? {}
  return raw && typeof raw === "object" ? raw : {}
}

function getFilePathFromArgs(args) {
  const p = args.filePath ?? args.file_path ?? args.path ?? args.filename
  return typeof p === "string" && p.trim() ? p.trim() : null
}

function getCommandFromArgs(args) {
  const cmd = args.command ?? args.cmd ?? args.script
  return typeof cmd === "string" ? cmd : ""
}

function normalizeRel(worktree, filePath) {
  if (!filePath) return null
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(worktree, filePath)
    const rel = path.relative(worktree, abs)
    if (!rel || rel.startsWith("..")) return filePath
    return rel
  } catch {
    return filePath
  }
}

function defaultState(projectRoot) {
  return {
    version: VERSION,
    projectRoot,
    createdAt: now(),
    updatedAt: now(),
    phase: "INIT",
    activeGoal: "",
    sessions: {},
    tasks: [],
    changedFiles: [],
    evidence: [],
    tests: [],
    browserChecks: [],
    blockers: [],
    rotation: {
      pending: false,
      reason: "",
      requestedAt: null,
      softThreshold: 0.65,
      hardThreshold: 0.8,
    },
    gates: {
      requireEvidence: true,
      requireReview: true,
      requireHandoff: true,
      requireCleanGitStatus: false,
    },
    counters: {
      events: 0,
      tools: 0,
      edits: 0,
      todos: 0,
    },
    lastEvent: null,
  }
}

function defaultConfig() {
  return {
    version: VERSION,
    danger: {
      blockCommands: [
        "rm -rf /*",
        "sudo rm -rf",
        "mkfs",
        ":(){ :|:& };:",
        "dd if=",
        "chmod -R 777 /",
        "chown -R",
        "curl *| sh",
        "wget *| sh",
      ],
      protectFiles: [".env", ".env.*", "**/.env", "**/.env.*", "id_rsa", "id_ed25519"],
    },
    evidence: {
      maxToolOutputChars: 4000,
      maxEventJsonChars: 6000,
    },
    rotationProfiles: {
      worker: { budgetTokens: 204800, soft: 0.80, hard: 0.85, notes: "MiniMax M2.7 204K ctx, rotate at 80-85%." },
      supervisor: { budgetTokens: 768000, soft: 0.78, hard: 0.95, notes: "DeepSeek V4 Pro 1M ctx, 768K usable for agent coding, buffer 400K." },
      handoff: { budgetTokens: 768000, soft: 0.78, hard: 0.95, notes: "Qwen3.7 Max 1M ctx, same practical bounds as supervisor." },
      checkpoint: { budgetTokens: 200000, soft: 0.75, hard: 0.90, notes: "GPT-5.5 400K ctx, 240K practical, rotate around 200K." },
      default: { soft: 0.75, hard: 0.85 },
    },
  }
}

function defaultHandoff() {
  return `# Team Handoff\n\n## Goal\n\nUnspecified. Use \`team_task\` or edit this handoff to set the project goal.\n\n## Current State\n\n- Phase: INIT\n- No verified implementation evidence yet.\n\n## Task DAG Status\n\n### Done\n\n- None\n\n### In Review\n\n- None\n\n### Failed / Blocked\n\n- None\n\n### Next\n\n- Create a small, verifiable next task.\n\n## Files in Flight\n\n| file | status | why touched | risk |\n|---|---|---|---|\n\n## Evidence\n\n- commands run: none\n- tests passed: none\n- browser checks: none\n- logs/screenshots: none\n\n## Failed Attempts\n\n| attempt | reason failed | do not repeat |\n|---|---|---|\n\n## Open Questions\n\n- None recorded.\n\n## Next Atomic Task\n\nDefine the next atomic task.\n\n## Stop Conditions\n\nA session may claim completion only when: task acceptance criteria are checked, evidence is recorded, reviewer/auditor gates pass when required, and this handoff is updated.\n\n## Reviewer Notes\n\n- None yet.\n`
}

function createPaths(root) {
  const teamDir = path.join(root, ".opencode", "team")
  return {
    root,
    teamDir,
    contextDir: path.join(teamDir, "context"),
    contextPackFile: path.join(teamDir, "context", "current-pack.md"),
    stateFile: path.join(teamDir, "state.json"),
    configFile: path.join(teamDir, "config.json"),
    handoffFile: path.join(teamDir, "handoff.md"),
    evidenceFile: path.join(teamDir, "evidence.md"),
    eventsFile: path.join(teamDir, "events.jsonl"),
    lockFile: path.join(teamDir, "runtime.lock"),
  }
}

function ensureFiles(paths) {
  mkdirp(paths.teamDir)
  if (!fs.existsSync(paths.configFile)) writeJson(paths.configFile, defaultConfig())
  if (!fs.existsSync(paths.stateFile)) writeJson(paths.stateFile, defaultState(paths.root))
  if (!fs.existsSync(paths.handoffFile)) writeTextAtomic(paths.handoffFile, defaultHandoff())
  if (!fs.existsSync(paths.evidenceFile)) {
    writeTextAtomic(paths.evidenceFile, `# Team Evidence\n\nGenerated by ${SERVICE} ${VERSION}.\n\n`)
  }
  if (!fs.existsSync(paths.eventsFile)) writeTextAtomic(paths.eventsFile, "")
}

function loadState(paths) {
  const state = readJson(paths.stateFile, defaultState(paths.root))
  state.version = state.version ?? VERSION
  state.projectRoot = state.projectRoot ?? paths.root
  state.sessions = state.sessions ?? {}
  state.tasks = Array.isArray(state.tasks) ? state.tasks : []
  state.changedFiles = Array.isArray(state.changedFiles) ? state.changedFiles : []
  state.evidence = Array.isArray(state.evidence) ? state.evidence : []
  state.tests = Array.isArray(state.tests) ? state.tests : []
  state.browserChecks = Array.isArray(state.browserChecks) ? state.browserChecks : []
  state.blockers = Array.isArray(state.blockers) ? state.blockers : []
  state.counters = state.counters ?? { events: 0, tools: 0, edits: 0, todos: 0 }
  return state
}

function saveState(paths, state) {
  state.updatedAt = now()
  writeJson(paths.stateFile, state)
}

function appendJsonl(file, entry) {
  mkdirp(path.dirname(file))
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`)
}

function appendEvidence(paths, item) {
  const state = loadState(paths)
  const entry = {
    id: item.id || stableId("ev"),
    type: item.type || "note",
    taskId: item.taskId || null,
    title: item.title || "Untitled evidence",
    command: item.command || null,
    path: item.path || null,
    url: item.url || null,
    status: item.status || "recorded",
    summary: item.summary || "",
    raw: item.raw ? truncate(item.raw, 3000) : undefined,
    createdAt: now(),
  }
  state.evidence.push(entry)
  if (entry.type === "test") state.tests.push(entry)
  if (entry.type === "browser") state.browserChecks.push(entry)
  saveState(paths, state)

  const md = [
    `\n## ${entry.createdAt} — ${entry.type}: ${entry.title}`,
    entry.taskId ? `- task: ${entry.taskId}` : null,
    entry.status ? `- status: ${entry.status}` : null,
    entry.command ? `- command: \`${entry.command.replace(/`/g, "\\`")}\`` : null,
    entry.path ? `- path: \`${entry.path}\`` : null,
    entry.url ? `- url: ${entry.url}` : null,
    entry.summary ? `\n${entry.summary}` : null,
    entry.raw ? `\n<details><summary>raw</summary>\n\n\`\`\`text\n${entry.raw}\n\`\`\`\n</details>` : null,
    "",
  ].filter(Boolean).join("\n")
  fs.appendFileSync(paths.evidenceFile, `${md}\n`)
  return entry
}

function addChangedFile(paths, filePath, reason = "edited") {
  if (!filePath) return
  const state = loadState(paths)
  const existing = state.changedFiles.find((x) => x.path === filePath)
  if (existing) {
    existing.updatedAt = now()
    existing.reason = reason || existing.reason
  } else {
    state.changedFiles.push({ path: filePath, reason, status: "in-flight", createdAt: now(), updatedAt: now() })
  }
  state.counters.edits = (state.counters.edits ?? 0) + 1
  saveState(paths, state)
}

function upsertTask(paths, task) {
  const state = loadState(paths)
  const id = task.id || stableId("task")
  const existing = state.tasks.find((t) => t.id === id)
  const next = {
    id,
    title: task.title || existing?.title || "Untitled task",
    status: task.status || existing?.status || "open",
    owner: task.owner || existing?.owner || "unassigned",
    area: task.area || existing?.area || "A",
    priority: task.priority || existing?.priority || "normal",
    acceptance: Array.isArray(task.acceptance) ? task.acceptance : existing?.acceptance || [],
    notes: task.notes ?? existing?.notes ?? "",
    evidenceIds: Array.isArray(task.evidenceIds) ? task.evidenceIds : existing?.evidenceIds || [],
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  }
  if (existing) Object.assign(existing, next)
  else state.tasks.push(next)
  state.phase = state.phase === "INIT" ? "TASK_DAG_CREATED" : state.phase
  saveState(paths, state)
  return next
}

function evaluateGate(paths, taskId = null) {
  const state = loadState(paths)
  const handoff = readText(paths.handoffFile, "")
  const tasks = taskId ? state.tasks.filter((t) => t.id === taskId) : state.tasks
  const openTasks = state.tasks.filter((t) => !["done", "reviewed", "verified"].includes(t.status))
  const taskEvidenceIds = new Set(tasks.flatMap((t) => t.evidenceIds || []))
  const evidence = taskId
    ? state.evidence.filter((e) => e.taskId === taskId || taskEvidenceIds.has(e.id))
    : state.evidence
  const changedFiles = state.changedFiles || []
  const tests = evidence.filter((e) => e.type === "test" && ["passed", "ok", "recorded"].includes(e.status))
  const reviews = evidence.filter((e) => ["review", "audit"].includes(e.type) && ["passed", "ok"].includes(e.status))
  const handoffLooksUpdated = /## Current State[\s\S]+## Task DAG Status/.test(handoff) && !handoff.includes("Unspecified. Use `team_task`")

  const failures = []
  const warnings = []

  if (!tasks.length) failures.push("No task is registered in .opencode/team/state.json.")
  if (taskId && !tasks.length) failures.push(`Task not found: ${taskId}`)
  if (!evidence.length) failures.push("No evidence recorded. Use team_evidence after tests/review/browser checks.")
  if (changedFiles.length && !tests.length) warnings.push("Files changed but no passing test evidence is recorded.")
  if (state.gates?.requireReview && changedFiles.length && !reviews.length) warnings.push("Files changed but no review/audit pass evidence is recorded.")
  if (state.gates?.requireHandoff && !handoffLooksUpdated) warnings.push("handoff.md still looks like the initial template or lacks current state.")
  if (openTasks.length && !taskId) warnings.push(`${openTasks.length} task(s) still not done/reviewed/verified.`)
  if (state.rotation?.pending) warnings.push(`Session rotation pending: ${state.rotation.reason || "no reason recorded"}`)

  return {
    ok: failures.length === 0 && warnings.length === 0,
    failures,
    warnings,
    summary: {
      phase: state.phase,
      tasks: state.tasks.length,
      openTasks: openTasks.length,
      changedFiles: changedFiles.length,
      evidence: state.evidence.length,
      tests: state.tests.length,
      browserChecks: state.browserChecks.length,
    },
  }
}

function renderStatus(paths) {
  const state = loadState(paths)
  const gate = evaluateGate(paths)
  const recentTasks = [...state.tasks].slice(-8)
  const recentEvidence = [...state.evidence].slice(-8)
  return {
    version: VERSION,
    phase: state.phase,
    activeGoal: state.activeGoal,
    updatedAt: state.updatedAt,
    rotation: state.rotation,
    summary: gate.summary,
    gate,
    recentTasks,
    recentEvidence,
    changedFiles: state.changedFiles,
    handoffPath: path.relative(paths.root, paths.handoffFile),
    evidencePath: path.relative(paths.root, paths.evidenceFile),
  }
}

function renderCompactionContext(paths) {
  const status = renderStatus(paths)
  const handoff = truncate(readText(paths.handoffFile, ""), 6000)
  return `\n## OpenCode Team Runtime State\n\nThe project uses opencode-team-runtime. Preserve these facts across compaction.\n\n### Status JSON\n\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\`\n\n### Handoff\n\n${handoff}\n\n### Continuation Rule\n\nDo not claim the whole task is done unless team_gate passes. If rotation is pending, update handoff/evidence and continue from the next atomic task in a fresh session.\n`
}

function isDangerousCommand(command, config) {
  if (!command) return null
  const normalized = command.replace(/\s+/g, " ").trim()
  for (const pattern of config.danger?.blockCommands || []) {
    const re = new RegExp(`^${pattern.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`, "i")
    if (re.test(normalized)) return pattern
  }
  return null
}

function isProtectedFile(filePath) {
  if (!filePath) return false
  const base = path.basename(filePath)
  return base === ".env" || base.startsWith(".env.") || base === "id_rsa" || base === "id_ed25519"
}

export const TeamRuntimePlugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd()
  const paths = createPaths(root)
  ensureFiles(paths)
  const config = readJson(paths.configFile, defaultConfig())

  const log = async (level, message, extra = {}) => {
    try {
      await client?.app?.log?.({ body: { service: SERVICE, level, message, extra } })
    } catch {
      // Avoid breaking the user's session if logging is unavailable.
    }
  }

  const recordEvent = (type, payload = {}) => {
    const state = loadState(paths)
    const entry = { ts: now(), type, payload: safeJsonParse(truncate(payload, config.evidence?.maxEventJsonChars || 6000), payload) }
    state.counters.events = (state.counters.events ?? 0) + 1
    state.lastEvent = entry
    saveState(paths, state)
    appendJsonl(paths.eventsFile, entry)
  }

  await log("info", `Team runtime ${VERSION} initialized`, { root })

  return {
    "shell.env": async (_input, output) => {
      output.env = output.env || {}
      output.env.OPENCODE_TEAM_ROOT = paths.teamDir
      output.env.OPENCODE_TEAM_STATE = paths.stateFile
      output.env.OPENCODE_TEAM_HANDOFF = paths.handoffFile
      output.env.OPENCODE_TEAM_EVIDENCE = paths.evidenceFile
      output.env.OPENCODE_TEAM_CONTEXT = paths.contextDir
      output.env.OPENCODE_TEAM_CONTEXT_PACK = paths.contextPackFile
    },

    event: async ({ event }) => {
      const type = event?.type || event?.name || "unknown"
      const props = event?.properties || event?.data || event?.payload || {}

      if (type === "session.created") {
        const state = loadState(paths)
        const id = props?.sessionID || props?.info?.id || event?.session?.id || event?.id || stableId("session")
        state.sessions[id] = {
          id,
          status: "created",
          createdAt: now(),
          updatedAt: now(),
          raw: truncate(event, 1500),
        }
        state.phase = state.phase === "INIT" ? "IDEA_RECEIVED" : state.phase
        saveState(paths, state)
      }

      if (type === "session.error") {
        const state = loadState(paths)
        state.blockers.push({ id: stableId("block"), type: "session.error", event: truncate(event, 2000), createdAt: now() })
        saveState(paths, state)
      }

      if (type === "session.compacted") {
        const state = loadState(paths)
        state.rotation.pending = false
        state.rotation.reason = "compacted"
        saveState(paths, state)
      }

      if (type === "session.idle") {
        const gate = evaluateGate(paths)
        recordEvent("session.idle", { event, gate })
        if (!gate.ok) {
          await log("warn", "Session became idle before team gate passed", gate)
        } else {
          await log("info", "Session idle with team gate passed", gate.summary)
        }
        return
      }

      if (type === "todo.updated") {
        const state = loadState(paths)
        state.counters.todos = (state.counters.todos ?? 0) + 1
        saveState(paths, state)
      }

      if (type === "file.edited") {
        const filePath = normalizeRel(root, props?.file ?? props?.path ?? event?.path ?? event?.file ?? "")
        if (filePath) addChangedFile(paths, filePath, "file.edited")
      }

      // Keep all event types in the JSONL log for later context packing.
      recordEvent(type, event)
    },

    "tool.execute.before": async (input, output) => {
      const args = getArgObject(output || input)
      const toolName = input?.tool ?? output?.tool ?? "unknown"
      if (toolName === "bash") {
        const command = getCommandFromArgs(args)
        const matched = isDangerousCommand(command, config)
        if (matched) {
          appendEvidence(paths, {
            type: "block",
            title: "Blocked dangerous command",
            command,
            status: "blocked",
            summary: `Blocked by pattern: ${matched}`,
          })
          throw new Error(`[team-runtime] Dangerous command blocked: ${matched}`)
        }
      }
      if (["read", "write", "edit", "apply_patch"].includes(toolName)) {
        const filePath = normalizeRel(root, getFilePathFromArgs(args))
        if (toolName === "read" && isProtectedFile(filePath)) {
          throw new Error(`[team-runtime] Protected file blocked from read: ${filePath}`)
        }
      }
      recordEvent("tool.execute.before", { tool: toolName, args: truncate(args, 1500) })
    },

    "tool.execute.after": async (input, output) => {
      const args = getArgObject(input)
      const toolName = input?.tool ?? "unknown"
      const state = loadState(paths)
      state.counters.tools = (state.counters.tools ?? 0) + 1
      saveState(paths, state)

      if (["write", "edit", "apply_patch"].includes(toolName)) {
        const filePath = normalizeRel(root, getFilePathFromArgs(args))
        if (filePath) addChangedFile(paths, filePath, `tool.${toolName}`)
      }

      if (toolName === "bash") {
        const command = getCommandFromArgs(args)
        const looksLikeTest = /(^|\s)(npm|pnpm|yarn|bun)\s+(test|run\s+test|run\s+check|run\s+lint)|pytest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|tsc\s+--noEmit/i.test(command)
        if (looksLikeTest) {
          appendEvidence(paths, {
            type: "test",
            title: "Test/check command executed",
            command,
            status: "recorded",
            summary: "A test-like command was executed. Mark as passed only after reviewer verifies output.",
            raw: truncate(output, config.evidence?.maxToolOutputChars || 4000),
          })
        }
      }
      recordEvent("tool.execute.after", { tool: toolName, args: truncate(args, 1500), output: truncate(output, 2000) })
    },

    "experimental.session.compacting": async (_input, output) => {
      output.context = output.context || []
      output.context.push(renderCompactionContext(paths))
      recordEvent("experimental.session.compacting", { injected: true })
    },

    tool: {
      team_status: tool({
        description: "Return opencode-team-runtime state, gate status, recent tasks, recent evidence, and handoff/evidence file paths. Use this before claiming completion.",
        args: {
          format: tool.schema.enum(["json", "markdown"]).optional().describe("Output format. Default: json"),
        },
        async execute(args) {
          const status = renderStatus(paths)
          if (args.format === "markdown") {
            return `# Team Status\n\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\``
          }
          return JSON.stringify(status, null, 2)
        },
      }),

      team_task: tool({
        description: "Create or update a team task in .opencode/team/state.json. Tasks should be atomic and verifiable.",
        args: {
          id: tool.schema.string().optional().describe("Existing task id to update. Omit to create."),
          title: tool.schema.string().describe("Short atomic task title."),
          status: tool.schema.enum(["open", "working", "blocked", "claimed_done", "reviewing", "failed", "done", "reviewed", "verified"]).optional(),
          owner: tool.schema.string().optional().describe("Agent or model owner, e.g. a-zone-coder, reviewer."),
          area: tool.schema.enum(["A", "B", "handoff", "research", "runtime"]).optional(),
          priority: tool.schema.enum(["low", "normal", "high", "urgent"]).optional(),
          acceptance: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria."),
          notes: tool.schema.string().optional(),
        },
        async execute(args) {
          const task = upsertTask(paths, args)
          return JSON.stringify({ ok: true, task }, null, 2)
        },
      }),

      team_evidence: tool({
        description: "Append evidence for a task: test result, review, audit, browser check, benchmark, source, or blocker. Completion requires evidence.",
        args: {
          type: tool.schema.enum(["note", "test", "review", "audit", "browser", "benchmark", "source", "block"]).describe("Evidence type."),
          title: tool.schema.string().describe("Short evidence title."),
          taskId: tool.schema.string().optional(),
          status: tool.schema.enum(["recorded", "passed", "failed", "blocked", "ok"]).optional(),
          command: tool.schema.string().optional(),
          path: tool.schema.string().optional(),
          url: tool.schema.string().optional(),
          summary: tool.schema.string().optional(),
          raw: tool.schema.string().optional().describe("Optional raw log/output. It will be truncated."),
        },
        async execute(args) {
          const entry = appendEvidence(paths, args)
          if (args.taskId) {
            const state = loadState(paths)
            const task = state.tasks.find((t) => t.id === args.taskId)
            if (task) {
              task.evidenceIds = Array.from(new Set([...(task.evidenceIds || []), entry.id]))
              task.updatedAt = now()
              saveState(paths, state)
            }
          }
          return JSON.stringify({ ok: true, evidence: entry }, null, 2)
        },
      }),

      team_handoff: tool({
        description: "Read, replace, or append to .opencode/team/handoff.md. Use before rotation or after meaningful progress.",
        args: {
          action: tool.schema.enum(["read", "append", "replace", "template"]).describe("read current handoff, append text, replace text, or regenerate template."),
          content: tool.schema.string().optional().describe("Markdown content for append/replace."),
        },
        async execute(args) {
          if (args.action === "read") return readText(paths.handoffFile, "")
          if (args.action === "template") {
            writeTextAtomic(paths.handoffFile, defaultHandoff())
            return "handoff.md reset to template"
          }
          if (args.action === "replace") {
            if (!args.content?.trim()) throw new Error("content is required for replace")
            writeTextAtomic(paths.handoffFile, args.content)
            return "handoff.md replaced"
          }
          if (args.action === "append") {
            if (!args.content?.trim()) throw new Error("content is required for append")
            fs.appendFileSync(paths.handoffFile, `\n\n${args.content.trim()}\n`)
            return "handoff.md appended"
          }
          throw new Error(`unknown action: ${args.action}`)
        },
      }),

      team_gate: tool({
        description: "Evaluate whether a task/session can honestly claim completion. Use before saying done or before ending a session.",
        args: {
          taskId: tool.schema.string().optional().describe("Optional task id to gate a specific task."),
        },
        async execute(args) {
          const gate = evaluateGate(paths, args.taskId || null)
          return JSON.stringify(gate, null, 2)
        },
      }),

      team_rotate: tool({
        description: "Mark session rotation as pending or complete. Use when context is noisy/full or before handoff to a fresh session.",
        args: {
          action: tool.schema.enum(["request", "complete", "clear"]).describe("request rotation, mark complete, or clear pending flag."),
          reason: tool.schema.string().optional(),
        },
        async execute(args) {
          const state = loadState(paths)
          if (args.action === "request") {
            state.rotation.pending = true
            state.rotation.reason = args.reason || "rotation requested"
            state.rotation.requestedAt = now()
            state.phase = "HANDOFF_REQUIRED"
          } else if (args.action === "complete") {
            state.rotation.pending = false
            state.rotation.reason = args.reason || "rotation complete"
            state.phase = "SESSION_ROTATED"
          } else {
            state.rotation.pending = false
            state.rotation.reason = ""
            state.rotation.requestedAt = null
          }
          saveState(paths, state)
          return JSON.stringify({ ok: true, rotation: state.rotation, phase: state.phase }, null, 2)
        },
      }),

      team_agent: tool({
        description: "Register, list, heartbeat, metric, or message logical team agents. Agents are coördination abstractions, not OS processes.",
        args: {
          action: tool.schema.enum(["register", "list", "heartbeat", "metric", "send", "poll", "status"]).describe("Action to perform."),
          id: tool.schema.string().optional().describe("Agent ID."),
          role: tool.schema.string().optional().describe("Agent role."),
          capabilities: tool.schema.string().optional().describe("Comma-separated capabilities."),
          mode: tool.schema.string().optional().describe("Agent mode: desktop-subagent, cli-session, or manual."),
          status: tool.schema.string().optional().describe("Metric status: passed or failed."),
          to: tool.schema.string().optional().describe("Message recipient agent ID."),
          from: tool.schema.string().optional().describe("Message sender agent ID. Defaults to system."),
          type: tool.schema.string().optional().describe("Message type."),
          payload: tool.schema.string().optional().describe("Message payload text."),
          agent_status: tool.schema.string().optional().describe("Agent status value to set."),
          durationMs: tool.schema.number().optional().describe("Task duration in milliseconds."),
          limit: tool.schema.number().optional().describe("Maximum results to return (for poll)."),
        },
        async execute(args) {
          const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "agent-registry-runner.mjs")
          const cmdArgs = [runner, args.action]
          if (args.id) cmdArgs.push("--id", args.id)
          if (args.role) cmdArgs.push("--role", args.role)
          if (args.capabilities) cmdArgs.push("--capabilities", args.capabilities)
          if (args.mode) cmdArgs.push("--mode", args.mode)
          if (args.status) cmdArgs.push("--status", args.status)
          if (args.to) cmdArgs.push("--to", args.to)
          if (args.from) cmdArgs.push("--from", args.from)
          if (args.type) cmdArgs.push("--type", args.type)
          if (args.payload) cmdArgs.push("--payload", args.payload)
          if (args.agent_status) cmdArgs.push("--agent-status", args.agent_status)
          if (args.durationMs) cmdArgs.push("--duration-ms", String(args.durationMs))
          if (args.limit) cmdArgs.push("--limit", String(args.limit))
          cmdArgs.push("--project", root)
          cmdArgs.push("--json")

          const result = spawnSync("node", cmdArgs, { encoding: "utf8", timeout: 15000 })
          if (result.error) throw new Error(`Agent runner failed: ${result.error.message}`)
          if (result.stderr) throw new Error(`Agent runner stderr: ${result.stderr}`)
          return result.stdout
        },
      }),

      team_mailbox: tool({
        description: "Read recent team mailbox messages for an agent. Use to coördinate between mother session and subagents.",
        args: {
          to: tool.schema.string().optional().describe("Filter messages addressed to this agent ID."),
          limit: tool.schema.number().optional().describe("Maximum messages to return (default 10)."),
        },
        async execute(args) {
          const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "agent-registry-runner.mjs")
          const cmdArgs = [runner, "poll"]
          if (args.to) cmdArgs.push("--to", args.to)
          if (args.limit) cmdArgs.push("--limit", String(args.limit))
          cmdArgs.push("--project", root)
          cmdArgs.push("--json")

          const result = spawnSync("node", cmdArgs, { encoding: "utf8", timeout: 15000 })
          if (result.error) throw new Error(`Mailbox poll failed: ${result.error.message}`)
          if (result.stderr) throw new Error(`Mailbox poll stderr: ${result.stderr}`)
          return result.stdout
        },
      }),
    },
  }
}

export default TeamRuntimePlugin
