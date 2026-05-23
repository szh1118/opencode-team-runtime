#!/usr/bin/env node
/**
 * opencode-team-runtime P2.6 browser bridge MCP server.
 * Delegates to .opencode/scripts/browser-bridge-server.mjs for Chrome extension bridge commands.
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
const RUNNER = path.resolve(__dirname, "..", "scripts", "browser-bridge-server.mjs");

function safeUrl(url) {
  if (!url) return "";
  const u = new URL(url);
  if (["http:", "https:"].includes(u.protocol)) return url;
  if (u.protocol === "file:" && process.env.OPENCODE_BROWSER_BRIDGE_ALLOW_FILE_URL === "true") return url;
  throw new Error(`URL protocol not allowed: ${u.protocol}`);
}

function runBridge(command, args = {}) {
  if (!fs.existsSync(RUNNER)) throw new Error(`browser bridge runner not found: ${RUNNER}`);
  const argv = [RUNNER, command, "--project", PROJECT_ROOT];
  if (args.url) argv.push(safeUrl(args.url));
  if (args.tabId != null) argv.push("--tab", String(args.tabId));
  if (args.mode) argv.push("--mode", String(args.mode));
  if (args.mark) argv.push("--mark");
  if (args.screenshot) argv.push("--screenshot", String(args.screenshot));
  if (args.timeoutMs != null) argv.push("--timeout-ms", String(args.timeoutMs));
  if (args.manualTimeoutMs != null) argv.push("--manual-timeout-ms", String(args.manualTimeoutMs));
  if (args.waitMs != null) argv.push("--wait-ms", String(args.waitMs));
  if (args.action) argv.push("--action", String(args.action));
  if (args.target) argv.push("--target", String(args.target));
  if (args.selector) argv.push("--selector", String(args.selector));
  if (args.value != null) argv.push("--value", String(args.value));
  if (args.key) argv.push("--key", String(args.key));
  if (args.text) argv.push("--text", String(args.text));
  if (args.notText) argv.push("--not-text", String(args.notText));
  if (process.env.OPENCODE_BROWSER_BRIDGE_PORT) argv.push("--port", process.env.OPENCODE_BROWSER_BRIDGE_PORT);
  if (process.env.OPENCODE_BROWSER_BRIDGE_TOKEN) argv.push("--token", process.env.OPENCODE_BROWSER_BRIDGE_TOKEN);
  const res = spawnSync(process.execPath, argv, { cwd: PROJECT_ROOT, env: process.env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  let parsed = null;
  if (stdout) { try { parsed = JSON.parse(stdout); } catch { parsed = { raw: stdout }; } }
  if (res.status !== 0) throw new Error(stderr || parsed?.error || `browser bridge command failed: ${command}`);
  return parsed || { ok: true };
}

const TOOLS = [
  {
    name: "status",
    description: "Check whether the Chrome extension bridge server is running and whether a Chrome extension client is connected.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_tabs",
    description: "List Chrome tabs from the user's real Chrome browser through the OpenCode Team Browser Bridge extension.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "active_tab",
    description: "Return the current active Chrome tab.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "open",
    description: "Open a URL in the user's real Chrome browser through the extension bridge.",
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } }
  },
  {
    name: "digest",
    description: "Inspect a real Chrome tab and return a compact ScreenDigest with actionable element ids. Use mark=true to generate a marked screenshot.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, tabId: { type: "number" }, mark: { type: "boolean" }, timeoutMs: { type: "number" }, waitMs: { type: "number" }, screenshot: { type: "string" } } }
  },
  {
    name: "observe",
    description: "Inspect a real Chrome tab using mode=reduced|digest|all and save raw/reduced/digest artifacts under .opencode/team/browser/chrome-bridge.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, tabId: { type: "number" }, mode: { type: "string", enum: ["reduced", "digest", "all", "raw"] }, mark: { type: "boolean" }, timeoutMs: { type: "number" }, waitMs: { type: "number" }, screenshot: { type: "string" } } }
  },
  {
    name: "act_by_id",
    description: "Act on a real Chrome tab by element id from the latest ScreenDigest, then save a new ScreenDigest and evidence. Prefer this over free-form JS.",
    inputSchema: { type: "object", required: ["target", "action"], properties: { url: { type: "string" }, tabId: { type: "number" }, target: { type: "string" }, selector: { type: "string" }, action: { type: "string", enum: ["click", "type", "press", "select", "check", "uncheck"] }, value: { type: "string" }, key: { type: "string" }, text: { type: "string" }, notText: { type: "string" }, waitMs: { type: "number" }, timeoutMs: { type: "number" } } }
  },
  {
    name: "manual",
    description: "Ask the user to manually complete login/CAPTCHA/2FA/consent in real Chrome, then click Continue agent. A ScreenDigest and evidence are saved afterward.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, tabId: { type: "number" }, manualTimeoutMs: { type: "number" }, mark: { type: "boolean" }, timeoutMs: { type: "number" }, text: { type: "string" }, selector: { type: "string" } } }
  }
];

async function handleTool(name, args = {}) {
  if (name === "status") return runBridge("status", args);
  if (name === "list_tabs") return runBridge("list-tabs", args);
  if (name === "active_tab") return runBridge("active", args);
  if (name === "open") return runBridge("open", args);
  if (name === "digest") return runBridge("digest", args);
  if (name === "observe") return runBridge("observe", args);
  if (name === "act_by_id") return runBridge("act", args);
  if (name === "manual") return runBridge("manual", args);
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
