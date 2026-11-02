import { formatCentsAsCurrency } from "@/lib/money";

/**
 * One premium per row, drawn against the largest on the page (Leads A2).
 *
 * The bar is what makes a column of premiums readable at a glance: the number alone makes every
 * row look alike until you read all of them. It is shared rather than copied because the agent's
 * Daily deal flow and the partner's draw the same column, and a second copy is how the two drift
 * into looking subtly different.
 *
 * `monthlyCents` is a **monthly** premium; the figure shown is the annualised one, because that is
 * how a policy's worth is quoted. A row with no premium recorded yet says so and shows no bar —
 * never a zero-width bar, which reads as "sold for nothing".
 */
export function PremiumBar({ monthlyCents, max }: { monthlyCents: number | null; max: number }) {
  return (
    <span className="flex items-center gap-2.5">
      {monthlyCents != null && (
        <span aria-hidden className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
          {max > 0 && (
            <span
              className="block h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${Math.max(4, ((monthlyCents * 12) / max) * 100)}%` }}
            />
          )}
        </span>
      )}
      <span className="w-[90px] text-right font-semibold tabular-nums" aria-label={monthlyCents == null ? "No premium quoted yet" : undefined}>
        {monthlyCents == null ? "Not quoted" : formatCentsAsCurrency(monthlyCents * 12)}
      </span>
    </span>
  );
}
