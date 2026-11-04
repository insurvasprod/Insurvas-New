import Link from "next/link";
import { notFound } from "next/navigation";
import { listRuns } from "@/lib/ingestion/dailyRunStore";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay, type CarrierFileType } from "@/lib/ingestion/constants";
import { clearlyBetter } from "@/lib/ingestion/fileCheck";
import { checkCarrierFile } from "@/lib/ingestion/fileCheckStore";
import { loadFileCommissions, loadFileHead, loadFileNeeds, loadFileRows, loadNotInFile, type FileHead, type FileRows, type RowView } from "@/lib/ingestion/fileOutcomeStore";
import { CHANGE_FIELD_LABELS, ROW_OUTCOME_LABELS, ROW_OUTCOME_TONES, changeValue, needsCount, policyHref } from "@/lib/ingestion/fileStages";
import { isNeedsYouKind, KIND_META, QUEUE_KIND, type NeedsYouKind } from "@/lib/needsYou/kinds";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { pdfBalanceReview } from "@/lib/ingestion/rawLayer";
import { loadFileTrace } from "@/lib/ingestion/traceStore";
import { FileFrame, fileTabsOf, type FileTab } from "@/components/app/book/files/file-frame";
import { FileRowsTable, type FileRowLine } from "@/components/app/book/files/file-rows";
import { FileRuns } from "@/components/app/book/files/file-runs";
import { FileWaiting, type WaitingPart } from "@/components/app/book/files/file-work";
import { OutcomeFilter, RemoveChip } from "@/components/app/book/files/outcome-filter";
import { StageRow } from "@/components/app/book/files/stage-strip";
import { CarrierFileAttribute } from "@/components/app/carrier-file-attribute";
import { FileReread } from "@/components/app/book/files/file-reread";
import { RowToolbar } from "@/components/app/book/files/row-toolbar";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PdfBalanceReview } from "@/components/app/pdf-balance-review";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Pager } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book of business › Files › a file (LA-4.20, Notion sprint; round 2, owner 2026-11-02): one carrier file
 * as a detail page. Overview (the eight stages, what happened in numbers, what it left for a person; a
 * file that stopped shows why, the PDF's balance and "Who sent this?") · Rows (every row with its outcome,
 * filtered, exported; the whole file "As sent" one click away, at its own address) · Changes on a policy
 * file (the policies the previous file had and this one doesn't, and each field it changed) · Commissions
 * on a commission file (the balance and every line against what was expected). Owner and bookkeeper.
 * Opening it writes nothing.
 *
 * Round 4 (owner 2026-11-02): Overview and Rows are one page — stages, what the file waits on grouped by kind
 * (each with its way through, decided in place), then the rows — so an agent fixes a row where it is listed.
 *
 * Round 3 (owner 2026-11-02, docs/la4/POLISH-ROUND3.md), compact: the stages are one slim row with no card
 * and no sentence, the figures one StatStrip whose tiles are the links, what the file needs is 10 rows then
 * "See all N", and no explainer card — a stopped file is one line with its one action.
 */
/** The most "Not in this file" policies listed (the rest are counted in its footer). */
const NOT_IN_SHOWN = 200;
const cents = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (value: number) => value.toLocaleString("en-US");
const link = "font-semibold text-[var(--accent-ink)] hover:underline";

const PAGE_SIZE = 25;

type Search = { tab?: string; page?: string; outcome?: string; view?: string; q?: string; show?: string; kind?: string; open?: string };

export default async function CarrierFilePage({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: Promise<Search> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId } = await params;
  if (!isRecordUuid(fileId)) notFound();
  const search = await searchParams;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [head, carriers] = await Promise.all([loadFileHead(tenantId, fileId), fileCarrierChoices(tenantId)]);
  if (!head) notFound();
  // Only the tabs this file has: Changes on a policy file, Commissions on a commission file. Round 4: the
  // Overview is the Rows page (?tab=overview and ?tab=rows land on it).
  const tab: FileTab = fileTabsOf(head).find((key) => key === search.tab) ?? "rows";
  const rows = (tab === "commissions" && head.fileType === "commissions") || tab === "history" ? null : await loadFileRows(tenantId, fileId);
  // Run history (owner 2026-11-02): the runs that took this file, each with its stages.
  const runs = tab === "history" ? await listRuns(tenantId, 50, { fileId }) : null;
  // The Changes tab holds what the previous file had and this one lacks, the field changes and the new
  // policies: its count is all three, so a tab with rows never says 0 (walk 2026-11-02).
  // A new-business file lists only the applications the carrier just took, so nothing is "missing" from it: it is
  // never compared with the full policy file before it (E2E 2026-11-02: a 2-row file read "Changes 71").
  const notIn = head.fileType === "commissions" ? null : head.fileType === "new_business" ? { comparedWith: null, policies: [] } : await loadNotInFile(tenantId, head);
  // The Changes tab's count is what this file changed: each field change and each new policy. "Not in this file"
  // is shown on the tab but watched, not changed, so it isn't counted (owner 2026-11-03).
  const changed = rows && notIn ? rows.rows.reduce((sum, row) => sum + row.changes.length + (row.outcome === "new" ? 1 : 0), 0) : null;

  // Round 4: the file's own runs, one row per step in the stage bar's words (the Files list keeps PipelineRuns).
  const body = tab === "history" && runs ? <FileRuns runs={runs.runs} available={runs.available} fileId={head.id} fileType={head.fileType} />
    : tab === "changes" && notIn ? ChangesTab({ head, rows, notIn, search })
      : tab === "commissions" ? await CommissionsTab({ tenantId, head, search })
        : await FileBody({ tenantId, head, rows, notIn, carriers, readOnly, search });

  return (
    <FileFrame head={head} tenantId={tenantId} tab={tab} more={tab === "rows" && head.rowCount !== null ? rowsMore(head, search) : []} counts={{ rows: head.rowCount, changes: head.status === "parsed" && head.fileType !== "commissions" ? changed : null, history: runs?.available ? runs.runs.length : null }} readOnly={readOnly}>
      {body}
    </FileFrame>
  );
}

// ─── Rows: the file's one page of work (round 4) ────────────────────────────────────────────────

type NotIn = Awaited<ReturnType<typeof loadNotInFile>>;

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

/** The Linked column's short words; the method's full name is the tooltip (MATCH_METHOD_LABELS). */
const LINK_SHORT: Record<string, string> = {
  "By policy number": "By number",
  "By submission number": "By submission",
  "Suggested, then confirmed": "Suggested",
  "Picked by a person": "By a person",
  "From your existing book": "Existing book",
  "To a new client from the row": "New client",
  "Waits for you": "Waits",
};

/** A group's words on the Needs you card: the short line and the full sentence behind it. */
const GROUP_WORDS: Partial<Record<NeedsYouKind, { label: string; why: string; whyFull: string }>> = {
  "no-sale": { label: "No sale yet", why: "A new client was made from each row", whyFull: "No sale has this policy yet: a new client was made from the row. The writing agent confirms it, links an existing client, or links the sale." },
  "pick-client": { label: "Pick the client", why: "More than one sale could be each one", whyFull: "Several sales or applications look like this policy; no single field decides, so a person picks." },
  money: { label: "Money doesn’t match", why: "Paid differs from what was expected", whyFull: "The statement paid a different amount from what the rate card expects for this policy." },
  "status-word": { label: "Status words", why: "Waiting on Insurvas to map them", whyFull: "A status word no carrier has used before holds its rows until Insurvas maps it; they run once it is." },
};

function whatChanged(row: RowView): string {
  if (row.outcome === "changed") return row.changes.map((c) => `${CHANGE_FIELD_LABELS[c.field] ?? c.field} ${changeValue(c.field, c.from)} → ${changeValue(c.field, c.to)}`).join(" · ");
  if (row.outcome === "commission") return row.lines.map((l) => `${l.type.replaceAll("_", " ")} ${cents(l.amountCents)}`).join(" · ");
  if (row.outcome === "new") return row.what.replace(/^New policy( · )?/, "").replace(/^./, (c) => c.toUpperCase()) || "—";
  if (row.outcome === "held" || row.outcome === "not_read") return row.what;
  // Needs you and No change: the chip already says it.
  return "—";
}

/** The Needs you item a row waits on: its match review, or the "policy with no sale" item it raised. */
function itemOf(row: RowView, queueBy: Map<string, { id: string; queueType: string }>): { kind: NeedsYouKind; id: string } | null {
  if (row.reviewId) return { kind: "pick-client", id: row.reviewId };
  const queue = row.outcome === "needs_you" && row.policyNumber ? queueBy.get(row.policyNumber) : undefined;
  const kind = queue ? QUEUE_KIND[queue.queueType as keyof typeof QUEUE_KIND] : undefined;
  return queue && kind ? { kind, id: queue.id } : null;
}

/**
 * A file's page (round 4, owner 2026-11-02: "overview and rows kind of show the same thing … in overview it
 * shouldn't be shown as a table"): one page, no Overview tab. Its stages (the file type's own), what stopped it
 * (to the bell) and "Who sent this?", what it waits on grouped by kind with each group's way through (FileWork),
 * then every row with its outcome — the chips' counts are the figures the Overview had — each waiting row
 * decided under itself. Opening it writes nothing.
 */
async function FileBody({ tenantId, head, rows, notIn, carriers, readOnly, search }: { tenantId: string; head: FileHead; rows: FileRows | null; notIn: NotIn | null; carriers: Awaited<ReturnType<typeof fileCarrierChoices>>; readOnly: boolean; search: Search }) {
  const base = fileHref(head.id);
  if (search.view === "sent") return SentRows({ tenantId, head, page: Number(search.page) || 1 });
  const failed = head.status === "failed";
  // LA-4.4: a PDF statement the balance gate refused, read again for review (writes nothing).
  const balance = head.fileKind === "pdf" && failed ? await pdfBalanceReview(tenantId, head.id) : null;
  // Owner request 2026-10-14 · the file checker only SUGGESTS: a person confirms who sent a file that came
  // without a carrier ("Who sent this?"); a layout that missed a required column names the layout that fits.
  const needsCarrier = failed && !head.carrierId;
  const missedColumn = failed && Boolean(head.carrierId) && /required column/i.test(head.errorDetail ?? "");
  const check = needsCarrier || missedColumn ? await checkCarrierFile(tenantId, head.id).catch(() => null) : null;
  const better = missedColumn && check ? clearlyBetter(check, check.currentLayoutKey) : null;
  const commissions = head.fileType === "commissions" ? await loadFileCommissions(tenantId, head.id) : null;
  const needs = await loadFileNeeds(tenantId, head, rows, commissions);
  // One line for what stopped the file, the most urgent first, with its one action (it goes to the bell).
  const stopped = failed && head.errorDetail && !needsCarrier;
  const replace = !readOnly && head.carrierId && head.fileType ? (
    <CarrierFileUploadButton
      carriers={carriers}
      openWhenDone
      size="sm"
      label="Replace with a corrected file"
      preset={{ carrierId: head.carrierId, fileType: head.fileType as CarrierFileType, fileDate: head.fileDate, agency: head.agency }}
    />
  ) : null;

  // ── what it waits on, grouped ──
  const all = rows?.rows ?? [];
  const queueBy = new Map((rows?.queueItems ?? []).filter((q) => q.policyNumber).map((q) => [q.policyNumber as string, q]));
  const lines = all.map((row) => ({ row, item: itemOf(row, queueBy) }));
  const needsTotal = needsCount(head.stages) || needs.length;
  const byKind = new Map<NeedsYouKind, string[]>();
  for (const { item } of lines) if (item) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.id]);
  // Round 5: what the file waits on is one line with one way through, the Review page; groups and bulk live there.
  const reviewBase = `/app/needs-you/review?file=${head.id}&from=${encodeURIComponent(base)}`;
  const parts: WaitingPart[] = [...byKind.entries()].sort((x, y) => y[1].length - x[1].length).map(([kind, ids]) => ({ label: GROUP_WORDS[kind]?.label ?? KIND_META[kind].label, count: ids.length, href: `${reviewBase}&kind=${kind}` }));
  for (const kind of ["money", "status-word"] as const) {
    const label = KIND_META[kind].label;
    const count = needs.filter((item) => item.kind === label && item.href).length;
    if (count) parts.push({ label: GROUP_WORDS[kind]!.label, count, href: kind === "money" ? `${reviewBase}&kind=money` : null });
  }
  const reviewable = parts.reduce((sum, part) => sum + (part.href ? part.count : 0), 0);

  // ── the rows ──
  const kindFilter = search.kind && isNeedsYouKind(search.kind) ? search.kind : null;
  const filters = ROW_FILTERS.filter((f) => f.key === "all" || f.key === search.outcome || all.some(f.test))
    .filter((f) => head.fileType === "commissions" ? !["changed", "new", "no_change", "moved", "linked"].includes(f.key) : f.key !== "commission");
  const active = filters.find((f) => f.key === search.outcome) ?? filters[0];
  const needle = (search.q ?? "").trim().toLowerCase();
  const shown = lines.filter(({ row, item }) => active.test(row) && (!kindFilter || item?.kind === kindFilter) && (!needle || `${row.policyNumber ?? ""} ${row.clientName ?? ""} ${row.rowNumber}`.toLowerCase().includes(needle)));
  const query = (outcome: string, kind: string | null = kindFilter) => {
    const params = new URLSearchParams();
    if (outcome !== "all") params.set("outcome", outcome);
    if (kind) params.set("kind", kind);
    if (needle) params.set("q", needle);
    const text = params.toString();
    return text ? `${base}?${text}` : base;
  };
  // Every row of the filter goes to the table, which pages it to the window's height (UI-CONSISTENCY §6b).
  const table: FileRowLine[] = shown.map(({ row, item }) => ({
    rowNumber: row.rowNumber,
    policyNumber: row.policyNumber,
    policyHref: row.policyNumber && head.carrierId && row.outcome !== "commission" ? policyHref(head.carrierId, row.policyNumber) : null,
    clientName: row.clientName,
    chip: item?.kind === "pick-client" ? `Pick client${row.reviewChoices ? ` · ${row.reviewChoices}` : ""}` : item?.kind === "no-sale" ? "No sale yet" : ROW_OUTCOME_LABELS[row.outcome],
    chipTitle: row.what,
    tone: ROW_OUTCOME_TONES[row.outcome],
    detail: whatChanged(row),
    linked: row.linkedBy ? LINK_SHORT[row.linkedBy] ?? row.linkedBy : "—",
    linkedTitle: row.linkedBy ?? "Not linked",
    card: row.card ? `${row.card.from ?? "—"} → ${row.card.to}` : row.outcome === "needs_you" || row.outcome === "held" ? "Waits" : "—",
    rowHref: rowHref(head.id, row.rowNumber),
    reviewHref: item ? `${reviewBase}&kind=${item.kind}&id=${encodeURIComponent(item.id)}` : null,
  }));
  const notInCount = notIn?.policies.length ?? 0;

  return (
    <>
      {/* The file type's own stages, one slim track (round 4). */}
      <StageRow stages={head.stages} fileType={head.fileType} focus={head.stages.find((s) => s.state === "failed" || s.state === "needs")?.name ?? null} />

      {stopped ? (
        <Callout
          tone="error"
          title={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {head.fileType === "commissions" ? "Nothing from this statement was posted: " : "Nothing from this file was read into your book: "}{head.errorDetail}
                {better ? ` These columns match ${better.name}${better.carriers.length ? ` (used by ${better.carriers.map((carrier) => carrier.name).join(", ")})` : ""}.` : ""}
                {head.unfinished ? ` The ${head.unfinished.stage} step didn't finish either.` : ""}
              </span>
              {replace}
            </span>
          }
        />
      ) : head.unfinished ? (
        <Callout
          tone="warning"
          title={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Not finished: the {head.unfinished.stage} step failed{head.unfinished.error ? ` (${head.unfinished.error})` : ""}.</span>
              {!readOnly && <FileReread fileId={head.id} />}
            </span>
          }
        />
      ) : null}

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

      <FileWaiting total={needsTotal} parts={parts} reviewHref={reviewable ? reviewBase : null} reviewCount={reviewable} />

      <FileRowsTable
        key={`${active.key}:${kindFilter ?? ""}`}
        pageKey={needle}
        rows={table}
        toolbar={head.rowCount !== null ? (
          // One toolbar row (§6): the search (?q=) and the outcomes (the figures the Overview had), then Not in file and
          // Refresh last; As sent and Export are in More.
          <RowToolbar
            filters={<>
              <OutcomeFilter value={active.key} options={filters.map((f) => ({ key: f.key, label: f.label, warn: f.warn, count: all.filter(f.test).length, href: query(f.key) }))} />
              {kindFilter && <RemoveChip label={GROUP_WORDS[kindFilter]?.label ?? KIND_META[kindFilter].label} href={query(active.key, null)} />}
            </>}
            actions={notInCount > 0 ? <Button asChild variant="outline"><Link href={`${base}?tab=changes`} title="The policies the previous file had and this one doesn't: watched, never lapsed">Not in file<span className="tabular-nums text-[var(--warning-ink)]">{n(notInCount)}</span></Link></Button> : undefined}
          />
        ) : undefined}
        empty={head.rowCount === null ? <EmptyState title="No rows kept yet" hint={head.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout: its rows are kept once one is published." : "The rows are kept once the file is read."} />
          : shown.length === 0 ? <EmptyState title="No row matches" hint="Choose another outcome, or clear the search." /> : undefined}
      />
    </>
  );
}

/**
 * The Rows tab's extras, in the header's More (round 4: the toolbar stays one row): the whole file as the carrier
 * sent it (round 3: was the Whole file tab) and the rows exported, cut to the outcome shown.
 */
function rowsMore(head: FileHead, search: Search): Array<{ label: string; href: string }> {
  const outcome = ROW_FILTERS.find((f) => f.key === search.outcome)?.key ?? "all";
  return [
    { label: "The file as sent", href: `${fileHref(head.id)}/whole` },
    { label: outcome === "all" ? "Export rows" : "Export these rows", href: `/api/app/carrier-files/rows-export?file=${head.id}${outcome !== "all" && outcome !== "moved" && outcome !== "linked" ? `&outcome=${outcome}` : ""}` },
  ];
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
      action={<Button asChild variant="outline" size="sm"><Link href={base}>Back to outcomes</Link></Button>}
      footer={file.rowCount ? <Pager page={file.page} pageSize={file.pageSize} total={file.rowCount} noun="rows" pageHref={`${base}?view=sent`} /> : undefined}
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

function ChangesTab({ head, rows, notIn, search }: { head: FileHead; rows: FileRows | null; notIn: NotIn; search: Search }) {
  const base = fileHref(head.id);
  if (head.fileType === "commissions") return <TableCard><EmptyState title="A commission file changes no policy" hint="Its lines are on the Commissions tab." /></TableCard>;
  const changes = (rows?.rows ?? []).flatMap((row) => row.changes.map((c, i) => ({ key: `${row.rowNumber}-${i}`, row, ...c })));
  const news = (rows?.rows ?? []).filter((row) => row.outcome === "new");
  const list = [...changes.map((c) => ({ key: c.key, row: c.row, field: CHANGE_FIELD_LABELS[c.field] ?? c.field, from: changeValue(c.field, c.from), to: changeValue(c.field, c.to), isNew: false })), ...news.map((row) => ({ key: `new-${row.rowNumber}`, row, field: "—", from: "", to: "New", isNew: true }))];
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(search.page) || 1), pages);
  const carrierId = head.carrierId;

  return (
    <>
      <TableCard
        title={`Not in this file · ${n(notIn.policies.length)}`}
        // Round 3: no explainer card. A policy left out of a newer file is never lapsed on its own: it is watched.
        description={notIn.comparedWith ? `compared with ${notIn.comparedWith.name} of ${fileDay(notIn.comparedWith.fileDate)} · watched, never lapsed` : head.fileType === "new_business" ? "a new-business file lists only new applications, so none is missing from it" : "no earlier file of this carrier and type to compare with"}
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
        title={`Changed · ${n(changes.length)}`}
        description={news.length ? `and ${n(news.length)} new` : undefined}
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
  if (!money || head.status !== "parsed") return <TableCard><EmptyState title="Nothing posted from this file" hint={head.status === "failed" ? "It stopped before its lines were read: see the Rows tab." : "Its lines post once it is read."} /></TableCard>;
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
