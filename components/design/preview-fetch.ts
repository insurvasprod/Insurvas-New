"use client";

import { previewAnswer, type PreviewState } from "@/lib/settings/preview/fixtures";

/**
 * The Settings preview's API (settings-shell plan, R1). On a /design/ page, every request to this
 * app's /api/ is answered here and **never reaches the server**: from lib/settings/preview/fixtures.ts
 * when there is a sample, otherwise with a "no sample" error. The browser may be signed in to a real
 * account, so letting a request through would read, or save, real data. Requests anywhere else, and
 * to other origins, go out as usual.
 *
 * Installed when this module first loads, not in an effect: the panels fetch in their own effects,
 * which run before any parent's. The table and the state live on `window` and are refreshed every
 * time this module is evaluated, so a hot reload uses the current fixtures. Development only (the
 * /design pages refuse production).
 */
type Lookup = typeof previewAnswer;

declare global {
  interface Window {
    __insurvasPreviewFetch?: boolean;
    __insurvasPreviewAnswer?: Lookup;
    __insurvasPreviewState?: PreviewState;
  }
}

export function setPreviewState(next: PreviewState) {
  if (typeof window !== "undefined") window.__insurvasPreviewState = next;
}

if (typeof window !== "undefined") {
  // Every evaluation: the newest fixtures win after a hot reload.
  window.__insurvasPreviewAnswer = previewAnswer;
  if (!window.__insurvasPreviewFetch) {
    window.__insurvasPreviewFetch = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!window.location.pathname.startsWith("/design/")) return real(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return real(input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try { body = JSON.parse(init.body); } catch { body = null; }
      }
      const answer = window.__insurvasPreviewAnswer?.(method, url.pathname, window.__insurvasPreviewState ?? "loaded", body)
        ?? { status: 404, body: { error: `The preview has no sample for ${method} ${url.pathname}.` } };
      await new Promise((resolve) => setTimeout(resolve, method === "GET" ? 350 : 700));
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
    };
  }
}
