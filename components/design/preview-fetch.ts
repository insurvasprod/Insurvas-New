"use client";

import { previewAnswer, type PreviewState } from "@/lib/settings/preview/fixtures";

/**
 * The Settings preview's API (settings-shell plan, R1): on a /design/ page only, a request the preview
 * has a sample for is answered from lib/settings/preview/fixtures.ts, after a short delay so loading
 * and saving states show. Every other request goes out as usual.
 *
 * Installed when this module is first loaded, not in an effect: the panels fetch in their own effects,
 * which run before any parent's. Development only (the /design pages refuse production).
 */
let state: PreviewState = "loaded";
export function setPreviewState(next: PreviewState) {
  state = next;
}

declare global {
  interface Window { __insurvasPreviewFetch?: boolean }
}

if (typeof window !== "undefined" && !window.__insurvasPreviewFetch) {
  window.__insurvasPreviewFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!window.location.pathname.startsWith("/design/")) return real(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    const answer = url.origin === window.location.origin ? previewAnswer(method, url.pathname, state, body) : null;
    if (!answer) return real(input, init);
    await new Promise((resolve) => setTimeout(resolve, method === "GET" ? 350 : 700));
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  };
}
