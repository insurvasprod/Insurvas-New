import Link from "next/link";
import { redirect } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { BookImport } from "@/components/app/book-import";
import { FILES_IN_HREF, FilesInTabs } from "@/components/app/book/setup/files-in-tabs";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { agencyTimezone, loadBucketView } from "@/lib/ingestion/bucketStore";
import { BOOK_IMPORT_PENDING_MESSAGE, loadBookImport } from "@/lib/ingestion/bookImport";
import { bookAdvanceAtRisk } from "@/lib/ingestion/commissionLedgerStore";
import { isoDate } from "@/lib/ingestion/path";
import { moneyOrUnknown } from "@/lib/ingestion/policyCurrent";
import { CARRIER_FILES_PENDING_MESSAGE, listCarrierFiles, listSenders } from "@/lib/ingestion/registry";
import { fileCarrierChoices } from "@/lib/carriers/agency";

/**
 * Carrier sync › Files in › Your carriers. r7 4·A (owner 2026-11-10, "Build all four"): the three ways a file comes
 * in are the sub-page bar on the title line — Your carriers · Email · Bucket (FilesInTabs), each tab its own address
 * (/email, /bucket) — and the three cards between the strip and the table are gone: the Email address heads the
 * Email tab, the missing files are the Bucket tab's red count. Upload a file is once, on the title line.
 * Below the book's strip, each carrier's folder: where to find its latest policy file, and whether it is in
 * (Bring your existing book, LA-4.10); a row opens its import dialog. /app/book-import renders this same page, and
 * the old ?date= (the bucket's day) lands on the Bucket tab.
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
  // The tabs' counts: the known senders (Email) and the open missing files (Bucket).
  const [senders, zone] = list.available ? await Promise.all([listSenders(tenantId), agencyTimezone(tenantId)]) : [null, null];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: zone ?? "America/New_York" });
  const bucket = zone ? await loadBucketView(tenantId, today).catch(() => null) : null;
  const blocked = !list.available ? CARRIER_FILES_PENDING_MESSAGE : readOnly ? "Receiving files is paused while the account is read-only." : null;
  const upload = (
    <>
      {view.available && view.totals.policies > 0 && <Link href="/app/exceptions" className={buttonVariants({ variant: "outline" })}>Look over imported clients</Link>}
      {blocked ? <Button type="button" disabled title={blocked}>Upload a file</Button> : <CarrierFileUploadButton carriers={carriers} openWhenDone />}
    </>
  );
  const counts = {
    carriers: view.available ? view.carriers.length - view.done : null,
    email: senders ? senders.senders.length : null,
    bucket: bucket?.available ? bucket.missing.length : null,
  };

  return (
    <DataInPage step="files-in" actions={upload}
      tabs={<FilesInTabs active="carriers" counts={counts} />}
      chip={<InfoTip label="About Files in" side="right">How your carriers&apos; files reach Insurvas, and your book as it stands. Upload a file any time; or give each carrier your agency&apos;s email address (Email), or let a script drop files in the bucket (Bucket), and they arrive on their own. When you start, bring in each carrier&apos;s latest in-force file from Your carriers: open a carrier, or drop its file on its row. That is your existing book.</InfoTip>}
    >
      {!view.available ? (
        <TableCard><EmptyState title="Importing a book needs a database update" hint={BOOK_IMPORT_PENDING_MESSAGE} /></TableCard>
      ) : (
        <>
          <StatStrip label="Your book so far">
            <StatTile label="Carriers done" value={`${view.done} of ${view.carriers.length}`} footnote={view.done < view.carriers.length ? <StatusChip tone="warning">{`${view.carriers.length - view.done} to go`}</StatusChip> : "imported or skipped for now"} />
            <StatTile label="Policies" value={view.totals.policies.toLocaleString("en-US")} footnote="in your book now" href="/app/policies" />
            <StatTile label="Premium a month" value={`$${Math.round(view.totals.monthlyPremiumCents / 100).toLocaleString("en-US")}`} footnote={view.totals.atRisk ? <StatusChip tone="warning">{`${view.totals.atRisk.toLocaleString("en-US")} ${view.totals.atRisk === 1 ? "policy" : "policies"} at risk`}</StatusChip> : "0 policies at risk"} href={view.totals.atRisk ? "/app/policies?show=risk" : undefined} />
            <StatTile label="Persistency" value={view.persistency.ready ? "Ready" : "Building"} footnote={view.persistency.ready ? "enough months of files" : view.persistency.label.replace(/^building — /, "")} />
            <StatTile label="Advances at risk" value={moneyOrUnknown(advance.cents)} footnote={advance.cents === null ? "until commission statements arrive" : `unearned, on ${advance.policies} ${advance.policies === 1 ? "policy" : "policies"} with an advance${advance.unknown ? ` · ${advance.unknown} more not known yet` : ""}`} />
          </StatStrip>
          <section id="existing-book" aria-label="Your carriers" className="grid min-w-0">
            <BookImport carriers={view.carriers} processing={view.processing} readOnly={readOnly} />
          </section>
        </>
      )}
    </DataInPage>
  );
}
