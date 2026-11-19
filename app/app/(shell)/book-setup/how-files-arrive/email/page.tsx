import { Suspense } from "react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FilesInEmailActions } from "@/components/app/book/setup/files-in-email-actions";
import { FilesInTabs, filesInCrumbs } from "@/components/app/book/setup/files-in-tabs";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { agencyTimezone, loadBucketView } from "@/lib/ingestion/bucketStore";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";

/**
 * Carrier sync › Files in › Email. r7 4·1 (owner 2026-11-10): the Email tab of Files in's sub-page bar, at its own
 * address, so the old /email link lands on it. The agency's own address heads the card; the senders each carrier's
 * mail is recognised by are the table. Add sender and Copy address are on the title line; a sender's row opens its
 * dialog, and Remove asks first. Owner and bookkeeper; writing is paused while the account is read-only. Opening it
 * writes nothing.
 */
export default async function FilesInEmailPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the title line, the tabs and Add sender draw at once; the counts, the address
  // and the senders stream in. The reads are today's, in today's order, only started before the frame returns.
  const read = (async () => {
    const [list, carriers] = await Promise.all([listCarrierFiles(tenantId, 1), fileCarrierChoices(tenantId)]);
    const [address, senders, zone] = list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId), agencyTimezone(tenantId)]) : [null, null, null];
    const today = new Date().toLocaleDateString("en-CA", { timeZone: zone ?? "America/New_York" });
    const bucket = zone ? await loadBucketView(tenantId, today).catch(() => null) : null;
    return { list, carriers, address, senders, bucket };
  })();
  return (
    <DataInPage
      step="files-in"
      tabs={<Suspense fallback={<FilesInTabs active="email" counts={{ carriers: null, email: null, bucket: null }} />}><Tabs read={read} /></Suspense>}
      actions={<Suspense fallback={<FilesInEmailActions address={null} carriers={[]} canWrite={false} writeBlockedReason={null} />}><Actions read={read} readOnly={readOnly} /></Suspense>}
      chip={<InfoTip label="About email" side="right">Create your agency&apos;s address once, then ask each carrier to send its reports to it, or forward them yourself. Add each carrier&apos;s sending address so its files are recognised: a file from an unknown sender still arrives, but waits until its carrier is known.</InfoTip>}
      breadcrumbs={filesInCrumbs("Email")}
    >
      <StreamSection shape="table"><Doors read={read} readOnly={readOnly} /></StreamSection>
    </DataInPage>
  );
}

type Read = Promise<{
  list: Awaited<ReturnType<typeof listCarrierFiles>>;
  carriers: Awaited<ReturnType<typeof fileCarrierChoices>>;
  address: Awaited<ReturnType<typeof getInboundAddress>> | null;
  senders: Awaited<ReturnType<typeof listSenders>> | null;
  bucket: Awaited<ReturnType<typeof loadBucketView>> | null;
}>;

/** The tabs with their counts; until they are known, the same tabs without them. */
async function Tabs({ read }: { read: Read }) {
  const { senders, bucket } = await read;
  return <FilesInTabs active="email" counts={{ carriers: null, email: senders ? senders.senders.length : null, bucket: bucket?.available ? bucket.missing.length : null }} />;
}

async function Actions({ read, readOnly }: { read: Read; readOnly: boolean }) {
  const { list, carriers, address } = await read;
  const writeBlockedReason = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  return <FilesInEmailActions address={address?.address ?? null} carriers={carriers} canWrite={!readOnly && list.available} writeBlockedReason={writeBlockedReason} />;
}

async function Doors({ read, readOnly }: { read: Read; readOnly: boolean }) {
  const { list, address, senders } = await read;
  if (!list.available) return <TableCard><EmptyState title="Email-in needs a database update" hint={CARRIER_FILES_PENDING_MESSAGE} /></TableCard>;
  if (!address || !senders) return null;
  return (
    <CarrierFileDoors
      address={address.address}
      addressConfigured={address.configured}
      senders={senders.senders}
      canWrite={!readOnly}
      writeBlockedReason={readOnly ? "Receiving files is paused while the account is read-only." : null}
    />
  );
}
