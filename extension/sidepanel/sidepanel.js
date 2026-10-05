// The side panel: copy-assist for the application the grant names (read through the carrier tab,
// so the request's Origin is the carrier's), a Fill button that runs the published map, and a
// Highlight mode that outlines the fields the map finds. It never holds the token — the service
// worker does — and it keeps no values anywhere but this page's memory.

const $ = (id) => document.getElementById(id);
const host = (origin) => origin.replace(/^https:\/\//, "");

let grant = null;
let payload = null;
let highlightOn = false;
let missed = new Set();
const ticks = new Set();

const port = chrome.runtime.connect({ name: "panel" });
port.onMessage.addListener((msg) => {
  if (msg?.type !== "grant") return;
  const changed = (msg.grant?.grantId ?? null) !== (grant?.grantId ?? null);
  grant = msg.grant;
  if (changed) { payload = null; missed = new Set(); ticks.clear(); }
  render();
  if (changed && grant) load();
});
// Keeps the service worker (and the grant in its memory) alive while the panel is open.
setInterval(() => { try { port.postMessage({ type: "ping" }); } catch { /* the worker restarted */ } }, 20_000);

function op(name, args) {
  return chrome.runtime.sendMessage({ type: "op", op: name, args });
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function setState(children) {
  $("state").replaceChildren(...[].concat(children));
}

function minutesLeft() {
  return grant ? Math.max(0, Math.round((new Date(grant.expiresAt).getTime() - Date.now()) / 60000)) : 0;
}

function render() {
  const line = $("grant-line");
  if (!grant) {
    line.textContent = "No application open.";
    setState(el("p", {}, "Open an application in Insurvas and press Fill on carrier site."));
    $("actions").hidden = true;
    $("copy").hidden = true;
    return;
  }
  const who = payload ? `${payload.application.clientName} · ${payload.application.carrierName ?? "Carrier"}` : host(grant.origin);
  line.textContent = `${who} · ${minutesLeft()} min left`;
  $("actions").hidden = !payload;
  $("fill").disabled = !payload?.map;
  $("fill").title = payload && !payload.map ? "No published field map for this carrier yet — use the copy list." : "";
  $("highlight").disabled = !payload?.map;
  $("highlight").setAttribute("aria-pressed", String(highlightOn));
  renderCopy();
}

async function load() {
  const res = await op("load");
  if (!res?.ok) return showProblem(res);
  setState([]);
  payload = res.payload;
  for (const key of payload.ticks ?? []) ticks.add(key);
  render();
}

function showProblem(res) {
  const message = res?.error ?? "Something went wrong.";
  if (res?.needsPermission) {
    setState([
      el("p", {}, message),
      el("button", { type: "button", class: "primary", onclick: allow }, `Allow on ${host(grant.origin)}`),
    ]);
  } else if (res?.wrongTab) {
    setState([el("p", {}, message), el("button", { type: "button", onclick: load }, "Try again")]);
  } else {
    setState([el("p", {}, message), el("button", { type: "button", onclick: load }, "Try again")]);
  }
  $("actions").hidden = !payload;
}

async function allow() {
  // A user gesture in an extension page: the only place Chrome lets us ask for a host.
  const granted = await chrome.permissions.request({ origins: [`${grant.origin}/*`] });
  if (granted) load();
}

function result(text) {
  const p = $("result");
  p.textContent = text;
  p.hidden = !text;
}

async function fill() {
  if (!payload?.map) return;
  $("fill").disabled = true;
  result("Filling…");
  const res = await op("fill", { map: payload.map });
  $("fill").disabled = false;
  if (!res?.ok) return result(res?.error ?? "Couldn't fill this page.");
  if (!res.pageMatched) return result("This page isn't in the field map. Use the copy list below.");
  missed = new Set(res.missed.map((m) => m.fieldKey));
  const parts = [`Filled ${res.filled.length} ${res.filled.length === 1 ? "field" : "fields"}.`];
  if (res.missed.length) parts.push(`${res.missed.length} not found — they're marked in the copy list.`);
  result(parts.join(" "));
  renderCopy();
  if (highlightOn) await op("highlight", { map: payload.map, on: true });
}

async function toggleHighlight() {
  highlightOn = !highlightOn;
  const res = await op("highlight", { map: payload?.map ?? null, on: highlightOn });
  if (!res?.ok) { highlightOn = false; result(res?.error ?? "Couldn't highlight this page."); }
  else if (highlightOn) result(`${res.matched} ${res.matched === 1 ? "field" : "fields"} outlined${res.missing.length ? `, ${res.missing.length} not found` : ""}.`);
  else result("");
  render();
}

async function copyText(key, text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return result("Couldn't copy — select the value and press Ctrl+C.");
  }
  ticks.add(key);
  result(`Copied ${label.toLowerCase()}.`);
  renderCopy();
  op("tick", { key }).catch(() => {});
}

async function copySensitive(ref) {
  // One field per request; Insurvas logs the read before it answers.
  const res = await op("sensitive", { key: ref.key });
  if (!res?.ok || typeof res.value !== "string") return result(res?.error ?? "Couldn't read that value.");
  await copyText(ref.key, res.value, ref.label);
}

function row({ key, label, display, onCopy }) {
  const has = Boolean(display);
  return el("button", { type: "button", class: `row${missed.has(key) ? " missed" : ""}`, disabled: has ? null : "", onclick: has ? onCopy : undefined, "aria-label": has ? `Copy ${label}, ${display}` : `${label}: not given` }, [
    el("span", { class: "text" }, [el("span", { class: "label" }, label), el("span", { class: "value" }, display ?? "Not given")]),
    ticks.has(key) ? el("span", { class: "tick", "aria-label": "Copied" }, "✓ copied") : null,
  ]);
}

function renderCopy() {
  if (!payload) { $("copy").hidden = true; return; }
  $("copy").hidden = false;
  const sensitiveBy = new Map();
  for (const ref of payload.sensitive) sensitiveBy.set(ref.group, [...(sensitiveBy.get(ref.group) ?? []), ref]);
  let total = 0;
  let done = 0;
  const blocks = payload.groups.map((group) => {
    const rows = [];
    let section = null;
    for (const item of group.items) {
      if (item.section && item.section !== section) { section = item.section; rows.push(el("h3", {}, section)); }
      if (item.display) { total += 1; if (ticks.has(item.key)) done += 1; }
      rows.push(row({ key: item.key, label: item.label, display: item.display, onCopy: () => copyText(item.key, item.copy ?? item.display, item.label) }));
    }
    for (const ref of sensitiveBy.get(group.key) ?? []) {
      total += 1;
      if (ticks.has(ref.key)) done += 1;
      rows.push(row({ key: ref.key, label: ref.label, display: ref.masked, onCopy: () => copySensitive(ref) }));
    }
    return el("section", {}, [el("h3", {}, group.label), ...rows]);
  });
  $("groups").replaceChildren(...blocks);
  $("progress").textContent = `${done} of ${total} copied`;
}

$("fill").addEventListener("click", fill);
$("highlight").addEventListener("click", toggleHighlight);
$("reload").addEventListener("click", load);
$("forget").addEventListener("click", async () => {
  if (highlightOn && payload?.map) await op("highlight", { map: payload.map, on: false }).catch(() => {});
  await chrome.runtime.sendMessage({ type: "forget" });
});
setInterval(() => { if (grant) render(); }, 30_000);
render();
