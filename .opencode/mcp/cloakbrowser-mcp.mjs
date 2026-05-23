#!/usr/bin/env node
/**
 * opencode-team-runtime P2.5 CloakBrowser MCP server
 *
 * Exposes browser evidence + perception tools to OpenCode.  The actual browser
 * work is delegated to .opencode/scripts/browser-runner.mjs so humans and agents
 * use the same code path and evidence files.
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
const RUNNER = path.resolve(__dirname, "..", "scripts", "browser-runner.mjs");

function log(...args) {
  if (process.env.OPENCODE_TEAM_MCP_DEBUG === "1") console.error("[cloakbrowser-mcp]", ...args);
}

function safeUrl(url) {
  if (!url || typeof url !== "string") throw new Error("url is required");
  const u = new URL(url);
  if (["http:", "https:"].includes(u.protocol)) return url;
  if (u.protocol === "file:" && process.env.CLOAKBROWSER_ALLOW_FILE_URL === "true") return url;
  throw new Error(`URL protocol not allowed: ${u.protocol}. Allowed: http, https${process.env.CLOAKBROWSER_ALLOW_FILE_URL === "true" ? ", file" : ""}`);
}

function runRunner(command, args = {}) {
  if (!fs.existsSync(RUNNER)) throw new Error(`browser-runner not found at ${RUNNER}`);
  const argv = [RUNNER, command];
  if (args.url) argv.push(safeUrl(args.url));
  argv.push("--project", PROJECT_ROOT);
  if (args.screenshot) argv.push("--screenshot", String(args.screenshot));
  if (args.text) argv.push("--text", String(args.text));
  if (args.notText) argv.push("--not-text", String(args.notText));
  if (args.selector) argv.push("--selector", String(args.selector));
  if (args.waitMs != null) argv.push("--wait-ms", String(args.waitMs));
  if (args.timeoutMs != null) argv.push("--timeout-ms", String(args.timeoutMs));
  if (args.manualTimeoutMs != null) argv.push("--manual-timeout-ms", String(args.manualTimeoutMs));
  if (args.dom) argv.push("--dom");
  if (args.mark) argv.push("--mark");
  if (args.manual) argv.push("--manual");
  if (args.mode) argv.push("--mode", String(args.mode));
  if (args.action) argv.push("--action", String(args.action));
  if (args.target) argv.push("--target", String(args.target));
  if (args.value != null) argv.push("--value", String(args.value));
  if (args.key) argv.push("--key", String(args.key));

  let stepsTemp = null;
  if (Array.isArray(args.steps)) {
    const dir = path.join(PROJECT_ROOT, ".opencode", "team", "browser");
    fs.mkdirSync(dir, { recursive: true });
    stepsTemp = path.join(dir, `mcp-steps-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(stepsTemp, JSON.stringify(args.steps, null, 2));
    argv.push("--steps", path.relative(PROJECT_ROOT, stepsTemp));
  } else if (args.stepsFile) {
    argv.push("--steps", String(args.stepsFile));
  }

  const res = spawnSync(process.execPath, argv, {
    cwd: PROJECT_ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (stepsTemp && process.env.OPENCODE_TEAM_KEEP_TEMP !== "1") {
    try { fs.unlinkSync(stepsTemp); } catch {}
  }

  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  let parsed = null;
  if (stdout) {
    try { parsed = JSON.parse(stdout); }
    catch { parsed = { raw: stdout }; }
  }
  if (res.status !== 0) {
    const err = new Error(`browser-runner failed with exit ${res.status}: ${stderr || parsed?.error || stdout}`);
    err.data = parsed || { stdout, stderr };
    throw err;
  }
  return parsed || { ok: true, stderr };
}

const TOOLS = [
  {
    name: "visit",
    description: "Open a URL with headed CloakBrowser by default, collect title/text/console/network evidence, optionally assert text or selector, and save screenshot/evidence under .opencode/team/browser. Set manual=true when the user may need to solve a challenge or log in.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "http(s) URL to open." },
        text: { type: "string", description: "Optional text that must appear on the page." },
        notText: { type: "string", description: "Optional text that must not appear on the page." },
        selector: { type: "string", description: "Optional CSS selector that must exist." },
        screenshot: { type: "string", description: "Optional screenshot file name. Use 'none' to skip." },
        waitMs: { type: "number", description: "Extra milliseconds to wait after navigation." },
        timeoutMs: { type: "number", description: "Navigation/assertion timeout." },
        manual: { type: "boolean", description: "Show headed browser and wait for the user to click Continue agent overlay." },
        manualTimeoutMs: { type: "number", description: "Manual intervention timeout. Default 10 minutes." }
      }
    }
  },
  {
    name: "snapshot",
    description: "Open a URL and save a browser snapshot with screenshot, page text, reduced DOM summary, console logs, and network/page errors.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        dom: { type: "boolean", description: "Include interactive reduced DOM summary. Defaults true for snapshot." },
        screenshot: { type: "string" },
        waitMs: { type: "number" },
        timeoutMs: { type: "number" },
        manual: { type: "boolean" },
        manualTimeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "observe",
    description: "Open a page and extract browser perception state. mode=reduced returns semantic/actionable state; mode=digest returns ScreenDigest; mode=all also saves raw text. Use mark=true to generate an element-id screenshot.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        mode: { type: "string", enum: ["reduced", "digest", "raw", "all"], description: "Observation detail level. Default reduced." },
        mark: { type: "boolean", description: "Generate a marked screenshot with element ids overlaid." },
        screenshot: { type: "string" },
        waitMs: { type: "number" },
        timeoutMs: { type: "number" },
        manual: { type: "boolean" },
        manualTimeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "digest",
    description: "Open a page and return a compact ScreenDigest: human-visible summary, visible regions, actionable elements with stable ids/selectors/bboxes, and technical health. This is the preferred tool for text-only models.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        mark: { type: "boolean", description: "Generate a marked screenshot with element ids." },
        screenshot: { type: "string" },
        waitMs: { type: "number" },
        timeoutMs: { type: "number" },
        manual: { type: "boolean" },
        manualTimeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "act_by_id",
    description: "Open a URL, resolve a target element id from the latest reduced ScreenDigest/current-reduced.json, execute a safe structured action, then record a new ScreenDigest as evidence. Use after digest/observe.",
    inputSchema: {
      type: "object",
      required: ["url", "target", "action"],
      properties: {
        url: { type: "string" },
        target: { type: "string", description: "Element id from ScreenDigest, e.g. e3." },
        action: { type: "string", enum: ["click", "type", "press", "select", "check", "uncheck"] },
        value: { type: "string", description: "Text/select/key value for type/select/press." },
        key: { type: "string", description: "Keyboard key for press." },
        text: { type: "string", description: "Optional assertion text after action." },
        selector: { type: "string", description: "Optional assertion selector after action." },
        screenshot: { type: "string" },
        waitMs: { type: "number" },
        timeoutMs: { type: "number" },
        manual: { type: "boolean", description: "Allow user intervention before acting." },
        manualTimeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "manual",
    description: "Open a headed CloakBrowser page and wait for the user to complete manual work such as login or challenge handling. The page shows a 'Continue agent' overlay; after user clicks it, a ScreenDigest and evidence are recorded.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        screenshot: { type: "string" },
        mark: { type: "boolean" },
        timeoutMs: { type: "number" },
        manualTimeoutMs: { type: "number" },
        text: { type: "string" },
        selector: { type: "string" }
      }
    }
  },
  {
    name: "interact",
    description: "Open a URL, execute a small sequence of browser actions, then record screenshot/snapshot/assertions as evidence. Use for web app smoke tests; use manual=true when user intervention may be required.",
    inputSchema: {
      type: "object",
      required: ["url", "steps"],
      properties: {
        url: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["action"],
            properties: {
              action: { type: "string", enum: ["click", "type", "press", "wait", "waitForSelector", "scroll", "goto"] },
              selector: { type: "string" },
              text: { type: "string" },
              key: { type: "string" },
              ms: { type: "number" },
              dx: { type: "number" },
              dy: { type: "number" },
              url: { type: "string" },
              waitUntil: { type: "string" },
              timeoutMs: { type: "number" }
            }
          }
        },
        text: { type: "string", description: "Optional text assertion after steps." },
        selector: { type: "string", description: "Optional selector assertion after steps." },
        screenshot: { type: "string" },
        waitMs: { type: "number" },
        timeoutMs: { type: "number" },
        manual: { type: "boolean" },
        manualTimeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "doctor",
    description: "Check whether CloakBrowser/playwright dependencies, headed default, persistent profile, and team folders are available.",
    inputSchema: { type: "object", properties: {} }
  }
];

function toolCall(name, args) {
  if (name === "visit") return runRunner("visit", args);
  if (name === "snapshot") return runRunner("snapshot", { dom: true, ...args });
  if (name === "observe") return runRunner("observe", { mode: "reduced", ...args });
  if (name === "digest") return runRunner("digest", { mode: "digest", ...args });
  if (name === "act_by_id") return runRunner("act", args);
  if (name === "manual") return runRunner("manual", { mode: "digest", manual: true, ...args });
  if (name === "interact") return runRunner("interact", args);
  if (name === "doctor") return runRunner("doctor", args);
  throw new Error(`Unknown tool: ${name}`);
}

function makeResponse(id, result) { return { jsonrpc: "2.0", id, result }; }
function makeError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }; }

async function handleMessage(msg) {
  log("recv", msg.method);
  if (msg.method === "initialize") {
    return makeResponse(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "opencode-team-cloakbrowser", version: VERSION }
    });
  }
  if (msg.method === "notifications/initialized" || msg.method === "initialized") return null;
  if (msg.method === "ping") return makeResponse(msg.id, {});
  if (msg.method === "tools/list") return makeResponse(msg.id, { tools: TOOLS });
  if (msg.method === "tools/call") {
    const { name, arguments: args = {} } = msg.params || {};
    try {
      const result = toolCall(name, args);
      return makeResponse(msg.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false
      });
    } catch (err) {
      return makeResponse(msg.id, {
        content: [{ type: "text", text: JSON.stringify({ error: err.message, data: err.data || null }, null, 2) }],
        isError: true
      });
    }
  }
  if (msg.id == null) return null;
  return makeError(msg.id, -32601, `Method not found: ${msg.method}`);
}

let buffer = Buffer.alloc(0);
function send(message) {
  if (!message) return;
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function tryParseFrames() {
  while (buffer.length) {
    const text = buffer.toString("utf8");
    const headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      const nl = text.indexOf("\n");
      if (nl === -1) return;
      const line = text.slice(0, nl).trim();
      buffer = buffer.subarray(Buffer.byteLength(text.slice(0, nl + 1)));
      if (!line) continue;
      Promise.resolve(handleMessage(JSON.parse(line))).then(send).catch((err) => send(makeError(null, -32603, err.message)));
      continue;
    }
    const header = text.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = Buffer.byteLength(text.slice(0, headerEnd + 4), "utf8");
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    Promise.resolve(handleMessage(JSON.parse(body))).then(send).catch((err) => send(makeError(null, -32603, err.message)));
  }
}

process.stdin.on("readable", () => {
  buffer = Buffer.concat([buffer, chunk]);
  try { tryParseFrames(); }
  catch (err) { send(makeError(null, -32700, err.message)); }
});
process.stdin.on("end", () => process.exit(0));
