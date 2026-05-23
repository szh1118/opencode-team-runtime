#!/usr/bin/env node
/**
 * opencode-team-runtime P3 research MCP server.
 * Delegates to .opencode/scripts/research-runner.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.6.0-p4";
const PROTOCOL_VERSION = "2025-03-26";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(process.env.TEAM_PROJECT_ROOT || process.cwd());
const RUNNER = path.resolve(__dirname, "..", "scripts", "research-runner.mjs");

function runResearch(command, args = {}) {
  if (!fs.existsSync(RUNNER)) throw new Error(`research runner not found: ${RUNNER}`);
  const argv = [RUNNER, command, "--project", PROJECT_ROOT];
  if (args.url) argv.push(String(args.url));
  if (args.query) argv.push(String(args.query));
  if (args.question) argv.push(String(args.question));
  if (args.claim) argv.push(String(args.claim));
  if (args.title) argv.push("--title", String(args.title));
  if (args.sourceUrl) argv.push("--url", String(args.sourceUrl));
  if (args.file) argv.push("--file", String(args.file));
  if (args.out) argv.push("--out", String(args.out));
  if (args.topic) argv.push("--topic", String(args.topic));
  if (args.evidence) argv.push("--evidence", Array.isArray(args.evidence) ? args.evidence.join(",") : String(args.evidence));
  if (args.kind) argv.push("--kind", String(args.kind));
  if (args.confidence != null) argv.push("--confidence", String(args.confidence));
  if (args.minScore != null) argv.push("--min-score", String(args.minScore));
  if (args.fetch === false) argv.push("--no-fetch");
  if (args.browser) argv.push("--browser", String(args.browser));
  if (args.execute) argv.push("--execute");

  const res = spawnSync(process.execPath, argv, { cwd: PROJECT_ROOT, env: process.env, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  let parsed = null;
  if (stdout) { try { parsed = JSON.parse(stdout); } catch { parsed = { raw: stdout }; } }
  if (res.status !== 0) throw new Error(stderr || parsed?.error || `research command failed: ${command}`);
  return parsed || { ok: true };
}

const TOOLS = [
  { name: "status", description: "Return evidence-first research ledger status: source count, claim count, unsupported claim count, and paths.", inputSchema: { type: "object", properties: {} } },
  { name: "add_source", description: "Add a source URL to the research ledger. The runner fetches and chunks it when possible. Prefer primary sources.", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, title: { type: "string" }, fetch: { type: "boolean" } } } },
  { name: "add_text", description: "Add a local text/markdown file as a source and chunk it.", inputSchema: { type: "object", required: ["file", "title"], properties: { file: { type: "string" }, title: { type: "string" }, sourceUrl: { type: "string" } } } },
  { name: "add_claim", description: "Record a research claim. Evidence is required as SOURCE_ID[#CHUNK_ID]. Unsupported claims must not enter plans/reports as facts.", inputSchema: { type: "object", required: ["claim", "evidence"], properties: { claim: { type: "string" }, evidence: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, kind: { type: "string", enum: ["fact", "inference", "uncertain"] }, confidence: { type: "number" } } } },
  { name: "validate", description: "Validate every recorded claim against cited chunks. Returns supported/weak/unsupported status.", inputSchema: { type: "object", properties: { minScore: { type: "number" } } } },
  { name: "report", description: "Generate a markdown report from recorded sources/claims. Report is blocked if claims are unsupported/unvalidated.", inputSchema: { type: "object", properties: { topic: { type: "string" }, out: { type: "string" } } } },
  { name: "search_browser", description: "Open a browser search page through CloakBrowser or Browser Bridge. Use this only as a discovery step; add sources explicitly afterward.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, browser: { type: "string", enum: ["none", "cloak", "bridge"] } } } },
  { name: "run_agent", description: "Ask the research-scout agent to perform an evidence-first research pass. Dry-run unless execute=true.", inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" }, execute: { type: "boolean" } } } }
];

async function handleTool(name, args = {}) {
  if (name === "status") return runResearch("status", args);
  if (name === "add_source") return runResearch("add-source", args);
  if (name === "add_text") return runResearch("add-text", args);
  if (name === "add_claim") return runResearch("claim", args);
  if (name === "validate") return runResearch("validate", args);
  if (name === "report") return runResearch("report", args);
  if (name === "search_browser") return runResearch("search", args);
  if (name === "run_agent") return runResearch("run", args);
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
