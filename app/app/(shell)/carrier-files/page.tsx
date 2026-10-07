import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { CarrierFilesTable } from "@/components/app/carrier-files-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, libraryCarriers, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { listOpenUnmappedStatuses } from "@/lib/ingestion/statusAdmin";
import { shownWord } from "@/lib/ingestion/statuses";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Carrier files (LA-4.1, Notion sprint): every policy file and commission file a
 * carrier sent, through any of the three doors — uploaded here, emailed to the agency's address, or
 * dropped into the bucket by the agency's scripts. A file that cannot be read is listed as failed
 * with the reason; a corrected reissue replaces the earlier file for that day, which stays listed.
 *
 * Owner and bookkeeper (`statements.view`), as the API. Opening the page writes nothing.
 */
export default async function CarrierFilesPage({ searchParams }: { searchParams: Promise<{ view?: string; upload?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files are received and managed by the account owner or a bookkeeper." />;
  }

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { view, upload } = await searchParams;
  const showDoors = view === "doors";
  const [list, carriers, unmapped] = await Promise.all([listCarrierFiles(tenantId), libraryCarriers(), listOpenUnmappedStatuses(tenantId)]);
  const [address, senders] = showDoors && list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId)]) : [null, null];

  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  const current = list.files.filter((file) => file.status !== "superseded");
  const failed = current.filter((file) => file.status === "failed").length;
  const replaced = list.files.length - current.length;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Carrier files"
        description="Policy and commission files from your carriers, uploaded, emailed in or dropped by a script."
        actions={blocked ? <Button type="button" disabled title={blocked}>Upload a file</Button> : <CarrierFileUploadButton carriers={carriers} autoOpen={upload === "1"} />}
      />

      {/* LA-4.5: a status word nobody has mapped holds its rows back until Insurvas maps it. */}
      {unmapped.entries.length > 0 && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {unmapped.entries.reduce((sum, entry) => sum + entry.rows, 0).toLocaleString("en-US")} policies are held until Insurvas maps {unmapped.entries.length === 1 ? "a status word" : `${unmapped.entries.length} status words`} your carriers sent: {unmapped.entries.slice(0, 6).map((entry) => `${shownWord(entry.raw)} from ${entry.carrierName} (${entry.rows.toLocaleString("en-US")})`).join(", ")}{unmapped.entries.length > 6 ? ", …" : ""}. They are read automatically once mapped.
        </div>
      )}

      {blocked && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{blocked}</div>
      )}

      {list.files.length > 0 && (
        <StatStrip label="Carrier file totals">
          <StatTile label="Files" value={current.length.toLocaleString("en-US")} footnote={`${current.filter((file) => file.fileType === "policies").length.toLocaleString("en-US")} policy · ${current.filter((file) => file.fileType === "commissions").length.toLocaleString("en-US")} commission`} />
          <StatTile label="Failed" value={failed.toLocaleString("en-US")} valueTone={failed ? "warning" : undefined} footnote="cannot be read" />
          <StatTile label="Replaced" value={replaced.toLocaleString("en-US")} footnote="by a corrected file" />
          <StatTile label="Duplicates skipped" value={list.skips.length.toLocaleString("en-US")} footnote="already received" />
        </StatStrip>
      )}

      {list.available && (
        <ViewTabs
          label="Carrier file views"
          active={showDoors ? "doors" : "files"}
          tabs={[
            { key: "files", label: "Files", count: list.files.length, href: "/app/carrier-files" },
            { key: "doors", label: "Email and bucket", href: "/app/carrier-files?view=doors" },
          ]}
        />
      )}

      {showDoors && address && senders ? (
        <CarrierFileDoors
          tenantId={tenantId}
          address={address.address}
          addressConfigured={address.configured}
          senders={senders.senders}
          carriers={carriers}
          canWrite={!readOnly}
          writeBlockedReason={readOnly ? "Paused while the account is read-only." : null}
        />
      ) : (
        <CarrierFilesTable
          files={list.files}
          emptyTitle={list.available ? "No carrier file received yet" : "Carrier files are not available yet"}
          emptyHint={list.available ? "Upload a policy or commission file, email one to the agency's address, or have a script drop it into the bucket." : "Files appear here once the update is applied."}
        />
      )}
    </div>
  );
}
