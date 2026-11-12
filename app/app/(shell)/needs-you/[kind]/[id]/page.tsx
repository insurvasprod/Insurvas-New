import Link from "next/link";
import { notFound } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { ItemDecide } from "@/components/app/book/needs-you/item-decide";
import { ItemTabs, itemTab, type ItemTab } from "@/components/app/book/needs-you/item-tabs";
import { RowAsSentTable } from "@/components/app/book/needs-you/row-as-sent";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { ageLong, isItemId, isNeedsYouKind, isNeedsYouView, KIND_META, neighbours, viewItems, type NeedsYouView } from "@/lib/needsYou/kinds";
import { needsYouScope } from "@/lib/needsYou/scope";
import { loadItemPage, loadNeedsYou, type ItemDetail } from "@/lib/needsYou/store";

const LINK = "font-medium text-[var(--accent-ink)] hover:underline";

/**
 * Round 3 (docs/la4/POLISH-ROUND3.md): what an item waits on that nobody here can save — a letter that is out,
 * a word Insurvas maps — as one muted line under the title, not a card.
 */
function waitsLine(detail: ItemDetail) {
  if (detail.kind === "money" && detail.finding.status === "disputed") {
    return <>A letter is out: record what {detail.finding.carrierName} did in <Link href="/app/discrepancies" className={LINK}>Money › Discrepancies</Link>; it stays here until then.</>;
  }
  if (detail.kind === "status-word") {
    const rows = detail.rows.toLocaleString("en-US");
    return <>Waiting on Insurvas to map this word: its {rows} {detail.rows === 1 ? "row is" : "rows are"} held until then, and run once it is mapped.{detail.firstSeenFileId && <> <Link href={`/app/carrier-files/file/${detail.firstSeenFileId}`} className={LINK}>Open the file it first came in</Link>.</>}</>;
  }
  return null;
}

/**
 * Book of business › Needs you › one item (owner 2026-11-02, round 2; it was a side sheet): the same page for
 * every kind. The kind's chip and where it came from, how long it has waited and whose it is, then Decide —
 * the evidence, the choices its own API accepts, and what saving does — and the carrier's row as sent. Saving
 * opens the next item of the list it was opened from. Opening it writes nothing.
 */
export default async function NeedsYouItemPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ from?: string; tab?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Needs you" description="Every decision your carrier files leave for a person." />;
  if (!actAsPagePermission(guard, "policies.view")) return <RoleGateNotice featureLabel="Needs you" detail="Decisions on your book are made by producers, bookkeepers and the account owner." />;
  // AG-0.5: as the list.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Needs you" detail="In an agency, the owner, admins and the bookkeeper make these decisions." />;

  const { kind, id: rawId } = await params;
  let id = rawId;
  try { id = decodeURIComponent(rawId); } catch { notFound(); }
  if (!isNeedsYouKind(kind) || !isItemId(kind, id)) notFound();

  const scope = await needsYouScope(guard);
  const [list, page] = await Promise.all([loadNeedsYou(scope), loadItemPage(scope, kind, id)]);
  const me = { userId: scope.userId, keeper: scope.keeper };
  const item = list.open.find((entry) => entry.kind === kind && entry.id === id) ?? null;
  const { from: asked, tab: askedTab } = await searchParams;
  // The list it was opened from; a status word cycles through the other status words.
  const fallback: Exclude<NeedsYouView, "closed"> = kind === "status-word" ? "insurvas" : scope.keeper ? "agency" : "mine";
  const chosen: Exclude<NeedsYouView, "closed"> = isNeedsYouView(asked) && asked !== "closed" && (scope.keeper || asked === "mine") ? asked : fallback;
  // An item that isn't in the list it names (opened from a link, or that list moved on) cycles through its own.
  const from = item && !viewItems(list.open, chosen, me).some((entry) => entry.kind === kind && entry.id === id) ? fallback : chosen;
  const listHref = `/app/needs-you?view=${from}`;

  if (!page || !item) {
    return (
      <DataInPage step="needs-you" title="This item is closed">
        <EmptyState title="Nothing to decide here any more" hint="Someone decided it, a newer file answered it, or it isn't yours to see. Your list has what still waits." action={<Button asChild><Link href={listHref}>Back to Needs you</Link></Button>} />
      </DataInPage>
    );
  }

  const items = viewItems(list.open, from, me);
  const place = neighbours(items, kind, id);
  const nextHref = place.next ? `${place.next.href}?from=${from}` : null;
  const meta = KIND_META[kind];
  const waits = waitsLine(page.detail);
  const tab = itemTab(askedTab, Boolean(page.row));
  const tabHref = (next: ItemTab) => `${item.href}?from=${from}${next === "row" ? "&tab=row" : ""}`;

  return (
    <DataInPage
      step="needs-you"
      title={item.about}
      // The item's parts on the title line (UI-CONSISTENCY §8a), as the other steps' tabs are.
      tabs={<ItemTabs current={tab} hasRow={Boolean(page.row)} href={tabHref} />}
      actions={nextHref ? <Button asChild variant="outline"><Link href={nextHref}>Skip</Link></Button> : undefined}
    >
      {/* Owner 2026-11-10: nothing beside or under the title; the kind leads the item's own line. */}
      {/* Owner 2026-11-11: one plain line, one chip (the kind; an escalated item's chip turns danger and says so). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-foreground">
        <StatusChip tone={item.escalated ? "danger" : item.tone}>{item.escalated ? `${meta.label} · escalated` : meta.label}</StatusChip>
        <span className="whitespace-nowrap">Waiting {ageLong(item.ageDays)}</span>
        <span className="whitespace-nowrap">Owner {item.who}</span>
        {place.index >= 0 && <span className="whitespace-nowrap tabular-nums">Item {place.index + 1} of {place.total}</span>}
        <span>{item.why}</span>
      </div>
      {waits && <p className="m-0 text-sm text-muted-foreground">{waits}</p>}
      <div id="needs-you-item-panel" role="tabpanel" aria-labelledby={`needs-you-item-panel-tab-${tab}`} className="flex min-w-0 flex-col gap-4">
        {tab === "row" && page.row ? <RowAsSentTable row={page.row} /> : <ItemDecide detail={page.detail} nextHref={nextHref} listHref={listHref} readOnly={guard.entitlement.access === "read_only"} />}
      </div>
    </DataInPage>
  );
}
