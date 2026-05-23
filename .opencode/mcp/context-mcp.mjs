#!/usr/bin/env node
/**
 * Minimal MCP server exposing opencode-team-runtime P4 context tools.
 * Implements stdio JSON-RPC directly to avoid third-party dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensure, ingestAll, search, writePack, compressText, status, addDocument } from "../scripts/context-runner.mjs";

const PROJECT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
ensure(PROJECT);

const tools = [
  {
    name: "status",
    description: "Return local context index status: chunk counts, kinds, current context pack path.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "ingest",
    description: "Refresh the local context index from handoff, evidence, task DAG, browser artifacts, research ledger, sessions, and events.",
    inputSchema: { type: "object", properties: { all: { type: "boolean" }, team: { type: "boolean" }, research: { type: "boolean" }, browser: { type: "boolean" }, sessions: { type: "boolean" }, events: { type: "boolean" } } }
  },
  {
    name: "search",
    description: "Search the deterministic local context index. Use before asking the main session to read long logs.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number" }, kind: { type: "string" } } }
  },
  {
    name: "pack",
    description: "Generate a compact markdown context pack for a query and save it under .opencode/team/context/current-pack.md.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number" }, maxChars: { type: "number" }, out: { type: "string" } } }
  },
  {
    name: "compress_text",
    description: "Compress raw shell/browser/research/json/generic text by retaining important lines and pruning noise.",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" }, kind: { type: "string", enum: ["shell", "browser", "research", "json", "generic"] }, maxChars: { type: "number" } } }
  },
  {
    name: "add_text",
    description: "Add a short ad hoc note to the local context index.",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, tags: { type: "array", items: { type: "string" } } } }
  }
];

function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

async function callTool(name, args = {}) {
  if (name === "status") return textResult(status(PROJECT));
  if (name === "ingest") return textResult(ingestAll(PROJECT, args));
  if (name === "search") {
    const results = search(PROJECT, args.query || "", { limit: args.limit || undefined, kind: args.kind || undefined });
    return textResult(results.map((r, i) => `### ${i + 1}. ${r.title}\n- id: ${r.id}\n- kind: ${r.kind}\n- score: ${Number(r.score || 0).toFixed(2)}\n- source: ${r.sourcePath || r.sourceUrl || "unknown"}\n\n${r.text}`).join("\n\n---\n\n") || "No matching context chunks found.");
  }
  if (name === "pack") return textResult(writePack(PROJECT, args.query || "", { limit: args.limit || undefined, maxChars: args.maxChars || undefined, out: args.out || "" }));
  if (name === "compress_text") return textResult(compressText(args.text || "", { kind: args.kind || "generic", maxChars: args.maxChars || 12000 }).text);
  if (name === "add_text") return textResult(addDocument(PROJECT, { kind: args.kind || "note", title: args.title || "Ad hoc context", sourcePath: "mcp:add_text", text: args.text || "", tags: args.tags || [] }));
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
