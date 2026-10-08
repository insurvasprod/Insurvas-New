import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { BookImport } from "@/components/app/book-import";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { BOOK_IMPORT_PENDING_MESSAGE, loadBookImport } from "@/lib/ingestion/bookImport";
import { bookAdvanceAtRisk } from "@/lib/ingestion/commissionLedgerStore";
import { moneyOrUnknown } from "@/lib/ingestion/policyCurrent";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Import your book (LA-4.10, Notion sprint): the latest policy file from each
 * carrier portal, through the ordinary pipeline, so the book is there on day one. Owner and
 * bookkeeper. Opening the page writes nothing.
 */
export default async function BookImportPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Import your book" description="Bring in your existing book from each carrier's latest policy file." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Import your book" detail="The book is imported by the account owner or a bookkeeper." />;
  const [view, advance] = await Promise.all([loadBookImport(guard.context.tenantId), bookAdvanceAtRisk(guard.context.tenantId).catch(() => ({ cents: null, policies: 0, unknown: 0 }))]);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Import your book"
        description="Upload each carrier's latest policy file, or drop it on the carrier's row. Each one is read as soon as it arrives."
        actions={view.available && view.totals.policies > 0 ? <Link href="/app/exceptions" className={buttonVariants({ variant: "outline" })}>Look over imported clients</Link> : undefined}
      />
      {!view.available ? (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{BOOK_IMPORT_PENDING_MESSAGE}</div>
      ) : (
        <>
          <StatStrip label="Your book so far">
            <StatTile label="Carriers done" value={`${view.done} of ${view.carriers.length}`} footnote="imported or skipped for now" />
            <StatTile label="Policies" value={view.totals.policies.toLocaleString("en-US")} footnote="in your book now" />
            <StatTile label="Premium a month" value={`$${Math.round(view.totals.monthlyPremiumCents / 100).toLocaleString("en-US")}`} footnote={`${view.totals.atRisk.toLocaleString("en-US")} ${view.totals.atRisk === 1 ? "policy" : "policies"} at risk`} valueTone={view.totals.atRisk ? "warning" : undefined} />
            <StatTile label="Persistency" value={view.persistency.ready ? "Ready" : "Building"} footnote={view.persistency.ready ? "enough months of files" : view.persistency.label.replace(/^building — /, "")} />
            <StatTile label="Advances at risk" value={moneyOrUnknown(advance.cents)} footnote={advance.cents === null ? "until commission statements arrive" : `unearned, on ${advance.policies} ${advance.policies === 1 ? "policy" : "policies"} with an advance${advance.unknown ? ` · ${advance.unknown} more not known yet` : ""}`} />
          </StatStrip>
          <BookImport carriers={view.carriers} others={view.others} processing={view.processing} readOnly={guard.entitlement.access === "read_only"} />
        </>
      )}
    </div>
  );
}
