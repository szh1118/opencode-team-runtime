#!/usr/bin/env node
/**
 * opencode-team-runtime P2.5 browser evidence + perception runner
 *
 * Design goals:
 * - Use CloakBrowser in headed mode by default so a human can intervene.
 * - Keep the main LLM context clean: raw page state -> reduced page state -> ScreenDigest.
 * - Allow weak/text-only models to act by element id, not by guessing selectors or pixels.
 * - Record every browser observation/action as durable evidence under .opencode/team/browser.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const VERSION = "0.3.5-p2.5";

function now() { return new Date().toISOString(); }
function id(prefix = "browser") { return `${prefix}-${crypto.randomBytes(4).toString("hex")}`; }
function usage() {
  console.log(`opencode-team-runtime browser runner ${VERSION}

Usage:
  node .opencode/scripts/browser-runner.mjs visit URL [--project DIR] [--screenshot NAME] [--text TEXT] [--selector CSS] [--manual]
  node .opencode/scripts/browser-runner.mjs assert URL --text TEXT [--selector CSS] [--project DIR]
  node .opencode/scripts/browser-runner.mjs snapshot URL [--project DIR] [--dom] [--screenshot NAME] [--manual]
  node .opencode/scripts/browser-runner.mjs observe URL [--project DIR] [--mode reduced|raw|digest|all] [--screenshot NAME] [--mark] [--manual]
  node .opencode/scripts/browser-runner.mjs digest URL [--project DIR] [--screenshot NAME] [--mark] [--manual]
  node .opencode/scripts/browser-runner.mjs act URL --target e1 --action click|type|press|select|check|uncheck [--value TEXT] [--project DIR] [--manual]
  node .opencode/scripts/browser-runner.mjs manual URL [--project DIR] [--manual-timeout-ms 600000] [--screenshot NAME]
  node .opencode/scripts/browser-runner.mjs interact URL --steps steps.json [--project DIR] [--screenshot NAME] [--manual]
  node .opencode/scripts/browser-runner.mjs doctor [--project DIR]

Env:
  CLOAKBROWSER_HEADLESS=true|false      default false for this project
  CLOAKBROWSER_HUMANIZE=true|false      default true
  CLOAKBROWSER_PROXY=http://...         optional
  CLOAKBROWSER_PROFILE_DIR=path         optional persistent profile; recommended for signed-in/manual workflows
  CLOAKBROWSER_TIMEOUT_MS=45000         default 45000
  CLOAKBROWSER_MANUAL_TIMEOUT_MS=600000 default 10 minutes
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const opts = {
    command,
    url: "",
    project: process.cwd(),
    screenshot: "",
    text: "",
    notText: "",
    selector: "",
    stepsFile: "",
    dom: false,
    mark: false,
    manual: false,
    mode: "reduced",
    waitMs: 0,
    timeoutMs: Number(process.env.CLOAKBROWSER_TIMEOUT_MS || 45000),
    manualTimeoutMs: Number(process.env.CLOAKBROWSER_MANUAL_TIMEOUT_MS || 600000),
    action: "",
    target: "",
    value: "",
    key: "",
    json: false,
    _: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" || a === "--dir" || a === "-C") opts.project = path.resolve(args[++i]);
    else if (a === "--screenshot") opts.screenshot = args[++i] || "";
    else if (a === "--text" || a === "--contains") opts.text = args[++i] || "";
    else if (a === "--not-text") opts.notText = args[++i] || "";
    else if (a === "--selector") opts.selector = args[++i] || "";
    else if (a === "--steps") opts.stepsFile = args[++i] || "";
    else if (a === "--dom") opts.dom = true;
    else if (a === "--mark") opts.mark = true;
    else if (a === "--manual" || a === "--human") opts.manual = true;
    else if (a === "--mode") opts.mode = args[++i] || "reduced";
    else if (a === "--wait-ms") opts.waitMs = Number(args[++i] || 0);
    else if (a === "--timeout-ms") opts.timeoutMs = Number(args[++i] || 45000);
    else if (a === "--manual-timeout-ms") opts.manualTimeoutMs = Number(args[++i] || 600000);
    else if (a === "--action") opts.action = args[++i] || "";
    else if (a === "--target") opts.target = args[++i] || "";
    else if (a === "--value" || a === "--text-value") opts.value = args[++i] || "";
    else if (a === "--key") opts.key = args[++i] || "";
    else if (a === "--json") opts.json = true;
    else opts._.push(a);
  }
  opts.url = opts._[0] || "";
  return opts;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
}

function teamDir(project, ...parts) { return path.join(project, ".opencode", "team", ...parts); }
function browserDir(project, ...parts) { return teamDir(project, "browser", ...parts); }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function appendText(file, text) { mkdirp(path.dirname(file)); fs.appendFileSync(file, text); }
function truncate(s, max = 12000) { s = String(s ?? ""); return s.length <= max ? s : `${s.slice(0, max)}\n...<truncated ${s.length - max} chars>`; }
function rel(project, file) { return file ? path.relative(project, file) : null; }

async function resolveBrowserModule() {
  try {
    const mod = await import("cloakbrowser");
    return { kind: "cloakbrowser", ...mod };
  } catch (err) {
    try {
      const mod = await import("playwright-core");
      return { kind: "playwright-core", ...mod };
    } catch {
      const e = new Error(`Missing browser dependencies. Install with: npm install cloakbrowser playwright-core\nOriginal cloakbrowser import error: ${err.message}`);
      e.code = "BROWSER_DEPS_MISSING";
      throw e;
    }
  }
}

function launchOptions(project, opts = {}) {
  const headless = boolEnv("CLOAKBROWSER_HEADLESS", false);
  const humanize = boolEnv("CLOAKBROWSER_HUMANIZE", true);
  const proxy = process.env.CLOAKBROWSER_PROXY || undefined;
  const timezone = process.env.CLOAKBROWSER_TIMEZONE || undefined;
  const locale = process.env.CLOAKBROWSER_LOCALE || undefined;
  const geoip = boolEnv("CLOAKBROWSER_GEOIP", false);
  const viewport = process.env.CLOAKBROWSER_VIEWPORT ? parseViewport(process.env.CLOAKBROWSER_VIEWPORT) : undefined;
  const base = { headless, humanize, proxy, timezone, locale, geoip, viewport, timeout: opts.timeoutMs };
  Object.keys(base).forEach((k) => base[k] === undefined && delete base[k]);
  return base;
}

function parseViewport(v) {
  const m = /^([0-9]+)x([0-9]+)$/i.exec(String(v));
  if (!m) return undefined;
  return { width: Number(m[1]), height: Number(m[2]) };
}

async function openContext(project, opts) {
  const mod = await resolveBrowserModule();
  const options = launchOptions(project, opts);
  const profile = process.env.CLOAKBROWSER_PROFILE_DIR || path.join(".opencode", "team", "browser", "profile");
  let context;
  let browser;

  if (mod.kind === "cloakbrowser") {
    if (profile && mod.launchPersistentContext) {
      const userDataDir = path.isAbsolute(profile) ? profile : path.join(project, profile);
      mkdirp(userDataDir);
      context = await mod.launchPersistentContext({ ...options, userDataDir });
    } else if (mod.launchContext) {
      context = await mod.launchContext(options);
    } else {
      browser = await mod.launch(options);
      context = await browser.newContext();
    }
  } else {
    const userDataDir = path.isAbsolute(profile) ? profile : path.join(project, profile);
    mkdirp(userDataDir);
    if (mod.chromium.launchPersistentContext) context = await mod.chromium.launchPersistentContext(userDataDir, { headless: options.headless });
    else {
      browser = await mod.chromium.launch({ headless: options.headless });
      context = await browser.newContext();
    }
  }
  return { kind: mod.kind, browser, context, headless: options.headless, profile };
}

async function closeContext(opened) {
  try { if (opened.context) await opened.context.close(); } catch {}
  try { if (opened.browser) await opened.browser.close(); } catch {}
}

function setupPageCollectors(page) {
  const consoleLogs = [];
  const pageErrors = [];
  const requests = [];
  const responses = [];
  page.on?.("console", (msg) => {
    consoleLogs.push({ type: msg.type?.() || "log", text: msg.text?.() || String(msg), location: msg.location?.() || null, time: now() });
  });
  page.on?.("pageerror", (err) => {
    pageErrors.push({ message: err.message, stack: err.stack, time: now() });
  });
  page.on?.("requestfailed", (req) => {
    requests.push({ url: req.url(), method: req.method(), failure: req.failure?.(), time: now() });
  });
  page.on?.("response", (res) => {
    const status = res.status();
    if (status >= 400) responses.push({ url: res.url(), status, statusText: res.statusText(), time: now() });
  });
  return { consoleLogs, pageErrors, requests, responses };
}

async function pageSnapshot(page, opts) {
  const result = {
    url: page.url(),
    title: await page.title().catch(() => ""),
    text: "",
    domSummary: null,
  };
  result.text = truncate(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""), 20000);
  if (opts.dom) {
    result.domSummary = await extractReducedPageState(page, { maxElements: 250 }).catch((err) => ({ error: err.message }));
  }
  return result;
}

async function runAssertions(page, opts) {
  const assertions = [];
  if (opts.text) {
    const body = await page.locator("body").innerText({ timeout: opts.timeoutMs }).catch(() => "");
    assertions.push({ type: "contains_text", expected: opts.text, passed: body.includes(opts.text) });
  }
  if (opts.notText) {
    const body = await page.locator("body").innerText({ timeout: opts.timeoutMs }).catch(() => "");
    assertions.push({ type: "not_contains_text", expectedAbsent: opts.notText, passed: !body.includes(opts.notText) });
  }
  if (opts.selector) {
    const count = await page.locator(opts.selector).count().catch(() => 0);
    assertions.push({ type: "selector_exists", selector: opts.selector, count, passed: count > 0 });
  }
  return assertions;
}

async function applySteps(page, steps, timeoutMs) {
  const results = [];
  for (const step of steps) {
    const action = step.action;
    const startedAt = now();
    try {
      if (action === "click") await page.locator(step.selector).click({ timeout: step.timeoutMs || timeoutMs });
      else if (action === "type") await page.locator(step.selector).fill(step.text ?? "", { timeout: step.timeoutMs || timeoutMs });
      else if (action === "press") await page.keyboard.press(step.key || "Enter");
      else if (action === "wait") await page.waitForTimeout(Number(step.ms || 1000));
      else if (action === "waitForSelector") await page.locator(step.selector).waitFor({ timeout: step.timeoutMs || timeoutMs });
      else if (action === "scroll") await page.mouse.wheel(Number(step.dx || 0), Number(step.dy || 700));
      else if (action === "goto") await page.goto(step.url, { waitUntil: step.waitUntil || "domcontentloaded", timeout: step.timeoutMs || timeoutMs });
      else throw new Error(`Unsupported action: ${action}`);
      results.push({ action, status: "passed", startedAt, endedAt: now(), step });
    } catch (err) {
      results.push({ action, status: "failed", startedAt, endedAt: now(), step, error: err.message });
      throw new Error(`Step failed (${action}): ${err.message}`);
    }
  }
  return results;
}

async function extractRawPageState(page) {
  return await page.evaluate(() => {
    const body = document.body;
    const viewport = { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY };
    return {
      url: location.href,
      title: document.title,
      viewport,
      text: (body?.innerText || "").slice(0, 80000),
      htmlLength: document.documentElement?.outerHTML?.length || 0,
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName?.toLowerCase(),
        id: document.activeElement.id || null,
        text: (document.activeElement.innerText || document.activeElement.getAttribute?.("aria-label") || "").slice(0, 200)
      } : null
    };
  });
}

async function extractReducedPageState(page, options = {}) {
  const maxElements = Number(options.maxElements || 180);
  return await page.evaluate((maxElements) => {
    const trim = (s, n = 180) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const inViewport = (rect) => rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    const roleOf = (el) => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (["input", "textarea"].includes(tag)) return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "textbox";
      if (tag === "select") return "combobox";
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) return "heading";
      if (tag === "form") return "form";
      if (tag === "nav") return "navigation";
      if (tag === "main") return "main";
      if (tag === "dialog") return "dialog";
      return tag;
    };
    const labelText = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return trim(aria);
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const t = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ");
        if (trim(t)) return trim(t);
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.innerText) return trim(label.innerText);
      }
      const parentLabel = el.closest("label");
      if (parentLabel?.innerText) return trim(parentLabel.innerText);
      return trim(el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("name") || el.innerText || el.value || "");
    };
    const cssPath = (el) => {
      if (!el || el.nodeType !== 1) return "";
      if (el.id) return `#${CSS.escape(el.id)}`;
      const testid = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
      if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
      const name = el.getAttribute("name");
      const tag = el.tagName.toLowerCase();
      if (name && ["input", "textarea", "select", "button"].includes(tag)) return `${tag}[name="${CSS.escape(name)}"]`;
      const parts = [];
      let cur = el;
      for (let depth = 0; cur && cur.nodeType === 1 && depth < 5; depth++, cur = cur.parentElement) {
        let part = cur.tagName.toLowerCase();
        const cls = Array.from(cur.classList || []).filter(c => /^[a-zA-Z0-9_-]{1,32}$/.test(c)).slice(0, 2);
        if (cls.length) part += "." + cls.map(c => CSS.escape(c)).join(".");
        const parent = cur.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter(x => x.tagName === cur.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
      }
      return parts.join(" > ");
    };
    const bbox = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const interactiveQuery = [
      "a[href]", "button", "input", "textarea", "select", "summary", "details",
      "[role]", "[onclick]", "[contenteditable='true']", "[tabindex]:not([tabindex='-1'])",
      "[data-testid]", "[data-test]", "[data-cy]"
    ].join(",");
    const elements = [];
    const seen = new Set();
    for (const el of Array.from(document.querySelectorAll(interactiveQuery))) {
      if (!(el instanceof Element) || seen.has(el)) continue;
      seen.add(el);
      const visible = isVisible(el);
      const rect = el.getBoundingClientRect();
      const name = labelText(el);
      const role = roleOf(el);
      const text = trim(el.innerText || el.value || el.getAttribute("placeholder") || "");
      if (!visible && !name && !text) continue;
      if (elements.length >= maxElements) break;
      const selector = cssPath(el);
      elements.push({
        id: `e${elements.length + 1}`,
        tag: el.tagName.toLowerCase(),
        role,
        name,
        text,
        selector,
        type: el.getAttribute("type") || undefined,
        href: el.getAttribute("href") || undefined,
        disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
        visible,
        inViewport: inViewport(rect),
        bbox: bbox(el),
        confidence: selector ? 0.88 : 0.55
      });
    }
    const regions = [];
    for (const el of Array.from(document.querySelectorAll("header,nav,main,form,section,article,aside,footer,dialog,[role=dialog],[role=main],[role=navigation]")).slice(0, 80)) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (!inViewport(r) && regions.length > 12) continue;
      regions.push({
        id: `r${regions.length + 1}`,
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        name: labelText(el),
        text: trim(el.innerText, 300),
        selector: cssPath(el),
        bbox: bbox(el),
        inViewport: inViewport(r)
      });
      if (regions.length >= 24) break;
    }
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role=heading]")).filter(isVisible).slice(0, 30).map((el, i) => ({ id: `h${i + 1}`, level: el.tagName?.match(/^H([1-6])$/)?.[1] || el.getAttribute("aria-level") || null, text: trim(el.innerText || el.textContent, 200), bbox: bbox(el) }));
    const visibleTextBlocks = Array.from(document.querySelectorAll("p,li,td,th,label,button,a,span,div")).filter((el) => isVisible(el)).map((el) => trim(el.innerText || el.textContent, 180)).filter(Boolean).filter((s, i, arr) => arr.indexOf(s) === i).slice(0, 80);
    const forms = Array.from(document.querySelectorAll("form")).filter(isVisible).slice(0, 20).map((el, i) => ({ id: `f${i + 1}`, selector: cssPath(el), text: trim(el.innerText, 600), bbox: bbox(el) }));
    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
      pageState: {
        loading: document.readyState !== "complete",
        readyState: document.readyState,
        modalOpen: Boolean(document.querySelector("dialog[open],[role=dialog],[aria-modal=true]")),
        focused: document.activeElement ? labelText(document.activeElement) || document.activeElement.tagName?.toLowerCase() : null
      },
      headings,
      regions,
      forms,
      visibleTextBlocks,
      interactiveElements: elements,
      extractedAt: new Date().toISOString()
    };
  }, maxElements);
}

function makeScreenDigest(reduced, health = {}) {
  const title = reduced.title || reduced.url || "Untitled page";
  const headings = (reduced.headings || []).map(h => h.text).filter(Boolean).slice(0, 8);
  const topRegions = (reduced.regions || []).filter(r => r.inViewport).slice(0, 8).map(r => `${r.role || r.tag}${r.name ? `: ${r.name}` : ""}${r.text ? ` — ${truncate(r.text, 180)}` : ""}`);
  const elements = (reduced.interactiveElements || []).filter(e => e.visible).slice(0, 80);
  const importantText = (reduced.visibleTextBlocks || []).slice(0, 30);
  const consoleErrors = (health.consoleLogs || []).filter(l => ["error", "warning"].includes(l.type)).slice(0, 10);
  const networkErrors = [...(health.failedRequests || []), ...(health.errorResponses || [])].slice(0, 10);
  const suggested = [];
  for (const e of elements.slice(0, 20)) {
    if (["button", "link", "textbox", "combobox", "checkbox", "radio"].includes(e.role)) {
      suggested.push({ action: e.role === "textbox" ? "type" : e.role === "combobox" ? "select" : e.role === "checkbox" ? "check" : "click", target: e.id, label: e.name || e.text || e.selector, reason: `${e.role} element visible in viewport=${e.inViewport}` });
    }
  }
  return {
    kind: "ScreenDigest",
    version: VERSION,
    url: reduced.url,
    title,
    viewport: reduced.viewport,
    humanVisibleSummary: [
      `Page title: ${title}`,
      headings.length ? `Main headings: ${headings.join(" / ")}` : "No obvious heading detected.",
      topRegions.length ? `Visible regions: ${topRegions.slice(0, 4).join(" | ")}` : "No major semantic region detected.",
      elements.length ? `Visible actionable elements: ${elements.slice(0, 12).map(e => `${e.id} ${e.role} '${e.name || e.text || e.selector}'`).join("; ")}` : "No visible actionable element detected."
    ].join("\n"),
    pageState: reduced.pageState,
    visibleRegions: (reduced.regions || []).slice(0, 12),
    visibleText: importantText,
    interactiveElements: elements,
    technicalHealth: {
      consoleErrors,
      pageErrors: health.pageErrors || [],
      networkErrors,
      counts: {
        consoleLogs: (health.consoleLogs || []).length,
        pageErrors: (health.pageErrors || []).length,
        failedRequests: (health.failedRequests || []).length,
        errorResponses: (health.errorResponses || []).length
      }
    },
    suggestedNextActions: suggested.slice(0, 12),
    uncertainties: [
      ...(elements.length === 0 ? ["No actionable element was detected. The page may be canvas-heavy, not loaded, or blocked by an overlay."] : []),
      ...((health.pageErrors || []).length ? ["Page JavaScript errors are present; verify before claiming success."] : []),
      ...(((health.failedRequests || []).length + (health.errorResponses || []).length) ? ["Network/HTTP errors are present; verify before claiming success."] : [])
    ],
    extractedAt: now()
  };
}

async function addElementMarkers(page, reduced) {
  const elements = (reduced.interactiveElements || []).filter(e => e.visible && e.inViewport).slice(0, 80);
  await page.evaluate((elements) => {
    const old = document.getElementById("__opencode_team_markers");
    if (old) old.remove();
    const root = document.createElement("div");
    root.id = "__opencode_team_markers";
    root.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;font-family:Arial,sans-serif;";
    for (const e of elements) {
      const [x, y, w, h] = e.bbox;
      const box = document.createElement("div");
      box.textContent = e.id;
      box.title = `${e.id} ${e.role} ${e.name || e.text || e.selector}`;
      box.style.cssText = `position:absolute;left:${Math.max(0, x)}px;top:${Math.max(0, y)}px;min-width:18px;height:18px;padding:1px 4px;background:#ffcc00;color:#111;border:2px solid #111;border-radius:8px;font-size:12px;font-weight:700;line-height:16px;box-shadow:0 1px 4px rgba(0,0,0,.4);`;
      const outline = document.createElement("div");
      outline.style.cssText = `position:absolute;left:${Math.max(0, x)}px;top:${Math.max(0, y)}px;width:${Math.max(4, w)}px;height:${Math.max(4, h)}px;border:2px solid #ffcc00;background:rgba(255,204,0,.08);`;
      root.appendChild(outline);
      root.appendChild(box);
    }
    document.documentElement.appendChild(root);
  }, elements).catch(() => null);
}

async function removeElementMarkers(page) {
  await page.evaluate(() => document.getElementById("__opencode_team_markers")?.remove()).catch(() => null);
}

async function waitForHumanContinue(page, opts, reason = "Manual action requested") {
  const deadline = Date.now() + Number(opts.manualTimeoutMs || 600000);
  let lastUrl = "";
  while (Date.now() < deadline) {
    await page.evaluate((reason) => {
      const old = document.getElementById("__opencode_team_manual_gate");
      if (window.__OPENCODE_TEAM_CONTINUE === true) return;
      if (old) return;
      window.__OPENCODE_TEAM_CONTINUE = false;
      const root = document.createElement("div");
      root.id = "__opencode_team_manual_gate";
      root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:white;border:2px solid #fff;border-radius:12px;padding:12px;max-width:360px;font:14px/1.4 system-ui, sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.45);";
      root.innerHTML = `<div style=\"font-weight:700;margin-bottom:6px\">OpenCode Team: manual browser step</div><div style=\"margin-bottom:10px\"></div><button style=\"background:#22c55e;color:#111;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer\">Continue agent</button>`;
      root.children[1].textContent = reason || "Complete the manual step, then click Continue agent.";
      root.querySelector("button").onclick = () => { window.__OPENCODE_TEAM_CONTINUE = true; root.remove(); };
      document.documentElement.appendChild(root);
    }, reason).catch(() => null);

    const done = await page.evaluate(() => window.__OPENCODE_TEAM_CONTINUE === true).catch(() => false);
    if (done) return;
    const url = page.url?.() || "";
    if (url !== lastUrl) lastUrl = url;
    await page.waitForTimeout(1000).catch(() => null);
  }
  throw new Error(`Manual wait timed out after ${opts.manualTimeoutMs}ms. The user did not click Continue agent.`);
}

function saveObservationArtifacts(project, runId, raw, reduced, digest) {
  const base = browserDir(project);
  mkdirp(base);
  const files = {};
  if (raw) { files.raw = path.join(base, `${runId}.raw.json`); writeJson(files.raw, raw); writeJson(path.join(base, "current-raw.json"), raw); }
  if (reduced) { files.reduced = path.join(base, `${runId}.reduced.json`); writeJson(files.reduced, reduced); writeJson(path.join(base, "current-reduced.json"), reduced); }
  if (digest) { files.digest = path.join(base, `${runId}.digest.json`); writeJson(files.digest, digest); writeJson(path.join(base, "current-digest.json"), digest); }
  return files;
}

function saveEvidence(project, result) {
  const base = browserDir(project);
  mkdirp(base);
  const runId = result.runId || id("browser");
  const jsonFile = path.join(base, `${runId}.json`);
  writeJson(jsonFile, result);
  const evidenceFile = teamDir(project, "evidence.md");
  const status = result.passed ? "PASS" : "FAIL";
  appendText(evidenceFile, `\n## Browser Evidence: ${runId}\n\n- status: ${status}\n- command: ${result.command}\n- url: ${result.url || ""}\n- title: ${result.snapshot?.title || result.digest?.title || ""}\n- json: ${path.relative(project, jsonFile)}\n${result.screenshotPath ? `- screenshot: ${path.relative(project, result.screenshotPath)}\n` : ""}${result.markedScreenshotPath ? `- marked screenshot: ${path.relative(project, result.markedScreenshotPath)}\n` : ""}${result.digestPath ? `- screen digest: ${result.digestPath}\n` : ""}${result.error ? `- error: ${result.error}\n` : ""}\n`);

  const stateFile = teamDir(project, "state.json");
  const state = readJson(stateFile, null);
  if (state) {
    state.browserChecks = Array.isArray(state.browserChecks) ? state.browserChecks : [];
    state.evidence = Array.isArray(state.evidence) ? state.evidence : [];
    const item = {
      id: runId,
      type: "browser",
      title: `Browser ${result.command}: ${result.url || ""}`,
      path: path.relative(project, jsonFile),
      url: result.url,
      status: result.passed ? "passed" : "failed",
      summary: result.summary || result.digest?.humanVisibleSummary || "",
      createdAt: now(),
    };
    state.browserChecks.push(item);
    state.evidence.push(item);
    state.updatedAt = now();
    writeJson(stateFile, state);
  }
  return jsonFile;
}

function loadCurrentReduced(project) {
  return readJson(browserDir(project, "current-reduced.json"), null);
}

async function actById(page, reduced, opts) {
  const target = (reduced?.interactiveElements || []).find(e => e.id === opts.target);
  if (!target) throw new Error(`Target element not found in current reduced state: ${opts.target}`);
  if (!target.selector) throw new Error(`Target ${opts.target} has no selector`);
  const loc = page.locator(target.selector).first();
  const action = opts.action || "click";
  if (action === "click") await loc.click({ timeout: opts.timeoutMs });
  else if (action === "type") await loc.fill(opts.value ?? "", { timeout: opts.timeoutMs });
  else if (action === "press") await loc.press(opts.key || opts.value || "Enter", { timeout: opts.timeoutMs });
  else if (action === "select") await loc.selectOption(opts.value, { timeout: opts.timeoutMs });
  else if (action === "check") await loc.check({ timeout: opts.timeoutMs });
  else if (action === "uncheck") await loc.uncheck({ timeout: opts.timeoutMs });
  else throw new Error(`Unsupported act-by-id action: ${action}`);
  return { action, target: opts.target, selector: target.selector, label: target.name || target.text || "", status: "passed", time: now() };
}

async function runObserve(page, opts, collectors, result) {
  const raw = ["raw", "all"].includes(opts.mode) ? await extractRawPageState(page) : null;
  const reduced = ["reduced", "digest", "all", "raw"].includes(opts.mode) ? await extractReducedPageState(page) : null;
  const digest = ["digest", "all"].includes(opts.mode) ? makeScreenDigest(reduced, collectors) : null;
  const files = saveObservationArtifacts(opts.project, result.runId, raw, reduced, digest);
  result.raw = raw;
  result.reduced = reduced;
  result.digest = digest;
  result.rawPath = files.raw ? rel(opts.project, files.raw) : null;
  result.reducedPath = files.reduced ? rel(opts.project, files.reduced) : null;
  result.digestPath = files.digest ? rel(opts.project, files.digest) : null;
  if (opts.mark && reduced) {
    await addElementMarkers(page, reduced);
    const markedPath = path.join(browserDir(opts.project), `${result.runId}.marked.png`);
    await page.screenshot({ path: markedPath, fullPage: false }).catch(() => null);
    if (fs.existsSync(markedPath)) result.markedScreenshotPath = markedPath;
    await removeElementMarkers(page);
  }
  return { raw, reduced, digest };
}

async function executeBrowserCommand(opts) {
  if (["help", "--help", "-h"].includes(opts.command)) { usage(); return { passed: true }; }
  if (opts.command === "doctor") {
    const result = { version: VERSION, project: opts.project, checks: [], defaults: { headless: boolEnv("CLOAKBROWSER_HEADLESS", false), humanize: boolEnv("CLOAKBROWSER_HUMANIZE", true), profile: process.env.CLOAKBROWSER_PROFILE_DIR || path.join(".opencode", "team", "browser", "profile") } };
    try { const mod = await resolveBrowserModule(); result.checks.push({ name: "browser_module", passed: true, kind: mod.kind }); }
    catch (err) { result.checks.push({ name: "browser_module", passed: false, error: err.message }); }
    result.checks.push({ name: "team_dir", passed: fs.existsSync(teamDir(opts.project)) });
    result.checks.push({ name: "browser_dir", passed: fs.existsSync(browserDir(opts.project)) || (mkdirp(browserDir(opts.project)), true) });
    result.passed = result.checks.every((c) => c.passed);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (!opts.url) throw new Error("URL is required");
  const runId = id("browser");
  const opened = await openContext(opts.project, opts);
  const page = opened.context.pages?.()[0] || await opened.context.newPage();
  const collectors = setupPageCollectors(page);
  const result = {
    version: VERSION,
    runId,
    command: opts.command,
    url: opts.url,
    startedAt: now(),
    endedAt: null,
    passed: false,
    browserKind: opened.kind,
    headless: opened.headless,
    profile: opened.profile,
    assertions: [],
    stepResults: [],
    actionResult: null,
    snapshot: null,
    raw: null,
    reduced: null,
    digest: null,
    consoleLogs: collectors.consoleLogs,
    pageErrors: collectors.pageErrors,
    failedRequests: collectors.requests,
    errorResponses: collectors.responses,
    screenshotPath: null,
    markedScreenshotPath: null,
    rawPath: null,
    reducedPath: null,
    digestPath: null,
    error: null,
    summary: "",
  };

  try {
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
    if (opts.manual || opts.command === "manual") {
      await waitForHumanContinue(page, opts, "Complete CAPTCHA/login/manual checks in this headed CloakBrowser window, then click Continue agent.");
    }

    if (opts.command === "interact") {
      const stepsPath = path.isAbsolute(opts.stepsFile) ? opts.stepsFile : path.join(opts.project, opts.stepsFile);
      const steps = readJson(stepsPath, []);
      if (!Array.isArray(steps)) throw new Error("--steps must point to a JSON array");
      result.stepResults = await applySteps(page, steps, opts.timeoutMs);
    } else if (opts.command === "act") {
      let reduced = loadCurrentReduced(opts.project);
      if (!reduced || reduced.url !== page.url()) reduced = await extractReducedPageState(page);
      result.actionResult = await actById(page, reduced, opts);
      await page.waitForTimeout(Number(opts.waitMs || 500));
    }

    result.assertions = await runAssertions(page, opts);
    const assertionPass = result.assertions.every((a) => a.passed !== false);

    if (["snapshot", "visit", "assert", "interact", "manual", "act"].includes(opts.command)) {
      result.snapshot = await pageSnapshot(page, { dom: opts.dom || opts.command === "snapshot" });
    }
    if (["observe", "digest", "manual", "act"].includes(opts.command)) {
      if (opts.command === "digest") opts.mode = "digest";
      if (opts.command === "manual" && !["raw", "reduced", "digest", "all"].includes(opts.mode)) opts.mode = "digest";
      if (opts.command === "act" && !["raw", "reduced", "digest", "all"].includes(opts.mode)) opts.mode = "digest";
      await runObserve(page, opts, collectors, result);
    }

    const screenshotName = opts.screenshot || `${runId}.png`;
    if (screenshotName !== "none") {
      const screenshotPath = path.join(browserDir(opts.project), screenshotName.endsWith(".png") ? screenshotName : `${screenshotName}.png`);
      mkdirp(path.dirname(screenshotPath));
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
      if (fs.existsSync(screenshotPath)) result.screenshotPath = screenshotPath;
    }

    result.passed = assertionPass && result.pageErrors.length === 0;
    result.summary = `${result.passed ? "PASS" : "FAIL"}: ${result.snapshot?.title || result.digest?.title || result.url}; assertions=${result.assertions.length}; console=${result.consoleLogs.length}; pageErrors=${result.pageErrors.length}; requestFailures=${result.failedRequests.length}; httpErrors=${result.errorResponses.length}`;
  } catch (err) {
    result.error = err.message;
    result.summary = `FAIL: ${err.message}`;
  } finally {
    result.endedAt = now();
    await closeContext(opened);
  }

  const jsonFile = saveEvidence(opts.project, result);
  const output = {
    ...result,
    artifact: path.relative(opts.project, jsonFile),
    screenshotPath: result.screenshotPath ? rel(opts.project, result.screenshotPath) : null,
    markedScreenshotPath: result.markedScreenshotPath ? rel(opts.project, result.markedScreenshotPath) : null,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!result.passed) process.exitCode = 2;
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  executeBrowserCommand(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(JSON.stringify({ passed: false, error: err.message, stack: err.stack }, null, 2));
    process.exit(1);
  });
}

export { executeBrowserCommand, parseArgs, extractReducedPageState, makeScreenDigest };
