"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { PRODUCER_STATUS_LABELS, type ProducerStatus } from "@/lib/agency/constants";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/lib/tenantAuth/roles";
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
type TabKey = "overview" | "carriers" | "onboarding" | "production" | "money";

/**
 * AG-1.1 · one producer. Tabs: Overview (status, role, manager, contact, and the actions), Carriers (AG-0.9),
 * Onboarding (AG-1.10), Production (a link into LA-4's book filtered to him — not a copy of it) and Money (his
 * ledger and statements; hidden from a manager, absent for an assistant). A producer opening his own record sees
 * Overview, Carriers, Onboarding and his own Money, and no actions.
 */
export function ProducerDetail({ producerId, viewer }: { producerId: string; viewer: { isOwner: boolean; isManager: boolean; isBookkeeper: boolean; canSeeMoney: boolean } }) {
  const { data, error, loading, reload } = useAgencyData<Detail>(`/api/app/agency/producers/${producerId}`);
  const scores = useAgencyData<{ rows: Score[] }>("/api/app/agency/scorecards");
  const roster = useAgencyData<{ rows: Array<{ id: string; displayName: string; status: string }> }>(viewer.isOwner ? "/api/app/agency/producers" : null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [dialog, setDialog] = useState<null | "offboard" | "suspend" | "reactivate" | "manager">(null);
  const score = useMemo(() => scores.data?.rows.find((r) => r.producerUserId === data?.userId) ?? null, [scores.data, data]);

  if (error) return <ErrorState detail={error} />;
  if (loading || !data) return <SectionLoading rows={6} columns={2} label="Loading the producer" />;

  const showMoney = viewer.canSeeMoney && !(viewer.isManager && !data.isSelf);
  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "carriers" as const, label: "Carriers" },
    { key: "onboarding" as const, label: "Onboarding", tone: !data.canSubmit && data.status !== "offboarded" && data.status !== "invited" ? ("danger" as const) : undefined },
    ...(!data.isSelf ? [{ key: "production" as const, label: "Production" }] : []),
    ...(showMoney ? [{ key: "money" as const, label: "Money" }] : []),
  ];

  async function resendInvite() {
    const { error: message } = await sendJson(`/api/app/team/${data!.userId}/resend-invite`, "POST", {});
    if (message) notify.fail(message); else notify.done(`A new invitation went to ${data!.email}. It is valid for 7 days.`);
  }

  const actions = viewer.isOwner && !data.isSelf ? (
    <>
      {data.status === "invited" && <Button variant="outline" onClick={resendInvite}>Resend invite</Button>}
      {(data.status === "active" || data.status === "onboarding") && <Button variant="outline" onClick={() => setDialog("suspend")}>Suspend</Button>}
      {(data.status === "suspended" || data.status === "offboarded") && <Button variant="outline" onClick={() => setDialog("reactivate")} disabled={data.status === "offboarded" && !!data.reactivatableUntil && data.reactivatableUntil < new Date().toISOString().slice(0, 10)}>Reactivate</Button>}
      {data.status !== "offboarded" && data.status !== "invited" && <Button variant="outline" onClick={() => setDialog("offboard")}>Offboard</Button>}
    </>
  ) : undefined;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader
        title={data.displayName}
        description={`${data.role ? MEMBER_ROLE_LABELS[data.role as MemberRole] ?? data.role : "Producer"} · reports to ${data.managerName}${data.hiredOn ? ` · hired ${data.hiredOn}` : ""}`}
        actions={actions}
      />
      <ViewTabs label="Producer" tabs={tabs} value={tab} onChange={setTab} idPrefix="producer-tab" />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TableCard title="This month">
            {!score ? <SectionLoading rows={5} columns={2} label="Loading production" /> : (
              <Table><TableBody>
                <TableRow><TableCell>Submitted</TableCell><TableCell className="text-right tabular-nums">{score.submitted}</TableCell></TableRow>
                <TableRow><TableCell>Issued</TableCell><TableCell className="text-right tabular-nums">{score.issued}</TableCell></TableRow>
                <TableRow><TableCell>Placement</TableCell><TableCell className="text-right tabular-nums">{score.placement}</TableCell></TableRow>
                <TableRow><TableCell>Month-4 alive</TableCell><TableCell className="text-right tabular-nums">{score.m4.text}</TableCell></TableRow>
                <TableRow><TableCell>Advance at risk</TableCell><TableCell className="text-right"><Money cents={score.advanceAtRiskCents} /></TableCell></TableRow>
              </TableBody></Table>
            )}
          </TableCard>
          <TableCard title="Details" action={viewer.isOwner && !data.isSelf && data.status !== "offboarded" ? <Button size="sm" variant="outline" onClick={() => setDialog("manager")}>Change manager</Button> : undefined}>
            <Table><TableBody>
              <TableRow><TableCell>Status</TableCell><TableCell className="text-right"><StatusChip tone={STATUS_TONE[data.status]}>{PRODUCER_STATUS_LABELS[data.status]}</StatusChip></TableCell></TableRow>
              <TableRow><TableCell>Can submit</TableCell><TableCell className="text-right">{data.canSubmit ? <StatusChip tone="good">Yes</StatusChip> : <StatusChip tone="warning">{data.canSubmitReason ?? "Not yet"}</StatusChip>}</TableCell></TableRow>
              <TableRow><TableCell>Manager</TableCell><TableCell className="text-right">{data.managerName}</TableCell></TableRow>
              <TableRow><TableCell>NPN</TableCell><TableCell className="text-right font-mono text-xs">{data.npn ?? "—"}</TableCell></TableRow>
              <TableRow><TableCell>Email</TableCell><TableCell className="text-right">{data.email ?? "—"}</TableCell></TableRow>
              {data.status === "offboarded" && <TableRow><TableCell>Frozen balance</TableCell><TableCell className="text-right"><Money cents={data.frozenBalanceCents} /></TableCell></TableRow>}
              {data.status === "offboarded" && <TableRow><TableCell>Offboarded</TableCell><TableCell className="text-right tabular-nums">{data.offboardedOn}{data.reactivatableUntil ? ` · undo until ${data.reactivatableUntil}` : ""}</TableCell></TableRow>}
            </TableBody></Table>
          </TableCard>
          {viewer.isOwner && <ProducerSupportCard producerId={producerId} producerName={data.displayName} />}
        </div>
      )}
      {tab === "carriers" && <ProducerCarriersTab producerId={producerId} canEdit={viewer.isOwner} />}
      {tab === "onboarding" && <ProducerOnboardingTab producerId={producerId} isOwner={viewer.isOwner} isSelf={data.isSelf} />}
      {tab === "production" && (
        <TableCard title="Production" description="His policies live in the book; this is the book filtered to him.">
          <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Button asChild><Link href={`/app/policies?agent=${data.userId}`}>Open his policies</Link></Button>
            <Button asChild variant="outline"><Link href="/app/producer-scorecards">Compare on the scorecards</Link></Button>
          </div>
        </TableCard>
      )}
      {tab === "money" && showMoney && <ProducerMoneyTab url={`/api/app/agency/producers/${producerId}/money`} />}

      <OffboardDialog producerId={producerId} open={dialog === "offboard"} onOpenChange={(o) => setDialog(o ? "offboard" : null)} onDone={reload} />
      <StatusDialog producerId={producerId} name={data.displayName} action="suspend" open={dialog === "suspend"} onOpenChange={(o) => setDialog(o ? "suspend" : null)} onDone={reload} />
      <StatusDialog producerId={producerId} name={data.displayName} action="reactivate" open={dialog === "reactivate"} onOpenChange={(o) => setDialog(o ? "reactivate" : null)} onDone={reload} />
      <ManagerDialog producerId={producerId} name={data.displayName} managers={(roster.data?.rows ?? []).filter((r) => r.status !== "offboarded" && r.status !== "invited").map((r) => ({ id: r.id, name: r.displayName }))} open={dialog === "manager"} onOpenChange={(o) => setDialog(o ? "manager" : null)} onDone={reload} />
    </div>
  );
}
