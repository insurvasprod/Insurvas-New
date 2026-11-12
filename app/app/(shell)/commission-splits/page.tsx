import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { readSplitBook } from "@/lib/agency/splitStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { SPLITS_SLOT } from "@/components/app/commissions/splits/slots";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { SplitsBoard } from "@/components/app/agency/splits-board";

/**
 * AG-1.6 · Commissions › Commission splits (round 7, owner pick 8·A, 2026-11-10; docs/la4/mockups-r7/commissions.html).
 * Active · Ended on the title line (`?tab=ended`); New split, the one primary, opens the split dialog with a policy
 * lookup (`?new=1` opens it too, with a Change link's prefill). Owner and admin edit; the bookkeeper reads.
 */
export default async function CommissionSplitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Commission splits" description="Policies two producers share." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Commission splits" detail="The owner, admins and the bookkeeper see commission splits." />;
  const canEdit = guard.role === "owner" && guard.entitlement.access !== "read_only";
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const tab = one("tab") === "ended" ? "ended" : "active";
  const book = await readSplitBook(guard.context.tenantId).catch((error: unknown) => {
    console.error("[commission splits]", error);
    return null;
  });
  const prefill = canEdit && one("new") === "1" ? { carrier: one("carrier"), policy: one("policy"), writer: one("writer"), other: one("other"), share: one("share") } : null;
  return (
    <CommissionsPage
      step="splits"
      info="Policies two producers agreed to share. The agency's commission pays the writer's pool at the writer's own level; the override comes off first, then the pool is split by the shares, which always add up to 100%."
      tabs={<ViewTabs label="Commission splits" value={tab} tabs={[
        { key: "active", label: "Active", count: book?.active.length ?? null, href: "/app/commission-splits" },
        { key: "ended", label: "Ended", count: book?.ended.length ?? null, href: "/app/commission-splits?tab=ended" },
      ]} />}
      actions={canEdit ? <StepSlotTarget id={SPLITS_SLOT} /> : undefined}
    >
      {book ? <SplitsBoard key={tab} rows={tab === "ended" ? book.ended : book.active} tab={tab} people={book.people} canEdit={canEdit} prefill={prefill} />
        : <TableCard><ErrorState detail="The splits could not be read. Reload to try again." /></TableCard>}
    </CommissionsPage>
  );
}
