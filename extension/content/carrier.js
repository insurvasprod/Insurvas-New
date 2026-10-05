// Injected into the carrier's tab on demand (chrome.scripting), only when the tab is on the grant's
// origin and the person allowed that origin. Requests to Insurvas go from here so their Origin is the
// carrier's — the API refuses any other origin for this grant.
//
// Fill, never submit: this sets field values and dispatches input/change events. It never clicks a
// button, never presses Enter, never calls form.submit(). A selector that finds nothing fills
// nothing — no guessing — and is reported as a map miss so the field shows in the copy list.
(() => {
  if (window.__insurvasCarrier) return;
  window.__insurvasCarrier = true;

  const HIGHLIGHT = "data-insurvas-highlight";
  const HIGHLIGHT_STYLE = "2px solid #f97316";

  async function api(msg, path, init = {}) {
    const res = await fetch(`${msg.apiOrigin}${path}`, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      headers: { Authorization: `Bearer ${msg.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || `Insurvas refused the request (${res.status}).`);
    return body;
  }

  const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  /** "exact" when the step's URL pattern matches this page, "any" for a page with no address yet. */
  function stepMatch(pattern) {
    if (!pattern || pattern === "*") return "any";
    const target = /^https?:\/\//.test(pattern) ? `${location.origin}${location.pathname}` : location.pathname;
    const re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
    return re.test(target) ? "exact" : null;
  }

  function find(entry) {
    for (const selector of [entry.selector, entry.selectorFallback]) {
      if (!selector) continue;
      try {
        const all = [...document.querySelectorAll(selector)];
        if (all.length) return all;
      } catch {
        // An invalid selector finds nothing.
      }
    }
    return [];
  }

  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const lower = (s) => String(s ?? "").trim().toLowerCase();
  const labelOf = (el) => lower(el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "");

  /** Returns null when filled, or the reason it was not. */
  function put(els, entry, value) {
    const el = els[0];
    if (entry.inputKind === "radio") {
      const target = els.find((r) => r instanceof HTMLInputElement && r.type === "radio" && (lower(r.value) === lower(value) || labelOf(r) === lower(value)));
      if (!target) return "option_not_found";
      if (!target.checked) target.click();
      return null;
    }
    if (entry.inputKind === "checkbox") {
      if (!(el instanceof HTMLInputElement) || el.type !== "checkbox") return "not_fillable";
      const want = ["y", "yes", "true", "1", "on"].includes(lower(value));
      if (el.checked !== want) el.click();
      return null;
    }
    if (el instanceof HTMLSelectElement) {
      const options = [...el.options];
      const option = options.find((o) => o.value === value) ?? options.find((o) => lower(o.value) === lower(value)) ?? options.find((o) => lower(o.textContent) === lower(value));
      if (!option) return "option_not_found";
      setNative(el, option.value);
      return null;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.disabled || el.readOnly || ["submit", "button", "image", "reset", "file", "hidden"].includes(el.type)) return "not_fillable";
      let v = value;
      const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
      if (el.type === "date" && us) v = `${us[3]}-${us[1]}-${us[2]}`;
      setNative(el, v);
      return null;
    }
    return "not_fillable";
  }

  function pageSteps(map) {
    return (map?.steps ?? []).map((s) => ({ ...s, match: stepMatch(s.urlPattern) })).filter((s) => s.match);
  }

  async function fill(msg) {
    const map = msg.map;
    if (!map) return { ok: false, error: "There's no published field map for this carrier yet — use the copy list." };
    const steps = pageSteps(map);
    if (!steps.length) return { ok: true, pageMatched: false, filled: [], missed: [], empty: [] };
    const filled = [];
    const missed = [];
    const empty = [];
    const reported = new Map();
    for (const step of steps) {
      const misses = [];
      let total = 0;
      let done = 0;
      for (const entry of step.entries) {
        const els = find(entry);
        if (!els.length) {
          missed.push({ fieldKey: entry.fieldKey, reason: "selector_not_found" });
          // A page with no address cannot tell "not on this page" from "not found": not reported.
          if (step.match === "exact") misses.push({ field_key: entry.fieldKey, reason: "selector_not_found" });
          continue;
        }
        let value = entry.value;
        if (entry.sensitive) {
          const res = await api(msg, `/api/app/extension/fields/${encodeURIComponent(entry.fieldKey)}?entry=${encodeURIComponent(entry.id)}&application_id=${encodeURIComponent(msg.applicationId)}`).catch(() => null);
          value = res && typeof res.value === "string" ? res.value : null;
        }
        if (value === null || value === undefined || value === "") {
          empty.push(entry.fieldKey);
          continue;
        }
        total += 1;
        const reason = put(els, entry, value);
        if (reason) {
          missed.push({ fieldKey: entry.fieldKey, reason });
          // Found but refused the value: a real miss on any page, wildcard or not.
          misses.push({ field_key: entry.fieldKey, reason });
        } else {
          done += 1;
          filled.push(entry.fieldKey);
        }
      }
      if (step.match === "exact" || misses.length) reported.set(step.pageKey, { misses, total: total + misses.filter((m) => m.reason === "selector_not_found").length, done });
    }
    for (const [pageKey, r] of reported) {
      await api(msg, "/api/app/extension/map-miss", {
        method: "POST",
        body: JSON.stringify({ map_id: map.id, page_key: pageKey, url: `${location.origin}${location.pathname}`, misses: r.misses, fields_filled: r.done, fields_total: Math.max(r.total, r.done) }),
      }).catch(() => null);
    }
    return { ok: true, pageMatched: true, filled, missed, empty };
  }

  function highlight(msg) {
    for (const el of document.querySelectorAll(`[${HIGHLIGHT}]`)) {
      el.style.outline = el.getAttribute(HIGHLIGHT) === "-" ? "" : el.getAttribute(HIGHLIGHT);
      el.removeAttribute(HIGHLIGHT);
    }
    if (!msg.on) return { ok: true, matched: 0, missing: [] };
    let matched = 0;
    const missing = [];
    for (const step of pageSteps(msg.map)) {
      for (const entry of step.entries) {
        const els = find(entry);
        if (!els.length) missing.push(entry.fieldKey);
        for (const el of els) {
          el.setAttribute(HIGHLIGHT, el.style.outline || "-");
          el.style.outline = HIGHLIGHT_STYLE;
          matched += 1;
        }
      }
    }
    return { ok: true, matched, missing };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== "insurvas:op") return false;
    const run = async () => {
      switch (msg.op) {
        case "load":
          return { ok: true, payload: await api(msg, `/api/app/extension/fields?application_id=${encodeURIComponent(msg.applicationId)}`) };
        case "fill":
          return fill(msg);
        case "highlight":
          return highlight(msg);
        case "sensitive": {
          const res = await api(msg, `/api/app/extension/fields/${encodeURIComponent(msg.key)}?application_id=${encodeURIComponent(msg.applicationId)}`);
          return { ok: true, value: res.value };
        }
        case "tick":
          await api(msg, "/api/app/extension/ticks", { method: "PUT", body: JSON.stringify({ field_key: msg.key }) });
          return { ok: true };
        default:
          return { ok: false, error: "Unknown operation." };
      }
    };
    run().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  });
})();
