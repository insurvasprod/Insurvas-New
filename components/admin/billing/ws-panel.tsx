import type { ReactNode } from "react";

import { cardSurface } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One card on the billing workspace (billing-r2 screen 1): a small sentence-case title, an optional count chip and
 * a muted note on the right, then the body. Every card loads and fails on its own (frame first): the page wraps
 * each in Suspense with `WsPanelLoading`, and a card whose reads throw draws `WsPanelError`.
 */
export function WsPanel({ title, count, note, children, className }: {
  title: string;
  /** A count of new things waiting (gold, the one place colour means "new"). */
  count?: number | null;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn(cardSurface, "flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex min-h-11 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="m-0 text-sm font-semibold text-foreground">{title}</h2>
        {typeof count === "number" && count > 0 && (
          <span className="rounded-badge bg-[var(--highlight-soft)] px-1.5 text-xs font-semibold tabular-nums text-[var(--highlight-ink)]">{count.toLocaleString("en-US")}</span>
        )}
        {note && <span className="ml-auto truncate text-xs text-muted-foreground">{note}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

export function WsPanelLoading({ title, rows = 4, className }: { title: string; rows?: number; className?: string }) {
  return (
    <WsPanel title={title} className={className}>
      <div role="status" aria-live="polite" className="flex flex-col gap-2 p-4">
        <span className="sr-only">Loading {title.toLowerCase()}</span>
        {Array.from({ length: rows }, (_, i) => <span key={i} aria-hidden="true" className="m-skel h-5 w-full rounded-md" />)}
      </div>
    </WsPanel>
  );
}

export function WsPanelError({ title, className }: { title: string; className?: string }) {
  return (
    <WsPanel title={title} className={className}>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
        <p className="m-0 text-sm font-semibold text-foreground">Couldn&apos;t load this</p>
        <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">Its figures didn&apos;t answer. The rest of the page is current; reload to try again.</p>
      </div>
    </WsPanel>
  );
}

/** Runs a card's reads and hands back the data or null, logging the failure. Kept out of JSX so nothing renders inside a try. */
export async function settlePanel<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-billing] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** "2h ago", "yesterday", "Nov 15": how long ago, in a glance. Server-printed with the request's clock. */
export function agoWords(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  const date = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
