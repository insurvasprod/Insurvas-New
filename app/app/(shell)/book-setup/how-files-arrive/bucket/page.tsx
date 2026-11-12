import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FilesInBucketActions } from "@/components/app/book/setup/files-in-bucket-actions";
import { FilesInTabs, filesInCrumbs } from "@/components/app/book/setup/files-in-tabs";
import { CarrierBucket } from "@/components/app/carrier-bucket";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { agencyTimezone, BUCKET_PENDING_MESSAGE, loadBucketView } from "@/lib/ingestion/bucketStore";
import { isoDate } from "@/lib/ingestion/path";
import { CARRIER_FILES_PENDING_MESSAGE, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";

/**
 * Carrier sync › Files in › Bucket. r7 4·2 (owner 2026-11-10): the Bucket tab of Files in's sub-page bar, at its own
 * address, so the old /bucket link — and Files in's old ?date= — lands on it. What scripts dropped into the agency's
 * folder, one day at a time (?date=, today in the agency's time zone by default), with the files expected that never
 * came as red rows at the top of the day. Copy the folder and Check now are on the title line.
 * Owner and bookkeeper; Check now is paused while the account is read-only. Opening it writes nothing.
 */
export default async function FilesInBucketPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { date } = await searchParams;
  const [list, carriers] = await Promise.all([listCarrierFiles(tenantId, 1), fileCarrierChoices(tenantId)]);
  const [zone, senders] = list.available ? await Promise.all([agencyTimezone(tenantId), listSenders(tenantId)]) : [null, null];
  const day = date && isoDate(date) ? date : new Date().toLocaleDateString("en-CA", { timeZone: zone ?? "America/New_York" });
  const bucket = zone ? await loadBucketView(tenantId, day) : null;
  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : !bucket?.available ? BUCKET_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  return (
    <DataInPage
      step="files-in"
      tabs={<FilesInTabs active="bucket" counts={{ carriers: null, email: senders ? senders.senders.length : null, bucket: bucket?.available ? bucket.missing.length : null }} />}
      actions={<FilesInBucketActions tenantId={tenantId} blocked={blocked} />}
      chip={<InfoTip label="About the bucket" side="right">A folder your own scripts drop carrier files into, by day, agency, carrier and kind. Insurvas reads it on a schedule; Check now reads it at once. Pick a day to see what arrived; the files that day was expected to bring but didn&apos;t are the red rows at the top.</InfoTip>}
      breadcrumbs={filesInCrumbs("Bucket")}
    >
      {!list.available ? <TableCard><EmptyState title="Receiving files needs a database update" hint={CARRIER_FILES_PENDING_MESSAGE} /></TableCard>
        : bucket?.available ? <CarrierBucket initial={bucket} tenantId={tenantId} carriers={carriers} readOnly={readOnly} />
        : <TableCard><EmptyState title="The bucket needs a database update" hint={BUCKET_PENDING_MESSAGE} /></TableCard>}
    </DataInPage>
  );
}
