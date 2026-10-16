import Link from "next/link";

/**
 * LA-6.4 · an overdue regulator complaint is the single loudest thing in the product: a banner on
 * every page that cannot be dismissed, until the complaint is answered. A missed DOI deadline is an
 * escalation toward losing the licence.
 */
export function OverdueComplaintBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm font-semibold text-[var(--error-ink)]">
      <span>
        {count === 1 ? "A regulator complaint is past its response deadline." : `${count} regulator complaints are past their response deadline.`} A missed deadline puts the licence at risk.
      </span>
      <Link href="/app/complaints" className="underline">Respond now</Link>
    </div>
  );
}
