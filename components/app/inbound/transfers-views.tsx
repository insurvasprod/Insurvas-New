import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * One Inbound page (named Transfers until 2026-10-25), two views (Module 1 simplified, 2026-10-25): the queue of transfers (the
 * inbox, at /app/inbound) and the floor (who is waiting, on a call or free, at /app/floor). They
 * were two sidebar entries over the same transfers; now one entry and this switch. Both addresses
 * still work, so a link to either lands on its view.
 */
export function TransfersViews({ current }: { current: "queue" | "floor" }) {
  const views = [
    { key: "queue", label: "Queue", href: "/app/inbound" },
    { key: "floor", label: "Floor", href: "/app/floor" },
  ] as const;
  return (
    <nav aria-label="Inbound view" className="inline-flex h-9 items-center gap-0.5 rounded-full border border-border p-0.5">
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
