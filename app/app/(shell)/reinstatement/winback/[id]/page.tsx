import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { personName } from "@/lib/format/personName";
import { fileDay } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS } from "@/lib/retention/winback";
import { loadWinback, WINBACK_PENDING_MESSAGE } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

/**
 * Retention › Win-back › a client (round 3, owner 2026-11-06: "the work happens on a page, not in the row").
 * Who they are and how to reach them, what they had, why it ended (and how we know), when they may be called
 * and what to say. The call itself is made from the Win-back lead list in the dialer, where its gates
 * (calling window, do-not-call, attempts) apply: this page opens that lead once the client is on the list.
 * Read-only; the same gates and scope as the list.
 */
export default async function WinbackClientPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Win-back" description="Former clients worth winning back, once the cooling-off has passed." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Win-back" detail="Win-back calls are the owner's and the producers'." />;
  const { id } = await params;
  if (!isRecordUuid(id)) notFound();
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const data = await loadWinback(viewer, { release: false });
  if (!data.available) return <RetentionPage step="reinstatement" title="Win-back"><TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard></RetentionPage>;
  const r = data.rows.find((row) => row.id === id);
  if (!r) notFound();
  const name = r.clientName ? personName(r.clientName) : r.policyNumber;
  const stage = r.band === "never" ? { label: "Never call", tone: "danger" as const }
    : r.releasedAt ? { label: "On the Win-back list", tone: "good" as const }
      : r.blockedReason ? { label: "Couldn't go on the list", tone: "danger" as const }
        : { label: `Cooling off until ${r.eligibleFrom ? fileDay(r.eligibleFrom) : "—"}`, tone: "neutral" as const };
  // Under the name, one short line (owner 2026-11-06): how to reach them; the rest is in the cards below.
  const facts = (
    <>
      {r.phone ? <span className="select-all font-semibold tabular-nums text-foreground">{phoneText(r.phone)}</span> : <span className="text-[var(--warning-ink)]">No phone on file</span>}
      {[r.age !== null ? ` · ${r.age}` : null, r.state ? ` · ${r.state}` : null].filter(Boolean).join("")}
    </>
  );
  // Where they are on the way back (a progress bar, not chips by the name): cooling off, callable, on the list.
  const stages = ["Cooling off", "Callable", "On the Win-back list"];
  const at = r.releasedAt ? 3 : r.eligibleFrom && r.eligibleFrom <= data.today ? 2 : 1;
  // What to say follows why it ended: never "a payment failed" when the files don't say so.
  const when = fileDay(r.lapsedOn).replace(/\s\d+,/, "");
  const script = r.category === "affordability"
    ? `Your ${r.carrierName} policy ended when the payments got hard. Prices and plans change: shall we look at something that fits your budget now?`
    : r.category === "mechanical" || r.category === "administrative"
      ? `Your ${r.carrierName} policy ended in ${when} because a payment didn't go through. We can still get you covered, often at a similar price.`
      : `Your ${r.carrierName} policy ended in ${when}. I'd like to understand what happened, and see whether we can get you covered again.`;

  return (
    <RetentionPage
      step="reinstatement"
      title={name}
      facts={facts}
      breadcrumbs={retentionTrail("reinstatement", name)}
      actions={<>
        {r.leadId && <Button asChild><Link href={`/app/leads/${r.leadId}`}>Open the lead</Link></Button>}
        <Button asChild variant="outline"><Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`}>Open the policy</Link></Button>
      </>}
    >
      <section className={`${cardSurface} flex flex-col gap-3 px-5 py-4`} aria-label="Where they are">
        {r.band === "never" || r.blockedReason ? (
          <p className="m-0 text-sm font-semibold" style={{ color: "var(--error-ink)" }}>{stage.label}{r.blockedReason ? `: ${r.blockedReason}` : ""}</p>
        ) : (
          // Only the stage they are at (owner 2026-11-06), never the ones they aren't.
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label={`Stage: ${stages[at - 1]}`}>
            <span className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span className="text-sm font-semibold text-[var(--success-ink)]">{stages[at - 1]}</span>
              <span aria-hidden="true" className="block h-1.5 rounded-full bg-[var(--success-ink)]" />
            </span>
            <span className="whitespace-nowrap text-sm font-semibold text-foreground">Chance: {BAND_LABELS[r.band]}</span>
          </div>
        )}
        <p className="m-0 text-sm text-foreground"><span className="font-semibold">{CATEGORY_LABELS[r.category]}</span> · lapsed {fileDay(r.lapsedOn)} · {r.carrierName} {r.policyNumber}</p>
      </section>
      {/* Grows to the foot of the screen (owner 2026-11-06: "fill the full height, no gaps"). */}
      <div className="grid gap-4 lg:flex-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-label="Why it ended">
          <h2 className="m-0 text-xs font-semibold text-muted-foreground">Why it ended</h2>
          <p className="m-0 text-sm text-foreground">{CATEGORY_LABELS[r.category]} <span className="text-muted-foreground">({SOURCE_LABELS[r.source]}{r.detail && r.source !== "none" ? `: ${r.detail}` : ""})</span></p>
          <h2 className="m-0 mt-2 text-xs font-semibold text-muted-foreground">What to say</h2>
          <p className="m-0 text-sm text-foreground">&ldquo;{script}&rdquo;</p>
        </section>
        <section className={`${cardSurface} flex flex-col gap-2 p-5`} aria-label="What they had and when to call">
          <h2 className="m-0 text-xs font-semibold text-muted-foreground">What they had</h2>
          {/* What they had, as a table (owner 2026-11-06), the same shape as a case's facts. */}
          <FactTable rows={[
            ["Premium", `${money(r.premiumCents)}/mo`],
            ["Cover", r.faceCents !== null ? `$${Math.round(r.faceCents / 100).toLocaleString("en-US")}` : "—"],
            ["Paid", r.monthsPaid !== null ? `${r.monthsPaid} ${r.monthsPaid === 1 ? "month" : "months"}` : "—"],
            ["When to call", r.band === "never" ? "Never: do-not-call or deceased" : r.releasedAt ? `On the list since ${fileDay(r.releasedAt.slice(0, 10))}` : r.blockedReason ? r.blockedReason : `From ${r.eligibleFrom ? fileDay(r.eligibleFrom) : "—"}`],
          ]} />
          <p className="m-0 mt-2 text-xs text-muted-foreground">The call is made from the Win-back list, where the calling window and do-not-call checks apply.</p>
        </section>
      </div>
    </RetentionPage>
  );
}
