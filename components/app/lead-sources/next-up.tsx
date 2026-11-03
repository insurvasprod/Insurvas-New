import type { ReactNode } from "react";

import { Callout } from "@/components/app/settings/primitives";

/**
 * Was the "Next up" strip at the top of a page (2026-10-30). Retired by the owner 2026-11-02: "never
 * show this thing ever in the pages" (UI-CONSISTENCY §3). No tinted line, icon or sentence any more.
 * What the strip held that the page still needs:
 *
 *   action   the button, on its own at the right; on some pages (import review, contacts' Save, the
 *            import's Continue) it is the only way to do the thing, so it stays
 *   danger   something cannot run at all: the one-line alert §3 keeps for blocked states
 *
 * Everything else (the "warning" / "action" / "done" sentences) is dropped. The `next-step-strip`
 * ratchet counts the old call sites down and stops new ones.
 */
export type NextUpTone = "danger" | "warning" | "action" | "done";

export function NextUp({ tone, children, action = null }: {
  tone: NextUpTone;
  children: ReactNode;
  action?: ReactNode;
  /** Ignored: kept so old callers compile. */
  more?: ReactNode;
}) {
  if (tone !== "danger" && !action) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {tone === "danger" && <Callout tone="error" title={children} />}
      {action && <div className="flex flex-wrap items-center justify-end gap-2">{action}</div>}
    </div>
  );
}
