import { DataInPage } from "@/components/app/data-in/data-in-page";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { CarrierBucket } from "@/components/app/carrier-bucket";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { agencyTimezone, BUCKET_PENDING_MESSAGE, loadBucketView } from "@/lib/ingestion/bucketStore";
import { isoDate } from "@/lib/ingestion/path";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { fileCarrierChoices } from "@/lib/carriers/agency";

/**
 * Book of business › Setup › How files arrive (owner 2026-11-02, round 3; docs/la4/POLISH-ROUND3.md): the three
 * doors a carrier file comes in by — upload, the agency's email address with its known senders, and the
 * bucket — moved here from Carrier files, because how files arrive is setup, not work. The same components
 * and loaders that view used; /app/carrier-files?view=doors, ?view=bucket and ?view=arrive redirect here.
 * Owner and bookkeeper, like every Setup tab; writing (upload, the address, senders, Check now) is paused
 * while the account is read-only, as before. Opening it writes nothing.
 */
export default async function SetupHowFilesArrivePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="How files arrive" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="How files arrive" detail="Setup is for the account owner and bookkeepers." />;

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { date } = await searchParams;
  // Whether the carrier-file tables are in (one row is enough to tell).
  const [list, carriers] = await Promise.all([listCarrierFiles(tenantId, 1), fileCarrierChoices(tenantId)]);
  const [address, senders, bucketZone] = list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId), agencyTimezone(tenantId)]) : [null, null, null];
  // The bucket, one day at a time: today in the agency's time zone unless a day is asked for.
  const bucketDate = date && isoDate(date) ? date : new Date().toLocaleDateString("en-CA", { timeZone: bucketZone ?? "America/New_York" });
  const bucket = bucketZone ? await loadBucketView(tenantId, bucketDate) : null;
  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  const upload = blocked
    ? <Button type="button" disabled title={blocked}>Upload a file</Button>
    : <CarrierFileUploadButton carriers={carriers} openWhenDone />;

  // Round 3 (owner 2026-11-02): no explainer card. Upload is the page's action; the email and bucket doors
  // are the two cards below, each saying what it is in its own title.
  return (
    <DataInPage step="setup" lead={<SetupTabs active="how-files-arrive" />} actions={upload}>
      {!list.available && <Callout tone="warning" title={CARRIER_FILES_PENDING_MESSAGE} />}
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
    </DataInPage>
  );
}
