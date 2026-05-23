#!/usr/bin/env node
/**
 * opencode-team-runtime P2.6 Chrome Browser Bridge
 *
 * This process is the local localhost bridge between OpenCode/MCP and the
 * Chrome extension.  The extension polls /extension/poll and returns job
 * results to /extension/result.  The MCP server and CLI send commands to
 * /api/command.  It intentionally avoids external npm dependencies.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const VERSION = "0.6.0-p4";
const DEFAULT_PORT = Number(process.env.OPENCODE_BROWSER_BRIDGE_PORT || 37987);
const DEFAULT_HOST = process.env.OPENCODE_BROWSER_BRIDGE_HOST || "127.0.0.1";
const DEFAULT_TOKEN = process.env.OPENCODE_BROWSER_BRIDGE_TOKEN || "dev-local";

function now() { return new Date().toISOString(); }
function rid(prefix = "bridge") { return `${prefix}-${crypto.randomBytes(5).toString("hex")}`; }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function appendText(file, text) { mkdirp(path.dirname(file)); fs.appendFileSync(file, text); }
function truncate(s, max = 16000) { s = String(s ?? ""); return s.length <= max ? s : `${s.slice(0, max)}\n...<truncated ${s.length - max} chars>`; }
function teamDir(project, ...parts) { return path.join(project, ".opencode", "team", ...parts); }
function browserDir(project, ...parts) { return teamDir(project, "browser", ...parts); }
function evidenceFile(project) { return teamDir(project, "evidence.md"); }

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const opts = {
    command,
    project: process.cwd(),
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    token: DEFAULT_TOKEN,
    url: "",
    tabId: "",
    mode: "digest",
    mark: false,
    screenshot: "",
    timeoutMs: 60000,
    manualTimeoutMs: 600000,
    action: "",
    target: "",
    selector: "",
    value: "",
    key: "",
    text: "",
    notText: "",
    waitMs: 0,
    json: false,
    _: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" || a === "--dir" || a === "-C") opts.project = path.resolve(args[++i]);
    else if (a === "--host") opts.host = args[++i] || DEFAULT_HOST;
    else if (a === "--port") opts.port = Number(args[++i] || DEFAULT_PORT);
    else if (a === "--token") opts.token = args[++i] || DEFAULT_TOKEN;
    else if (a === "--url") opts.url = args[++i] || "";
    else if (a === "--tab" || a === "--tab-id") opts.tabId = args[++i] || "";
    else if (a === "--mode") opts.mode = args[++i] || "digest";
    else if (a === "--mark") opts.mark = true;
    else if (a === "--screenshot") opts.screenshot = args[++i] || "";
    else if (a === "--timeout-ms") opts.timeoutMs = Number(args[++i] || 60000);
    else if (a === "--manual-timeout-ms") opts.manualTimeoutMs = Number(args[++i] || 600000);
    else if (a === "--action") opts.action = args[++i] || "";
    else if (a === "--target") opts.target = args[++i] || "";
    else if (a === "--selector") opts.selector = args[++i] || "";
    else if (a === "--value" || a === "--text-value") opts.value = args[++i] || "";
    else if (a === "--key") opts.key = args[++i] || "";
    else if (a === "--text" || a === "--contains") opts.text = args[++i] || "";
    else if (a === "--not-text") opts.notText = args[++i] || "";
    else if (a === "--wait-ms") opts.waitMs = Number(args[++i] || 0);
    else if (a === "--json") opts.json = true;
    else opts._.push(a);
  }
  if (!opts.url && opts._[0] && /^https?:\/\//.test(opts._[0])) opts.url = opts._[0];
  return opts;
}

function usage() {
  console.log(`opencode-team-runtime Chrome browser bridge ${VERSION}

Usage:
  node .opencode/scripts/browser-bridge-server.mjs serve [--project DIR] [--port 37987]
  node .opencode/scripts/browser-bridge-server.mjs doctor [--project DIR]
  node .opencode/scripts/browser-bridge-server.mjs status [--project DIR]
  node .opencode/scripts/browser-bridge-server.mjs list-tabs [--project DIR]
  node .opencode/scripts/browser-bridge-server.mjs active [--project DIR]
  node .opencode/scripts/browser-bridge-server.mjs open URL [--project DIR]
  node .opencode/scripts/browser-bridge-server.mjs observe [URL] [--tab ID] [--mode digest|reduced|all] [--mark]
  node .opencode/scripts/browser-bridge-server.mjs digest [URL] [--tab ID] [--mark]
  node .opencode/scripts/browser-bridge-server.mjs manual [URL] [--tab ID] [--manual-timeout-ms 600000]
  node .opencode/scripts/browser-bridge-server.mjs act [URL] --target e1 --action click|type|press|select|check|uncheck [--value TEXT]

Typical:
  ./opencode-chrome-bridge serve
  # load .opencode/browser-extension as unpacked extension in Chrome
  ./opencode-chrome-bridge digest https://example.com --mark

Env:
  OPENCODE_BROWSER_BRIDGE_PORT=37987
  OPENCODE_BROWSER_BRIDGE_TOKEN=dev-local
`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type,x-opencode-bridge-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(`${body}\n`);
}

function getToken(req) {
  const header = req.headers["x-opencode-bridge-token"];
  return Array.isArray(header) ? header[0] : header;
}

function requireToken(req, expected) {
  if (!expected || expected === "dev-local") return true;
  return getToken(req) === expected;
}

function createServerState({ project, token }) {
  return {
    project,
    token,
    startedAt: now(),
    clients: new Map(),
    pendingResults: new Map(),
  };
}

function clientSummary(client) {
  return {
    clientId: client.clientId,
    extensionVersion: client.extensionVersion,
    userAgent: client.userAgent,
    connectedAt: client.connectedAt,
    lastSeen: client.lastSeen,
    queueLength: client.queue.length,
  };
}

function getOrCreateClient(state, clientId, body = {}) {
  const id = clientId || body.clientId || "default";
  let client = state.clients.get(id);
  if (!client) {
    client = {
      clientId: id,
      connectedAt: now(),
      lastSeen: now(),
      extensionVersion: body.extensionVersion || "unknown",
      userAgent: body.userAgent || "unknown",
      queue: [],
      pendingPoll: null,
    };
    state.clients.set(id, client);
  }
  client.lastSeen = now();
  if (body.extensionVersion) client.extensionVersion = body.extensionVersion;
  if (body.userAgent) client.userAgent = body.userAgent;
  return client;
}

function chooseClient(state, clientId = "") {
  if (clientId && state.clients.has(clientId)) return state.clients.get(clientId);
  const clients = [...state.clients.values()].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  return clients[0] || null;
}

function pushJob(client, job) {
  client.queue.push(job);
  client.lastSeen = now();
  if (client.pendingPoll) {
    const res = client.pendingPoll.res;
    clearTimeout(client.pendingPoll.timer);
    client.pendingPoll = null;
    const next = client.queue.shift();
    sendJson(res, 200, { ok: true, job: next });
  }
}

function sendEmptyPoll(client, res, timeoutMs = 25000) {
  client.lastSeen = now();
  if (client.queue.length) {
    const job = client.queue.shift();
    sendJson(res, 200, { ok: true, job });
    return;
  }
  if (client.pendingPoll) {
    try { sendJson(client.pendingPoll.res, 204, { ok: true, job: null }); } catch {}
    clearTimeout(client.pendingPoll.timer);
  }
  const timer = setTimeout(() => {
    if (client.pendingPoll?.res === res) client.pendingPoll = null;
    sendJson(res, 200, { ok: true, job: null });
  }, timeoutMs);
  client.pendingPoll = { res, timer };
}

function waitForResult(state, jobId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingResults.delete(jobId);
      reject(new Error(`Timed out waiting for extension result for ${jobId}`));
    }, timeoutMs);
    state.pendingResults.set(jobId, { resolve, reject, timer });
  });
}

function resolveResult(state, body) {
  const jobId = String(body.jobId || "");
  const pending = state.pendingResults.get(jobId);
  if (!pending) return false;
  state.pendingResults.delete(jobId);
  clearTimeout(pending.timer);
  if (body.ok === false) {
    const err = new Error(body.error?.message || body.error || `Extension job failed: ${jobId}`);
    err.data = body;
    pending.reject(err);
  } else {
    pending.resolve(body.result ?? {});
  }
  return true;
}

async function handleCommand(state, body) {
  const client = chooseClient(state, body.clientId || "");
  if (!client) throw new Error("No Chrome extension client is connected. Start `./opencode-chrome-bridge serve`, load `.opencode/browser-extension` as an unpacked extension, and click Connect.");
  const jobId = rid("job");
  const timeoutMs = Math.max(1000, Number(body.timeoutMs || 60000));
  const job = {
    id: jobId,
    command: body.command,
    args: body.args || {},
    createdAt: now(),
  };
  pushJob(client, job);
  const result = await waitForResult(state, jobId, timeoutMs + 5000);
  return { ok: true, client: clientSummary(client), jobId, result };
}

function startServer(opts) {
  const state = createServerState({ project: opts.project, token: opts.token });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

      if (url.pathname === "/health" || url.pathname === "/api/status") {
        return sendJson(res, 200, {
          ok: true,
          version: VERSION,
          startedAt: state.startedAt,
          clients: [...state.clients.values()].map(clientSummary),
          pendingResults: state.pendingResults.size,
        });
      }

      if (url.pathname.startsWith("/extension/")) {
        const body = req.method === "POST" ? await readBody(req) : {};
        const clientId = body.clientId || url.searchParams.get("clientId") || url.searchParams.get("client") || "default";
        const client = getOrCreateClient(state, clientId, body);
        if (url.pathname === "/extension/register") return sendJson(res, 200, { ok: true, version: VERSION, serverTime: now(), client: clientSummary(client) });
        if (url.pathname === "/extension/poll") return sendEmptyPoll(client, res, Number(url.searchParams.get("timeoutMs") || 25000));
        if (url.pathname === "/extension/result") {
          const matched = resolveResult(state, body);
          return sendJson(res, 200, { ok: true, matched });
        }
      }

      if (url.pathname === "/api/command") {
        if (!requireToken(req, opts.token)) return sendJson(res, 401, { ok: false, error: "invalid bridge token" });
        const body = await readBody(req);
        const result = await handleCommand(state, body);
        return sendJson(res, 200, result);
      }

      sendJson(res, 404, { ok: false, error: `not found: ${url.pathname}` });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message, stack: process.env.OPENCODE_TEAM_DEBUG === "1" ? err.stack : undefined });
    }
  });

  server.listen(opts.port, opts.host, () => {
    console.log(`[opencode-browser-bridge] listening on http://${opts.host}:${opts.port}`);
    console.log(`[opencode-browser-bridge] project=${opts.project}`);
    console.log(`[opencode-browser-bridge] load extension from ${path.join(opts.project, ".opencode", "browser-extension")}`);
  });
}

async function postJson(url, token, body, timeoutMs = 60000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs + 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-bridge-token": token },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function command(opts, command, args = {}) {
  const url = `http://${opts.host}:${opts.port}/api/command`;
  const resp = await postJson(url, opts.token, { command, args, timeoutMs: opts.timeoutMs }, opts.timeoutMs);
  return resp.result;
}

function saveDataUrl(file, dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, Buffer.from(m[2], "base64"));
  return file;
}

function recordEvidence(project, kind, summary, payload = {}) {
  const evidence = evidenceFile(project);
  appendText(evidence, `\n## ${kind}: ${summary}\n\n`);
  appendText(evidence, `- time: ${now()}\n`);
  if (payload.url) appendText(evidence, `- url: ${payload.url}\n`);
  if (payload.tabId != null) appendText(evidence, `- tab: ${payload.tabId}\n`);
  if (payload.artifacts?.length) {
    appendText(evidence, `- artifacts:\n`);
    for (const a of payload.artifacts) appendText(evidence, `  - ${path.relative(project, a)}\n`);
  }
  if (payload.notes) appendText(evidence, `\n${payload.notes}\n`);
}

function saveBrowserResult(project, label, result, opts = {}) {
  const runId = rid(`chrome-${label}`);
  const dir = browserDir(project, "chrome-bridge");
  mkdirp(dir);
  const artifacts = [];
  const rawFile = path.join(dir, `${runId}.json`);
  writeJson(rawFile, { savedAt: now(), label, result });
  artifacts.push(rawFile);

  const state = result?.pageState || result?.state || result?.digest || result;
  if (state?.raw) {
    const f = path.join(dir, "current-chrome-raw.json");
    writeJson(f, state.raw); artifacts.push(f);
  }
  if (state?.reduced) {
    const f = path.join(dir, "current-chrome-reduced.json");
    writeJson(f, state.reduced); artifacts.push(f);
  }
  if (state?.digest) {
    const f = path.join(dir, "current-chrome-digest.json");
    writeJson(f, state.digest); artifacts.push(f);
  }
  if (result?.screenshotDataUrl || state?.screenshotDataUrl) {
    const name = opts.screenshot || `${runId}.png`;
    const f = path.join(dir, name.endsWith(".png") ? name : `${name}.png`);
    const saved = saveDataUrl(f, result.screenshotDataUrl || state.screenshotDataUrl);
    if (saved) artifacts.push(saved);
  }
  recordEvidence(project, `browser-${label}`, result?.url || state?.url || "Chrome bridge result", {
    url: result?.url || state?.url,
    tabId: result?.tabId || state?.tabId,
    artifacts,
    notes: state?.digest?.human_visible_summary ? `Summary: ${truncate(state.digest.human_visible_summary, 1000)}\n` : "",
  });
  return { runId, artifacts };
}

function loadLatestReduced(project) {
  return readJson(browserDir(project, "chrome-bridge", "current-chrome-reduced.json"), null);
}

function resolveSelectorFromTarget(project, target) {
  const reduced = loadLatestReduced(project);
  const el = reduced?.interactive_elements?.find((x) => x.id === target);
  return el?.selector || "";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const base = `http://${opts.host}:${opts.port}`;
  if (["help", "--help", "-h"].includes(opts.command)) return usage();
  if (opts.command === "serve") return startServer(opts);
  if (opts.command === "doctor") {
    const extDir = path.join(opts.project, ".opencode", "browser-extension");
    const manifest = path.join(extDir, "manifest.json");
    let server = null;
    try { server = await getJson(`${base}/api/status`, 3000); } catch (err) { server = { ok: false, error: err.message }; }
    const out = { ok: fs.existsSync(manifest), version: VERSION, extensionDir: extDir, manifestExists: fs.existsSync(manifest), server };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (opts.command === "status") {
    const out = await getJson(`${base}/api/status`, opts.timeoutMs);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  let result;
  if (opts.command === "list-tabs") result = await command(opts, "list_tabs", {});
  else if (opts.command === "active") result = await command(opts, "active_tab", {});
  else if (opts.command === "open") result = await command(opts, "open_url", { url: opts.url || opts._[0] });
  else if (opts.command === "observe" || opts.command === "digest") {
    result = await command(opts, "observe", { url: opts.url, tabId: opts.tabId, mode: opts.command === "digest" ? "digest" : opts.mode, mark: opts.mark, waitMs: opts.waitMs, screenshot: opts.screenshot });
    saveBrowserResult(opts.project, opts.command, result, opts);
  } else if (opts.command === "manual") {
    result = await command(opts, "manual", { url: opts.url, tabId: opts.tabId, manualTimeoutMs: opts.manualTimeoutMs, mark: opts.mark, text: opts.text, selector: opts.selector });
    saveBrowserResult(opts.project, "manual", result, opts);
  } else if (opts.command === "act") {
    const selector = opts.selector || resolveSelectorFromTarget(opts.project, opts.target);
    result = await command(opts, "act", { url: opts.url, tabId: opts.tabId, target: opts.target, selector, action: opts.action, value: opts.value, key: opts.key, waitMs: opts.waitMs, text: opts.text, notText: opts.notText });
    saveBrowserResult(opts.project, "act", result, opts);
  } else {
    throw new Error(`Unknown command: ${opts.command}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, stack: process.env.OPENCODE_TEAM_DEBUG === "1" ? err.stack : undefined }, null, 2));
  process.exit(1);
});
