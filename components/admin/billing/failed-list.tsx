"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { st } from "@/components/app/settings/primitives";
import { Button, buttonVariants } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { cardLinkEmail } from "@/lib/failedPayments/cardLink";
import { nextWords, shortDay, type Ladder } from "@/lib/failedPayments/model";
import type { ClosedRow, PastDueRow } from "@/lib/failedPayments/reads";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

export type FailedLens = "past_due" | "recovered" | "lost";

const money = (cents: number | null) => (cents === null ? "—" : formatCentsAsCurrency(cents));

/**
 * The Failed payments lists (billing-r2 screen 4): who is past due with the provider's reason and retry ladder,
 * and the failures recovered or lost in the last 90 days. A past-due row opens a sheet with the whole ladder and
 * what can be done: Whop cannot retry on request through our integration, so the action is the board's fallback,
 * "Send the customer a link to update their card" (the provider's own card page), else the customer's record.
 */
export function FailedList({ lens, pastDue, recovered, lost, now }: {
  lens: FailedLens;
  pastDue: PastDueRow[];
  recovered: ClosedRow[] | null;
  lost: ClosedRow[] | null;
  /** The request's clock, so the ladder reads the same on the server and in the browser. */
  now: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? pastDue.find((row) => row.subscriptionId === openId) ?? null : null;

  if (lens !== "past_due") {
    const rows = lens === "recovered" ? recovered : lost;
    return (
      <TableCard className="min-w-0">
        <table className={cn(st.table, "min-w-[940px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Plan</th>
              <th scope="col" className={cn(st.th, "w-[100px]")}>Failed</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}>{lens === "recovered" ? "Recovered" : "Lost"}</th>
              <th scope="col" className={cn(st.th, "w-[240px]")}>Why it failed</th>
              <th scope="col" className={cn(st.th, st.num, "w-[110px]")}>Amount</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows === null && (
              <tr><td colSpan={6} className="border-t border-[var(--border)] p-0"><EmptyState title="Couldn't read the last 90 days" hint="The payment history didn't answer. The past-due list is current; reload to try again." /></td></tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr><td colSpan={6} className="border-t border-[var(--border)] p-0">
                <EmptyState title={lens === "recovered" ? "Nothing recovered in 90 days" : "Nobody lost in 90 days"} hint={lens === "recovered" ? "A customer appears here when a payment goes through after failing." : "A customer appears here when the provider cancels after the last retry."} />
              </td></tr>
            )}
            {(rows ?? []).map((row) => (
              <tr key={`${row.tenantId}-${row.failedAt}`} className="m-row">
                <td className={cn(st.td, "max-w-0 truncate")}><Link href={`/admin/tenants/${row.tenantId}?tab=subscription`} className="font-semibold text-[var(--ink)] no-underline hover:underline">{row.tenantName}</Link></td>
                <td className={cn(st.td, "truncate")}>{row.planName ?? "—"}</td>
                <td className={st.td}>{shortDay(row.failedAt)}</td>
                <td className={st.td}>{shortDay(row.endedAt)}</td>
                <td className={cn(st.td, "max-w-0 truncate")} title={row.reason ?? undefined}>{row.reason ?? "Not given"}</td>
                <td className={cn(st.td, st.num)} title="The plan's price on its cycle">{money(row.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    );
  }

  return (
    <>
      <TableCard className="min-w-0">
        <table className={cn(st.table, "min-w-[1120px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}>Invoice</th>
              <th scope="col" className={cn(st.th, st.num, "w-[100px]")}>Amount</th>
              <th scope="col" className={cn(st.th, "w-[200px]")}>Why it failed</th>
              <th scope="col" className={cn(st.th, "w-[300px]")}>Retry ladder</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Next</th>
              <th scope="col" className={cn(st.th, "w-10")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {pastDue.length === 0 && (
              <tr><td colSpan={7} className="border-t border-[var(--border)] p-0">
                <EmptyState title="Nobody is past due" hint="When a payment fails, the customer appears here with their retry ladder." />
              </td></tr>
            )}
            {pastDue.map((row) => (
              <tr key={row.subscriptionId} className={cn("m-row cursor-pointer hover:bg-[var(--hover-wash)]", openId === row.subscriptionId && "bg-[var(--hover-wash)]")} onClick={() => setOpenId(row.subscriptionId)}>
                <td className={cn(st.td, "max-w-0")}>
                  <button type="button" aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); setOpenId(row.subscriptionId); }} className="block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                    {row.tenantName}
                  </button>
                </td>
                <td className={st.td}>{row.invoice?.number ?? "—"}</td>
                <td className={cn(st.td, st.num)}>{money(row.invoice?.totalCents ?? row.amountCents)}</td>
                <td className={cn(st.td, "max-w-0 truncate")} title={row.ladder.reason ?? undefined}>{row.ladder.reason ?? "Not given"}</td>
                <td className={st.td}><LadderLine ladder={row.ladder} /></td>
                <td className={st.td}><StatusChip tone={row.ladder.readOnlyAt && Date.parse(row.ladder.readOnlyAt) <= now ? "danger" : "warning"}>{nextWords(row.ladder, now)}</StatusChip></td>
                <td className={st.td}><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          The provider retries the card on its own and cancels five days after the first failure; the workspace then goes read-only. Nothing is deleted.
        </p>
      </TableCard>

      {open && <PastDueSheet row={open} now={now} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** The ladder on one line: Failed Nov 14 › Retried Nov 16 › Next Nov 18 › Read-only Nov 19. */
function LadderLine({ ladder }: { ladder: Ladder }) {
  if (!ladder.steps.length) return <span className="text-muted-foreground">No failure on record</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
      {ladder.steps.map((step, index) => (
        <span key={step.key} className="inline-flex items-center gap-1 whitespace-nowrap">
          {index > 0 && <span aria-hidden="true" className="text-muted-foreground">›</span>}
          <span className={cn(step.state === "done" ? "text-foreground" : step.state === "next" ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {step.label} {shortDay(step.at)}
          </span>
        </span>
      ))}
    </span>
  );
}

function PastDueSheet({ row, now, onClose }: { row: PastDueRow; now: number; onClose: () => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSend = row.hasMembership && Boolean(row.ownerEmail);
  const preview = cardLinkEmail({ ownerName: null, businessName: row.tenantName, amountLabel: row.invoice ? formatCentsAsCurrency(row.invoice.totalCents) : row.amountCents === null ? null : formatCentsAsCurrency(row.amountCents), readOnlyAt: row.ladder.readOnlyAt, url: "(the provider's card page)" });

  async function send() {
    setBusy(true);
    const res = await fetch("/api/admin/billing/failed-payments/card-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: row.subscriptionId }) }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      notify.block(body?.error ?? "The link could not be sent");
      return;
    }
    notify.done(`Card link sent to ${body?.to ?? row.ownerEmail}`);
    setConfirm(false);
    router.refresh();
  }

  return (
    <>
      <DetailPanel
        mode="overlay"
        className="lg:w-[min(560px,calc(100vw-80px))]"
        title={row.tenantName}
        subtitle={`${row.planName ?? "Plan unknown"} · past due`}
        status={<StatusChip tone={row.ladder.readOnlyAt && Date.parse(row.ladder.readOnlyAt) <= now ? "danger" : "warning"}>{nextWords(row.ladder, now)}</StatusChip>}
        onClose={onClose}
        closeLabel="Close the customer"
        footer={
          <>
            <Link href={`/admin/tenants/${row.tenantId}?tab=subscription`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}>Open Customer Record</Link>
            <span className="flex-1" />
            {canSend ? (
              <Button type="button" onClick={() => setConfirm(true)} disabled={busy}>Send a link to update their card…</Button>
            ) : (
              <span className="text-xs text-muted-foreground">{!row.hasMembership ? "No provider membership to send a card page for" : "No owner email to send to"}</span>
            )}
          </>
        }
      >
        <FactTable
          labelWidth={140}
          rows={[
            ["Invoice", row.invoice ? <Link key="i" href={`/admin/invoices/${row.invoice.id}`} className="text-[var(--accent-ink)] no-underline hover:underline">{row.invoice.number} · {formatCentsAsCurrency(row.invoice.totalCents)}{row.invoice.dueAt ? ` · due ${shortDay(row.invoice.dueAt)}` : ""}</Link> : "No unpaid invoice on record"],
            ["Renewal price", money(row.amountCents)],
            ["Why it failed", row.ladder.reason ?? "The provider didn't say"],
            ["First failed", shortDay(row.ladder.failedAt)],
            ["Retried", row.ladder.triedAgainOn.length ? row.ladder.triedAgainOn.map(shortDay).join(", ") : "Not yet"],
            ["Next retry", row.ladder.nextRetryAt ? shortDay(row.ladder.nextRetryAt) : "None named by the provider"],
            ["Read-only from", row.ladder.readOnlyAt ? shortDay(row.ladder.readOnlyAt) : "—"],
            ["Owner", row.ownerEmail ?? "No owner email"],
          ]}
        />
        <p className="m-0 text-xs text-muted-foreground">
          Retrying the charge on request isn&apos;t something our payment provider integration can do; the provider retries on its own schedule. Sending the owner the provider&apos;s card page is the quickest way back.
        </p>
      </DetailPanel>

      <Dialog open={confirm} onOpenChange={(value) => !value && !busy && setConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {row.tenantName} a link to update their card</DialogTitle>
            <DialogDescription>One email to {row.ownerEmail}, with the provider&apos;s own card page. Recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <p className="m-0 text-sm font-semibold text-foreground">{preview.subject}</p>
            <p className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-[var(--body)]">{preview.text}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>Close</Button>
            <Button type="button" onClick={() => void send()} disabled={busy}>{busy ? "Sending…" : "Send the link"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
