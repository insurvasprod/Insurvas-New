import Link from "next/link";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { NeedsYouList } from "@/components/app/book/needs-you/needs-you-list";
import { ReviewOldest } from "@/components/app/book/needs-you/review-oldest";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { ViewTabs } from "@/components/ui/view-tabs";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fromFile, isNeedsYouView, NEEDS_YOU_GROUPS, searchParam, VIEW_LABELS, viewItems, type NeedsYouGroup, type NeedsYouItem, type NeedsYouView } from "@/lib/needsYou/kinds";
import { needsYouScope } from "@/lib/needsYou/scope";
import { loadFileFilter, loadNeedsYou } from "@/lib/needsYou/store";

/**
 * Book of business › Needs you (owner 2026-11-02, round 2): every decision the carrier files leave for a person,
 * in one list — clients to pick, sales no carrier has, money that doesn't match, credit, agent codes, status
 * words — each opening its own item page. Opening it writes nothing.
 *
 * Round 4 (owner 2026-11-02): each item is decided under its row, and items alike fold into one line.
 *
 * Policy matching and Exceptions keep their addresses inside this step, for what this list doesn't replace:
 * the links made (with Reopen) and the match accuracy, and who owns each queue.
 */
export default async function NeedsYouPage({ searchParams }: { searchParams: Promise<{ view?: string; file?: string; group?: string; q?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Needs you" description="Every decision your carrier files leave for a person." />;
  if (!actAsPagePermission(guard, "policies.view")) return <RoleGateNotice featureLabel="Needs you" detail="Decisions on your book are made by producers, bookkeepers and the account owner." />;
  // AG-0.5: inside an agency these decisions reach across producers' books, so a narrow session is refused, as Exceptions.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Needs you" detail="In an agency, the owner, admins and the bookkeeper make these decisions." />;

  // Lapse risk (LA-4.16) opens from here (owner 2026-11-02: "Lapse risk → Needs you"), by its own route's rule.
  const [scope, radar] = await Promise.all([needsYouScope(guard), guardPage("chargeback_radar")]);
  const lapseRisk = radar.entitled && actAsPage(radar, ["owner", "producer", "retention"]);
  const { view: asked, file: fileId, group: askedGroup, q } = await searchParams;
  // Files › "Open all in Needs you": only what that one file left (an unknown file shows everything).
  const [list, file] = await Promise.all([loadNeedsYou(scope), fileId && isRecordUuid(fileId) ? loadFileFilter(scope.tenantId, fileId) : null]);
  const me = { userId: scope.userId, keeper: scope.keeper };
  // A producer's own items are the whole of what they see, so Agency would repeat Mine.
  const views: NeedsYouView[] = scope.keeper ? ["mine", "agency", "insurvas", "closed"] : ["mine", "closed"];
  const view: NeedsYouView = isNeedsYouView(asked) && views.includes(asked) ? asked : scope.keeper ? "agency" : "mine";
  const keep = (items: NeedsYouItem[]) => (file ? items.filter((entry) => fromFile(entry, file)) : items);
  const itemsOf = (v: NeedsYouView) => keep(v === "closed" ? list.closed : viewItems(list.open, v, me));
  const fileQuery = file ? `&file=${file.fileId}` : "";
  const items = itemsOf(view);
  const oldest = view === "closed" ? null : items[0] ?? null;

  return (
    <DataInPage
      step="needs-you"
      lead={<ViewTabs label="Needs you views" value={view} tabs={views.map((v) => ({ key: v, label: VIEW_LABELS[v], count: v === "closed" ? null : itemsOf(v).length, href: `/app/needs-you?view=${v}${fileQuery}` }))} />}
      actions={oldest ? <ReviewOldest fileId={file?.fileId ?? null} view={view} /> : undefined}
    >
      {/* Round 3: the sources that could not be read, as one line. */}
      {list.notes.length > 0 && <Callout tone="warning" title={list.notes.join(" · ")} />}
      <NeedsYouList items={items} view={view} initialGroup={(NEEDS_YOU_GROUPS as readonly string[]).includes(askedGroup ?? "") ? (askedGroup as NeedsYouGroup) : "all"} readOnly={guard.entitlement.access === "read_only"} fromFile={file ? { name: file.name, clearHref: `/app/needs-you?view=${view}` } : null} initialQuery={searchParam(q) ?? ""} />
      {/* Round 3: no explainer line, just the two older views by name. */}
      {(scope.keeper || lapseRisk) && (
        <p className="m-0 flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          {lapseRisk && <Link href="/app/lapse-risk" className="font-medium text-[var(--accent-ink)] hover:underline">Lapse risk: who to call today</Link>}
          {scope.keeper && <Link href="/app/policy-matching?tab=links" className="font-medium text-[var(--accent-ink)] hover:underline">Client links and Reopen</Link>}
          {scope.keeper && <Link href="/app/exceptions" className="font-medium text-[var(--accent-ink)] hover:underline">Queue owners and closed items</Link>}
        </p>
      )}
    </DataInPage>
  );
}
