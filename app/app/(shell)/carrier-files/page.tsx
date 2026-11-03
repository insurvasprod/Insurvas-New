import Link from "next/link";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { CarrierBucket } from "@/components/app/carrier-bucket";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { CarrierFilesTable } from "@/components/app/carrier-files-table";
import { AgentFindings, PipelineRuns } from "@/components/app/pipeline-runs";
import { PolicyChangesTable } from "@/components/app/policy-changes-table";
import { StageLegend } from "@/components/app/book/files/stage-strip";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { agencyTimezone, BUCKET_PENDING_MESSAGE, loadBucketView } from "@/lib/ingestion/bucketStore";
import { fileDay } from "@/lib/ingestion/constants";
import { listFindings, listRuns } from "@/lib/ingestion/dailyRunStore";
import { listFileStages, loadMissingFiles } from "@/lib/ingestion/fileOutcomeStore";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, libraryCarriers, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { isoDate } from "@/lib/ingestion/path";
import { listPolicyChanges } from "@/lib/ingestion/snapshotStore";
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
 * Tabs: Files · Missing (the file monitor's cadence findings, LA-4.17/4.19) · How files arrive (upload,
 * email and bucket together). Runs, Agent findings and Policy changes stay as further tabs, at the addresses
 * they always had (?view=runs, findings, changes; ?view=doors and ?view=bucket open How files arrive).
 *
 * Owner and bookkeeper (`statements.view`), as the API. Opening the page writes nothing.
 */
type View = "files" | "missing" | "arrive" | "changes" | "runs" | "findings";
const CADENCE: Record<string, string> = { daily: "Every business day", weekly: "Weekly", monthly: "Monthly" };

export default async function CarrierFilesPage({ searchParams }: { searchParams: Promise<{ view?: string; upload?: string; date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files are received and managed by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { view: asked, upload, date } = await searchParams;
  const view: View = asked === "doors" || asked === "bucket" || asked === "arrive" ? "arrive" : asked === "missing" || asked === "changes" || asked === "runs" || asked === "findings" ? asked : "files";
  const [list, carriers, unmapped] = await Promise.all([listCarrierFiles(tenantId), libraryCarriers(), listOpenUnmappedStatuses(tenantId)]);
  const [stages, missing] = list.available
    ? await Promise.all([view === "files" ? listFileStages(tenantId, list.files) : null, loadMissingFiles(tenantId)])
    : [null, { available: false, missing: [] }];
  const [address, senders] = view === "arrive" && list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId)]) : [null, null];
  // LA-4.6: what moved between the carriers' policy files.
  const changes = view === "changes" && list.available ? await listPolicyChanges(tenantId) : null;
  // LA-4.19: the runs, and what the agents raised in them.
  const [runs, findings] = await Promise.all([
    view === "runs" && list.available ? listRuns(tenantId) : null,
    view === "findings" && list.available ? listFindings(tenantId) : null,
  ]);

  // The bucket, one day at a time: today in the agency's time zone unless a day is asked for.
  const bucketZone = view === "arrive" && list.available ? await agencyTimezone(tenantId) : null;
  const bucketDate = date && isoDate(date) ? date : new Date().toLocaleDateString("en-CA", { timeZone: bucketZone ?? "America/New_York" });
  const bucket = bucketZone ? await loadBucketView(tenantId, bucketDate) : null;

  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  const current = list.files.filter((file) => file.status !== "superseded");
  const waiting = current.filter((file) => file.waitingForLayout).length;
  const failedFiles = current.filter((file) => file.status === "failed" && !file.waitingForLayout && file.carrierId);
  const replaced = list.files.length - current.length;
  const needsYou = stages ? current.reduce((sum, file) => sum + (stages[file.id]?.needs ?? 0), 0) : 0;
  const upload_ = (props: { label?: string; size?: "sm"; variant?: "outline"; preset?: { carrierId: string } }) =>
    blocked ? <Button type="button" size={props.size} variant={props.variant} disabled title={blocked}>{props.label ?? "Upload a file"}</Button> : <CarrierFileUploadButton carriers={carriers} openWhenDone {...props} />;

  return (
    <DataInPage
      step="files"
      actions={<>
        {list.available && view === "files" && <Button asChild variant="outline"><a href="/api/app/carrier-files/rows-export" download>Download problem rows</a></Button>}
        {blocked ? <Button type="button" disabled title={blocked}>Upload a file</Button> : <CarrierFileUploadButton carriers={carriers} autoOpen={upload === "1"} openWhenDone />}
      </>}
      lead={list.available ? (
        <ViewTabs
          label="Carrier file views"
          active={view}
          tabs={[
            { key: "files", label: "Files", count: list.files.length, href: "/app/carrier-files" },
            { key: "missing", label: "Missing", count: missing.missing.length, tone: "danger", href: "/app/carrier-files?view=missing" },
            { key: "arrive", label: "How files arrive", href: "/app/carrier-files?view=arrive" },
            { key: "changes", label: "Policy changes", href: "/app/carrier-files?view=changes" },
            { key: "runs", label: "Runs", href: "/app/carrier-files?view=runs" },
            { key: "findings", label: "Agent findings", href: "/app/carrier-files?view=findings" },
          ]}
        />
      ) : undefined}
    >

      {/* LA-4.5: a status word nobody has mapped holds its rows back until Insurvas maps it. */}
      {unmapped.entries.length > 0 && (
        <Callout tone="warning" title={`${unmapped.entries.reduce((sum, entry) => sum + entry.rows, 0).toLocaleString("en-US")} policies are held until Insurvas maps ${unmapped.entries.length === 1 ? "a status word" : `${unmapped.entries.length} status words`} your carriers sent.`}>
          {unmapped.entries.slice(0, 6).map((entry) => `${shownWord(entry.raw)} from ${entry.carrierName} (${entry.rows.toLocaleString("en-US")})`).join(", ")}{unmapped.entries.length > 6 ? ", …" : ""}. They are read automatically once mapped.
        </Callout>
      )}

      {blocked && <Callout tone="warning" title={blocked} />}

      {view === "files" && list.files.length > 0 && (
        <StatStrip label="Carrier file totals">
          <StatTile label="Files in use" value={current.length.toLocaleString("en-US")} footnote={replaced ? `${replaced.toLocaleString("en-US")} more replaced by a corrected file` : [["policies", "policy"], ["commissions", "commission"], ["new_business", "new business"]].map(([type, word]) => [current.filter((file) => file.fileType === type).length, word] as const).filter(([count], index) => index < 2 || count > 0).map(([count, word]) => `${count.toLocaleString("en-US")} ${word}`).join(" · ")} />
          <StatTile label="Need you" value={needsYou.toLocaleString("en-US")} valueTone={needsYou ? "warning" : undefined} footnote="rows and files waiting on a person" />
          <StatTile label="Waiting for a layout" value={waiting.toLocaleString("en-US")} footnote="read once Insurvas sets up the layout" />
          <StatTile label="Failed" value={failedFiles.length.toLocaleString("en-US")} valueTone={failedFiles.length ? "warning" : undefined} footnote="cannot be read, see the reason" />
          <StatTile label="Duplicates skipped" value={list.skips.length.toLocaleString("en-US")} footnote="already received" />
        </StatStrip>
      )}

      {view === "missing" ? (
        <TableCard title="Due but not here" description="From each carrier's cadence in Carrier rules: a carrier that sent nothing by its due day.">
          {!missing.available ? <EmptyState title="Missing files are not available yet" hint={BUCKET_PENDING_MESSAGE} />
            : missing.missing.length === 0 ? <EmptyState title="Nothing is late" hint="Every carrier with a cadence has sent its file on time." /> : (
              <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                <thead><tr><th className="w-[200px]">Carrier</th><th className="w-[170px]">Cadence</th><th className="w-[200px]">Expected</th><th>Why</th><th className="w-[120px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {missing.missing.map((item) => (
                    <tr key={item.id}>
                      <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{item.carrierName}</span></td>
                      <td>{CADENCE[item.cadence] ?? item.cadence}</td>
                      <td>{item.due ? <StatusChip tone={item.daysLate > 2 ? "danger" : "warning"}>{fileDay(item.due)} · {item.daysLate} {item.daysLate === 1 ? "day" : "days"} late</StatusChip> : "—"}</td>
                      <td><span className="block whitespace-normal break-words leading-snug">{item.reasoning}</span></td>
                      <td className="text-right">{upload_({ label: "Upload it", size: "sm", variant: "outline", preset: { carrierId: item.carrierId } })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </TableCard>
      ) : view === "arrive" ? (
        <>
          <Card>
            <CardHeader><CardTitle>How files arrive</CardTitle><CardDescription>Three doors, one list: a file is the same file however it came, and the same file twice is skipped.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
              <div className="flex flex-col items-start gap-2"><span className="font-semibold text-foreground">Upload</span><span className="text-muted-foreground">Drop a carrier file in: a CSV, Excel or PDF, as the portal gave it.</span>{upload_({ size: "sm", variant: "outline" })}</div>
              <div className="flex flex-col items-start gap-2"><span className="font-semibold text-foreground">Email</span><span className="text-muted-foreground">{address?.address ? <>Forward carrier emails to <span className="font-mono text-xs text-foreground">{address.address}</span></> : "Give the agency its own address below, then forward carrier emails to it."}</span></div>
              <div className="flex flex-col items-start gap-2"><span className="font-semibold text-foreground">Bucket</span><span className="text-muted-foreground">Scripts drop files in <span className="font-mono text-xs text-foreground">date / agency / carrier / type</span>, read every five minutes.</span></div>
            </CardContent>
          </Card>
          {address && senders && (
            <CarrierFileDoors
              address={address.address}
              addressConfigured={address.configured}
              senders={senders.senders}
              carriers={carriers}
              canWrite={!readOnly}
              writeBlockedReason={readOnly ? "Paused while the account is read-only." : null}
            />
          )}
          {bucket?.available ? <CarrierBucket initial={bucket} tenantId={tenantId} readOnly={readOnly} /> : list.available && <Callout tone="warning" title={BUCKET_PENDING_MESSAGE} />}
        </>
      ) : view === "runs" && runs ? (
        <PipelineRuns runs={runs.runs} available={runs.available} canRun={!readOnly} />
      ) : view === "findings" && findings ? (
        <AgentFindings findings={findings.findings} accuracy={findings.accuracy} available={findings.available} canReview={!readOnly} />
      ) : view === "changes" && changes ? (
        <PolicyChangesTable
          changes={changes.changes}
          emptyTitle={changes.available ? "No policy has changed yet" : "Policy changes are not available yet"}
          emptyHint={changes.available ? "Changes appear when a carrier's next policy file differs from the one before it." : "They appear once the database update (20261008140000) is applied."}
        />
      ) : (
        <>
          <CarrierFilesTable
            files={list.files}
            stages={stages ?? undefined}
            emptyTitle={list.available ? "No carrier file received yet" : "Carrier files are not available yet"}
            emptyHint={list.available ? "Upload a policy or commission file, email one to the agency's address, or have a script drop it into the bucket." : "Files appear here once the update is applied."}
          />
          {list.files.length > 0 && <StageLegend />}
          {failedFiles.slice(0, 1).map((file) => (
            <Callout key={file.id} tone="error" title={`${file.carrierName ?? "A carrier"} ${file.fileType === "commissions" ? "statement" : "file"} of ${fileDay(file.fileDate)} stopped. Nothing from it was posted.`}>
              {file.errorDetail ?? "It couldn't be read."}{failedFiles.length > 1 ? ` ${failedFiles.length - 1} more ${failedFiles.length === 2 ? "file" : "files"} stopped too.` : ""}{" "}
              <Link href={fileHref(file.id)} className="font-semibold text-[var(--accent-ink)] hover:underline">Open the file</Link>
            </Callout>
          ))}
        </>
      )}
    </DataInPage>
  );
}
