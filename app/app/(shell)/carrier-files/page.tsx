import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { CarrierFilesTable } from "@/components/app/carrier-files-table";
import { AgentFindings } from "@/components/app/pipeline-runs";
import { OutcomeFilter } from "@/components/app/book/files/outcome-filter";
import { StageLegend } from "@/components/app/book/files/stage-strip";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StreamSection } from "@/components/ui/stream-section";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { BUCKET_PENDING_MESSAGE } from "@/lib/ingestion/bucketStore";
import { fileDay } from "@/lib/ingestion/constants";
import { listFindings } from "@/lib/ingestion/dailyRunStore";
import { listFileStages, loadMissingFiles } from "@/lib/ingestion/fileOutcomeStore";
import { FILE_FILTERS, fileWhere, needsYouParts, type FileFilter } from "@/lib/ingestion/fileStages";
import { CARRIER_FILES_PENDING_MESSAGE, listCarrierFiles } from "@/lib/ingestion/registry";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { isoDate } from "@/lib/ingestion/path";
import { listOpenUnmappedStatuses } from "@/lib/ingestion/statusAdmin";
import { shownWord } from "@/lib/ingestion/statuses";
import { fileHref } from "@/lib/ingestion/trace";

/**
 * Book of business › Files (LA-4.1, Notion sprint; round 2, owner 2026-11-02): every policy file and
 * commission file a carrier sent, through any of the three doors — uploaded here, emailed to the agency's
 * address, or dropped into the bucket by the agency's scripts. Each file shows its eight stages and where
 * it is, and opens its own page. A file that cannot be read is listed as failed with the reason; a
 * corrected reissue replaces the earlier file for that day, which stays listed.
 *
 * Round 3 (owner 2026-11-02, docs/la4/POLISH-ROUND3.md): six tabs became none. One list with the chips
 * All · Needs you · Failed · Missing (?show=…; Missing is the file monitor's due-but-not-here findings,
 * LA-4.17/4.19, with Upload on the row). How files arrive is setup: ?view=doors|bucket|arrive go to
 * Setup › How files arrive. Policy changes is about policies: ?view=changes goes to Policies › Recent
 * changes. The warnings above the list are one line, the most urgent first.
 *
 * Owner 2026-11-02: Run history is a tab on each file's page (?view=runs comes back here); what the
 * agents raised is "Problems found", under the Needs you chip (?view=findings lands there), and its open
 * ones count in that chip. The problem-rows download is gone: every problem is fixed in the system.
 *
 * Owner and bookkeeper (`statements.view`), as the API. Opening the page writes nothing.
 */
const CADENCE: Record<string, string> = { daily: "Every business day", weekly: "Weekly", monthly: "Monthly" };
const n = (value: number) => value.toLocaleString("en-US");
const link = "font-semibold text-[var(--accent-ink)] hover:underline";
const HOW_FILES_ARRIVE_HREF = "/app/book-setup/how-files-arrive";
const RECENT_CHANGES_HREF = "/app/policies?view=changes";

export default async function CarrierFilesPage({ searchParams }: { searchParams: Promise<{ view?: string; show?: string; upload?: string; date?: string }> }) {
  const { view: asked, show: shown, upload, date } = await searchParams;
  // The old tabs that moved (round 3): their addresses keep working, on the page that holds them now.
  if (asked === "doors" || asked === "bucket" || asked === "arrive") redirect(date && isoDate(date) ? `${HOW_FILES_ARRIVE_HREF}?date=${date}` : HOW_FILES_ARRIVE_HREF);
  if (asked === "changes") redirect(RECENT_CHANGES_HREF);
  if (asked === "runs") redirect("/app/carrier-files");
  if (asked === "findings") redirect("/app/carrier-files?show=needs");

  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files are received and managed by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  // ?view=missing was the Missing tab: it is the Missing chip now.
  const filter: FileFilter = FILE_FILTERS.find((f) => f.key === (asked === "missing" ? "missing" : shown))?.key ?? "all";
  // Perf pass 2026-11-09: the missing files and the agents' findings need nothing of the list, so they are read
  // beside it; they are used (and a failure raised) only when the list is available, as before.
  // Frame first (UI-CONSISTENCY §7a): the title line, Statements and Upload draw at once; the problems line, the strip
  // and the list stream in. The reads are today's, in today's order, only started before the frame returns.
  const missingRead = settle(loadMissingFiles(tenantId));
  const findingsRead = settle(listFindings(tenantId));
  const first: First = Promise.all([listCarrierFiles(tenantId), fileCarrierChoices(tenantId), listOpenUnmappedStatuses(tenantId)]);

  return (
    <DataInPage
      step="files"
      actions={<>
        {/* Carrier statements have their own import and review (owner 2026-11-02: moved here from Commissions). */}
        <Button asChild variant="outline"><Link href="/app/statements">Statements</Link></Button>
        <Suspense fallback={<Button type="button" disabled>Upload a file</Button>}><Upload read={first} readOnly={readOnly} autoOpen={upload === "1"} /></Suspense>
      </>}
    >
      <StreamSection shape="strip+table"><Files first={first} missingRead={missingRead} findingsRead={findingsRead} tenantId={tenantId} readOnly={readOnly} filter={filter} /></StreamSection>
    </DataInPage>
  );
}

const settle = <T,>(promise: Promise<T>): Promise<Settled<T>> => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
const used = <T,>(read: Settled<T>): T => {
  if (!read.ok) throw read.error;
  return read.value;
};
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
type First = Promise<[Awaited<ReturnType<typeof listCarrierFiles>>, Awaited<ReturnType<typeof fileCarrierChoices>>, Awaited<ReturnType<typeof listOpenUnmappedStatuses>>]>;

const pausedWhy = (available: boolean, readOnly: boolean) => (!available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null);

async function Upload({ read, readOnly, autoOpen }: { read: First; readOnly: boolean; autoOpen: boolean }) {
  const [list, carriers] = await read;
  const blocked = pausedWhy(list.available, readOnly);
  return blocked ? <Button type="button" disabled title={blocked}>Upload a file</Button> : <CarrierFileUploadButton carriers={carriers} autoOpen={autoOpen} openWhenDone />;
}

async function Files({ first, missingRead, findingsRead, tenantId, readOnly, filter }: {
  first: First;
  missingRead: Promise<Settled<Awaited<ReturnType<typeof loadMissingFiles>>>>;
  findingsRead: Promise<Settled<Awaited<ReturnType<typeof listFindings>>>>;
  tenantId: string;
  readOnly: boolean;
  filter: FileFilter;
}) {
  const [list, carriers, unmapped] = await first;
  const [stages, missing] = list.available
    ? await Promise.all([listFileStages(tenantId, list.files), missingRead.then(used)])
    : [null, { available: false, missing: [] }];
  // LA-4.19: what the agents raised in the runs — Problems found, counted in Needs you.
  const findings = list.available ? used(await findingsRead) : null;
  const openFindings = findings?.findings.filter((f) => f.status === "open").length ?? 0;

  const blocked = pausedWhy(list.available, readOnly);
  const current = list.files.filter((file) => file.status !== "superseded");
  const where = (file: (typeof list.files)[number]) => fileWhere(file, stages?.[file.id]);
  const waiting = current.filter((file) => file.waitingForLayout).length;
  const failedFiles = current.filter((file) => file.status === "failed" && !file.waitingForLayout && file.carrierId);
  const replaced = list.files.length - current.length;
  const needsYou = stages ? current.reduce((sum, file) => sum + (stages[file.id]?.needs ?? 0), 0) : 0;
  const filesNeedingYou = list.files.filter((file) => where(file) === "needs").length;
  // The chip counts files and open problems found; the figure says which (walk 2026-11-20: "1" over "0 rows waiting").
  const needsWords = needsYouParts({ files: filesNeedingYou, rows: needsYou, problems: openFindings });
  const counts: Record<FileFilter, number> = {
    all: list.files.length,
    needs: filesNeedingYou + openFindings,
    failed: list.files.filter((file) => where(file) === "failed").length,
    missing: missing.missing.length,
  };
  const chipHref = (key: FileFilter) => (key === "all" ? "/app/carrier-files" : `/app/carrier-files?show=${key}`);
  const chips = list.available ? (
    <OutcomeFilter
      label="Show files"
      value={filter}
      options={FILE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key], warn: f.key !== "all", href: chipHref(f.key) }))}
    />
  ) : undefined;
  const upload_ = (props: { label?: string; size?: "sm"; variant?: "outline"; preset?: { carrierId: string } }) =>
    blocked ? <Button type="button" size={props.size} variant={props.variant} disabled title={blocked}>{props.label ?? "Upload a file"}</Button> : <CarrierFileUploadButton carriers={carriers} openWhenDone {...props} />;

  // One line for everything that is wrong, the most urgent first (round 3): a file that stopped, then
  // receiving paused, then status words that hold rows back (LA-4.5). The line's one action is the first's.
  const heldRows = unmapped.entries.reduce((sum, entry) => sum + entry.rows, 0);
  const problems: Array<{ text: string; title?: string; action?: { label: string; href: string } }> = [
    ...(failedFiles.length ? [{
      text: failedFiles.length === 1
        ? `${failedFiles[0].carrierName ?? "A carrier"} ${failedFiles[0].fileType === "commissions" ? "statement" : "file"} of ${fileDay(failedFiles[0].fileDate)} stopped; nothing from it was posted`
        : `${n(failedFiles.length)} files stopped; nothing from them was posted`,
      title: failedFiles[0].errorDetail ?? undefined,
      action: failedFiles.length === 1 ? { label: "Open the file", href: fileHref(failedFiles[0].id) } : { label: "See them", href: chipHref("failed") },
    }] : []),
    ...(blocked ? [{ text: blocked }] : []),
    ...(unmapped.entries.length ? [{
      text: `${n(heldRows)} ${heldRows === 1 ? "policy is" : "policies are"} held until Insurvas maps ${unmapped.entries.length === 1 ? "a status word" : `${unmapped.entries.length} status words`}`,
      title: `${unmapped.entries.slice(0, 6).map((entry) => `${shownWord(entry.raw)} from ${entry.carrierName} (${n(entry.rows)})`).join(", ")}${unmapped.entries.length > 6 ? ", …" : ""}. They are read automatically once mapped.`,
    }] : []),
  ];
  const action = problems.find((p) => p.action)?.action;

  // The table foundation (§6b): a page of late files fitted to the screen's foot, the shared Pager in the footer.
  const missingTable = (
    <PagedTableCard toolbar={chips} total={missing.missing.length} noun={missing.missing.length === 1 ? "late file" : "late files"} suffix="most late first">
      {!missing.available ? <EmptyState title="Missing files are not available yet" hint={BUCKET_PENDING_MESSAGE} />
        : missing.missing.length === 0 ? <EmptyState title="Nothing is late" hint="Every carrier with a cadence has sent its file on time." /> : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Carrier</th><th>Cadence</th><th>Expected</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <PagedBody>
              {/* One line per row (owner 2026-11-11): the date plain, the lateness in the one chip, the reasoning its tooltip. */}
              {missing.missing.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap font-medium text-foreground">{item.carrierName}</td>
                  <td className="whitespace-nowrap">{CADENCE[item.cadence] ?? item.cadence}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{item.due ? fileDay(item.due) : "—"}</td>
                  <td>{item.due ? <StatusChip tone={item.daysLate > 2 ? "danger" : "warning"} title={item.reasoning}>{item.daysLate} {item.daysLate === 1 ? "day" : "days"} late</StatusChip> : <StatusChip tone="warning" title={item.reasoning}>Late</StatusChip>}</td>
                  <td className="text-right">{upload_({ label: "Upload", size: "sm", variant: "outline", preset: { carrierId: item.carrierId } })}</td>
                </tr>
              ))}
            </PagedBody>
          </table>
        )}
    </PagedTableCard>
  );

  return (
    <>
    {problems.length > 0 && (
      <Callout
        tone={failedFiles.length ? "error" : "warning"}
        title={
          <>
            {problems.map((p, index) => <span key={index} title={p.title}>{index > 0 ? " · " : ""}{p.text}</span>)}.
            {action && <> <Link href={action.href} className={link}>{action.label}</Link></>}
          </>
        }
      />
    )}

    <>
        {list.files.length > 0 && filter !== "missing" && (
          <StatStrip label="Carrier file totals">
            <StatTile label="Files in use" value={n(current.length)} footnote={replaced ? `${n(replaced)} more replaced by a corrected file` : [["policies", "policy"], ["commissions", "commission"], ["new_business", "new business"]].map(([type, word]) => [current.filter((file) => file.fileType === type).length, word] as const).filter(([count], index) => index < 2 || count > 0).map(([count, word]) => `${n(count)} ${word}`).join(" · ")} />
            {/* Files, as the chip counts them; the rows they hold are the footnote (walk 2026-11-02: 861 beside 10 read as a disagreement). */}
            {/* Owner 2026-11-11: plain figures; a tile that is a problem says so in one chip in its footnote. */}
            <StatTile label="Need you" value={n(counts.needs)} footnote={needsWords ? <StatusChip tone="warning">{needsWords}</StatusChip> : "nothing waiting on a person"} href={chipHref("needs")} />
            <StatTile label="Waiting for a layout" value={n(waiting)} footnote="read once Insurvas sets up the layout" />
            <StatTile label="Failed" value={n(counts.failed)} footnote={counts.failed ? <StatusChip tone="warning" title="Cannot be read, see the reason">Cannot be read</StatusChip> : "cannot be read, see the reason"} href={chipHref("failed")} />
            <StatTile label="Duplicates skipped" value={n(list.skips.length)} footnote="already received" />
          </StatStrip>
        )}

        {filter === "missing" ? missingTable : (
          <>
            <CarrierFilesTable
              key={filter}
              files={list.files}
              stages={stages ?? undefined}
              show={filter === "needs" || filter === "failed" ? filter : undefined}
              chips={chips}
              also={filter === "needs" && openFindings ? `and ${n(openFindings)} ${openFindings === 1 ? "problem" : "problems"} found, below` : undefined}
              emptyShown={filter === "needs"
                ? { title: "No file needs you", hint: openFindings ? `${n(openFindings)} ${openFindings === 1 ? "problem the agents found needs" : "problems the agents found need"} you; ${openFindings === 1 ? "it is" : "they are"} listed below.` : "Every file is read or still being read." }
                : filter === "failed" ? { title: "No file failed", hint: "Every file could be read." } : undefined}
              emptyTitle={list.available ? "No carrier file received yet" : "Carrier files are not available yet"}
              emptyHint={list.available ? "Upload a policy or commission file, email one to the agency's address, or have a script drop it into the bucket." : "Files appear here once the update is applied."}
            />
            {/* Problems found (was Checks): what the agents raised, open ones first, where Needs you already looks. */}
            {filter === "needs" && findings && (findings.findings.length > 0 || !findings.available) && (
              <AgentFindings findings={findings.findings} accuracy={findings.accuracy} available={findings.available} canReview={!readOnly} />
            )}
            {list.files.length > 0 && <StageLegend />}
          </>
        )}
      </>
    </>
  );
}
