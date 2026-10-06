import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { TabbedSections } from "@/components/app/book-views";
import { PersistencyTable } from "@/components/app/persistency-tables";
import { MIN_COHORT, PERSISTENCY_MONTHS, TARGET_MONTH, TARGET_RATE, persistencyPct } from "@/lib/persistency/compute";
import { getPersistencyReport } from "@/lib/persistency/service";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * Insight › Persistency (LA-4.8): of the policies old enough to judge, how many were still alive 3,
 * 6, 9 and 13 months after issue — overall, then by issue cohort (the quarter issued), by carrier
 * and by lead source. Month 9 is the one carriers judge an agent on, so it leads, against the 65%
 * line below which a contract is at risk.
 *
 * A producer sees their own book's, as on the ledger. A cell with fewer than five policies shows
 * "—" alone: three policies are not a rate. When the lead-source tables cannot be read, one line
 * says so instead of every policy quietly reading "Unattributed".
 */
const pct = persistencyPct;

export default async function PersistencyPage() {
  const guard = await guardPage("cohort_persistency");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Persistency" description="How many of your policies are still in force at months 3, 6, 9 and 13, by carrier and by lead source." />;
  }
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Persistency" detail="Persistency is read by the account owner, producers (their own book) and bookkeepers." />;
  }
  const report = await getPersistencyReport({
    tenantId: guard.context.tenantId,
    canView: (producerUserId) => roleCanViewCommission(guard.role, guard.context.userId, producerUserId),
  });
  const at = (month: number) => report.overall.find((cell) => cell.month === month);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Persistency" description="Of the policies old enough to judge, how many were still in force at each month." />

      {report.policies === 0 ? (
        <TableCard><EmptyState title="No issued policies yet" hint="Persistency appears once policies in your book are old enough to judge — three months after issue for the first figure." /></TableCard>
      ) : (
        <>
          <StatStrip label="Persistency">
            <StatTile
              label={`Month ${TARGET_MONTH}`}
              value={pct(report.target.rate)}
              valueTone={report.target.below === null ? undefined : report.target.below ? "danger" : "good"}
              footnote={report.target.rate === null ? `needs ${MIN_COHORT} policies issued ${TARGET_MONTH}+ months ago` : `${at(TARGET_MONTH)?.alive}/${report.target.eligible} · carriers look for ${Math.round(TARGET_RATE * 100)}%`}
            />
            {PERSISTENCY_MONTHS.filter((month) => month !== TARGET_MONTH).map((month) => {
              const cell = at(month);
              return <StatTile key={month} label={`Month ${month}`} value={pct(cell?.rate ?? null)} footnote={cell && cell.eligible ? `${cell.alive}/${cell.eligible} in force` : "not old enough yet"} />;
            })}
          </StatStrip>
          {report.leadSourcesUnavailable && (
            <p role="status" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">Lead sources could not be read just now, so every policy shows as Unattributed. Refresh to try again.</p>
          )}
          {/* One breakdown at a time (2026-10-06 redesign), not stacked. */}
          <TabbedSections
            label="Persistency by"
            sections={[
              { key: "cohort", label: "By issue cohort", count: report.byCohort.length, content: <PersistencyTable rows={report.byCohort} noun="issue quarter" plural="issue quarters" searchLabel="Search quarters, e.g. 2026" /> },
              { key: "carrier", label: "By carrier", count: report.byCarrier.length, content: <PersistencyTable rows={report.byCarrier} noun="carrier" plural="carriers" searchLabel="Search carriers" /> },
              { key: "source", label: "By lead source", count: report.byLeadSource.length, content: <PersistencyTable rows={report.byLeadSource} noun="lead source" plural="lead sources" searchLabel="Search lead sources" /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
