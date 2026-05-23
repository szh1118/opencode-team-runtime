#!/usr/bin/env node
/**
 * Optional Chrome Native Messaging host scaffold.
 *
 * P2.6 primarily uses a localhost bridge server because it is easier to debug
 * and works without native host installation.  This script is included so the
 * extension can later switch to codex-chrome style nativeMessaging bootstrap.
 * It implements length-prefixed Chrome native messaging and can launch the
 * local bridge server on request.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = process.env.OPENCODE_TEAM_PROJECT_ROOT || path.resolve(__dirname, "..", "..", "..");
const BRIDGE = path.join(PROJECT_ROOT, ".opencode", "scripts", "browser-bridge-server.mjs");

function readMessage() {
  const lenBuf = Buffer.alloc(4);
  const n = fs.readSync(0, lenBuf, 0, 4, null);
  if (n === 0) return null;
  if (n !== 4) throw new Error("Invalid native message length prefix");
  const len = lenBuf.readUInt32LE(0);
  const body = Buffer.alloc(len);
  fs.readSync(0, body, 0, len, null);
  return JSON.parse(body.toString("utf8"));
}

function writeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  fs.writeSync(1, len);
  fs.writeSync(1, body);
}

function ensureServer(args = {}) {
  if (!fs.existsSync(BRIDGE)) throw new Error(`bridge script not found: ${BRIDGE}`);
  const port = String(args.port || process.env.OPENCODE_BROWSER_BRIDGE_PORT || 37987);
  const child = spawn(process.execPath, [BRIDGE, "serve", "--project", PROJECT_ROOT, "--port", port], {
    cwd: PROJECT_ROOT,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { ok: true, pid: child.pid, port, project: PROJECT_ROOT };
}

while (true) {
  const msg = readMessage();
  if (!msg) break;
  try {
    if (msg.type === "ping") writeMessage({ ok: true, type: "pong", project: PROJECT_ROOT });
    else if (msg.type === "ensure_server") writeMessage(ensureServer(msg));
    else writeMessage({ ok: false, error: `unknown native host message: ${msg.type}` });
  } catch (err) {
    writeMessage({ ok: false, error: err.message });
  }
}
