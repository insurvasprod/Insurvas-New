"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

// The clock as an external store: one tick a second, read as whole seconds so the snapshot is stable
// between ticks. The server has no "now", so it reads null and the first client pass matches it.
const subscribeClock = (tick: () => void) => {
  const id = window.setInterval(tick, 1000);
  return () => window.clearInterval(id);
};
const clockSeconds = () => Math.floor(Date.now() / 1000);
const noClock = () => null;

/**
 * "● Live · updated 12s ago" — how fresh the figures on a dashboard are.
 *
 * `updatedAt` is when the data was read (the server's render time, or a poll's last success). The
 * dot pulses while the data is fresh and goes still and amber once it is older than `staleAfter`,
 * so a page that stopped refreshing says so instead of looking live. Reduced motion: no pulse.
 */
export function LiveStamp({ updatedAt, staleAfterSeconds = 120, className }: { updatedAt: string | number | Date; staleAfterSeconds?: number; className?: string }) {
  const at = new Date(updatedAt).getTime();
  const nowSeconds = useSyncExternalStore(subscribeClock, clockSeconds, noClock);

  // Before the client clock is read there is no "now" to subtract from: say "Live" and nothing else.
  const age = nowSeconds === null ? null : Math.max(0, nowSeconds - Math.floor(at / 1000));
  const stale = age !== null && age > staleAfterSeconds;
  const ago = age === null ? null : age < 5 ? "just now" : age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        stale ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--accent-ink)]",
        className,
      )}
      title={new Date(at).toLocaleString()}
    >
      <span className={cn("m-live-dot", stale && "is-stale")} aria-hidden="true" />
      <span>{stale ? "Not refreshing" : "Live"}</span>
      {ago && <span className="font-normal opacity-80">· updated {ago}</span>}
    </span>
  );
}
