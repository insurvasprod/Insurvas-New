import Link from "next/link";

import { DashChart, DashChip, DashHero, DashLayout, DashList, DashNeeds, DashTable, type DashItem, type DashTone } from "@/components/app/home/dash/dash-kit";
import { HomePanel } from "@/components/app/home/home-panel";
import { StageStrip } from "@/components/app/book/files/stage-strip";
import { DonutChart, LineSeries, type ChartTone } from "@/components/ui/chart";
import { fileTypeWord, loadBookView, monthRange, shortDay, type ChangeItem } from "@/lib/dashboard/views/book";
import type { DashViewProps } from "@/components/app/home/views/view-props";

/**
 * The dashboard's Book of business view (owner 2026-11-06, /app/dashboard?view=book): what the carrier files
 * left for a person, the policies issued each month with the lapses beside them, the book by carrier, this
 * week's files and where each one is, where the book stands, the book's size, and what the files changed lately.
 * Every figure is the one its own page reads (lib/dashboard/views/book.ts) and opens that page, filtered.
 */
/** One figure for the Overview's "Your modules". */
export function bookHeadline(data: Awaited<ReturnType<typeof loadBookView>>): { figure: string; line: string } | null {
  const book = data.book;
  if (!book) return null;
  return data.money
    ? { figure: `$${Math.round(book.totals.annualCents / 100).toLocaleString("en-US")}`, line: `a year · ${book.totals.inForce.toLocaleString("en-US")} in force` }
    : { figure: book.totals.inForce.toLocaleString("en-US"), line: "policies in force" };
}

/** The "Policies issued" chart (with lapses beside it), drawn by this view and by the Overview. */
export function bookIssuedChart(data: Awaited<ReturnType<typeof loadBookView>>) {
  const { book, links } = data;
  const n = (value: number) => value.toLocaleString("en-US");
  // Big: policies issued by month, lapses beside them; a month opens the policies issued in it.
  const issuedTotal = book ? book.issued.reduce((sum, point) => sum + point.value, 0) : 0;
  const first = book?.issued[0];
  const last = book?.issued[book.issued.length - 1];
  const windowHref = first && last ? `/app/policies?from=${monthRange(first.key).from}&to=${monthRange(last.key).to}` : "/app/policies";
  const big = book && links.policies ? (
    <DashChart
      title="Policies issued"
      link={{ label: "Policies", href: windowHref }}
      total={n(issuedTotal)}
      totalLine={`issued · last ${book.issued.length} months`}
      legend={book.lapsed ? [{ label: "Issued", tone: "primary" }, { label: "Lapsed", tone: "info" }] : undefined}
    >
      <LineSeries
        points={book.issued}
        compare={book.lapsed ? { points: book.lapsed, label: "Lapsed" } : undefined}
        summary={`Policies issued each month over the last ${book.issued.length} months${book.lapsed ? ", with the policies a carrier file moved to lapsed" : ""}.`}
        unit="policies"
        minHeight={200}
        hrefFor={(point) => {
          const range = monthRange(point.key);
          return `/app/policies?from=${range.from}&to=${range.to}`;
        }}
      />
    </DashChart>
  ) : null;
  return big;
}

export async function BookView(props: DashViewProps) {
  const data = await loadBookView(props);
  const { book, links, money } = data;
  const n = (value: number) => value.toLocaleString("en-US");
  const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

  const big = bookIssuedChart(data);

  // Side: the book in force by carrier, premium for the money roles, else how many; each carrier opens its policies.
  const tones: ChartTone[] = ["strong", "mid", "soft", "faint", "quiet"];
  const side = book && links.policies ? (
    <HomePanel
      title={money ? "Premium by carrier" : "Policies by carrier"}
      period="in force"
      link={{ label: "Policies", href: "/app/policies?show=inforce" }}
    >
      {book.shares.length ? (
        <DonutChart
          segments={book.shares.map((share, index) => ({ key: share.key, label: share.label, value: share.value, tone: tones[Math.min(index, tones.length - 1)], href: share.href }))}
          summary={money ? "Annual premium in force, by carrier." : "Policies in force, by carrier."}
          centerValue={money ? dollars(book.totals.annualCents) : n(book.totals.inForce)}
          centerLabel={money ? "a year" : "in force"}
          format={money ? dollars : n}
          className="lg:flex-row lg:items-center"
        />
      ) : <p className="m-0 text-sm text-muted-foreground">No policy is in force yet.</p>}
    </HomePanel>
  ) : null;

  // Left: this week's carrier files, each with its stages and where it is; each opens its own page.
  const left = data.files && links.files ? (
    <HomePanel title="Carrier files" period="this week" link={{ label: "Carrier files", href: links.files }}>
      {data.files.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No file arrived this week.</p> : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col flex-wrap content-start gap-2 overflow-hidden p-0 [&>li]:w-full">
          {data.files.map((file) => (
            <li key={file.id}>
              <Link href={file.href} className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-[var(--surface-tile)] shadow-[inset_0_0_0_1px_var(--tile-edge)] px-3 py-2.5 text-foreground no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-tile))]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{file.carrierName ?? "Carrier not known"} · {fileTypeWord(file.fileType)}</span>
                  {file.where && <DashChip tone={file.where.tone as DashTone}>{file.where.label}</DashChip>}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  {file.stages && <StageStrip stages={file.stages} fileType={file.fileType} reading={file.reading} />}
                  <span className="ml-auto shrink-0 tabular-nums">{file.fileDate ? `for ${shortDay(file.fileDate)}` : shortDay(file.receivedAt.slice(0, 10))}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  ) : null;

  // Right: where the book stands; each state opens the Policies list on it (charged back opens the ledger's lines).
  const right = book && links.policies ? (
    <DashTable
      title="Where the book stands"
      link={{ label: "Policies", href: "/app/policies" }}
      heads={money ? ["Status", "Policies", "Annual premium"] : ["Status", "Policies"]}
      rows={book.standing.map((row) => ({ key: row.key, cells: money ? [row.label, n(row.count), dollars(row.annualCents)] : [row.label, n(row.count)], href: row.href }))}
    />
  ) : null;

  // Hero: the book, policies in force and what they bring in a year.
  const hero = book && links.policies ? (
    money ? (
      <DashHero
        kicker="THE BOOK"
        value={dollars(book.totals.annualCents)}
        line={`a year · ${n(book.totals.inForce)} ${book.totals.inForce === 1 ? "policy" : "policies"} in force`}
        facts={[{ label: "A month", value: dollars(book.totals.annualCents / 12) }, { label: "All policies", value: n(book.totals.all) }]}
        href="/app/policies?show=inforce"
      />
    ) : (
      <DashHero kicker="THE BOOK" value={n(book.totals.inForce)} line="policies in force" facts={[{ label: "All policies", value: n(book.totals.all) }]} href="/app/policies?show=inforce" />
    )
  ) : null;

  // List: what the carrier files changed lately; each opens that policy's history.
  const MARK: Record<ChangeItem["kind"], { mark: string; tone: DashTone }> = {
    issued: { mark: "✓", tone: "good" },
    lapsed: { mark: "!", tone: "danger" },
    status: { mark: "↻", tone: "info" },
    draft: { mark: "◷", tone: "warning" },
  };
  const list = data.changes && links.changes ? (
    <DashList
      title="Recent changes"
      period="from the carrier files"
      link={{ label: "All changes", href: links.changes }}
      items={data.changes.map((change): DashItem => ({ key: change.key, mark: MARK[change.kind].mark, tone: MARK[change.kind].tone, title: change.title, detail: change.detail, when: change.when, href: change.href }))}
      empty="No policy has changed yet."
    />
  ) : null;

  return (
    <DashLayout
      needs={<DashNeeds items={data.needs} />}
      big={big}
      side={side}
      left={left}
      right={right}
      hero={hero}
      list={list}
    />
  );
}
