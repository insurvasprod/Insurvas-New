"use client";

/**
 * After submit (step 10; board l3-ws-after): between "submitted" and the carrier's decision. A
 * counteroffer and the client's answer to it (LA-3.26, delta overlay l3-ov-counteroffer), the
 * requirements the carrier raised (LA-3.18, with LA-3.25's paramed exam dates), and the outcome
 * (LA-3.16). Issue is only ever recorded from the carrier's notice; a declined attempt is never
 * reopened — the next try is a new attempt.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { CounterofferView } from "@/lib/applications/types";
import { notify } from "@/lib/notify";

import { face, money } from "@/components/app/applications/parts";
import { CounterofferDeltaDialog, type OfferDetail } from "@/components/app/applications/outcome/counteroffer-delta-dialog";
import { CounterofferDialog } from "@/components/app/applications/outcome/counteroffer-dialog";
import { CounterofferPanel } from "@/components/app/applications/outcome/counteroffer-panel";
import { tierName } from "@/components/app/applications/outcome/model";
import { OutcomeCard } from "@/components/app/applications/outcome/outcome-card";
import { RequirementsCard } from "@/components/app/applications/outcome/requirements-table";
import { WithdrawDialog } from "@/components/app/applications/outcome/withdraw-dialog";
import { useNow } from "@/components/app/applications/outcome/use-now";
import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";

type Detail = OfferDetail & { id: string };

export function AfterStep() {
  const { attempt } = useWorkspace();
  // Keyed by attempt: an open dialog or a loaded offer never follows the agent to another attempt.
  return <AfterBody key={attempt.id} />;
}

function AfterBody() {
  const { attempt, readOnly, sample, actions, updateAttempt, goTo } = useWorkspace();
  const now = useNow();
  const [recording, setRecording] = useState(false);
  const [delta, setDelta] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<Detail[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);

  const pending = attempt.counteroffers.find((c) => c.status === "pending_client") ?? null;
  const lastResolved = [...attempt.counteroffers].reverse().find((c) => c.status !== "pending_client") ?? null;
  const detail = pending ? details.find((d) => d.id === pending.id) ?? null : null;
  const gender = attempt.values["insured.gender"]?.value;
  const pronoun = gender === "female" ? "she" : gender === "male" ? "he" : "they";

  const loadDetails = useCallback(async () => {
    if (sample || !attempt.counteroffers.length) return;
    const r = await request<{ counteroffers: Detail[] }>(attemptUrl(attempt.id, "/counteroffers"));
    if (r.ok) setDetails(r.data.counteroffers);
  }, [attempt.id, attempt.counteroffers.length, sample]);
  useEffect(() => { const t = window.setTimeout(() => { void loadDetails(); }, 0); return () => window.clearTimeout(t); }, [loadDetails]);

  async function answer(offer: CounterofferView, response: "accept" | "reject" | "expire") {
    if (sample) {
      const status = response === "accept" ? "accepted" : response === "reject" ? "rejected" : "expired";
      updateAttempt(response === "accept"
        ? { status: "pending_carrier", counteroffers: attempt.counteroffers.map((c) => (c.id === offer.id ? { ...c, status } : c)), values: { ...attempt.values, "cov.face_amount": { value: offer.offered.faceCents, source: "quote", reviewed: true }, "cov.monthly_premium": { value: offer.offered.monthlyCents, source: "quote", reviewed: true } } }
        : { status: "closed", outcome: response === "reject" ? "declined_by_client" : "offer_expired", closedAt: new Date().toISOString(), counteroffers: attempt.counteroffers.map((c) => (c.id === offer.id ? { ...c, status } : c)) });
      notify.done("Sample data — nothing was saved");
      setDelta(false);
      setExpiring(false);
      return;
    }
    setBusy(true);
    try {
      const r = await request<{ status: string; fyc: { before: number | null; after: number | null } | null; welcomePack: { version: number } | null }>(attemptUrl(attempt.id, `/counteroffers/${offer.id}/respond`), { method: "POST", body: { response } });
      if (!r.ok) { notify.block(r.error); return; }
      await actions.refresh();
      setDelta(false);
      setExpiring(false);
      if (response === "accept") {
        const fyc = r.data.fyc && r.data.fyc.before !== null && r.data.fyc.after !== null ? ` Estimated FYC ${money(r.data.fyc.before)} → ${money(r.data.fyc.after)}.` : "";
        notify.done(`Coverage is now ${face(offer.offered.faceCents)} at ${money(offer.offered.monthlyCents)} a month`, {
          detail: `${r.data.welcomePack ? "The welcome pack was reissued with the new amount — send it from the Submit step." : "The welcome pack will carry the new amount."}${fyc}`,
          action: r.data.welcomePack ? { label: "Open Submit", onClick: () => goTo("submit") } : undefined,
        });
      } else {
        notify.done(response === "reject" ? "Client declined the counteroffer — this attempt is closed" : "Counteroffer expired — this attempt is closed", { detail: "Start the next attempt, or close the case as lost." });
      }
    } finally {
      setBusy(false);
    }
  }

  if (attempt.status === "draft" || attempt.status === "ready") {
    return (
      <StepCard
        title="After submit"
        chips={<StatusChip tone="neutral">Not submitted</StatusChip>}
        actions={<>
          <Button type="button" variant="outline" onClick={() => goTo("review")}><ArrowLeft aria-hidden="true" />Back to Review</Button>
          {!readOnly && <Button type="button" variant="outline" onClick={() => setWithdrawing(true)}>Withdraw…</Button>}
          <Button type="button" onClick={() => goTo("submit")}>Go to Submit<ArrowRight aria-hidden="true" /></Button>
        </>}
      >
        <p className="text-sm text-[var(--body)]">Nothing to follow up yet — record the submission on the Submit step first. If the client has walked away, withdraw it.</p>
        <WithdrawDialog open={withdrawing} onOpenChange={setWithdrawing} />
        {sample && (
          <Button type="button" variant="ghost" className="self-start" onClick={() => updateAttempt({ status: "submitted", submittedAt: new Date().toISOString() })}>Preview as submitted</Button>
        )}
      </StepCard>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {pending && (
        <CounterofferPanel
          offer={pending}
          carrierName={attempt.carrierName}
          now={now}
          readOnly={readOnly}
          busy={busy}
          onAccept={() => setDelta(true)}
          onDecline={() => setDelta(true)}
          onExpire={() => setExpiring(true)}
        />
      )}
      {!pending && lastResolved && (
        <p className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--body)]">
          <span className="font-semibold text-[var(--ink)]">Counteroffer {lastResolved.status === "accepted" ? "accepted" : lastResolved.status === "rejected" ? "declined by the client" : "expired"}</span>
          {" — "}{tierName(lastResolved.offered.tier)} · {face(lastResolved.offered.faceCents)} at {money(lastResolved.offered.monthlyCents)} a month
          {lastResolved.status === "accepted" ? `, against ${face(lastResolved.applied.faceCents)} at ${money(lastResolved.applied.monthlyCents)} applied for. The original is kept.` : "."}
        </p>
      )}

      <RequirementsCard now={now} />
      <OutcomeCard onRecordCounteroffer={() => setRecording(true)} onAnswerOffer={(r) => { if (!pending) return; if (r === "expire") setExpiring(true); else setDelta(true); }} busy={busy} />

      <CounterofferDialog open={recording} onOpenChange={setRecording} />
      {pending && (
        <CounterofferDeltaDialog
          open={delta}
          onOpenChange={setDelta}
          offer={pending}
          detail={detail}
          carrierName={attempt.carrierName}
          attemptNo={attempt.attemptNo}
          productLabel={attempt.productLabel}
          draftDay={attempt.payment?.draftDay ?? null}
          pronoun={pronoun}
          now={now}
          busy={busy}
          onAnswer={(r) => void answer(pending, r)}
        />
      )}
      {pending && (
        <Overlay
          open={expiring}
          onOpenChange={(o) => { if (!busy) setExpiring(o); }}
          width={720}
          title="Let the offer expire?"
          subtitle={`${attempt.carrierName ?? "The carrier"} · attempt ${attempt.attemptNo}`}
          footerNote="The counteroffer is kept on the record either way."
          actions={<>
            <Button type="button" variant="outline" onClick={() => setExpiring(false)} disabled={busy} title={busy ? "Saving…" : undefined}>Keep it open</Button>
            <Button type="button" onClick={() => void answer(pending, "expire")} disabled={busy} title={busy ? "Saving…" : undefined}>{busy ? "Closing…" : "Close as expired"}</Button>
          </>}
        >
          <p className="text-sm text-[var(--body)]">The client gave no answer. This closes the attempt as “offer expired” — you can then try another carrier or close the case.</p>
        </Overlay>
      )}
    </div>
  );
}
