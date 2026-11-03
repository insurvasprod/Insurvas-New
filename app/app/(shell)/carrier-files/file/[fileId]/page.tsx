import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay, type CarrierFileType } from "@/lib/ingestion/constants";
import { clearlyBetter } from "@/lib/ingestion/fileCheck";
import { checkCarrierFile } from "@/lib/ingestion/fileCheckStore";
import { loadFileCommissions, loadFileHead, loadFileNeeds, loadFileRows, loadNotInFile, type FileHead, type FileRows, type RowView } from "@/lib/ingestion/fileOutcomeStore";
import { CHANGE_FIELD_LABELS, ROW_OUTCOME_LABELS, ROW_OUTCOME_TONES, changeValue, linkMethodLabel, needsCount, policyHref } from "@/lib/ingestion/fileStages";
import { isRecordUuid } from "@/lib/ingestion/path";
import { libraryCarriers } from "@/lib/ingestion/registry";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { pdfBalanceReview } from "@/lib/ingestion/rawLayer";
import { loadFileTrace } from "@/lib/ingestion/traceStore";
import { FileFrame, type FileTab } from "@/components/app/book/files/file-frame";
import { OutcomeFilter } from "@/components/app/book/files/outcome-filter";
import { StageStripLarge } from "@/components/app/book/files/stage-strip";
import { CarrierFileAttribute } from "@/components/app/carrier-file-attribute";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PdfBalanceReview } from "@/components/app/pdf-balance-review";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book of business › Files › a file (LA-4.20, Notion sprint; round 2, owner 2026-11-02): one carrier file
 * as a detail page. Overview (the eight stages, what happened in numbers, what it left for a person; a
 * file that stopped shows why, the PDF's balance and "Who sent this?") · Rows (every row with its outcome,
 * filtered, exported; "as sent" one click away) · Changes (each field it changed, and the policies the
 * previous file had and this one doesn't) · Commissions (the balance and every line against what was
 * expected) · Whole file (its own address). Owner and bookkeeper. Opening it writes nothing.
 */
const PAGE_SIZE = 25;
/** The Overview lists the first few of what a file waits on; the rest are one link away in Needs you. */
const NEEDS_SHOWN = 10;
const cents = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (value: number) => value.toLocaleString("en-US");
const link = "font-semibold text-[var(--accent-ink)] hover:underline";

type Search = { tab?: string; page?: string; outcome?: string; view?: string; q?: string; show?: string };

export default async function CarrierFilePage({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: Promise<Search> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId } = await params;
  if (!isRecordUuid(fileId)) notFound();
  const search = await searchParams;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [head, carriers] = await Promise.all([loadFileHead(tenantId, fileId), libraryCarriers()]);
  if (!head) notFound();
  const tab: FileTab = search.tab === "rows" || search.tab === "changes" || search.tab === "commissions" ? search.tab : "overview";
  const rows = tab === "commissions" && head.fileType === "commissions" ? null : await loadFileRows(tenantId, fileId);
  const changed = rows ? rows.rows.reduce((sum, row) => sum + row.changes.length, 0) : null;

  const body = tab === "rows" ? await RowsTab({ tenantId, head, rows, search })
    : tab === "changes" ? await ChangesTab({ tenantId, head, rows, search })
      : tab === "commissions" ? await CommissionsTab({ tenantId, head, search })
        : await OverviewTab({ tenantId, head, rows, carriers, readOnly });

  return (
    <FileFrame head={head} tab={tab} counts={{ rows: head.rowCount, changes: head.status === "parsed" && head.fileType !== "commissions" ? changed : null }} readOnly={readOnly}>
      {body}
    </FileFrame>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────────────────────────

function sentence(head: FileHead, rows: FileRows | null): string {
  const failed = head.stages.find((s) => s.state === "failed");
  if (failed) return `It stopped at ${failed.name}: ${failed.note}`;
  const layout = head.stages[1];
  if (layout.state === "needs") return layout.note + ".";
  if (head.rowCount === null || !rows) return head.status === "parsing" ? "Reading it now." : "Waiting to be read.";
  const total = head.rowCount;
  const waiting = rows.counts.needs_you + rows.counts.held;
  if (head.fileType === "commissions") {
    const posted = rows.counts.commission;
    return `${n(posted)} of ${n(total)} rows posted to the ledger.${waiting ? ` ${n(waiting)} wait for you; the rest are done.` : ""}`;
  }
  const still = head.stages.some((s) => s.state === "pending") ? " The later steps are still going." : "";
  const linkedStage = head.stages[4];
  const why = linkedStage.state === "needs" ? ` (${linkedStage.note.replace(/^Waiting for you: /, "")})` : "";
  return `${n(rows.linked)} of ${n(total)} linked${rows.linked ? `: ${methods(rows.linkMethods)}` : ""}. ${waiting ? `${n(waiting)} ${waiting === 1 ? "row waits" : "rows wait"} for you${why}; the other ${n(total - waiting)} are done.` : "Nothing waits for you."}${still}`;
}

/** "1 by submission number, 395 to a new client from the row": how the rows got their client. */
function methods(byMethod: Record<string, number>): string {
  return Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([method, count]) => `${n(count)} ${linkMethodLabel(method).replace(/^./, (c) => c.toLowerCase())}`).join(", ");
}

async function OverviewTab({ tenantId, head, rows, carriers, readOnly }: { tenantId: string; head: FileHead; rows: FileRows | null; carriers: Awaited<ReturnType<typeof libraryCarriers>>; readOnly: boolean }) {
  const base = fileHref(head.id);
  const failed = head.status === "failed";
  // LA-4.4: a PDF statement the balance gate refused, read again for review (writes nothing).
  const balance = head.fileKind === "pdf" && failed ? await pdfBalanceReview(tenantId, head.id) : null;
  // Owner request 2026-10-14 · the file checker only SUGGESTS: a person confirms who sent a file that came
  // without a carrier ("Who sent this?"); a layout that missed a required column names the layout that fits.
  const needsCarrier = failed && !head.carrierId;
  const missedColumn = failed && Boolean(head.carrierId) && /required column/i.test(head.errorDetail ?? "");
  const check = needsCarrier || missedColumn ? await checkCarrierFile(tenantId, head.id).catch(() => null) : null;
  const better = missedColumn && check ? clearlyBetter(check, check.currentLayoutKey) : null;
  const [notIn, commissions] = await Promise.all([
    head.fileType !== "commissions" ? loadNotInFile(tenantId, head) : null,
    head.fileType === "commissions" ? loadFileCommissions(tenantId, head.id) : null,
  ]);
  const needs = await loadFileNeeds(tenantId, head, rows, commissions);
  const rowsHref = (outcome: string) => `${base}?tab=rows&outcome=${outcome}`;
  const tile = (label: string, value: number, href: string, warn = false) => (
    <StatTile key={label} label={label} value={n(value)} valueTone={warn && value > 0 ? "warning" : undefined} footnote={<Link href={href} className={link}>See rows ›</Link>} />
  );

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <StageStripLarge stages={head.stages} focus={head.stages.find((s) => s.state === "failed" || s.state === "needs")?.name ?? null} />
          <p className="m-0 px-1 text-sm text-foreground">{sentence(head, rows)}</p>
        </CardContent>
      </Card>

      {failed && head.errorDetail && !needsCarrier && (
        <Callout tone="error" title={head.fileType === "commissions" ? "The statement stopped here. Nothing from it was posted." : "This file stopped here. Nothing from it was read into your book."}>
          {head.errorDetail}{" "}
          {better && <>These columns match {better.name}{better.carriers.length ? ` (used by ${better.carriers.map((carrier) => carrier.name).join(", ")})` : ""}. Check the file&apos;s carrier and type. </>}
          {!readOnly && head.carrierId && "Replace it with a corrected file, or read it again once its layout is fixed."}
        </Callout>
      )}
      {head.unfinished && <Callout tone="warning" title={`Not finished: the ${head.unfinished.stage} step failed.`}>{head.unfinished.error ? `${head.unfinished.error} ` : ""}Read again finishes it.</Callout>}

      {needsCarrier && (
        <CarrierFileAttribute
          fileId={head.id}
          readOnly={readOnly}
          carriers={carriers}
          suggestions={(check?.matches ?? []).map((match) => ({ layoutKey: match.layoutKey, layoutName: match.name, fileType: match.fileType, carriers: match.carriers, carrierId: match.carrierId, fit: match.fit, matched: match.matched, total: match.total, missingRequired: match.missingRequired, pdfRows: match.pdfRows }))}
          initial={{
            carrierId: check?.matches[0]?.carrierId ?? check?.fromName.carrierId ?? null,
            fileType: check?.matches[0]?.fileType ?? check?.fromName.fileType ?? (head.fileType as CarrierFileType | null) ?? null,
            fileDate: head.fileDate ?? check?.fromName.fileDate ?? null,
          }}
        />
      )}

      {balance && <PdfBalanceReview check={balance} />}

      {rows && head.rowCount !== null && head.status !== "failed" && (
        head.fileType === "commissions" && commissions ? (
          <StatStrip label="What this file did">
            {tile("Lines posted", rows.counts.commission, rowsHref("commission"))}
            <StatTile label="Need you" value={n(commissions.needsYou)} valueTone={commissions.needsYou ? "warning" : undefined} footnote={<Link href={`${base}?tab=commissions&show=needs`} className={link}>See lines ›</Link>} />
            <StatTile label="Waiting for the policy" value={n(commissions.waiting)} footnote={<Link href={`${base}?tab=commissions&show=waiting`} className={link}>See lines ›</Link>} />
            <StatTile label="Account lines" value={n(commissions.groups.filter((g) => g.account).length)} footnote={<Link href={`${base}?tab=commissions&show=account`} className={link}>See lines ›</Link>} />
            {tile("Not read", rows.counts.not_read + rows.counts.held, rowsHref("not_read"))}
          </StatStrip>
        ) : (
          <StatStrip label="What this file did">
            <StatTile label="Linked" value={n(rows.linked)} footnote={<>{rows.linked ? `${methods(rows.linkMethods)} · ` : ""}<Link href={rowsHref("linked")} className={link}>See rows ›</Link></>} />
            {tile("New policies", rows.counts.new, rowsHref("new"))}
            {tile("Changed", rows.counts.changed, rowsHref("changed"))}
            {tile("No change", rows.counts.no_change, rowsHref("no_change"))}
            {tile("Cards moved", rows.cardsMoved, rowsHref("moved"))}
            {tile("Need you", rows.counts.needs_you + rows.counts.held, rowsHref("needs_you"), true)}
            <StatTile label="Not in this file" value={n(notIn?.policies.length ?? 0)} valueTone={notIn?.policies.length ? "warning" : undefined} footnote={<Link href={`${base}?tab=changes`} className={link}>{notIn?.comparedWith ? "See policies ›" : "No earlier file"}</Link>} />
          </StatStrip>
        )
      )}

      {needs.length > 0 && (
        // One figure for what this file waits on: the strip's (the chip's) count; a commission file's money items.
        <TableCard title={`This file needs you for ${n(needsCount(head.stages) || needs.length)}`} action={<Button asChild variant="outline" size="sm"><Link href={`/app/needs-you?file=${head.id}`}>Open all in Needs you ›</Link></Button>}>
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th className="w-[200px]">Kind</th><th>About</th><th className="w-[120px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {needs.slice(0, NEEDS_SHOWN).map((item) => (
                <tr key={item.key}>
                  <td><StatusChip tone={item.tone}>{item.kind}</StatusChip></td>
                  <td><span className="block font-semibold text-foreground">{item.about}</span><span className="block text-xs text-muted-foreground">{item.why}</span></td>
                  <td className="text-right">{item.href ? <Button asChild variant="outline" size="sm"><Link href={item.href}>Open</Link></Button> : <span className="text-xs text-muted-foreground">Waiting on {item.waitingOn}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {needs.length > NEEDS_SHOWN && <p className="m-0 border-t border-border px-4 py-3 text-sm"><Link href={`/app/needs-you?file=${head.id}`} className={link}>See all {n(needs.length)} in Needs you ›</Link></p>}
        </TableCard>
      )}
    </>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────────────────────────

const ROW_FILTERS: Array<{ key: string; label: string; warn?: boolean; test: (row: RowView) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "needs_you", label: "Need you", warn: true, test: (row) => row.outcome === "needs_you" || row.outcome === "held" },
  { key: "changed", label: "Changed", test: (row) => row.outcome === "changed" },
  { key: "new", label: "New", test: (row) => row.outcome === "new" },
  { key: "no_change", label: "No change", test: (row) => row.outcome === "no_change" },
  { key: "held", label: "Held", warn: true, test: (row) => row.outcome === "held" },
  { key: "moved", label: "Moved a card", test: (row) => row.card !== null },
  { key: "linked", label: "Linked", test: (row) => row.linkedBy !== null && row.linkedBy !== "Waits for you" },
  { key: "commission", label: "Posted", test: (row) => row.outcome === "commission" },
  { key: "not_read", label: "Not read", test: (row) => row.outcome === "not_read" || row.outcome === "held" },
];

function whatChanged(row: RowView): string {
  if (row.outcome === "changed") return row.changes.map((c) => `${CHANGE_FIELD_LABELS[c.field] ?? c.field} ${changeValue(c.field, c.from)} → ${changeValue(c.field, c.to)}`).join(" · ");
  if (row.outcome === "commission") return row.lines.map((l) => `${l.type.replaceAll("_", " ")} ${cents(l.amountCents)}`).join(" · ");
  return row.what;
}

async function RowsTab({ tenantId, head, rows, search }: { tenantId: string; head: FileHead; rows: FileRows | null; search: Search }) {
  const base = fileHref(head.id);
  if (search.view === "sent") return SentRows({ tenantId, head, page: Number(search.page) || 1 });
  const all = rows?.rows ?? [];
  const filters = ROW_FILTERS.filter((f) => f.key === "all" || f.key === search.outcome || all.some(f.test))
    .filter((f) => head.fileType === "commissions" ? !["changed", "new", "no_change", "moved", "linked"].includes(f.key) : f.key !== "commission");
  const active = filters.find((f) => f.key === search.outcome) ?? filters[0];
  const needle = (search.q ?? "").trim().toLowerCase();
  const shown = all.filter((row) => active.test(row) && (!needle || `${row.policyNumber ?? ""} ${row.clientName ?? ""} ${row.rowNumber}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(search.page) || 1), pages);
  const slice = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const query = (outcome: string) => `${base}?tab=rows${outcome !== "all" ? `&outcome=${outcome}` : ""}${needle ? `&q=${encodeURIComponent(needle)}` : ""}`;
  const exportHref = `/api/app/carrier-files/rows-export?file=${head.id}${active.key !== "all" && active.key !== "moved" && active.key !== "linked" ? `&outcome=${active.key}` : ""}`;

  return (
    <TableCard
      toolbar={head.rowCount !== null ? (
        <div className="flex w-full flex-col gap-3">
          <OutcomeFilter value={active.key} options={filters.map((f) => ({ key: f.key, label: f.label, warn: f.warn, count: all.filter(f.test).length, href: query(f.key) }))} />
          <div className="flex w-full flex-wrap items-center gap-2">
            <form method="get" action={base} className="flex items-center gap-2">
              <input type="hidden" name="tab" value="rows" />
              {active.key !== "all" && <input type="hidden" name="outcome" value={active.key} />}
              <label className="sr-only" htmlFor="row-search">Policy or client</label>
              <input id="row-search" name="q" defaultValue={search.q ?? ""} placeholder="Policy or client" className={`${toolbarControl} w-56`} />
              <Button type="submit" variant="outline">Search</Button>
            </form>
            <span className="ml-auto flex items-center gap-2">
              <Button asChild variant="outline"><Link href={`${base}?tab=rows&view=sent`}>See rows as sent</Link></Button>
              <Button asChild variant="outline"><a href={exportHref} download>Export rows</a></Button>
            </span>
          </div>
        </div>
      ) : undefined}
      footer={shown.length ? <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} noun="rows" pageHref={query(active.key)} /> : undefined}
    >
      {head.rowCount === null ? <EmptyState title="No rows kept yet" hint={head.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout: its rows are kept once one is published." : "The rows are kept once the file is read."} />
        : shown.length === 0 ? <EmptyState title="No row matches" hint="Choose another outcome, or clear the search." /> : (
          <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[72px] text-right">Row</th>
                <th className="w-[190px]">Policy</th>
                <th className="w-[120px]">Outcome</th>
                <th>What changed</th>
                <th className="w-[170px]">Linked</th>
                <th className="w-[190px]">Card</th>
                <th className="w-[80px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.rowNumber}>
                  <td className="text-right tabular-nums text-muted-foreground">{row.rowNumber}</td>
                  <td>
                    {row.policyNumber && head.carrierId && row.outcome !== "commission"
                      ? <Link href={policyHref(head.carrierId, row.policyNumber)} className="block truncate font-semibold text-foreground hover:underline">{row.policyNumber}</Link>
                      : <span className="block truncate font-semibold text-foreground">{row.policyNumber ?? "—"}</span>}
                    <span className="block truncate text-xs text-muted-foreground">{row.clientName ?? (row.policyNumber ? "No client yet" : "")}</span>
                  </td>
                  <td><StatusChip tone={ROW_OUTCOME_TONES[row.outcome]}>{ROW_OUTCOME_LABELS[row.outcome]}</StatusChip></td>
                  <td><span className="block whitespace-normal break-words leading-snug">{whatChanged(row)}</span></td>
                  <td className={row.reviewId ? "text-[var(--warning-ink)]" : "text-muted-foreground"}>{row.reviewId ? row.what : row.linkedBy ?? "—"}</td>
                  <td className="text-muted-foreground">{row.card ? `${row.card.from ?? "—"} → ${row.card.to}` : row.outcome === "needs_you" || row.outcome === "held" ? "Waits" : "—"}</td>
                  <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={rowHref(head.id, row.rowNumber)} aria-label={`Open row ${row.rowNumber}`}>Open</Link></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}

/** The rows exactly as the carrier sent them: every column, scrolled sideways (the page before round 2). */
async function SentRows({ tenantId, head, page }: { tenantId: string; head: FileHead; page: number }) {
  const file = await loadFileTrace(tenantId, head.id, page);
  if (!file) notFound();
  const base = fileHref(head.id);
  return (
    <TableCard
      title="Rows as sent"
      description={file.rowCount ? `Every column as the carrier sent it (${file.columnCount}), scroll sideways for more.` : undefined}
      action={<Button asChild variant="outline" size="sm"><Link href={`${base}?tab=rows`}>Back to outcomes</Link></Button>}
      footer={file.rowCount ? <Pager page={file.page} pageSize={file.pageSize} total={file.rowCount} noun="rows" pageHref={`${base}?tab=rows&view=sent`} /> : undefined}
    >
      {file.rows.length === 0 ? <EmptyState title="No rows kept" hint={file.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout: its rows are kept once one is published." : "The rows are kept once the file is read."} /> : (
        <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] w-[76px] bg-[var(--surface-alt)] text-right">Row</th>
              {file.headers.map((h) => <th key={h} className="max-w-[180px] truncate" title={h}>{h}</th>)}
              <th className="w-[200px]">Became</th>
            </tr>
          </thead>
          <tbody>
            {file.rows.map((r) => (
              <tr key={r.rowNumber} className="group">
                <td className="sticky left-0 z-[1] bg-[var(--surface)] text-right group-hover:bg-[var(--surface-alt)]">
                  <Link href={rowHref(file.id, r.rowNumber)} className={`${link} tabular-nums`} aria-label={`Open row ${r.rowNumber}`}>{r.rowNumber}</Link>
                </td>
                {r.preview.map((v, i) => <td key={i} className="max-w-[180px] truncate font-mono text-xs" title={v}>{v === "" ? <span className="font-sans text-muted-foreground">—</span> : v}</td>)}
                <td className="text-xs">{r.produced ? <StatusChip tone={r.produced.startsWith("Policy") ? "good" : "info"}>{r.produced}</StatusChip> : <StatusChip tone="neutral">Held, or not read</StatusChip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

// ─── Changes ────────────────────────────────────────────────────────────────────────────────────

async function ChangesTab({ tenantId, head, rows, search }: { tenantId: string; head: FileHead; rows: FileRows | null; search: Search }) {
  const base = fileHref(head.id);
  if (head.fileType === "commissions") return <TableCard><EmptyState title="A commission file changes no policy" hint="Its lines are on the Commissions tab." /></TableCard>;
  const notIn = await loadNotInFile(tenantId, head);
  const changes = (rows?.rows ?? []).flatMap((row) => row.changes.map((c, i) => ({ key: `${row.rowNumber}-${i}`, row, ...c })));
  const news = (rows?.rows ?? []).filter((row) => row.outcome === "new");
  const list = [...changes.map((c) => ({ key: c.key, row: c.row, field: CHANGE_FIELD_LABELS[c.field] ?? c.field, from: changeValue(c.field, c.from), to: changeValue(c.field, c.to), isNew: false })), ...news.map((row) => ({ key: `new-${row.rowNumber}`, row, field: "—", from: "", to: "New", isNew: true }))];
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(search.page) || 1), pages);
  const carrierId = head.carrierId;

  return (
    <>
      <Callout tone="info" title="A policy left out of a newer file is never lapsed on its own.">It is watched: the carrier&apos;s next file, or a person, says what happened to it.</Callout>
      <TableCard
        title={`Not in this file · ${n(notIn.policies.length)}`}
        description={notIn.comparedWith ? `Compared with the previous file, ${notIn.comparedWith.name} of ${fileDay(notIn.comparedWith.fileDate)}.` : "There is no earlier file of this carrier and type to compare with."}
        action={notIn.comparedWith ? <Button asChild variant="outline" size="sm"><Link href={fileHref(notIn.comparedWith.id)}>Open the previous file</Link></Button> : undefined}
      >
        {notIn.policies.length === 0 ? <EmptyState title={notIn.comparedWith ? "Every policy is still here" : "Nothing to compare with"} hint={notIn.comparedWith ? "Each policy in the previous file is in this one too." : "The next file of this carrier and type is compared with this one."} /> : (
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Policy</th><th className="w-[220px]">Last seen</th><th className="w-[160px]">What happens</th><th className="w-[90px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {notIn.policies.slice(0, 200).map((p) => (
                <tr key={p.policyNumber}>
                  <td><span className="block font-semibold text-foreground">{p.policyNumber}</span><span className="block text-xs text-muted-foreground">{p.clientName ?? "No client yet"}</span></td>
                  <td className="text-muted-foreground">{fileDay(p.lastSeen)}{p.lastStatus ? ` · ${p.lastStatus.replaceAll("_", " ")}` : ""}</td>
                  <td><StatusChip tone="neutral">Watched</StatusChip></td>
                  <td className="text-right">{carrierId ? <Button asChild variant="outline" size="sm"><Link href={policyHref(carrierId, p.policyNumber)}>Open</Link></Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {notIn.policies.length > 200 && <p className="m-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">The first 200 of {n(notIn.policies.length)}.</p>}
      </TableCard>

      <TableCard
        title={`Changed · ${n(changes.length)}${news.length ? ` · ${n(news.length)} new` : ""}`}
        action={list.length ? <Button asChild variant="outline" size="sm"><a href={`/api/app/carrier-files/rows-export?file=${head.id}&outcome=changed`} download>Export</a></Button> : undefined}
        footer={list.length > PAGE_SIZE ? <Pager page={page} pageSize={PAGE_SIZE} total={list.length} noun="changes" pageHref={`${base}?tab=changes`} /> : undefined}
      >
        {list.length === 0 ? <EmptyState title="This file changed nothing" hint={head.previous ? "Every policy reads as it did in the previous file." : "The first file of a carrier and type is where each policy's history starts."} /> : (
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[200px]">Policy</th><th className="w-[160px]">Field</th><th>Change</th><th className="w-[110px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => (
                <tr key={c.key}>
                  <td><span className="block font-semibold text-foreground">{c.row.policyNumber}</span><span className="block text-xs text-muted-foreground">{c.row.clientName ?? `Row ${c.row.rowNumber}`}</span></td>
                  <td>{c.field}</td>
                  <td>{c.isNew ? <span className="font-semibold text-foreground">New</span> : <><span className="text-muted-foreground">{c.from}</span> → <span className="font-semibold text-foreground">{c.to}</span></>}</td>
                  <td className="text-right">{carrierId && c.row.policyNumber ? <Button asChild variant="outline" size="sm"><Link href={policyHref(carrierId, c.row.policyNumber, "history")}>History</Link></Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

// ─── Commissions ────────────────────────────────────────────────────────────────────────────────

const SHOW: Record<string, { label: string; test: (g: { result: { tone: string; label: string }; account: boolean }) => boolean }> = {
  all: { label: "All", test: () => true },
  needs: { label: "Need you", test: (g) => g.result.tone === "warning" },
  matches: { label: "Matches", test: (g) => g.result.tone === "good" },
  waiting: { label: "Waiting", test: (g) => g.result.label === "Waits for the policy" },
  account: { label: "Account", test: (g) => g.account },
};

async function CommissionsTab({ tenantId, head, search }: { tenantId: string; head: FileHead; search: Search }) {
  const base = fileHref(head.id);
  if (head.fileType !== "commissions") return <TableCard><EmptyState title="A policy file carries no commission lines" hint="Commission lines arrive in the carrier's commission files; each policy's are on its own page." /></TableCard>;
  const money = await loadFileCommissions(tenantId, head.id);
  if (!money || head.status !== "parsed") return <TableCard><EmptyState title="Nothing posted from this file" hint={head.status === "failed" ? "It stopped before its lines were read: see the Overview." : "Its lines post once it is read."} /></TableCard>;
  const key = search.show && SHOW[search.show] ? search.show : "all";
  const shown = money.groups.filter(SHOW[key].test);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(search.page) || 1), pages);
  const checked = head.fileKind === "pdf";

  return (
    <>
      <StatStrip label="The balance check">
        <StatTile label="Lines add to" value={cents(money.linesCents)} />
        <StatTile label="Statement says" value={checked ? cents(money.linesCents) : "Not stated"} valueSize={checked ? "figure" : "text"} footnote={checked ? "its stated total, checked when read" : "this file states no total"} />
        <StatTile label="Balance" value={checked ? "Matches" : "Not checked"} valueSize="text" footnote={checked ? "a statement that doesn't balance is never posted" : "only a PDF statement states one"} />
        <StatTile label="Posted" value={`${n(money.postedRows)} of ${n(head.rowCount ?? 0)}`} valueSize="text" footnote="rows in the ledger" />
        <StatTile label="Waiting" value={n(money.waiting)} valueTone={money.waiting ? "warning" : undefined} footnote="lines whose policy no file has yet" />
      </StatStrip>
      <TableCard
        title={`Lines · ${n(money.groups.reduce((sum, g) => sum + g.lines, 0))}`}
        toolbar={<OutcomeFilter value={key} options={Object.entries(SHOW).map(([k, s]) => ({ key: k, label: s.label, warn: k === "needs", count: money.groups.filter(s.test).length, href: `${base}?tab=commissions${k === "all" ? "" : `&show=${k}`}` }))} />}
        footer={shown.length > PAGE_SIZE ? <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} noun="policies" pageHref={`${base}?tab=commissions${key === "all" ? "" : `&show=${key}`}`} /> : undefined}
      >
        {shown.length === 0 ? <EmptyState title="No line here" hint="Choose another filter." /> : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th className="w-[200px]">Policy</th><th className="w-[170px]">Line</th><th className="w-[110px] text-right">Paid</th><th className="w-[110px] text-right">Expected</th><th>Result</th><th className="w-[80px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((g) => (
                <tr key={g.key}>
                  <td>
                    {g.account ? <span className="block font-semibold text-foreground">Account line</span>
                      : head.carrierId && g.policyNumber ? <Link href={policyHref(head.carrierId, g.policyNumber, "commissions")} className="block font-semibold text-foreground hover:underline">{g.policyNumber}</Link> : <span className="block font-semibold">{g.policyNumber}</span>}
                    <span className="block truncate text-xs text-muted-foreground">{g.account ? g.description ?? "The carrier's own account" : g.clientName ?? "Policy not seen yet"}</span>
                  </td>
                  <td className="capitalize">{g.types.join(", ")}{g.lines > 1 ? ` ×${g.lines}` : ""}</td>
                  <td className="text-right tabular-nums">{cents(g.paidCents)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{g.expectedCents === null ? "—" : cents(g.expectedCents)}</td>
                  <td><StatusChip tone={g.result.tone}>{g.result.label}</StatusChip></td>
                  <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={rowHref(head.id, g.rowNumber)} aria-label={`Open row ${g.rowNumber}`}>Open</Link></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
