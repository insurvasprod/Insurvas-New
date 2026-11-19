import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadWinback, WINBACK_PENDING_MESSAGE, type ClaimRow } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { WinbackClaimActions } from "@/components/app/retention/winback-claim-actions";
import { clientName, policyHref, winbackClaimHref, winbackViewHref } from "@/components/app/retention/winback-stages";
import { buttonVariants } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { IntentLink } from "@/components/ui/nav-pending";

const claimName = (c: ClaimRow) => (c.clientName ? clientName({ clientName: c.clientName, policyNumber: c.policyNumber }) : c.policyNumber);

/**
 * Retention › Win-back › Possible claims › a claim (round 7, owner pick 3·A and 3·2, 2026-11-10): a policy that
 * lapsed after a reported death. Never a win-back call: help the family claim, then Mark handled (the title-line
 * primary, an md dialog with a note). ‹ › name the neighbouring claims in the list's order. A read-only account
 * sees the claim without the button. The same gates and scope as the list.
 */
export default async function WinbackClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Win-back" description="Former clients worth winning back, once the cooling-off has passed." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Win-back" detail="Win-back is the owner's and the producers'." />;
  const { id } = await params;
  if (!isRecordUuid(id)) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  const back = winbackViewHref("claims");
  // Frame first (UI-CONSISTENCY §7a): the trail and the step draw at once and the name waits in a title-shaped
  // placeholder. The read starts here; the name, ‹ ›, the strip and the cards each wait on it.
  const read = scopeFor(guard.context).then(async (scope) => {
    const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
    const data = await loadWinback(viewer, { release: false });
    if (!data.available) return { pending: true as const, claim: null };
    const at = data.claims.findIndex((c) => c.id === id);
    if (at < 0) return { pending: false as const, claim: null };
    return { pending: false as const, claim: data.claims[at], previous: at > 0 ? data.claims[at - 1] : null, next: at < data.claims.length - 1 ? data.claims[at + 1] : null, open: data.claims.length };
  });
  // Handled claims leave the list: an old link lands on Possible claims rather than a dead end.
  const found = (value: Awaited<typeof read>) => {
    if (value.pending) return null;
    if (!value.claim) redirect(back);
    return value;
  };

  return (
    <RetentionPage
      step="reinstatement"
      title={<RecordTitle read={read} name={(value) => (value.pending ? "Win-back" : value.claim ? claimName(value.claim) : null)} />}
      breadcrumbs={retentionTrail("reinstatement", "Claim", { label: "Possible claims", href: back })}
      actions={
        <Suspense fallback={null}>
          <Await read={read}>
            {(value) => {
              if (value.pending || !value.claim) return null;
              const { claim, previous, next } = value;
              return (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {previous && <IntentLink transitionTypes={["nav-back"]} href={winbackClaimHref(previous.id)} className={buttonVariants({ variant: "outline" })} title={`Previous claim: ${claimName(previous)}`}><ChevronLeft aria-hidden="true" />{claimName(previous)}</IntentLink>}
                  {next && <IntentLink transitionTypes={["nav-forward"]} href={winbackClaimHref(next.id)} className={buttonVariants({ variant: "outline" })} title={`Next claim: ${claimName(next)}`}>{claimName(next)}<ChevronRight aria-hidden="true" /></IntentLink>}
                  {!readOnly && <WinbackClaimActions claimId={claim.id} name={claimName(claim)} backHref={back} />}
                  <MoreMenu items={[{ label: "Open the policy", href: policyHref(claim.carrierId, claim.policyNumber) }]} />
                </span>
              );
            }}
          </Await>
        </Suspense>
      }
    >
      <StreamSection shape="strip">
        <Await read={read}>
          {(value) => {
            const shown = found(value);
            if (!shown) return <TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard>;
            const { claim, open } = shown;
            const name = claimName(claim);
            return (
              <StatStrip label={`${name}, possible claim`}>
                <StatTile label="Where it is" valueSize="text" value="Possible claim" href={back} footnote={<StatusChip tone="danger">Never a win-back call</StatusChip>} />
                <StatTile label="Policy" valueSize="text" value={`${claim.carrierName} ${claim.policyNumber}`} href={policyHref(claim.carrierId, claim.policyNumber)} footnote="open the policy" />
                <StatTile label="Reported" valueSize="text" value={fileDay(claim.createdAt.slice(0, 10))} href={back} footnote={`${open} open ${open === 1 ? "claim" : "claims"}`} />
              </StatStrip>
            );
          }}
        </Await>
      </StreamSection>
      <StreamSection shape="cards">
        <Await read={read}>
          {(value) => { const shown = found(value); return shown ? (
            <div className="grid gap-4 lg:flex-1 xl:grid-cols-2">
              <section className={`${cardSurface} flex flex-col gap-2 p-5`} aria-label="What the carrier reported">
                <h2 className="m-0 text-base font-semibold text-foreground">What the carrier reported</h2>
                <p className="m-0 text-sm text-foreground">{shown.claim.reason}</p>
              </section>
              <section className={`${cardSurface} flex flex-col gap-2 p-5`} aria-label="What to do">
                <h2 className="m-0 text-base font-semibold text-foreground">What to do</h2>
                <p className="m-0 text-sm text-foreground">Help the family claim: the policy lapsed after a reported death, so the cover may still pay. Then mark it handled, with a note of what was done.</p>
                <p className="m-0 text-xs text-muted-foreground">This policy is never sent to a win-back list. The phone number is not blocked, because the household may share it.</p>
              </section>
            </div>
          ) : null; }}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}
