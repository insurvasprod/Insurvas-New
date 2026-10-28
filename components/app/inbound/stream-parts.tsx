import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small shared visual pieces for the Queue, Floor, and call pages.
 */

/**
 * How long a caller has waited, against the workspace's waiting time (Settings › Inbound): a bar
 * that glows green, turns amber at the warning and red at escalation, with both marks drawn on it.
 * The bar's full width is twice the escalation time, so a caller past escalation still has room.
 */
export function WaitBar({ seconds, warnSeconds, escalateSeconds, className }: { seconds: number; warnSeconds: number; escalateSeconds: number; className?: string }) {
  const full = Math.max(escalateSeconds * 2, 1);
  const width = Math.min(100, (seconds / full) * 100);
  const tone = seconds >= escalateSeconds ? "var(--error)" : seconds >= warnSeconds ? "var(--warning)" : "var(--success)";
  return (
    <span aria-hidden className={cn("relative block h-2 min-w-16 flex-1 rounded-full bg-[var(--surface-alt)]", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${width}%`, background: `linear-gradient(90deg, var(--success), ${tone})`, boxShadow: `0 0 10px ${tone}` }} />
      <span className="absolute -inset-y-1 w-px bg-[var(--warning)] opacity-70" style={{ left: `${(warnSeconds / full) * 100}%` }} />
      <span className="absolute -inset-y-1 w-px bg-[var(--error)] opacity-70" style={{ left: `${(escalateSeconds / full) * 100}%` }} />
    </span>
  );
}

export type RingTone = "success" | "warning" | "error" | "brand" | "muted";
const RING_INK: Record<RingTone, string> = { success: "var(--success)", warning: "var(--warning)", error: "var(--error)", brand: "var(--primary)", muted: "var(--border-strong)" };

/**
 * A conic ring: an agent's presence on the Floor (full when free, part-filled on a call), a caller's
 * wait, or the call timer. The label sits in the middle.
 */
export function Ring({ value, tone, size = 48, thickness = 5, children, label }: { value: number; tone: RingTone; size?: number; thickness?: number; children?: ReactNode; label?: string }) {
  const degrees = Math.max(0, Math.min(1, value)) * 360;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative inline-grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(${RING_INK[tone]} ${degrees}deg, var(--surface-alt) 0)` }}
    >
      <span className="absolute rounded-full bg-[var(--color-card)]" style={{ inset: thickness }} />
      <span className="relative text-xs leading-none font-semibold tabular-nums text-foreground">{children}</span>
    </span>
  );
}
