import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { MIN_COHORT, PERSISTENCY_MONTHS, TARGET_MONTH, TARGET_RATE, type PersistencyCell, type PersistencyRow } from "@/lib/persistency/compute";
import { getPersistencyReport } from "@/lib/persistency/service";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * Insight › Persistency (LA-4.8): of the policies old enough to judge, how many were still alive 3,
 * 6, 9 and 13 months after issue — overall, by carrier and by lead source. Month 9 is the one
 * carriers judge an agent on, so it leads, against the 65% line below which a contract is at risk.
 *
 * A producer sees their own book's, as on the ledger. A cell with fewer than five policies shows
 * "—": three policies are not a rate.
 */
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

function Cell({ cell }: { cell: PersistencyCell | undefined }) {
  if (!cell || cell.eligible === 0) return <span className="text-muted-foreground">—</span>;
  const tone = cell.rate === null ? "text-muted-foreground" : cell.month === TARGET_MONTH && cell.rate < TARGET_RATE ? "font-semibold text-[var(--error-ink)]" : "text-foreground";
  return (
    <span className={`tabular-nums ${tone}`} title={`${cell.alive} of ${cell.eligible} still in force at month ${cell.month}`}>
      {pct(cell.rate)}
      <span className="block text-xs font-normal text-muted-foreground">{cell.alive}/{cell.eligible}</span>
    </span>
  );
}

function CohortTable({ title, rows, noun }: { title: string; rows: PersistencyRow[]; noun: string }) {
  return (
    <TableCard title={title} footer={<span>Showing {rows.length.toLocaleString("en-US")} {rows.length === 1 ? noun : `${noun}s`} · a cell needs {MIN_COHORT} policies old enough to count</span>}>
      <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr>
            <th>{noun[0].toUpperCase() + noun.slice(1)}</th>
            <th className="w-[96px] text-right">Policies</th>
            {PERSISTENCY_MONTHS.map((month) => <th key={month} className="w-[110px] text-right">Month {month}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="font-semibold text-foreground">{row.label}</td>
              <td className="text-right tabular-nums">{row.policies.toLocaleString("en-US")}</td>
              {PERSISTENCY_MONTHS.map((month) => <td key={month} className="text-right"><Cell cell={row.cells.find((cell) => cell.month === month)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

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
        <EmptyState title="No issued policies yet" hint="Persistency appears once policies in your book are old enough to judge — three months after issue for the first figure." />
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
          <CohortTable title="By carrier" rows={report.byCarrier} noun="carrier" />
          <CohortTable title="By lead source" rows={report.byLeadSource} noun="lead source" />
        </>
      )}
    </div>
  );
}
