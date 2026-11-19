import Link from "next/link";

import { Callout } from "@/components/app/settings/primitives";
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
export function LapseRiskEmpty({ notice, tabs, framed = false }: { notice?: string; tabs?: React.ReactNode; framed?: boolean }) {
  return (
    <div className={framed ? "m-stagger flex flex-col gap-6" : "m-stagger flex min-h-0 flex-grow flex-col gap-6"}>
      {!framed && <PageHeader title="Lapse risk" />}
      {!framed && tabs}
      {notice && <Callout tone="warning" title={notice} />}
      <TableCard>
        <EmptyState
          title="Nothing at risk right now"
          hint="Missed drafts, returned payments and service calls land here."
          action={<Button asChild variant="outline"><Link href="/app/policies">Review policies</Link></Button>}
        />
      </TableCard>
    </div>
  );
}
