import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PoliciesWorkspace } from "@/components/app/policies-workspace";
import { PolicyBook } from "@/components/app/policy-book";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { guardPage } from "@/lib/entitlements/guardPage";
import { loadBook, POLICY_BOOK_PENDING_MESSAGE } from "@/lib/ingestion/policyBookStore";

/**
 * Book of Business › Policies. Two views of one menu item:
 *   · From carrier files (LA-4.11, the default): every policy the carriers' files hold, read from
 *     LA-4.7's current-state table. Carrier data is read-only.
 *   · Entered by hand (LA-0.7): the agency's own list, which the dashboard, ledger and lapse radar
 *     still read until they move onto the carrier book.
 * Owner, producer and bookkeeper; a producer's carrier view holds the policies credited to them.
 */
export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const readOnly = guard.entitlement.access === "read_only";
  const params = await searchParams;
  const handView = params.view === "entered";
  const tabs = (count?: number) => (
    <ViewTabs
      label="Policy views"
      active={handView ? "entered" : "carrier"}
      tabs={[
        { key: "carrier", label: "From carrier files", count, href: "/app/policies" },
        { key: "entered", label: "Entered by hand", href: "/app/policies?view=entered" },
      ]}
    />
  );

  // The header lives in the workspace there: its Import and Add actions open the workspace's dialogs.
  if (handView) return <PoliciesWorkspace readOnly={readOnly} tabs={tabs()} />;

  const book = await loadBook({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  const query = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (typeof value === "string" && key !== "view" ? [[key, value]] : []))).toString();

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Policies" description="Every policy in your carriers' files, as of their latest file. Open one for its money, history and source." />
      {tabs(book.available ? book.rows.length : undefined)}
      {book.available ? (
        <PolicyBook rows={book.rows} initialQuery={query} saved={book.savedFilters} savedAvailable={book.savedFiltersAvailable} scoped={book.scoped} readOnly={readOnly} />
      ) : (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{POLICY_BOOK_PENDING_MESSAGE}</div>
      )}
    </div>
  );
}
