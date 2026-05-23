/* OpenCode Team Browser Bridge extension background service worker. */
const VERSION = "0.4.0-p2.6";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 37987;
const DEFAULT_TOKEN = "dev-local";

let settings = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  token: DEFAULT_TOKEN,
  clientId: "",
  polling: false,
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function bridgeBase() { return `http://${settings.host || DEFAULT_HOST}:${settings.port || DEFAULT_PORT}`; }
function now() { return new Date().toISOString(); }
function safeErr(err) { return { message: err?.message || String(err), stack: err?.stack || undefined }; }

async function loadSettings() {
  const stored = await chrome.storage.local.get(["host", "port", "token", "clientId", "polling"]);
  settings = {
    host: stored.host || DEFAULT_HOST,
    port: Number(stored.port || DEFAULT_PORT),
    token: stored.token || DEFAULT_TOKEN,
    clientId: stored.clientId || crypto.randomUUID(),
    polling: Boolean(stored.polling),
  };
  await chrome.storage.local.set({ clientId: settings.clientId });
}

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set(settings);
}

async function bridgeFetch(path, options = {}) {
  const headers = { "content-type": "application/json", "x-opencode-bridge-token": settings.token, ...(options.headers || {}) };
  const res = await fetch(`${bridgeBase()}${path}`, { ...options, headers });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || `Bridge HTTP ${res.status}`);
  return json;
}

async function register() {
  await bridgeFetch("/extension/register", {
    method: "POST",
    body: JSON.stringify({ clientId: settings.clientId, extensionVersion: VERSION, userAgent: navigator.userAgent }),
  });
}

async function pollLoop() {
  await loadSettings();
  if (!settings.polling) return;
  try { await register(); } catch (err) { await setStatus({ state: "disconnected", error: err.message }); await sleep(2000); }
  while (settings.polling) {
    try {
      await setStatus({ state: "connected", error: "" });
      const resp = await bridgeFetch(`/extension/poll?clientId=${encodeURIComponent(settings.clientId)}&timeoutMs=25000`, { method: "GET" });
      if (resp?.job) await handleJobAndReturn(resp.job);
    } catch (err) {
      await setStatus({ state: "error", error: err.message });
      await sleep(2000);
    }
    await loadSettings();
  }
  await setStatus({ state: "stopped", error: "" });
}

async function setStatus(patch) {
  await chrome.storage.local.set({ bridgeStatus: { ...patch, updatedAt: now(), base: bridgeBase(), clientId: settings.clientId } });
}

async function handleJobAndReturn(job) {
  let payload;
  try {
    const result = await handleJob(job);
    payload = { clientId: settings.clientId, jobId: job.id, ok: true, result };
  } catch (err) {
    payload = { clientId: settings.clientId, jobId: job.id, ok: false, error: safeErr(err) };
  }
  await bridgeFetch("/extension/result", { method: "POST", body: JSON.stringify(payload) });
}

async function handleJob(job) {
  const args = job.args || {};
  switch (job.command) {
    case "list_tabs": return listTabs();
    case "active_tab": return activeTab();
    case "open_url": return openUrl(args.url);
    case "observe": return observe(args);
    case "manual": return manual(args);
    case "act": return act(args);
    default: throw new Error(`Unknown browser bridge command: ${job.command}`);
  }
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.map(tabSummary) };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active tab found");
  return { tab: tabSummary(tab) };
}

function tabSummary(tab) {
  return { id: tab.id, windowId: tab.windowId, active: tab.active, title: tab.title, url: tab.url, status: tab.status };
}

async function openUrl(url) {
  if (!url) throw new Error("url is required");
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabComplete(tab.id, 45000);
  const current = await chrome.tabs.get(tab.id);
  return { tab: tabSummary(current) };
}

async function ensureTab(args = {}) {
  if (args.tabId) {
    const tab = await chrome.tabs.get(Number(args.tabId));
    if (args.url && tab.url !== args.url) {
      await chrome.tabs.update(tab.id, { url: args.url, active: true });
      await waitForTabComplete(tab.id, 45000);
    }
    return chrome.tabs.get(tab.id);
  }
  if (args.url) {
    const [existing] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (existing?.id) {
      await chrome.tabs.update(existing.id, { url: args.url, active: true });
      await waitForTabComplete(existing.id, 45000);
      return chrome.tabs.get(existing.id);
    }
    return (await openUrl(args.url)).tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  return tab;
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") { clearTimeout(timer); finish(); } }).catch(finish);
  });
}

async function executeFunction(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: "MAIN" });
  return res?.result;
}

async function observe(args = {}) {
  const tab = await ensureTab(args);
  if (args.waitMs) await sleep(Number(args.waitMs));
  const pageState = await executeFunction(tab.id, extractPageStateInPage, [{ mode: args.mode || "digest", maxElements: 260 }]);
  let screenshotDataUrl = null;
  if (args.mark) await executeFunction(tab.id, markElementsInPage, [pageState?.reduced?.interactive_elements || []]);
  try { screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }); } catch {}
  if (args.mark) await executeFunction(tab.id, clearMarksInPage, []);
  return { url: tab.url, tabId: tab.id, title: tab.title, pageState, screenshotDataUrl };
}

async function manual(args = {}) {
  const tab = await ensureTab(args);
  const timeoutMs = Number(args.manualTimeoutMs || 600000);
  await executeFunction(tab.id, waitForManualContinueInPage, [{ timeoutMs }]);
  const obs = await observe({ tabId: tab.id, mode: "digest", mark: args.mark ?? true });
  return { ...obs, manual: true };
}

async function act(args = {}) {
  const tab = await ensureTab(args);
  const selector = args.selector || "";
  const target = args.target || "";
  const action = args.action || "";
  const value = args.value || args.key || "";
  if (!selector && !target) throw new Error("selector or target is required");
  if (!action) throw new Error("action is required");
  const before = await executeFunction(tab.id, extractPageStateInPage, [{ mode: "reduced", maxElements: 300 }]);
  const element = selector ? { selector } : (before?.reduced?.interactive_elements || []).find((el) => el.id === target);
  if (!element?.selector) throw new Error(`Could not resolve target ${target}`);
  const actionResult = await executeFunction(tab.id, performActionInPage, [{ selector: element.selector, action, value }]);
  if (args.waitMs) await sleep(Number(args.waitMs));
  const after = await observe({ tabId: tab.id, mode: "digest", mark: true });
  const bodyText = after?.pageState?.raw?.text || after?.pageState?.digest?.visible_text_sample || "";
  const assertions = [];
  if (args.text) assertions.push({ type: "text", expected: args.text, ok: bodyText.includes(args.text) });
  if (args.notText) assertions.push({ type: "notText", expected: args.notText, ok: !bodyText.includes(args.notText) });
  return { tabId: tab.id, url: tab.url, actionResult, assertions, ...after };
}

function cssEscapeLite(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

// Runs in page context.
function extractPageStateInPage(options) {
  const maxElements = options?.maxElements || 260;
  const mode = options?.mode || "digest";
  const visibleText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  const viewport = { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY };
  const selectors = [];

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth;
  }
  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["checkbox", "radio", "button", "submit"].includes(type)) return type === "submit" ? "button" : type;
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "summary") return "button";
    return tag;
  }
  function labelOf(el) {
    const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    if (aria) return aria.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    const id = el.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${id.replace(/"/g, "\\\"")}"]`);
      if (label?.innerText) return label.innerText.trim();
    }
    const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
    return text.slice(0, 120);
  }
  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
    if (testId) return `[data-testid="${cssEscapeLite(testId)}"]`;
    const aria = el.getAttribute("aria-label");
    if (aria) return `${el.tagName.toLowerCase()}[aria-label="${cssEscapeLite(aria)}"]`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${cssEscapeLite(name)}"]`;
    const parts = [];
    let cur = el;
    for (let i = 0; cur && cur.nodeType === 1 && i < 4; i++, cur = cur.parentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { part += `#${CSS.escape(cur.id)}`; parts.unshift(part); break; }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((x) => x.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }
  function bboxOf(el) {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
  }

  const interactiveSelector = [
    "a[href]", "button", "input", "textarea", "select", "summary",
    "[role='button']", "[role='link']", "[role='textbox']", "[role='checkbox']", "[role='combobox']", "[role='menuitem']",
    "[onclick]", "[tabindex]"
  ].join(",");
  const rawEls = [...document.querySelectorAll(interactiveSelector)].filter(isVisible).slice(0, maxElements);
  const interactive = rawEls.map((el, idx) => ({
    id: `e${idx + 1}`,
    role: roleOf(el),
    name: labelOf(el) || `(unnamed ${el.tagName.toLowerCase()})`,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    href: el.getAttribute("href") || "",
    selector: selectorFor(el),
    bbox: bboxOf(el),
    disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
    value_sample: ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ? String(el.value || "").slice(0, 120) : "",
    confidence: 0.85,
  }));

  const headings = [...document.querySelectorAll("h1,h2,h3,[role='heading']")].filter(isVisible).slice(0, 24).map((el) => ({ text: (el.innerText || "").trim().slice(0, 160), bbox: bboxOf(el) }));
  const dialogs = [...document.querySelectorAll("dialog,[role='dialog'],[aria-modal='true']")].filter(isVisible).map((el) => ({ text: (el.innerText || "").trim().slice(0, 800), bbox: bboxOf(el) }));
  const forms = [...document.querySelectorAll("form")].filter(isVisible).slice(0, 12).map((el) => ({ text: (el.innerText || "").trim().slice(0, 800), bbox: bboxOf(el) }));

  const raw = mode === "all" || mode === "raw" ? {
    url: location.href,
    title: document.title,
    text: visibleText.slice(0, 24000),
    html_sample: document.documentElement.outerHTML.slice(0, 24000),
    viewport,
  } : { url: location.href, title: document.title, text: visibleText.slice(0, 12000), viewport };

  const reduced = {
    url: location.href,
    title: document.title,
    viewport,
    headings,
    dialogs,
    forms,
    visible_text_sample: visibleText.slice(0, 5000),
    interactive_elements: interactive,
    page_state: {
      modal_open: dialogs.length > 0,
      form_count: forms.length,
      interactive_count: interactive.length,
      loading: document.readyState !== "complete",
    },
  };

  const digest = {
    url: location.href,
    title: document.title,
    viewport,
    human_visible_summary: [
      document.title ? `Title: ${document.title}` : "No page title detected",
      headings.length ? `Headings: ${headings.map((h) => h.text).filter(Boolean).slice(0, 8).join(" | ")}` : "No visible headings detected",
      dialogs.length ? `Visible dialog/modal: ${dialogs[0].text.slice(0, 300)}` : "No visible modal detected",
      `Visible interactive elements: ${interactive.length}`,
    ].join("\n"),
    visible_regions: [
      { id: "r1", name: "Viewport", description: visibleText.slice(0, 800), bbox: [0, 0, window.innerWidth, window.innerHeight] },
    ],
    interactive_elements: interactive.slice(0, 80),
    visible_text_sample: visibleText.slice(0, 3000),
    technical_health: {
      browser_ready_state: document.readyState,
    },
    uncertainties: interactive.length >= maxElements ? ["Element list was truncated"] : [],
  };
  return { raw, reduced, digest };
}

function markElementsInPage(elements) {
  clearMarksInPage();
  const layer = document.createElement("div");
  layer.id = "opencode-team-bridge-mark-layer";
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647", fontFamily: "monospace" });
  for (const el of elements.slice(0, 80)) {
    if (!Array.isArray(el.bbox)) continue;
    const [left, top, right, bottom] = el.bbox;
    const box = document.createElement("div");
    Object.assign(box.style, { position: "fixed", left: `${left}px`, top: `${top}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, bottom - top)}px`, border: "2px solid #ff3b30", background: "rgba(255,59,48,0.05)", boxSizing: "border-box" });
    const label = document.createElement("div");
    label.textContent = el.id;
    Object.assign(label.style, { position: "absolute", left: "0", top: "-18px", background: "#ff3b30", color: "white", padding: "1px 4px", fontSize: "12px", borderRadius: "3px" });
    box.appendChild(label);
    layer.appendChild(box);
  }
  document.documentElement.appendChild(layer);
  return true;
}

function clearMarksInPage() {
  document.getElementById("opencode-team-bridge-mark-layer")?.remove();
  return true;
}

async function waitForManualContinueInPage({ timeoutMs }) {
  return new Promise((resolve, reject) => {
    document.getElementById("opencode-team-manual-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "opencode-team-manual-overlay";
    Object.assign(overlay.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647", background: "#111827", color: "white", padding: "14px", borderRadius: "12px", boxShadow: "0 8px 40px rgba(0,0,0,.35)", fontFamily: "system-ui, sans-serif", maxWidth: "360px"
    });
    overlay.innerHTML = `<div style="font-weight:700;margin-bottom:6px">OpenCode Team Browser Bridge</div><div style="font-size:13px;line-height:1.4;margin-bottom:10px">Complete login, CAPTCHA, 2FA, consent, or other manual browser work. Then click Continue agent.</div>`;
    const btn = document.createElement("button");
    btn.textContent = "Continue agent";
    Object.assign(btn.style, { background: "#22c55e", color: "#03150a", border: "0", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontWeight: "700" });
    overlay.appendChild(btn);
    document.documentElement.appendChild(overlay);
    const timer = setTimeout(() => { overlay.remove(); reject(new Error("Manual intervention timed out")); }, timeoutMs || 600000);
    btn.addEventListener("click", () => { clearTimeout(timer); overlay.remove(); resolve({ ok: true, continuedAt: new Date().toISOString() }); }, { once: true });
  });
}

function performActionInPage({ selector, action, value }) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found for selector: ${selector}`);
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const focusable = el;
  if (typeof focusable.focus === "function") focusable.focus();
  if (action === "click") {
    el.click();
  } else if (action === "type") {
    if (!("value" in el)) throw new Error("Cannot type into target without value property");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.value = value || "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (action === "press") {
    const key = value || "Enter";
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  } else if (action === "select") {
    if (el.tagName !== "SELECT") throw new Error("select action requires a select element");
    el.value = value || "";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (action === "check" || action === "uncheck") {
    if (!("checked" in el)) throw new Error("check/uncheck action requires a checkable element");
    el.checked = action === "check";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
  return { ok: true, selector, action, value };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await loadSettings();
    if (msg?.type === "GET_STATUS") {
      const s = await chrome.storage.local.get(["bridgeStatus", "host", "port", "clientId", "polling"]);
      sendResponse({ ok: true, settings: { host: settings.host, port: settings.port, clientId: settings.clientId, polling: settings.polling }, status: s.bridgeStatus || null });
    } else if (msg?.type === "START") {
      await saveSettings({ host: msg.host || settings.host, port: Number(msg.port || settings.port), token: msg.token || settings.token, polling: true });
      pollLoop();
      sendResponse({ ok: true });
    } else if (msg?.type === "STOP") {
      await saveSettings({ polling: false });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "unknown message" });
    }
  })().catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => loadSettings().then(() => setStatus({ state: "installed" })));
loadSettings().then(() => { if (settings.polling) pollLoop(); });
