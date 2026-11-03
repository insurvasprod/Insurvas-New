"use client";

import { useSyncExternalStore } from "react";
import { viewerTimeZone } from "@/lib/format/dates";

const subscribe = () => () => {};

/**
 * The viewer's time zone, or null in the server render and while hydrating. React renders the server
 * snapshot (null) until hydration is done and only then reads the browser's zone, so the server and the
 * first client render print the same text. Use `zone ?? "UTC"` for visible text, and leave a hover
 * title off while it is null.
 */
export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(subscribe, viewerTimeZone, () => null);
}
