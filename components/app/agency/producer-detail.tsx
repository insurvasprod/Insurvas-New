"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { PRODUCER_STATUS_LABELS, type ProducerStatus } from "@/lib/agency/constants";
import { Money } from "./money";
import { STATUS_TONE } from "./producers-roster";
import { ManagerDialog, OffboardDialog, StatusDialog } from "./producer-dialogs";
import { ProducerCarriersTab } from "./producer-carriers-tab";
import { ProducerOnboardingTab } from "./producer-onboarding-tab";
import { ProducerMoneyTab } from "./producer-money-tab";
import { ProducerSupportCard } from "./producer-support-card";
import { sendJson, useAgencyData } from "./use-agency-data";

type Detail = {
  id: string; userId: string; displayName: string; npn: string | null; status: ProducerStatus; hiredOn: string | null; offboardedOn: string | null;
  canSubmit: boolean; canSubmitReason: string | null; frozenBalanceCents: number | null; reactivatableUntil: string | null; seatReleasedOn: string | null;
  email: string | null; phone: string | null; role: string | null; managerProducerId: string | null; managerName: string; isSelf: boolean;
};
type Score = { producerUserId: string; submitted: number; issued: number; placement: string; m4: { text: string }; m13: { text: string }; advanceAtRiskCents: number };
export type ProducerTab = "overview" | "carriers" | "onboarding" | "money";

/** Fired after a header action (suspend, reactivate, manager, offboard) so the tab below re-reads the record. */
const CHANGED = "agency:producer-changed";

/**
 * AG-1.1 · one producer, Home › Agency › Producers › a producer (2026-11-03). The page draws the header
 * on the server — the name, the status chip, one line of facts, the actions (ProducerActions) and the tabs on the
 * title line — and this draws the open tab: Overview (this month's production and the record's details, plus who
 * supports him), Carriers (AG-0.9), Onboarding (AG-1.10) and Money (his ledger and statements; hidden from a
 * manager, absent for an assistant). The old Production tab was two links; they are in the header's More now.
 */
export function ProducerDetail({ producerId, tab, viewer }: { producerId: string; tab: ProducerTab; viewer: { isOwner: boolean; isManager: boolean; isBookkeeper: boolean; canSeeMoney: boolean } }) {
  const { data, error, loading, reload } = useAgencyData<Detail>(`/api/app/agency/producers/${producerId}`);
  const scores = useAgencyData<{ rows: Score[] }>(tab === "overview" ? "/api/app/agency/scorecards" : null);
  const score = useMemo(() => scores.data?.rows.find((r) => r.producerUserId === data?.userId) ?? null, [scores.data, data]);
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);

  if (error) return <TableCard><ErrorState detail={error} /></TableCard>;
  if (loading || !data) return <TableCard><SectionLoading rows={6} columns={2} label="Loading the producer" /></TableCard>;

  if (tab === "carriers") return <ProducerCarriersTab producerId={producerId} canEdit={viewer.isOwner} />;
  if (tab === "onboarding") return <ProducerOnboardingTab producerId={producerId} isOwner={viewer.isOwner} isSelf={data.isSelf} />;
  if (tab === "money") return <ProducerMoneyTab url={`/api/app/agency/producers/${producerId}/money`} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <TableCard title="This month">
        {scores.error ? <ErrorState detail={scores.error} /> : !scores.data ? <SectionLoading rows={5} columns={2} label="Loading production" /> : !score ? (
          <p className="p-4 text-sm text-[var(--muted)]">No production recorded for this month yet.</p>
        ) : (
          <Table><TableBody>
            <TableRow><TableCell>Submitted</TableCell><TableCell className="text-right tabular-nums">{score.submitted}</TableCell></TableRow>
            <TableRow><TableCell>Issued</TableCell><TableCell className="text-right tabular-nums">{score.issued}</TableCell></TableRow>
            <TableRow><TableCell>Placement</TableCell><TableCell className="text-right tabular-nums">{score.placement}</TableCell></TableRow>
            <TableRow><TableCell>Month-4 alive</TableCell><TableCell className="text-right tabular-nums">{score.m4.text}</TableCell></TableRow>
            <TableRow><TableCell>Advance at risk</TableCell><TableCell className="text-right"><Money cents={score.advanceAtRiskCents} /></TableCell></TableRow>
          </TableBody></Table>
        )}
      </TableCard>
      <TableCard title="Details">
        <Table><TableBody>
          <TableRow><TableCell>Status</TableCell><TableCell className="text-right"><StatusChip tone={STATUS_TONE[data.status]}>{PRODUCER_STATUS_LABELS[data.status]}</StatusChip></TableCell></TableRow>
          <TableRow><TableCell>Can submit</TableCell><TableCell className="text-right">{data.canSubmit ? <StatusChip tone="good">Yes</StatusChip> : <StatusChip tone="warning">{data.canSubmitReason ?? "Not yet"}</StatusChip>}</TableCell></TableRow>
          <TableRow><TableCell>Manager</TableCell><TableCell className="text-right">{data.managerName}</TableCell></TableRow>
          <TableRow><TableCell>NPN</TableCell><TableCell className="text-right font-mono text-xs">{data.npn ?? "—"}</TableCell></TableRow>
          <TableRow><TableCell>Email</TableCell><TableCell className="whitespace-normal text-right break-all">{data.email ?? "—"}</TableCell></TableRow>
          <TableRow><TableCell>Phone</TableCell><TableCell className="text-right tabular-nums">{data.phone ?? "—"}</TableCell></TableRow>
          {data.status === "offboarded" && <TableRow><TableCell>Frozen balance</TableCell><TableCell className="text-right"><Money cents={data.frozenBalanceCents} /></TableCell></TableRow>}
          {data.status === "offboarded" && <TableRow><TableCell>Offboarded</TableCell><TableCell className="text-right tabular-nums">{data.offboardedOn}{data.reactivatableUntil ? ` · undo until ${data.reactivatableUntil}` : ""}</TableCell></TableRow>}
        </TableBody></Table>
      </TableCard>
      {viewer.isOwner && !data.isSelf && <ProducerSupportCard producerId={producerId} producerName={data.displayName} />}
    </div>
  );
}

/**
 * The record's header buttons: at most two plus More (UI-CONSISTENCY, compact detail headers). For the owner or an
 * admin on someone else's record, the status step that fits (Resend invite, Suspend or Reactivate) and Change
 * manager; More holds Offboard and the ways into his production — his policies in the book and the scorecards.
 * Everyone else gets only those links. Each step is a confirm pop-up; after it the header re-reads on the server.
 */
export function ProducerActions({ producer, canManage, scorecards }: {
  producer: { id: string; userId: string; displayName: string; status: ProducerStatus; email: string | null; reactivatableUntil: string | null; isSelf: boolean };
  canManage: boolean;
  scorecards: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "offboard" | "suspend" | "reactivate" | "manager">(null);
  const roster = useAgencyData<{ rows: Array<{ id: string; displayName: string; status: string }> }>(canManage && dialog === "manager" ? "/api/app/agency/producers" : null);
  const manage = canManage && !producer.isSelf;
  const s = producer.status;
  const done = () => { window.dispatchEvent(new Event(CHANGED)); refreshStepCounts(); router.refresh(); };

  async function resendInvite() {
    const { error } = await sendJson(`/api/app/team/${producer.userId}/resend-invite`, "POST", {});
    if (error) notify.fail(error); else notify.done(`A new invitation went to ${producer.email ?? "them"}. It is valid for 7 days.`);
  }

  const reactivateClosed = s === "offboarded" && !!producer.reactivatableUntil && producer.reactivatableUntil < new Date().toISOString().slice(0, 10);
  return (
    <>
      {manage && s === "invited" && <Button variant="outline" onClick={resendInvite}>Resend invite</Button>}
      {manage && (s === "active" || s === "onboarding") && <Button variant="outline" onClick={() => setDialog("suspend")}>Suspend</Button>}
      {manage && (s === "suspended" || s === "offboarded") && <Button variant="outline" onClick={() => setDialog("reactivate")} disabled={reactivateClosed} title={reactivateClosed ? "More than 30 days since offboarding: invite them again" : undefined}>Reactivate</Button>}
      {manage && s !== "offboarded" && s !== "invited" && <Button variant="outline" onClick={() => setDialog("manager")}>Change manager</Button>}
      <MoreMenu items={[
        manage && s !== "offboarded" && s !== "invited" && { label: "Offboard", onSelect: () => setDialog("offboard") },
        !producer.isSelf && { label: "Open their policies", href: `/app/policies?agent=${producer.userId}` },
        scorecards && { label: "Compare on the scorecards", href: "/app/producer-scorecards" },
      ]} />
      {manage && (
        <>
          <OffboardDialog producerId={producer.id} open={dialog === "offboard"} onOpenChange={(o) => setDialog(o ? "offboard" : null)} onDone={done} />
          <StatusDialog producerId={producer.id} name={producer.displayName} action="suspend" open={dialog === "suspend"} onOpenChange={(o) => setDialog(o ? "suspend" : null)} onDone={done} />
          <StatusDialog producerId={producer.id} name={producer.displayName} action="reactivate" open={dialog === "reactivate"} onOpenChange={(o) => setDialog(o ? "reactivate" : null)} onDone={done} />
          <ManagerDialog producerId={producer.id} name={producer.displayName} managers={(roster.data?.rows ?? []).filter((r) => r.status !== "offboarded" && r.status !== "invited").map((r) => ({ id: r.id, name: r.displayName }))} open={dialog === "manager"} onOpenChange={(o) => setDialog(o ? "manager" : null)} onDone={done} />
        </>
      )}
    </>
  );
}
