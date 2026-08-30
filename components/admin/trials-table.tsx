"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TrialRow } from "@/lib/trials/queries";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type PendingAction = { trial: TrialRow; kind: "extend" | "cancel" } | null;

/**
 * Whether this trial looks like it will convert.
 *
 * Engagement stands in for the setup-progress column the ticket describes — nothing records which
 * setup steps are done, and the steps refer to product features that mostly do not exist, so a
 * count would read 0/5 for everyone. "Has never signed in, and the trial is nearly over" prompts
 * the same phone call, and it is measured rather than invented.
 */
function risk(trial: TrialRow): { level: "at_risk" | "quiet" | "engaged"; label: string } {
  if (!trial.last_login_at) {
    return trial.days_remaining <= 7
      ? { level: "at_risk", label: "Never signed in" }
      : { level: "quiet", label: "Not started yet" };
  }
  const daysSince = Math.floor((Date.now() - new Date(trial.last_login_at).getTime()) / 86_400_000);
  if (daysSince >= 5) return { level: "quiet", label: `Last seen ${daysSince}d ago` };
  return { level: "engaged", label: daysSince === 0 ? "Active today" : `Active ${daysSince}d ago` };
}

const RISK_STYLE = {
  at_risk: "border-transparent bg-destructive/10 text-destructive",
  quiet: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  engaged: "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]",
};

export function TrialsTable({ trials }: { trials: TrialRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(trial: TrialRow, body: Record<string, unknown>, success: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/trials/${trial.subscription_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(result?.error ?? "That did not work");
      return;
    }

    toast.success(success);
    setPending(null);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Tenant</TableHead>
              <TableHead className={tableHeadCell}>Plan</TableHead>
              <TableHead className={tableHeadCell}>Day</TableHead>
              <TableHead className={tableHeadCell}>Engagement</TableHead>
              <TableHead className={tableHeadCell}>Card</TableHead>
              <TableHead className={tableHeadCell}>Ends</TableHead>
              <TableHead className={tableHeadCell}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No trials in flight.
                </TableCell>
              </TableRow>
            ) : (
              trials.map((trial) => {
                const signal = risk(trial);
                const total = trial.days_elapsed + trial.days_remaining;

                return (
                  <TableRow key={trial.subscription_id}>
                    <TableCell className="font-medium">
                      {trial.business_name ?? trial.tenant_name}
                      <span className="block text-xs text-muted-foreground">{trial.owner_email}</span>
                    </TableCell>
                    <TableCell>{trial.plan_name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {trial.days_elapsed}/{total}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={RISK_STYLE[signal.level]}>
                        {signal.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {trial.has_payment_method ? (
                        <CheckCircle2 className="size-4 text-[var(--color-success)]" />
                      ) : (
                        <AlertTriangle className="size-4 text-[var(--color-warning)]" />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(trial.trial_ends_at).toLocaleDateString()}
                      <span className="block text-xs text-muted-foreground">
                        {trial.days_remaining}d left
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" onClick={() => setPending({ trial, kind: "extend" })}>
                        Extend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !trial.has_payment_method}
                        title={trial.has_payment_method ? undefined : "No card on file to charge"}
                        onClick={() => act(trial, { action: "convert" }, "Charged — the payment webhook will convert it")}
                      >
                        Convert
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPending({ trial, kind: "cancel" })}>
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "extend" ? "Extend" : "Cancel"} the trial for{" "}
              {pending?.trial.business_name ?? pending?.trial.tenant_name}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "extend"
                ? "Pushes the charge date and every reminder with it, here and at the payment provider."
                : "Stops the provider collecting and ends the trial. The reason is recorded."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {pending?.kind === "extend" && (
              <div className="space-y-1.5">
                <Label htmlFor="days">Extend by (days)</Label>
                <Input id="days" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={pending?.kind === "extend" ? "Onboarding call slipped a week" : "Customer asked to stop"}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Close
            </Button>
            <Button
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                pending &&
                act(
                  pending.trial,
                  pending.kind === "extend"
                    ? { action: "extend", days: Number(days), reason: reason.trim() }
                    : { action: "cancel", reason: reason.trim() },
                  pending.kind === "extend" ? "Trial extended" : "Trial cancelled",
                )
              }
            >
              {pending?.kind === "extend" ? "Extend trial" : "Cancel trial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
