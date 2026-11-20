import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RateCardCarrierEditor } from "@/components/app/rate-card-carrier";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { bpToPercent, TRIGGER_LABELS } from "@/lib/ingestion/expectedCommission";
import { EXPECTED_PENDING_MESSAGE, loadRateCard, type RateCardCarrier } from "@/lib/ingestion/expectedCommissionStore";
import { isRecordUuid } from "@/lib/ingestion/path";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Rate card › one carrier (owner 2026-11-19, board ledger-r1 2·A): the carrier's terms as their own page, opened
 * from Book of Business › Setup › Rate card (it was a scrolling pop-up). The contract on top, then a table per
 * thing — Rates, Advances, Products in your book — each edited in place (RateCardCarrierEditor). Same gate and
 * roles as the Rate card list: owner and bookkeeper on statement ingestion. Opening it writes nothing.
 */
export default async function RateCardCarrierPage({ params }: { params: Promise<{ carrierId: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Rate card" description="Rates, carrier terms and advances for your book." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Rate card" detail="Setup is for the account owner and bookkeepers." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Rate card" detail="Rates and contract levels are set by the account owner or a bookkeeper." />;
  const { carrierId } = await params;
  if (!isRecordUuid(carrierId)) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the title line draws at once; the carrier's name and its tables stream in.
  const view = loadRateCard(guard.context.tenantId);
  const carrier: Carrier = view.then((v) => (v.available ? v.carriers.find((c) => c.carrierId === carrierId) ?? null : null));

  return (
    <DataInPage
      step="rate-card"
      title={<RecordName read={carrier.then((c) => c?.carrierName ?? null)} />}
      chip={<Suspense fallback={null}><Checkable read={carrier} /></Suspense>}
      actions={<Button asChild variant="outline"><Link href="/app/book-setup">‹ Rate Card</Link></Button>}
    >
      <StreamSection shape="strip+table"><Body view={view} carrier={carrier} readOnly={readOnly} /></StreamSection>
    </DataInPage>
  );
}

type Carrier = Promise<RateCardCarrier | null>;

async function Checkable({ read }: { read: Carrier }) {
  const c = await read;
  if (!c || c.policies === 0) return null;
  return <StatusChip tone={c.pricedPolicies === c.policies ? "good" : c.pricedPolicies ? "warning" : "danger"}>{`${c.pricedPolicies} of ${c.policies} checkable`}</StatusChip>;
}

async function Body({ view, carrier, readOnly }: { view: ReturnType<typeof loadRateCard>; carrier: Carrier; readOnly: boolean }) {
  const [v, c] = await Promise.all([view, carrier]);
  if (!v.available) return <EmptyState title="The rate card isn't available yet" hint={EXPECTED_PENDING_MESSAGE} />;
  if (!c) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const share = c.monthlyCents ? Math.floor((c.pricedMonthlyCents * 100) / c.monthlyCents) : null;
  return (
    <>
      <StatStrip label={`${c.carrierName} at a glance`}>
        <StatTile label="Your level" value={<>{c.levelBp !== null ? `${bpToPercent(c.levelBp)}%` : "Not set"}</>} footnote={c.writingNumber ? `writing number ${c.writingNumber}` : "no writing number yet"} />
        <StatTile label="Pays" value={<>{c.trigger ? TRIGGER_LABELS[c.trigger] : "Not set"}</>} footnote={c.trigger ? (c.lagDays !== null ? `usually within ${c.lagDays} days` : "no usual lag set") : "nothing is expected until it is"} />
        <StatTile label="Policies" value={c.policies} footnote={`${whole(c.monthlyCents)} a month in premium`} />
        <StatTile
          label="Can be checked"
          value={<>{c.policies ? `${c.pricedPolicies} of ${c.policies}` : "—"}</>}
          footnote={c.reasons.length ? <StatusChip tone="warning">{`${c.reasons[0].reason} (${c.reasons[0].policies})`}</StatusChip> : share !== null ? `${share}% of premium` : "no policies yet"}
        />
      </StatStrip>
      <RateCardCarrierEditor carrier={c} products={v.products} readOnly={readOnly} today={today} />
    </>
  );
}
