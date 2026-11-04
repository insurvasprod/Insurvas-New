import Link from "next/link";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { BookImport } from "@/components/app/book-import";
import { CarrierBucket } from "@/components/app/carrier-bucket";
import { CarrierFileDoors } from "@/components/app/carrier-file-doors";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { agencyTimezone, BUCKET_PENDING_MESSAGE, loadBucketView } from "@/lib/ingestion/bucketStore";
import { BOOK_IMPORT_PENDING_MESSAGE, loadBookImport } from "@/lib/ingestion/bookImport";
import { bookAdvanceAtRisk } from "@/lib/ingestion/commissionLedgerStore";
import { isoDate } from "@/lib/ingestion/path";
import { moneyOrUnknown } from "@/lib/ingestion/policyCurrent";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { fileCarrierChoices } from "@/lib/carriers/agency";

/**
 * Book of business › Setup › Files in (board 8 and 23 of docs/la4/mockups-r5/book-commissions-r5.html): two sections.
 *
 *   How files arrive          the three doors a carrier file comes in by — upload, the agency's email address with
 *                             its known senders, and the bucket (round 3: moved here from Carrier files). The same
 *                             components and loaders that view used; /app/carrier-files?view=doors, ?view=bucket and
 *                             ?view=arrive redirect here.
 *   Bring your existing book  the onboarding import (LA-4.10): each carrier's latest policy file through the ordinary
 *                             pipeline. /app/book-import renders this same page, so its old links still land.
 *
 * Owner and bookkeeper, like every Setup tab; writing (upload, the address, senders, Check now, an import) is paused
 * while the account is read-only, as before. Opening it writes nothing.
 */
export default async function SetupFilesInPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const { date } = await searchParams;
  // Whether the carrier-file tables are in (one row is enough to tell).
  const [list, carriers, view, advance] = await Promise.all([
    listCarrierFiles(tenantId, 1),
    fileCarrierChoices(tenantId),
    loadBookImport(tenantId),
    bookAdvanceAtRisk(tenantId).catch(() => ({ cents: null, policies: 0, unknown: 0 })),
  ]);
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
    <DataInPage step="setup" lead={<SetupTabs active="files-in" tenantId={tenantId} />} actions={upload}>
      <section aria-labelledby="files-in-arrive" className="grid gap-4">
        <h2 id="files-in-arrive" className="text-card-title text-[var(--ink)]">How files arrive</h2>
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
      </section>

      <section id="existing-book" aria-labelledby="files-in-book" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="files-in-book" className="text-card-title text-[var(--ink)]">Bring your existing book</h2>
          {view.available && view.totals.policies > 0 && <Link href="/app/exceptions" className={buttonVariants({ variant: "outline" })}>Look over imported clients</Link>}
        </div>
        {!view.available ? (
          <Callout tone="warning" title={BOOK_IMPORT_PENDING_MESSAGE} />
        ) : (
          <>
            <StatStrip label="Your book so far">
              <StatTile label="Carriers done" value={`${view.done} of ${view.carriers.length}`} footnote="imported or skipped for now" />
              <StatTile label="Policies" value={view.totals.policies.toLocaleString("en-US")} footnote="in your book now" />
              <StatTile label="Premium a month" value={`$${Math.round(view.totals.monthlyPremiumCents / 100).toLocaleString("en-US")}`} footnote={`${view.totals.atRisk.toLocaleString("en-US")} ${view.totals.atRisk === 1 ? "policy" : "policies"} at risk`} valueTone={view.totals.atRisk ? "warning" : undefined} />
              <StatTile label="Persistency" value={view.persistency.ready ? "Ready" : "Building"} footnote={view.persistency.ready ? "enough months of files" : view.persistency.label.replace(/^building — /, "")} />
              <StatTile label="Advances at risk" value={moneyOrUnknown(advance.cents)} footnote={advance.cents === null ? "until commission statements arrive" : `unearned, on ${advance.policies} ${advance.policies === 1 ? "policy" : "policies"} with an advance${advance.unknown ? ` · ${advance.unknown} more not known yet` : ""}`} />
            </StatStrip>
            <BookImport carriers={view.carriers} processing={view.processing} readOnly={readOnly} />
          </>
        )}
      </section>
    </DataInPage>
  );
}
