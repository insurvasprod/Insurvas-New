import { cn } from "@/lib/utils";

/**
 * Where a policy's first-year commission stands, as one thin bar (boards 6 and 7): earned green, the advance not
 * yet earned (at risk) amber, short-paid red, still to come the track. Flat token colours, no gradient (§17).
 *
 * components/ui has `Meter` for one value against a target; this is the same bar in parts. If another screen
 * needs it, it moves to components/ui as a `parts` option on Meter rather than a second copy.
 */
export function MoneyBar({ parts, label, size = "row" }: { parts: { earned: number; atRisk: number; short: number; rest: number }; label: string; size?: "row" | "card" }) {
  return (
    <span role="img" aria-label={label} className={cn("flex w-full overflow-hidden rounded-full bg-[var(--surface-alt)]", size === "card" ? "h-2.5" : "h-1.5")}>
      {parts.earned > 0 && <span className="h-full bg-[var(--success)]" style={{ width: `${parts.earned}%` }} />}
      {parts.atRisk > 0 && <span className="h-full bg-[var(--warning)]" style={{ width: `${parts.atRisk}%` }} />}
      {parts.short > 0 && <span className="h-full bg-[var(--error)]" style={{ width: `${parts.short}%` }} />}
    </span>
  );
}
