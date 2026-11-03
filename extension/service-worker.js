// The service worker holds the ONE current grant, in memory only — never chrome.storage — and
// forgets it at expiry. If Chrome stops the worker, the grant is gone; press "Fill on carrier site"
// in Insurvas again. It never talks to the carrier's page itself: it injects content/carrier.js into
// the active tab (only when that tab is on the grant's origin and the person has allowed that origin)
// and hands it the token for one operation at a time.
import { APP_ORIGINS, GRANT_LIFETIME_MS } from "./config.js";

/** @type {{ token: string, expiresAt: string, origin: string, applicationId: string, grantId: string, apiOrigin: string } | null} */
let grant = null;
let expiryTimer = null;
const panels = new Set();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function publicGrant() {
  return grant ? { origin: grant.origin, expiresAt: grant.expiresAt, applicationId: grant.applicationId, grantId: grant.grantId } : null;
}

function broadcast() {
  for (const port of panels) {
    try { port.postMessage({ type: "grant", grant: publicGrant() }); } catch { panels.delete(port); }
  }
}

function clearGrant() {
  grant = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  broadcast();
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function acceptGrant(msg, sender) {
  // From our bridge, on an Insurvas page, about that same page's origin.
  if (!sender.tab || !APP_ORIGINS.includes(sender.origin) || msg.apiOrigin !== sender.origin) return { ok: false, error: "This page can't open a grant." };
  const origin = httpsOrigin(msg.origin);
  if (!origin || origin !== msg.origin) return { ok: false, error: "The grant names an invalid carrier site." };
  const left = new Date(msg.expiresAt).getTime() - Date.now();
  if (!Number.isFinite(left) || left <= 0 || left > GRANT_LIFETIME_MS + 60_000) return { ok: false, error: "The grant has expired." };
  grant = { token: msg.token, expiresAt: msg.expiresAt, origin, applicationId: msg.applicationId, grantId: msg.grantId, apiOrigin: msg.apiOrigin };
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(clearGrant, left);
  broadcast();
  // Opening the side panel needs a user gesture; the click that sent the grant usually counts.
  chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  return { ok: true };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

/** Runs one operation in the carrier tab. Every refusal is a readable sentence for the side panel. */
async function onCarrierTab(op, extra) {
  if (!grant) return { ok: false, error: "No grant. Press Fill on carrier site in Insurvas first." };
  if (new Date(grant.expiresAt).getTime() <= Date.now()) {
    clearGrant();
    return { ok: false, error: "The grant has expired. Press Fill on carrier site in Insurvas again." };
  }
  const tab = await activeTab();
  const pattern = `${grant.origin}/*`;
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) return { ok: false, needsPermission: true, error: `Allow the extension on ${grant.origin.replace("https://", "")} first.` };
  if (!tab || !tab.id || !tab.url || httpsOrigin(tab.url) !== grant.origin) return { ok: false, wrongTab: true, error: `Open ${grant.origin.replace("https://", "")} in this tab.` };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/carrier.js"] });
  // The token travels to the carrier tab's isolated content-script world for this one operation.
  return chrome.tabs.sendMessage(tab.id, {
    type: "insurvas:op", op, token: grant.token, apiOrigin: grant.apiOrigin, applicationId: grant.applicationId, ...extra,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== "object") return false;
  if (msg.type === "grant") {
    sendResponse(acceptGrant(msg, sender));
    return false;
  }
  // Everything else comes from the side panel only.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL("sidepanel/"))) return false;
  if (msg.type === "status") {
    sendResponse({ ok: true, grant: publicGrant() });
    return false;
  }
  if (msg.type === "forget") {
    clearGrant();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "op" && ["load", "fill", "highlight", "sensitive", "tick"].includes(msg.op)) {
    onCarrierTab(msg.op, msg.args ?? {})
      .then((res) => sendResponse(res ?? { ok: false, error: "The carrier page didn't answer. Reload it and try again." }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  return false;
});

// The side panel keeps a port open (and pings it) so the worker — and the grant in its memory —
// stays alive while the panel is in use.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel" || port.sender?.id !== chrome.runtime.id) return;
  panels.add(port);
  port.postMessage({ type: "grant", grant: publicGrant() });
  port.onMessage.addListener(() => {});
  port.onDisconnect.addListener(() => panels.delete(port));
});
