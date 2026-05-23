#!/usr/bin/env node
/** Minimal MCP server exposing opencode-team-runtime P7 reviewed patch tools. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensure, status, list, propose, validate, diff, review, approve, reject, apply, rollback } from "../scripts/patch-runner.mjs";

const PROJECT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
ensure(PROJECT);

const tools = [
  { name: "status", description: "Return reviewed patch workflow status and recent proposals.", inputSchema: { type: "object", properties: {} } },
  { name: "list", description: "List patch proposals, optionally filtered by status.", inputSchema: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } } } },
  { name: "propose", description: "Create a reviewed patch proposal. Only prompt/skill/config/docs paths are allowed by default.", inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" }, reason: { type: "string" }, kind: { type: "string", enum: ["write", "append", "replace"] }, target: { type: "string" }, content: { type: "string" }, text: { type: "string" }, search: { type: "string" }, replacement: { type: "string" }, all: { type: "boolean" }, suggestion: { type: "string" }, spec: { type: "string" } } } },
  { name: "validate", description: "Validate a patch proposal against the safe patch surface.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  { name: "diff", description: "Render the unified diff for a patch proposal.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  { name: "review", description: "Generate a reviewer checklist for a patch proposal.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, by: { type: "string" } } } },
  { name: "approve", description: "Approve a valid patch proposal. Applying still requires apply.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, by: { type: "string" }, note: { type: "string" } } } },
  { name: "reject", description: "Reject a patch proposal.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, by: { type: "string" }, reason: { type: "string" } } } },
  { name: "apply", description: "Apply an approved patch proposal and save rollback backups.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, force: { type: "boolean" } } } },
  { name: "rollback", description: "Rollback an applied patch using saved backups.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, by: { type: "string" }, reason: { type: "string" } } } }
];

function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}
async function callTool(name, args = {}) {
  if (name === "status") return textResult(status(PROJECT));
  if (name === "list") return textResult(list(PROJECT, args));
  if (name === "propose") return textResult(propose(PROJECT, args));
  if (name === "validate") return textResult(validate(PROJECT, args.id));
  if (name === "diff") return textResult(diff(PROJECT, args.id).diff);
  if (name === "review") return textResult(review(PROJECT, args.id, args));
  if (name === "approve") return textResult(approve(PROJECT, args.id, args));
  if (name === "reject") return textResult(reject(PROJECT, args.id, args));
  if (name === "apply") return textResult(apply(PROJECT, args.id, args));
  if (name === "rollback") return textResult(rollback(PROJECT, args.id, args));
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
