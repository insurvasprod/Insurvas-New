import { Suspense, type ReactNode } from "react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { MoreMenu } from "@/components/app/book/files/more-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { NeedsYouList } from "@/components/app/book/needs-you/needs-you-list";
import { ReviewOldest } from "@/components/app/book/needs-you/review-oldest";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { PageLoading } from "@/components/ui/page-loading";
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
  const me = { userId: scope.userId, keeper: scope.keeper };
  // Speed pass 2026-11-12: the title, the rail and the views draw at once; the list (every source read, about 4 s
  // on a large book) streams in under them. Its read starts here and each part below waits for it.
  const read = Promise.all([loadNeedsYou(scope), fileId && isRecordUuid(fileId) ? loadFileFilter(scope.tenantId, fileId) : null]).then(([list, file]) => {
    const keep = (items: NeedsYouItem[]) => (file ? items.filter((entry) => fromFile(entry, file)) : items);
    return { list, file, itemsOf: (v: NeedsYouView) => keep(v === "closed" ? list.closed : viewItems(list.open, v, me)) };
  });
  // A producer's own items are the whole of what they see, so Agency would repeat Mine.
  const views: NeedsYouView[] = scope.keeper ? ["mine", "agency", "insurvas", "closed"] : ["mine", "closed"];
  const view: NeedsYouView = isNeedsYouView(asked) && views.includes(asked) ? asked : scope.keeper ? "agency" : "mine";
  // The file filter is in the address, so the views' links keep it without waiting for the file's own read.
  const fileQuery = fileId && isRecordUuid(fileId) ? `&file=${fileId}` : "";
  const tabsOf = (count: (v: NeedsYouView) => number | null) => <ViewTabs label="Needs you views" value={view} tabs={views.map((v) => ({ key: v, label: VIEW_LABELS[v], count: v === "closed" ? null : count(v), href: `/app/needs-you?view=${v}${fileQuery}` }))} />;

  // Round 6 (owner 2026-11-06): the two older views go in More, not as loose links under the table.
  const more = [
    ...(lapseRisk ? [{ label: "Lapse risk: who to call today", href: "/app/lapse-risk" }] : []),
    ...(scope.keeper ? [{ label: "Client links and Reopen", href: "/app/policy-matching?tab=links" }, { label: "Queue owners and closed items", href: "/app/exceptions" }] : []),
  ];
  return (
    <DataInPage
      step="needs-you"
      // Why you came and what to do (round 6): behind the title's (i), never a notice on the page.
      chip={<InfoTip label="About Needs you" side="right">
        Every decision the carrier files leave for a person: a client to pick, a sale no carrier has, money that doesn&apos;t match, an agent code nobody owns. Each row&apos;s button says what to do; it opens the Review page at that item, and the row leaves the list when it is decided.
        <br /><br /><b>Mine</b> is what is assigned to you. <b>Agency</b> is everyone&apos;s. <b>Waiting on Insurvas</b> is a status word only Insurvas can map; nothing to do. <b>Closed</b> is the last 30 days. The oldest first; amber after 30 days, red after 90.
      </InfoTip>}
      tabs={<Suspense fallback={tabsOf(() => null)}><NeedsYouTabs read={read} tabsOf={tabsOf} /></Suspense>}
      actions={<><Suspense fallback={null}><Oldest read={read} view={view} /></Suspense><MoreMenu items={more} /></>}
    >
      <Suspense fallback={<PageLoading header={false} strip={false} />}>
        <NeedsYouBody read={read} view={view} group={(NEEDS_YOU_GROUPS as readonly string[]).includes(askedGroup ?? "") ? (askedGroup as NeedsYouGroup) : "all"} readOnly={guard.entitlement.access === "read_only"} q={q} />
      </Suspense>
    </DataInPage>
  );
}

type NeedsYouRead = Promise<{ list: Awaited<ReturnType<typeof loadNeedsYou>>; file: Awaited<ReturnType<typeof loadFileFilter>> | null; itemsOf: (v: NeedsYouView) => NeedsYouItem[] }>;

/** The views with their counts, once the list is read (the fallback draws the same tabs without counts). */
async function NeedsYouTabs({ read, tabsOf }: { read: NeedsYouRead; tabsOf: (count: (v: NeedsYouView) => number | null) => ReactNode }) {
  const { itemsOf } = await read;
  return tabsOf((v) => itemsOf(v).length);
}

/** "Review the oldest", only when the view has something open. */
async function Oldest({ read, view }: { read: NeedsYouRead; view: NeedsYouView }) {
  const { itemsOf, file } = await read;
  return view !== "closed" && itemsOf(view)[0] ? <ReviewOldest fileId={file?.fileId ?? null} view={view} /> : null;
}

async function NeedsYouBody({ read, view, group, readOnly, q }: { read: NeedsYouRead; view: NeedsYouView; group: NeedsYouGroup | "all"; readOnly: boolean; q: string | undefined }) {
  const { list, file, itemsOf } = await read;
  return (
    <>
      {/* Round 3: the sources that could not be read, as one line. */}
      {list.notes.length > 0 && <Callout tone="warning" title={list.notes.join(" · ")} />}
      <NeedsYouList items={itemsOf(view)} view={view} initialGroup={group} readOnly={readOnly} fromFile={file ? { name: file.name, clearHref: `/app/needs-you?view=${view}` } : null} initialQuery={searchParam(q) ?? ""} />
    </>
  );
}
