import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Shown while an LA-3 screen's migration has not been applied. One actionable line, no essay: the
 * screen is not broken, its tables do not exist yet.
 */
export function SetupPending({ title }: { title: string }) {
  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title={title} />
      <TableCard>
        <EmptyState title="This isn't set up yet" hint="Its database update has not been applied. Ask your Insurvas admin to apply the LA-3 migrations." />
      </TableCard>
    </div>
  );
}
