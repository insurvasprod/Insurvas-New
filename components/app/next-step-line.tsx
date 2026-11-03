import type { ReactNode } from "react";

/**
 * Retired (owner 2026-11-02: "never show this thing ever in the pages"). The "Next step" strip is
 * gone from the design system: a page's one action lives in its header or toolbar, and what waits on
 * someone lives in the bell. Kept as a no-op so old callers compile; the ui ratchet
 * `next-step-strip` stops new ones (UI-CONSISTENCY §6d).
 */
export function NextStepLine(props: { children: ReactNode; action?: ReactNode; label?: string }) {
  void props;
  return null;
}
