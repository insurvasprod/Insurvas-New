"use client";

import { createContext, useContext, useEffect, useId, useSyncExternalStore, type ReactNode } from "react";

/**
 * Page notices go to the bell, never onto the page (owner 2026-11-02: "do not show anything; if there
 * is anything to show put it as an alert in the notification"). `Callout` and `PageAlert` call
 * `usePageNotice` and draw nothing; the top bar reads `usePageNotices` and lists them first under
 * Alerts, counted on the bell's badge, for as long as the page that raised them is open.
 *
 * Inside a dialog the bell cannot be reached, so `InlineNotices` (wrapped round every DialogContent)
 * lets a Callout keep its one line there instead.
 */
export type PageNotice = { id: string; tone: "info" | "success" | "warning" | "error"; title: ReactNode; detail?: ReactNode };

let notices: PageNotice[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

function put(notice: PageNotice) {
  const at = notices.findIndex((item) => item.id === notice.id);
  notices = at === -1 ? [...notices, notice] : notices.map((item, index) => (index === at ? notice : item));
  emit();
}
function drop(id: string) {
  if (!notices.some((item) => item.id === id)) return;
  notices = notices.filter((item) => item.id !== id);
  emit();
}

const EMPTY: PageNotice[] = [];
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Every notice raised by what is on screen now, in the order they appeared. */
export function usePageNotices(): PageNotice[] {
  return useSyncExternalStore(subscribe, () => notices, () => EMPTY);
}

/** Raises a notice in the bell while the caller is mounted. Returns true when it was sent there. */
export function usePageNotice(notice: Omit<PageNotice, "id">, enabled = true): boolean {
  const id = useId();
  const { tone, title, detail } = notice;
  useEffect(() => {
    if (!enabled) return;
    put({ id, tone, title, detail });
  }, [id, tone, title, detail, enabled]);
  useEffect(() => () => drop(id), [id]);
  return enabled;
}

const InlineContext = createContext(false);

/** Notices raised inside stay on screen as one line (a dialog, where the bell is out of reach). */
export function InlineNotices({ children }: { children: ReactNode }) {
  return <InlineContext.Provider value>{children}</InlineContext.Provider>;
}

export function useNoticesInline(): boolean {
  return useContext(InlineContext);
}
