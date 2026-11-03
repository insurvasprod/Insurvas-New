import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A shell alert drawn on the page title's line (owner 2026-11-02: "on the same line with the title",
 * because a full-width banner above the trail pushed every page into a scroll). It fills the rest of
 * the line: the icon and the whole sentence on the left, the action on the right. One 36px line; a
 * sentence too long for the window ends in … and reads whole in the tooltip. `PageAlertSlot` in
 * `PageHeader` places it; a page with no header shows it above the page.
 */
export function PageAlert({
  tone,
  icon,
  text,
  action,
  role = "alert",
}: {
  tone: "error" | "warning";
  icon?: ReactNode;
  text: string;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex h-9 w-full min-w-0 items-center justify-between gap-6 rounded-lg border px-4 text-sm font-semibold",
        tone === "error"
          ? "border-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]"
          : "border-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon && <span aria-hidden="true" className="flex shrink-0 [&>svg]:size-4">{icon}</span>}
        <span className="min-w-0 truncate" title={text}>{text}</span>
      </span>
      {action && <span className="shrink-0 underline underline-offset-2">{action}</span>}
    </div>
  );
}
