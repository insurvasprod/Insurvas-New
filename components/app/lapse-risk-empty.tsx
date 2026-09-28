import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * The true empty state: a policy is listed only with the reason that put it there (a missed draft,
 * a returned payment, a service call), and none is open. The populated state is
 * lapse-risk-board.tsx; the page chooses between them on whether any signal is open.
 *
 * `notice` is for before the lapse-signal migration is applied: nothing can be recorded, and the
 * page says so rather than implying the book is clean.
 */
export function LapseRiskEmpty({ notice }: { notice?: string }) {
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Lapse risk" />
      {notice && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {notice}
        </div>
      )}
      <TableCard>
        <EmptyState
          title="Nothing at risk right now"
          hint="Policies appear here most urgent first, each with the signal that put it there — a missed draft, a returned payment, a service call."
          action={<Button asChild variant="outline"><Link href="/app/policies">Review policies</Link></Button>}
        />
      </TableCard>
    </div>
  );
}
