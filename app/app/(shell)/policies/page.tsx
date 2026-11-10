import Link from "next/link";

import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyBook } from "@/components/app/policy-book";
import { PolicyChangesTable } from "@/components/app/policy-changes-table";
import { PolicyEntryActions } from "@/components/app/policy-entry-actions";
import { carrierPicker } from "@/lib/carriers/agency";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { Callout } from "@/components/app/settings/primitives";
import { ViewTabs } from "@/components/ui/view-tabs";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { loadBook, loadHandPolicies, loadIssuedAwaiting, POLICY_BOOK_PENDING_MESSAGE } from "@/lib/ingestion/policyBookStore";
import { listPolicyChanges } from "@/lib/ingestion/snapshotStore";
import { loadBookMoney } from "@/lib/ingestion/policyMoneyStore";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";

type PoliciesView = "book" | "changes";

/**
 * Book of Business › Policies: one list (2026-10-08 overlap merge) of every policy the carriers'
 * files hold (LA-4.11, read from LA-4.7's current-state table, read-only) and every policy the
 * agency entered or imported by hand (LA-0.7, for carriers that send no file), and every sale recorded
 * as issued whose carrier file hasn't listed it yet (Module 4, Door 1), with a source filter.
 * Owner, producer and bookkeeper; a producer sees the policies credited to them or that they recorded.
 * Adding by hand is owner and producer, as the API.
 *
 * Round 5 (docs/la4/mockups-r5/book-commissions-r5.html, board 6): the book at a glance and where every
 * policy's money stands. The strip, the Health chip, the Commission bar and the Next date are worked out from
 * the ledger, the rate card, the open pay issues and policy_current (lib/ingestion/policyMoneyStore.ts); a
 * figure that can't be is "—". Each row opens its policy.
 *
 * Round 3 (docs/la4/POLISH-ROUND3.md): a "Book · Recent changes" switch. Recent changes (?view=changes) is
 * the old Carrier files › Policy changes view (LA-4.6), moved here because it is about policies; it keeps
 * that view's gates (statement ingestion, statements.view), since it lists every policy's changes, so a
 * producer sees only the Book. /app/carrier-files?view=changes redirects here.
 */
export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const readOnly = guard.entitlement.access === "read_only";
  const canAdd = !readOnly && guard.role !== "bookkeeper";
  // The address, this person's scope and the Add form's carriers are read at once, not one after the other (perf
  // pass 2026-11-08: three round trips in a row before the book itself was asked for).
  const early = Promise.all([searchParams, scopeFor(guard.context), canAdd ? carrierPicker(guard.context.tenantId).catch(() => []) : Promise.resolve([])]);
  // Recent changes: the gates Carrier files › Policy changes had.
  const ingestion = await guardPage("statement_ingestion");
  const canSeeChanges = ingestion.entitled && actAsPagePermission(ingestion, "statements.view");
  const [params, scope, carrierList] = await early;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
  const view: PoliciesView = params.view === "changes" && canSeeChanges ? "changes" : "book";
  const lead = canSeeChanges ? (
    <ViewTabs
      label="Policies views"
      value={view}
      tabs={[{ key: "book" as const, label: "Book", href: "/app/policies" }, { key: "changes" as const, label: "Recent changes", href: "/app/policies?view=changes" }]}
    />
  ) : undefined;
  const carriers = carrierList.map((carrier) => carrier.name);
  const actions = <PolicyEntryActions canAdd={canAdd} carriers={carriers} blockedReason={readOnly ? "Your account is read-only" : "Adding policies is for the owner and producers"} />;

  if (view === "changes") {
    // LA-4.6: what moved between the carriers' policy files.
    const changes = await listPolicyChanges(guard.context.tenantId);
    return (
      <DataInPage step="policies" tabs={lead} actions={actions}>
        <PolicyChangesTable
          changes={changes.changes}
          emptyTitle={changes.available ? "No policy has changed yet" : "Policy changes are not available yet"}
          emptyHint={changes.available ? "Changes appear when a carrier's next policy file differs from the one before it." : "They appear once the database update (20261008140000) is applied."}
        />
      </DataInPage>
    );
  }

  const lists = Promise.all([loadBook(viewer), loadHandPolicies(viewer), loadIssuedAwaiting(viewer).catch(() => [])]);
  // Where each policy's money stands, over exactly the rows this person may see. Its reads need only the tenant, so
  // they start now, beside the book's, and wait for the rows only to add them up (perf pass 2026-11-08).
  const moneyRead = loadBookMoney(guard.context.tenantId, lists.then(([book, hand, issued]) => [...(book.available ? book.rows : []), ...hand, ...issued])).catch((error) => {
    console.error("[policies] money", error);
    return null;
  });
  const [book, hand, issued] = await lists;
  // The old "Entered by hand" tab address lands on the same list, filtered to that source.
  const query = new URLSearchParams([...Object.entries(params).flatMap(([key, value]) => (typeof value === "string" && key !== "view" ? [[key, value]] : [])), ...(params.view === "entered" && !params.source ? [["source", "hand"]] : [])]).toString();
  const rows = [...(book.available ? book.rows : []), ...hand, ...issued];
  const unpriced = book.available ? book.unpriced : null;
  const money = await moneyRead;
  const listRows = rows.map((row) => ({ ...row, money: money?.byKey.get(`${row.carrierId}|${row.policyNumber}`) ?? null }));

  return (
    <DataInPage step="policies" tabs={lead} actions={actions}>
      {/* LA-4.13: the share of the book no rate can check, and the one place to fix it — one line (round 3). */}
      {unpriced && (
        <Callout tone="warning" title={`${unpriced.top.policies.toLocaleString("en-US")} ${unpriced.top.carrierName} ${unpriced.top.policies === 1 ? "policy" : "policies"}, $${Math.round(unpriced.top.monthlyCents / 100).toLocaleString("en-US")}/mo, have no rate, so their commission can't be checked${unpriced.carriers > 1 ? ` (${unpriced.policies.toLocaleString("en-US")} policies across ${unpriced.carriers} carriers in all)` : ""}.`}>
          {guard.role !== "producer" && <Link href="/app/rate-card" className="font-semibold underline">Add rates</Link>}
        </Callout>
      )}
      {!book.available && <Callout tone="warning" title={POLICY_BOOK_PENDING_MESSAGE} />}
      {!money && rows.length > 0 && <Callout tone="warning" title="Where each policy's money stands couldn't be worked out just now, so those figures show —. Reload to try again." />}
      {(book.available || hand.length > 0 || issued.length > 0) && (
        <PolicyBook rows={listRows} strip={money?.strip ?? null} initialQuery={query} saved={book.available ? book.savedFilters : []} savedAvailable={book.available && book.savedFiltersAvailable} scoped={guard.role === "producer"} readOnly={readOnly} canAddRate={!readOnly && holdsAnyRole(guard.roles, ["owner", "bookkeeper"])} />
      )}
    </DataInPage>
  );
}
