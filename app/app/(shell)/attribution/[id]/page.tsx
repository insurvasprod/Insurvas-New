import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { CreditDecide, CREDIT_FORM_ID } from "@/components/app/commissions/credit/credit-decide";
import { ageDays, ageTone, CREDIT_HREF, itemHref, nameOf, policyPageHref, statementRowHref, titleOf } from "@/components/app/commissions/credit/credit-core";
import { NeighbourLinks } from "@/components/app/commissions/producer-pay/neighbour-links";
import { RowAsSentTable } from "@/components/app/book/needs-you/row-as-sent";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { dollars } from "@/lib/agency/constants";
import { readCreditQueue } from "@/lib/agency/moneyStores";
import { readRoster } from "@/lib/agency/producerStore";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { fileDay } from "@/lib/ingestion/constants";
import { loadItemPage } from "@/lib/needsYou/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tab = "decide" | "row";

/**
 * AG-1.4 · Commissions › Who gets the credit › an item (round 7 direction A, docs/la4/mockups-r7/commissions.html
 * 3·1): the old Review page's right side, given an address. The title is the client and the policy; Decide · The
 * row as sent are its tabs; ‹ › name the neighbouring items in the To decide list (oldest first); the strip holds
 * the row's facts; "Give the credit and next" is the title line's primary. Opening it writes nothing.
 */
export default async function AttributionItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Who gets the credit" description="Statement lines two producers could own, or no producer has yet." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Who gets the credit" detail="The owner, admins and the bookkeeper decide who gets the credit." />;
  const [{ id }, { tab: asked }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const tenantId = guard.context.tenantId;
  const scope = { tenantId, userId: guard.context.userId, keeper: true, money: false, credit: true };

  const [queue, page, roster, today] = await Promise.all([
    readCreditQueue(tenantId).catch(() => null),
    loadItemPage(scope, "credit", id).catch(() => null),
    readRoster(guard.context).catch(() => null),
    agencyToday(tenantId).catch(() => new Date().toISOString().slice(0, 10)),
  ]);
  const open = queue?.open ?? [];
  const at = open.findIndex((r) => r.id === id);
  const row = at >= 0 ? open[at] : null;

  if (!row || !page || page.detail.kind !== "credit") {
    return (
      <CommissionsPage step="attribution" title="This item is closed" breadcrumbs={[{ label: "Commissions" }, { label: "Who gets the credit", href: CREDIT_HREF }, { label: "Closed" }]}>
        <TableCard>
          <EmptyState title="This item is closed" hint="Someone decided it, a newer file answered it, or it isn't yours to see." action={<Button asChild><Link href={CREDIT_HREF}>Back to Who gets the credit</Link></Button>} />
        </TableCard>
      </CommissionsPage>
    );
  }

  const previous = at > 0 ? open[at - 1] : null;
  const next = open[at + 1] ?? null;
  const tab: Tab = asked === "row" && page.row ? "row" : "decide";
  const readOnly = guard.entitlement.access === "read_only";
  const days = ageDays(row.createdAt.slice(0, 10), today);
  const name = nameOf(row);
  const producerIds = Object.fromEntries((roster?.rows ?? []).map((p) => [p.userId, p.id]));
  const nextHref = next ? itemHref(next.id) : null;

  const actions = (
    <>
      <NeighbourLinks previous={previous ? { href: itemHref(previous.id), name: nameOf(previous) } : null} next={next ? { href: itemHref(next.id), name: nameOf(next) } : null} noun="item" />
      {!readOnly && nextHref && <Button asChild variant="outline"><Link href={nextHref}>Skip</Link></Button>}
      {!readOnly && tab === "decide" && <Button type="submit" form={CREDIT_FORM_ID}>{next ? "Give the credit and next" : "Give the credit"}</Button>}
    </>
  );

  const writer = row.writingNumber;
  const strip = (
    <StatStrip label={`${name} at a glance`}>
      <StatTile label="Amount" value={dollars(row.amountCents)} href={row.fileId && row.rowNumber !== null ? statementRowHref(row.fileId, row.rowNumber) : undefined}
        footnote={row.rowNumber !== null ? `reported · statement row ${row.rowNumber}` : "reported"} />
      <StatTile label="Carrier" valueSize="text" value={row.carrierName ?? "Carrier not known"} href={row.carrierId && row.policyNumber ? policyPageHref(row.carrierId, row.policyNumber) : undefined}
        footnote={row.policyNumber ? `${row.policyNumber} · policy ›` : "no policy number"} />
      <StatTile label="Writing number" valueSize="text" value={row.agentIdentifier ?? "None on the row"} href={writer?.producerId ? `/app/producers/${writer.producerId}?tab=money` : undefined}
        footnote={writer ? `→ ${writer.name}` : row.agentIdentifier ? "isn't anyone yet" : "the carrier sent none"} />
      <StatTile label="Submitted by" valueSize="text" value={row.application?.name ?? "No application"} href={row.application?.producerId ? `/app/producers/${row.application.producerId}?tab=money` : undefined}
        footnote={row.application ? "application" : "no application names a producer"} />
      <StatTile label="Waiting" valueSize="text" value={`${days} ${days === 1 ? "day" : "days"}`} footnote={(() => { const tone = ageTone(days); const since = `since ${fileDay(row.createdAt.slice(0, 10))}`; return tone ? <StatusChip tone={tone}>{since.replace(/^./, (c) => c.toUpperCase())}</StatusChip> : since; })()} />
    </StatStrip>
  );

  const here = (t: Tab) => (t === "row" ? `${itemHref(id)}?tab=row` : itemHref(id));
  return (
    <CommissionsPage
      step="attribution"
      title={titleOf(row)}
      breadcrumbs={[{ label: "Commissions" }, { label: "Who gets the credit", href: CREDIT_HREF }, { label: "To decide", href: CREDIT_HREF }, { label: name }]}
      tabs={<ViewTabs<Tab> label={titleOf(row)} value={tab} tabs={[
        { key: "decide", label: "Decide", href: here("decide") },
        ...(page.row ? [{ key: "row" as const, label: "The row as sent", href: here("row") }] : []),
      ]} />}
      actions={actions}
    >
      {strip}
      {tab === "row" && page.row
        ? <RowAsSentTable row={page.row} />
        : <CreditDecide detail={page.detail} producerIds={producerIds} nextHref={nextHref} nextName={next ? nameOf(next) : null} listHref={CREDIT_HREF} readOnly={readOnly} />}
    </CommissionsPage>
  );
}
