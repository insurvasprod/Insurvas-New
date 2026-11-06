import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderInput, Mail, Upload } from "lucide-react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { BookImport } from "@/components/app/book-import";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { agencyTimezone, loadBucketView } from "@/lib/ingestion/bucketStore";
import { BOOK_IMPORT_PENDING_MESSAGE, loadBookImport } from "@/lib/ingestion/bookImport";
import { bookAdvanceAtRisk } from "@/lib/ingestion/commissionLedgerStore";
import { isoDate } from "@/lib/ingestion/path";
import { moneyOrUnknown } from "@/lib/ingestion/policyCurrent";
import { CARRIER_FILES_PENDING_MESSAGE, getInboundAddress, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { fileCarrierChoices } from "@/lib/carriers/agency";

const FILES_IN_HREF = "/app/book-setup/how-files-arrive";

/**
 * Carrier sync › Files in (round 6, owner 2026-11-06: "keep the cards and the folders at the top, and make email and the
 * bucket a sub page"). Top: the book so far as the mockups' strip, then the three ways a file comes in as three cards —
 * Upload (here), Email and the Bucket, each a page of its own under this address (/email, /bucket) — then each
 * carrier's folder: where to find its latest policy file, and whether it is in (Bring your existing book, LA-4.10).
 * /app/book-import renders this same page, and the old ?date= (the bucket's day) lands on the Bucket page.
 *
 * Owner and bookkeeper, like every Setup page; writing is paused while the account is read-only. Opening it writes nothing.
 */
export default async function SetupFilesInPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Files in" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Files in" detail="Setup is for the account owner and bookkeepers." />;
  const { date } = await searchParams;
  if (date && isoDate(date)) redirect(`${FILES_IN_HREF}/bucket?date=${date}`);

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [list, carriers, view, advance] = await Promise.all([
    listCarrierFiles(tenantId, 1),
    fileCarrierChoices(tenantId),
    loadBookImport(tenantId),
    bookAdvanceAtRisk(tenantId).catch(() => ({ cents: null, policies: 0, unknown: 0 })),
  ]);
  const [address, senders, zone] = list.available ? await Promise.all([getInboundAddress(tenantId), listSenders(tenantId), agencyTimezone(tenantId)]) : [null, null, null];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: zone ?? "America/New_York" });
  const bucket = zone ? await loadBucketView(tenantId, today).catch(() => null) : null;
  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  const upload = blocked
    ? <Button type="button" disabled title={blocked}>Upload a file</Button>
    : <CarrierFileUploadButton carriers={carriers} openWhenDone />;

  const senderCount = senders?.senders.length ?? 0;
  const bucketToday = bucket?.available ? bucket.rows.length : null;
  const bucketMissing = bucket?.available ? bucket.missing.length : 0;

  return (
    <DataInPage step="files-in" actions={upload}
      chip={<InfoTip label="About Files in" side="right">How your carriers&apos; files reach Insurvas, and your book as it stands. Upload a file any time; or give each carrier your agency&apos;s email address, or let a script drop files in the bucket, and they arrive on their own. When you start, bring in each carrier&apos;s latest in-force file from the list below: that is your existing book.</InfoTip>}
    >
      {!view.available ? <Callout tone="warning" title={BOOK_IMPORT_PENDING_MESSAGE} /> : (
        <StatStrip label="Your book so far">
          <StatTile label="Carriers done" value={`${view.done} of ${view.carriers.length}`} footnote="imported or skipped for now" valueTone={view.done < view.carriers.length ? "warning" : undefined} />
          <StatTile label="Policies" value={view.totals.policies.toLocaleString("en-US")} footnote="in your book now" />
          <StatTile label="Premium a month" value={`$${Math.round(view.totals.monthlyPremiumCents / 100).toLocaleString("en-US")}`} footnote={`${view.totals.atRisk.toLocaleString("en-US")} ${view.totals.atRisk === 1 ? "policy" : "policies"} at risk`} valueTone={view.totals.atRisk ? "warning" : undefined} />
          <StatTile label="Persistency" value={view.persistency.ready ? "Ready" : "Building"} footnote={view.persistency.ready ? "enough months of files" : view.persistency.label.replace(/^building — /, "")} />
          <StatTile label="Advances at risk" value={moneyOrUnknown(advance.cents)} footnote={advance.cents === null ? "until commission statements arrive" : `unearned, on ${advance.policies} ${advance.policies === 1 ? "policy" : "policies"} with an advance${advance.unknown ? ` · ${advance.unknown} more not known yet` : ""}`} />
        </StatStrip>
      )}

      {/* The three ways in, as cards: each says where it stands and opens its own page. */}
      <section aria-label="How files arrive" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload aria-hidden="true" className="size-4 text-muted-foreground" />Upload</CardTitle>
            <CardDescription>Any carrier, any file, from your computer. The quickest way in.</CardDescription>
            <CardAction>{blocked ? <Button type="button" variant="outline" size="sm" disabled title={blocked}>Upload</Button> : <CarrierFileUploadButton carriers={carriers} openWhenDone label="Upload" variant="outline" size="sm" />}</CardAction>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Mail aria-hidden="true" className="size-4 text-muted-foreground" />Email</CardTitle>
            <CardDescription>
              {!address ? "Not available yet." : !address.address ? "No address yet: create one, then give it to each carrier." : `${address.address} · ${senderCount ? `${senderCount} known ${senderCount === 1 ? "sender" : "senders"}` : "no known senders yet"}`}
            </CardDescription>
            <CardAction><Link href={`${FILES_IN_HREF}/email`} className={buttonVariants({ variant: address && !address.address ? "default" : "outline", size: "sm" })}>{address && !address.address ? "Set it up" : "Open"}</Link></CardAction>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FolderInput aria-hidden="true" className="size-4 text-muted-foreground" />Bucket</CardTitle>
            <CardDescription>
              {bucketToday === null ? "Not available yet." : `${bucketToday ? `${bucketToday.toLocaleString("en-US")} ${bucketToday === 1 ? "file" : "files"}` : "Nothing"} dropped today${bucketMissing ? ` · ${bucketMissing} expected ${bucketMissing === 1 ? "file is" : "files are"} missing` : ""}. For scripts that drop files by day, carrier and kind.`}
            </CardDescription>
            <CardAction><Link href={`${FILES_IN_HREF}/bucket`} className={buttonVariants({ variant: bucketMissing ? "default" : "outline", size: "sm" })}>Open</Link></CardAction>
          </CardHeader>
        </Card>
      </section>

      {/* Each carrier's folder: where its latest policy file is, and whether it is in. */}
      {view.available && (
        <section id="existing-book" aria-labelledby="files-in-book" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="files-in-book" className="text-card-title text-[var(--ink)]">Your carriers</h2>
            {view.totals.policies > 0 && <Link href="/app/exceptions" className={buttonVariants({ variant: "outline" })}>Look over imported clients</Link>}
          </div>
          <BookImport carriers={view.carriers} processing={view.processing} readOnly={readOnly} />
        </section>
      )}
    </DataInPage>
  );
}
