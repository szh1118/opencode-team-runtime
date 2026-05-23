#!/usr/bin/env node
/** Minimal MCP server exposing P8 overnight orchestrator tools. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
const SCRIPT = path.resolve(__dirname, "..", "scripts", "overnight-runner.mjs");

const tools = [
  { name: "status", description: "Return the current end-to-end overnight orchestrator state.", inputSchema: { type: "object", properties: {} } },
  { name: "run", description: "Start or resume a supervised end-to-end team run. Dry-run by default unless execute=true.", inputSchema: { type: "object", required: ["idea"], properties: { idea: { type: "string" }, execute: { type: "boolean" }, maxCycles: { type: "number" }, resume: { type: "boolean" }, skipResearch: { type: "boolean" }, skipBrowser: { type: "boolean" }, skipMemory: { type: "boolean" } } } },
  { name: "step", description: "Run one supervised orchestration cycle. Dry-run by default unless execute=true.", inputSchema: { type: "object", properties: { execute: { type: "boolean" }, idea: { type: "string" } } } },
  { name: "final", description: "Run final review, audit, handoff, memory learning, and suggestions.", inputSchema: { type: "object", properties: { execute: { type: "boolean" }, skipMemory: { type: "boolean" } } } },
  { name: "stop", description: "Stop the current overnight run and record the reason.", inputSchema: { type: "object", properties: { reason: { type: "string" } } } },
  { name: "doctor", description: "Check the overnight orchestrator installation.", inputSchema: { type: "object", properties: {} } }
];

function run(args) {
  const res = spawnSync("node", [SCRIPT, ...args, "--project", PROJECT], { cwd: PROJECT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: res.status === 0, code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}
function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}
async function callTool(name, args = {}) {
  if (name === "status") return textResult(run(["status", "--json"]));
  if (name === "doctor") return textResult(run(["doctor"]));
  if (name === "stop") return textResult(run(["stop", "--reason", args.reason || "stopped by MCP tool"]));
  if (name === "final") {
    const a = ["final"];
    if (args.execute) a.push("--execute");
    if (args.skipMemory) a.push("--skip-memory");
    return textResult(run(a));
  }
  if (name === "step") {
    const a = ["step"];
    if (args.idea) a.push(args.idea);
    if (args.execute) a.push("--execute");
    return textResult(run(a));
  }
  if (name === "run") {
    const a = [args.resume ? "resume" : "run", args.idea || ""];
    if (args.execute) a.push("--execute");
    if (args.maxCycles) a.push("--max-cycles", String(args.maxCycles));
    if (args.skipResearch) a.push("--skip-research");
    if (args.skipBrowser) a.push("--skip-browser");
    if (args.skipMemory) a.push("--skip-memory");
    return textResult(run(a));
  }
  throw new Error(`Unknown tool: ${name}`);
}
const __TOOLS__ = typeof TOOLS !== "undefined" ? TOOLS : tools;
const __CALL_TOOL__ = typeof handleTool !== "undefined" ? handleTool : callTool;
const __SERVER_VERSION__ = typeof VERSION !== "undefined" ? VERSION : "0.10.0-p8.1";
const __SERVER_NAME__ = `opencode-team-${path.basename(fileURLToPath(import.meta.url)).replace(/-mcp\.mjs$/, "")}`;

function __toTextResult(value) {
  if (value && Array.isArray(value.content)) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

async function __handleMessage(msg) {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: __SERVER_NAME__, version: __SERVER_VERSION__ },
      },
    };
  }
  if (msg.method === "notifications/initialized" || msg.method === "initialized") return null;
  if (msg.method === "ping") return { jsonrpc: "2.0", id: msg.id, result: {} };
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: __TOOLS__ } };
  if (msg.method === "tools/call") {
    try {
      const result = await __CALL_TOOL__(msg.params?.name, msg.params?.arguments || {});
      return { jsonrpc: "2.0", id: msg.id, result: __toTextResult(result) };
    } catch (err) {
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ error: err.message }, null, 2) }], isError: true } };
    }
  }
  if (msg.id == null) return null;
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
}

function __send(message) {
  if (!message) return;
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let __buffer = Buffer.alloc(0);
function __tryParseFrames() {
  while (__buffer.length) {
    const text = __buffer.toString("utf8");
    const headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const header = text.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        __buffer = __buffer.subarray(Buffer.byteLength(text.slice(0, headerEnd + 4), "utf8"));
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = Buffer.byteLength(text.slice(0, headerEnd + 4), "utf8");
      if (__buffer.length < bodyStart + length) return;
      const body = __buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      __buffer = __buffer.subarray(bodyStart + length);
      Promise.resolve(__handleMessage(JSON.parse(body))).then(__send).catch((err) => __send({ jsonrpc: "2.0", id: null, error: { code: -32603, message: err.message } }));
      continue;
    }

    const nl = text.indexOf("\n");
    if (nl === -1) return;
    const line = text.slice(0, nl).trim();
    __buffer = __buffer.subarray(Buffer.byteLength(text.slice(0, nl + 1), "utf8"));
    if (!line) continue;
    Promise.resolve(__handleMessage(JSON.parse(line))).then(__send).catch((err) => __send({ jsonrpc: "2.0", id: null, error: { code: -32603, message: err.message } }));
  }
}

process.stdin.on("data", (chunk) => {
  __buffer = Buffer.concat([__buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  try { __tryParseFrames(); }
  catch (err) { __send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err.message } }); }
});
process.stdin.on("end", () => process.exit(0));
