"use client";

import { useLayoutEffect } from "react";

/**
 * The first screen after signing in builds itself in (§ Motion, "shell-enter", owner pick 2026-11-09): the sidebar
 * slides in from the left, the top bar drops in, then the page rises — about 0.8s, once per sign-in, never on a
 * reload or a later page. Sign-in marks it (`markShellEntrance`) just before it moves to the app; the shell reads
 * the mark once, before its first paint, and clears it. Reduced motion: the global block makes it instant.
 */
const KEY = "insurvas:shell-enter";
const LENGTH_MS = 900;

/** Called by the sign-in form right before it opens the app. */
export function markShellEntrance() {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* the entrance is a courtesy */ }
}

export function ShellEntrance() {
  useLayoutEffect(() => {
    // A sign-out in this tab dimmed the last workspace (app-top-bar.tsx); a new one starts bright.
    document.documentElement.classList.remove("shell-leave");
    let marked = false;
    try { marked = sessionStorage.getItem(KEY) === "1"; sessionStorage.removeItem(KEY); } catch { /* no entrance */ }
    if (!marked) return;
    const root = document.documentElement;
    root.classList.add("shell-enter");
    const done = window.setTimeout(() => root.classList.remove("shell-enter"), LENGTH_MS);
    return () => { window.clearTimeout(done); root.classList.remove("shell-enter"); };
  }, []);
  return null;
}
