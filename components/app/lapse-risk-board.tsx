"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { notify } from "@/lib/notify";

import { useFittingPageSize } from "@/components/app/book-views";
import { RecordLapseSignal, refreshLapseSignalAccess } from "@/components/app/record-lapse-signal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";
import { dayMonthYear } from "@/lib/format/dates";
import {
  LAPSE_RESOLUTION_LABELS,
  LAPSE_SIGNAL_LABELS,
  LAPSE_SIGNAL_NOTE_MAX,
  URGENCY_RULE,
  type AtRiskPolicy,
  type AtRiskTotals,
  type CommissionExposed,
  type LapseResolution,
  type LapseSignalKind,
} from "@/lib/lapseRisk/model";

/**
 * /app/lapse-risk with something on it: every policy carrying at least one open lapse signal, most
 * urgent first (the order is lib/lapseRisk/model.ts rankAtRisk, and URGENCY_RULE says it in the
 * table's footer). Each row shows the signals that put it there, the premium, and what a
 * lapse today would charge back. The empty state stays the board's own (lapse-risk-empty.tsx).
 */

const KIND_TONE: Record<LapseSignalKind, { ink: string; dot: string }> = {
  returned_payment: { ink: "text-[var(--error-ink)]", dot: "bg-[var(--error)]" },
  missed_draft: { ink: "text-[var(--warning-ink)]", dot: "bg-[var(--warning)]" },
  service_call: { ink: "text-[var(--info-ink)]", dot: "bg-[var(--info)]" },
  other: { ink: "text-[var(--body)]", dot: "bg-[var(--muted)]" },
};

const RESOLUTION_HELP: Record<LapseResolution, string> = {
  payment_received: "The missed money arrived. Every open signal on this policy is closed and it leaves Lapse risk.",
  policy_reinstated: "The carrier reinstated the policy. Every open signal is closed and it leaves Lapse risk.",
  false_alarm: "Nothing was wrong. Every open signal is closed and it leaves Lapse risk.",
  policy_lapsed:
    "The policy lapsed. Its status on the book of business becomes Lapsed, and the commission ledger posts the chargeback for it. This cannot be undone from here.",
};

/** "24 Sep 2026". A calendar day, so no zone can shift it. */
function date(value: string) {
  return dayMonthYear(value.slice(0, 10));
}

/** The amount a lapse today would charge back; its window has its own column (Clawback). */
function Exposure({ exposure }: { exposure: CommissionExposed }) {
  if (exposure.state === "exposed") {
    return <span className="font-semibold tabular-nums text-foreground">{formatCentsAsCurrency(exposure.cents)}</span>;
  }
  const copy =
    exposure.state === "outside_window" ? "Outside the clawback window" : exposure.state === "not_issued" ? "Not issued yet" : "No commission rule on file";
  return (
    <span className="text-muted-foreground" title={exposure.state === "no_rule" ? exposure.reason : undefined}>
      {copy}
    </span>
  );
}

function Clawback({ exposure }: { exposure: CommissionExposed }) {
  if (exposure.state !== "exposed") return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{exposure.clawbackType === "prorated" ? "Prorated" : "Full"} to {date(exposure.clawbackEndsOn)}</span>;
}

/** Everything a signal says, for its chip's tooltip. */
function signalDetail(signal: AtRiskPolicy["signals"][number]) {
  const source = signal.source === "feed" ? "from a carrier feed" : `recorded by ${signal.recordedByName ?? "a former user"}`;
  return `${LAPSE_SIGNAL_LABELS[signal.kind]} · ${date(signal.occurredOn)} · ${source}${signal.note ? ` · ${signal.note}` : ""}`;
}

function ResolveAction({ policy, onDone }: { policy: AtRiskPolicy; onDone: () => void }) {
  const [resolution, setResolution] = useState<LapseResolution | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function choose(value: LapseResolution) {
    setNote("");
    setResolution(value);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!resolution) return;
    setSaving(true);
    try {
      const response = await fetch("/api/app/policies/lapse-risk/signals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: policy.policyId, resolution, note: note.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not resolve the lapse signals");
      notify.done(resolution === "policy_lapsed" ? `${policy.policyNumber} marked lapsed` : `${policy.policyNumber} is off Lapse risk`);
      setResolution(null);
      onDone();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "Could not resolve the lapse signals");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)]">
            Resolve
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => choose("payment_received")}>{LAPSE_RESOLUTION_LABELS.payment_received}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("policy_reinstated")}>{LAPSE_RESOLUTION_LABELS.policy_reinstated}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("false_alarm")}>{LAPSE_RESOLUTION_LABELS.false_alarm}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => choose("policy_lapsed")}>{LAPSE_RESOLUTION_LABELS.policy_lapsed}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={resolution !== null} onOpenChange={(next) => { if (!next && !saving) setResolution(null); }}>
        <DialogContent>
          {resolution && (
            <form onSubmit={confirm} className="grid gap-4">
              <DialogHeader>
                <DialogTitle className="text-base">
                  {resolution === "policy_lapsed" ? `Mark ${policy.policyNumber} lapsed?` : `${LAPSE_RESOLUTION_LABELS[resolution]} — ${policy.policyNumber}`}
                </DialogTitle>
                <DialogDescription>{RESOLUTION_HELP[resolution]}</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Resolves {policy.signals.length === 1 ? "1 open signal" : `${policy.signals.length} open signals`} on {policy.insuredName}&rsquo;s policy.
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor={`resolve-note-${policy.policyId}`}>
                  Note <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <textarea
                  id={`resolve-note-${policy.policyId}`}
                  rows={2}
                  maxLength={LAPSE_SIGNAL_NOTE_MAX}
                  className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setResolution(null)}>Cancel</Button>
                <Button type="submit" variant={resolution === "policy_lapsed" ? "destructive" : "default"} disabled={saving}>
                  {saving ? "Saving…" : resolution === "policy_lapsed" ? "Mark lapsed" : LAPSE_RESOLUTION_LABELS[resolution]}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LapseRiskBoard({
  policies,
  totals,
  readOnly,
  tabs,
}: {
  policies: AtRiskPolicy[];
  totals: AtRiskTotals;
  readOnly: boolean;
  tabs?: React.ReactNode;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => {
    void refreshLapseSignalAccess();
    startRefresh(() => router.refresh());
  };
  const openSignals = policies.reduce((sum, policy) => sum + policy.signals.length, 0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | LapseSignalKind>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return policies.filter((policy) =>
      (kind === "all" || policy.signals.some((signal) => signal.kind === kind)) &&
      (!needle || [policy.policyNumber, policy.insuredName, policy.carrier, policy.product].some((value) => value?.toLowerCase().includes(needle))),
    );
  }, [policies, query, kind]);
  const filtered = query.trim() !== "" || kind !== "all";
  const clearFilters = () => { setQuery(""); setKind("all"); setPage(1); };
  const { current, rows: pageRows } = paginate(visible, page, pageSize);

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader
        title="Lapse risk"
        actions={readOnly ? undefined : <RecordLapseSignal />}
      />
      {tabs}

      {readOnly && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">Your account is read-only. Recording and resolving lapse signals is unavailable.</div>}

      <StatStrip label="Lapse risk summary">
        <StatTile label="Policies at risk" value={totals.policies.toLocaleString()} footnote={`${openSignals} open ${openSignals === 1 ? "signal" : "signals"}`} />
        <StatTile label="Premium at risk" value={formatCentsAsCurrency(totals.monthlyPremiumCents)} unit="/mo" footnote={`${formatCentsAsCurrency(totals.annualPremiumCents)} a year`} />
        <StatTile
          label="Commission exposed"
          labelTitle="What the carriers would charge back if every policy here lapsed today"
          value={formatCentsAsCurrency(totals.commissionExposedCents)}
          footnote={totals.unpriced > 0 ? `if all lapsed today · ${totals.unpriced} not priced` : "if all lapsed today"}
        />
      </StatStrip>

      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-322px)] flex-col [&>*:nth-child(2)]:flex-1"
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clearFilters} />}
            <RefreshButton onClick={refresh} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policy, insured, carrier" />
            <select aria-label="Filter by signal" className={toolbarControl} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }}>
              <option value="all">All signals</option>
              {(Object.keys(KIND_TONE) as LapseSignalKind[]).map((key) => <option key={key} value={key}>{LAPSE_SIGNAL_LABELS[key]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={<Pager page={current} total={visible.length} pageSize={pageSize} noun={visible.length === 1 ? "policy" : "policies"} onPage={setPage} suffix={<span title={URGENCY_RULE}>{filtered ? `filtered from ${policies.length} · ` : ""}{URGENCY_RULE}</span>} />}
      >
        {visible.length === 0 ? (
          <NoMatches noun="policies" onClear={clearFilters} />
        ) : (
        <Table className="min-w-[1240px]">
          <TableHeader>
            <TableRow>
              <TableHead>Policy</TableHead>
              <TableHead>Insured</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Signals</TableHead>
              <TableHead>Oldest signal</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead className="text-right">Commission exposed</TableHead>
              <TableHead>Clawback</TableHead>
              {!readOnly && <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((policy) => {
              const oldest = policy.signals.reduce((first, signal) => (signal.occurredOn < first.occurredOn ? signal : first), policy.signals[0]);
              const notes = policy.signals.filter((signal) => signal.note).map((signal) => `${LAPSE_SIGNAL_LABELS[signal.kind]}: ${signal.note}`);
              return (
                <TableRow key={policy.policyId}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold text-foreground">{policy.policyNumber}</span>
                      {policy.status === "pending" && <StatusChip tone="warning">Pending</StatusChip>}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate" title={policy.insuredName}>{policy.insuredName}</TableCell>
                  <TableCell className="max-w-[150px] truncate" title={policy.carrier}>{policy.carrier}</TableCell>
                  <TableCell className="max-w-[140px] truncate" title={policy.product}>{policy.product}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-3">
                      {policy.signals.map((signal) => (
                        <span key={signal.id} title={signalDetail(signal)} className={`inline-flex items-center gap-1.5 text-xs font-semibold ${KIND_TONE[signal.kind].ink}`}>
                          <span className={`size-1.5 shrink-0 rounded-full ${KIND_TONE[signal.kind].dot}`} aria-hidden="true" />
                          {LAPSE_SIGNAL_LABELS[signal.kind]}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={oldest ? signalDetail(oldest) : undefined}>
                    {oldest ? <><span className="tabular-nums">{date(oldest.occurredOn)}</span><span className="text-muted-foreground"> · {oldest.source === "feed" ? "carrier feed" : oldest.recordedByName ?? "a former user"}</span></> : "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={notes.join("\n") || undefined}>{notes.length ? notes.join(" · ") : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right tabular-nums" title={`${formatCentsAsCurrency(policy.annualPremiumCents)} a year`}>{formatCentsAsCurrency(policy.monthlyPremiumCents)}/mo</TableCell>
                  <TableCell className="text-right"><Exposure exposure={policy.exposure} /></TableCell>
                  <TableCell><Clawback exposure={policy.exposure} /></TableCell>
                  {!readOnly && (
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        <RecordLapseSignal policy={{ id: policy.policyId, status: policy.status }} label="Add signal" showAtRisk={false} />
                        <ResolveAction policy={policy} onDone={refresh} />
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        )}
      </TableCard>
    </div>
  );
}
