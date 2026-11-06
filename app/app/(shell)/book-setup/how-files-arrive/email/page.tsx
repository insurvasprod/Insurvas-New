import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";

/**
 * Carrier sync › Files in › Email (round 6, owner 2026-11-06: "make email and the bucket a sub page"): the agency's
 * own address, and the senders each carrier's mail is recognised by. The same component and loaders Files in drew
 * in place. Owner and bookkeeper; writing is paused while the account is read-only. Opening it writes nothing.
 */
export default async function FilesInEmailPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [list, carriers] = await Promise.all([listCarrierFiles(tenantId, 1), fileCarrierChoices(tenantId)]);
  const [address, senders] = list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId)]) : [null, null];
  return (
    <DataInPage
      step="files-in"
      title="Email"
      chip={<InfoTip label="About email" side="right">Create your agency&apos;s address once, then ask each carrier to send its reports to it, or forward them yourself. Add each carrier&apos;s sending address so its files are recognised: a file from an unknown sender still arrives, but waits until its carrier is known.</InfoTip>}
      breadcrumbs={[{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Files in", href: "/app/book-setup/how-files-arrive" }, { label: "Email" }]}
    >
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
    </DataInPage>
  );
}
