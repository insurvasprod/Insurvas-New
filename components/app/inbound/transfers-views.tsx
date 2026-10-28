import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Team's two views (Inbound A, 2026-10-27; was the Queue/Floor switch): Now (who needs you, the
 * people, the calls) at /app/inbound/team, and All callers (every transfer today, Today by partner,
 * filters, lost-transfer recovery) at /app/inbound/team?tab=all. Agents work on Inbound itself.
 */
export function TeamViews({ current }: { current: "now" | "all" }) {
  const views = [
    { key: "now", label: "Now", href: "/app/inbound/team" },
    { key: "all", label: "All callers", href: "/app/inbound/team?tab=all" },
  ] as const;
  return (
    <nav aria-label="Team views" className="inline-flex h-9 w-fit items-center gap-0.5 rounded-full border border-border p-0.5">
      {views.map((view) => (
        <Link
          key={view.key}
          href={view.href}
          aria-current={view.key === current ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-full px-3.5 text-sm font-semibold tracking-[-0.01em] no-underline transition-colors",
            view.key === current ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
