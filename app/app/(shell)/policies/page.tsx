import Link from "next/link";

import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyBook } from "@/components/app/policy-book";
import { PolicyEntryActions } from "@/components/app/policy-entry-actions";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { scopeFor } from "@/lib/agency/visibility";
import { guardPage } from "@/lib/entitlements/guardPage";
import { loadBook, loadHandPolicies, loadIssuedAwaiting, POLICY_BOOK_PENDING_MESSAGE } from "@/lib/ingestion/policyBookStore";

/**
 * Book of Business › Policies: one list (2026-10-08 overlap merge) of every policy the carriers'
 * files hold (LA-4.11, read from LA-4.7's current-state table, read-only) and every policy the
 * agency entered or imported by hand (LA-0.7, for carriers that send no file), and every sale recorded
 * as issued whose carrier file hasn't listed it yet (Module 4, Door 1), with a source filter.
 * Owner, producer and bookkeeper; a producer sees the policies credited to them or that they recorded.
 * Adding by hand is owner and producer, as the API.
 */
export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const readOnly = guard.entitlement.access === "read_only";
  const params = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const [book, hand, issued] = await Promise.all([loadBook(viewer), loadHandPolicies(viewer), loadIssuedAwaiting(viewer).catch(() => [])]);
  // The old "Entered by hand" tab address lands on the same list, filtered to that source.
  const query = new URLSearchParams([...Object.entries(params).flatMap(([key, value]) => (typeof value === "string" && key !== "view" ? [[key, value]] : [])), ...(params.view === "entered" && !params.source ? [["source", "hand"]] : [])]).toString();
  const canAdd = !readOnly && guard.role !== "bookkeeper";
  const rows = [...(book.available ? book.rows : []), ...hand, ...issued];

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Policies"
        description="Every policy in your carriers' files, as of their latest file, and any you entered by hand. Open one for its money, history and source."
        actions={<PolicyEntryActions canAdd={canAdd} blockedReason={readOnly ? "Your account is read-only" : "Adding policies is for the owner and producers"} />}
      />
      {/* LA-4.13: the share of the book no rate can check, and the one place to fix it. */}
      {book.available && book.unpriced && (
        <p role="status" className="m-0 rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          {book.unpriced.top.policies.toLocaleString("en-US")} {book.unpriced.top.carrierName} {book.unpriced.top.policies === 1 ? "policy" : "policies"}, ${Math.round(book.unpriced.top.monthlyCents / 100).toLocaleString("en-US")}/mo, have no rate, so their commission can&apos;t be checked{book.unpriced.carriers > 1 ? ` (${book.unpriced.policies.toLocaleString("en-US")} policies across ${book.unpriced.carriers} carriers in all)` : ""}.{" "}
          {guard.role !== "producer" && <Link href="/app/rate-card" className="font-semibold underline">Add rates</Link>}
        </p>
      )}
      {!book.available && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{POLICY_BOOK_PENDING_MESSAGE}</div>
      )}
      {(book.available || hand.length > 0 || issued.length > 0) && (
        <PolicyBook rows={rows} initialQuery={query} saved={book.available ? book.savedFilters : []} savedAvailable={book.available && book.savedFiltersAvailable} scoped={guard.role === "producer"} readOnly={readOnly} />
      )}
    </div>
  );
}
