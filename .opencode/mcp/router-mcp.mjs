#!/usr/bin/env node
/**
 * Minimal MCP server exposing opencode-team-runtime P5 router tools.
 * Uses the router runner CLI as the deterministic source of truth.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
const SCRIPT = path.resolve(__dirname, "..", "scripts", "router-runner.mjs");

const tools = [
  {
    name: "status",
    description: "Return model router status, usage totals, premium-call budget, and config file paths.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "models",
    description: "List configured model aliases, opencode model IDs, tiers, capabilities, and context rotation budgets.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "decide",
    description: "Choose the model and routed agent for a role/task/kind/reason according to budget and failure policy.",
    inputSchema: {
      type: "object",
      required: ["role"],
      properties: {
        role: { type: "string" },
        kind: { type: "string" },
        task: { type: "string" },
        attempts: { type: "number" },
        reason: { type: "string" },
        execute: { type: "boolean" }
      }
    }
  },
  {
    name: "record_usage",
    description: "Record model usage after a run. Use even when token counts are rough estimates.",
    inputSchema: {
      type: "object",
      required: ["agent", "model"],
      properties: {
        agent: { type: "string" },
        model: { type: "string" },
        task: { type: "string" },
        status: { type: "string" },
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        cost: { type: "number" },
        reason: { type: "string" }
      }
    }
  },
  {
    name: "escalate",
    description: "Request an escalation route after repeated failures, missing implementation, unsupported claims, or browser failures.",
    inputSchema: {
      type: "object",
      required: ["role", "reason"],
      properties: {
        role: { type: "string" },
        reason: { type: "string" },
        attempts: { type: "number" },
        execute: { type: "boolean" }
      }
    }
  },
  {
    name: "checkpoint",
    description: "Request a checkpoint route for initial plan review, stuck diagnosis, visual review, or final audit.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        reason: { type: "string" },
        execute: { type: "boolean" }
      }
    }
  },
  {
    name: "budget",
    description: "Return today and total budget usage.",
    inputSchema: { type: "object", properties: {} }
  }
];

function run(args) {
  const result = spawnSync("node", [SCRIPT, ...args, "--project", PROJECT, "--json"], { cwd: PROJECT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `router exited ${result.status}`).trim());
  const raw = (result.stdout || "").trim();
  try { return JSON.parse(raw); } catch { return raw; }
}
function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}
async function callTool(name, args = {}) {
  if (name === "status") return textResult(run(["status"]));
  if (name === "models") return textResult(run(["models"]));
  if (name === "budget") return textResult(run(["budget"]));
  if (name === "decide") {
    const argv = ["decide", "--role", args.role || "chief-engineer"];
    if (args.kind) argv.push("--kind", String(args.kind));
    if (args.task) argv.push("--task", String(args.task));
    if (args.attempts !== undefined) argv.push("--attempts", String(args.attempts));
    if (args.reason) argv.push("--reason", String(args.reason));
    if (args.execute) argv.push("--execute");
    return textResult(run(argv));
  }
  if (name === "record_usage") {
    const argv = ["record", "--agent", args.agent || "unknown-agent", "--model", args.model || "unknown-model"];
    if (args.task) argv.push("--task", String(args.task));
    if (args.status) argv.push("--status", String(args.status));
    if (args.inputTokens !== undefined) argv.push("--input-tokens", String(args.inputTokens));
    if (args.outputTokens !== undefined) argv.push("--output-tokens", String(args.outputTokens));
    if (args.cost !== undefined) argv.push("--cost", String(args.cost));
    if (args.reason) argv.push("--reason", String(args.reason));
    return textResult(run(argv));
  }
  if (name === "escalate") {
    const argv = ["escalate", "--role", args.role || "chief-engineer", "--reason", args.reason || "repeated-failure"];
    if (args.attempts !== undefined) argv.push("--attempts", String(args.attempts));
    if (args.execute) argv.push("--execute");
    return textResult(run(argv));
  }
  if (name === "checkpoint") {
    const argv = ["checkpoint", "--kind", args.kind || "checkpoint"];
    if (args.reason) argv.push("--reason", String(args.reason));
    if (args.execute) argv.push("--execute");
    return textResult(run(argv));
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
