"use client";

import { useEffect, useState } from "react";

/** The Docs pages this reader has opened, and the how-to steps they ticked, kept in this browser. */
const READ_KEY = "docs-read";
const stepsKey = (slug: string) => `docs-steps:${slug}`;
const CHANGED = "docs:changed";

function readList(key: string): string[] {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; }
}
function writeList(key: string, list: string[]) {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(CHANGED));
}

export function markRead(slug: string) {
  const list = readList(READ_KEY);
  if (!list.includes(slug)) writeList(READ_KEY, [...list, slug]);
}

export function toggleStep(slug: string, index: number) {
  const list = readList(stepsKey(slug));
  const key = String(index);
  writeList(stepsKey(slug), list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
}

/** The pages read, re-read when another part of the page records one. */
export function useReadPages(): Set<string> {
  const [read, setRead] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () => setRead(new Set(readList(READ_KEY)));
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  return read;
}

/** The steps of one page this reader ticked, by index. */
export function useTickedSteps(slug: string): Set<number> {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  useEffect(() => {
    const load = () => setTicked(new Set(readList(stepsKey(slug)).map(Number)));
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [slug]);
  return ticked;
}
