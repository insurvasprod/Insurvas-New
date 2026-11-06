import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierBucket } from "@/components/app/carrier-bucket";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { agencyTimezone, BUCKET_PENDING_MESSAGE, loadBucketView } from "@/lib/ingestion/bucketStore";
import { isoDate } from "@/lib/ingestion/path";
import { CARRIER_FILES_PENDING_MESSAGE, listCarrierFiles } from "@/lib/ingestion/registry";

/**
 * Carrier sync › Files in › Bucket (round 6, owner 2026-11-06: "make email and the bucket a sub page"): what scripts
 * dropped into the agency's folder, one day at a time (?date=, today in the agency's time zone by default), and the
 * files expected that day that never came. The same component and loader Files in drew in place; Files in's old
 * ?date= lands here. Owner and bookkeeper; Check now is paused while the account is read-only. Opening it writes nothing.
 */
export default async function FilesInBucketPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { date } = await searchParams;
  const list = await listCarrierFiles(tenantId, 1);
  const zone = list.available ? await agencyTimezone(tenantId) : null;
  const day = date && isoDate(date) ? date : new Date().toLocaleDateString("en-CA", { timeZone: zone ?? "America/New_York" });
  const bucket = zone ? await loadBucketView(tenantId, day) : null;
  return (
    <DataInPage
      step="files-in"
      title="Bucket"
      chip={<InfoTip label="About the bucket" side="right">A folder your own scripts drop carrier files into, by day, agency, carrier and kind. Insurvas reads it on a schedule; Check now reads it at once. Pick a day to see what arrived and which files that day was expected to bring but didn&apos;t.</InfoTip>}
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Files in", href: "/app/book-setup/how-files-arrive" }, { label: "Bucket" }]}
    >
      {!list.available ? <Callout tone="warning" title={CARRIER_FILES_PENDING_MESSAGE} />
        : bucket?.available ? <CarrierBucket initial={bucket} tenantId={tenantId} readOnly={readOnly} />
        : <Callout tone="warning" title={BUCKET_PENDING_MESSAGE} />}
    </DataInPage>
  );
}
