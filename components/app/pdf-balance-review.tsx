import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { dollars, type BalanceCheck } from "@/lib/ingestion/pdfLayout";

const money = (cents: number | null) => (cents === null ? "not found" : dollars(cents));

/**
 * LA-4.4 · a PDF statement the balance gate refused, laid out for a person: the arithmetic first
 * (the lines' sum against the statement's own total; opening + activity against closing), then
 * every line the layout read. A difference with no line to explain it is a missed or misread line.
 * Nothing here is written anywhere.
 */
export function PdfBalanceReview({ check }: { check: BalanceCheck }) {
  const [header, ...rows] = check.grid;
  const sums: Array<{ label: string; left: string; right: string; diff: number | null }> = [];
  if (check.totalCents !== null || check.linesCents !== null) {
    sums.push({
      label: "Lines against the statement's total",
      left: `${rows.length} ${rows.length === 1 ? "line" : "lines"} add to ${money(check.linesCents)}`,
      right: `the statement says ${money(check.totalCents)}`,
      diff: check.linesCents !== null && check.totalCents !== null ? check.linesCents - check.totalCents : null,
    });
  }
  if (check.openingCents !== null || check.activityCents !== null || check.closingCents !== null) {
    const both = check.openingCents !== null && check.activityCents !== null;
    sums.push({
      label: "Opening + activity against closing",
      left: `${money(check.openingCents)} + ${money(check.activityCents)}${both ? ` = ${dollars(check.openingCents! + check.activityCents!)}` : ""}`,
      right: `closing ${money(check.closingCents)}`,
      diff: both && check.closingCents !== null ? check.openingCents! + check.activityCents! - check.closingCents : null,
    });
  }
  return (
    <PagedTableCard total={rows.length} noun="lines" title="Balance check" description="The lines this statement's layout reads, beside its own totals. Nothing from it is written until they agree.">
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[260px_1fr_1fr_160px]">
        {sums.map((sum) => (
          <div key={sum.label} className="contents">
            <dt className="text-muted-foreground">{sum.label}</dt>
            <dd className="m-0 tabular-nums">{sum.left}</dd>
            <dd className="m-0 tabular-nums">{sum.right}</dd>
            <dd className={`m-0 font-semibold tabular-nums ${sum.diff ? "text-[var(--error-ink)]" : "text-muted-foreground"}`}>{sum.diff === null ? "can't check" : sum.diff === 0 ? "agrees" : `off by ${dollars(sum.diff)}`}</dd>
          </div>
        ))}
      </dl>
      {rows.length > 0 && (
        <div className="overflow-x-auto border-t border-border">
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th className="w-[60px] text-right">Line</th>{header.map((name) => <th key={name}>{name}</th>)}</tr></thead>
            <PagedBody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td className="text-right tabular-nums text-muted-foreground">{index + 1}</td>
                  {row.map((cell, at) => <td key={at} className="max-w-[220px] truncate font-mono text-xs" title={cell}>{cell}</td>)}
                </tr>
              ))}
            </PagedBody>
          </table>
        </div>
      )}
    </PagedTableCard>
  );
}
