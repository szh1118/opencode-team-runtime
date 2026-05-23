#!/usr/bin/env node
/** Minimal MCP server exposing opencode-team-runtime P6 memory tools. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensure, status, record, learn, analyze, generateSuggestions, approve, exportPack } from "../scripts/memory-runner.mjs";

const PROJECT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
ensure(PROJECT);

const tools = [
  { name: "status", description: "Return advisory memory status: event counts, suggestions, scorecard files.", inputSchema: { type: "object", properties: {} } },
  { name: "record", description: "Record a success, failure, lesson, or note for future routing and prompt improvement analysis.", inputSchema: { type: "object", required: ["text"], properties: { kind: { type: "string" }, outcome: { type: "string" }, agent: { type: "string" }, model: { type: "string" }, task: { type: "string" }, severity: { type: "string" }, tags: { type: "array", items: { type: "string" } }, text: { type: "string" }, source: { type: "string" } } } },
  { name: "learn", description: "Scan evidence/router/task DAG and convert repeated successes/failures into advisory memory events.", inputSchema: { type: "object", properties: { from: { type: "string", description: "all, evidence, router, or task" } } } },
  { name: "analyze", description: "Recompute model/agent/pair scorecards from memory events.", inputSchema: { type: "object", properties: {} } },
  { name: "suggestions", description: "Generate advisory prompt/routing/context/browser/research improvement suggestions. Does not auto-apply runtime changes.", inputSchema: { type: "object", properties: {} } },
  { name: "pack", description: "Generate a compact memory pack for the current agent/session.", inputSchema: { type: "object", properties: { query: { type: "string" }, maxChars: { type: "number" } } } },
  { name: "approve_suggestion", description: "Mark a suggestion as approved or rejected. This does not modify core runtime files.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, decision: { type: "string", enum: ["approved", "rejected"] }, note: { type: "string" } } } }
];

function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

async function callTool(name, args = {}) {
  if (name === "status") return textResult(status(PROJECT));
  if (name === "record") return textResult(record(PROJECT, args));
  if (name === "learn") return textResult(learn(PROJECT, args));
  if (name === "analyze") return textResult(analyze(PROJECT, args));
  if (name === "suggestions") return textResult(generateSuggestions(PROJECT, args));
  if (name === "pack") return textResult(exportPack(PROJECT, args.query || "", { maxChars: args.maxChars || 16000 }).text);
  if (name === "approve_suggestion") return textResult(approve(PROJECT, args.id, args.decision || "approved", args.note || ""));
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

process.stdin.on("readable", () => {
    let chunk; while ((chunk = process.stdin.read()) !== null) {
__buffer = Buffer.concat([__buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  }
  try { __tryParseFrames(); }
  catch (err) { __send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err.message } }); }
});
process.stdin.on("end", () => process.exit(0));
