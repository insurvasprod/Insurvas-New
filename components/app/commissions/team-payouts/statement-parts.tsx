"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/notify";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { sendJson } from "@/components/app/agency/use-agency-data";
import { BasisChip } from "@/components/app/agency/money";
import { bpsToPercent, dollars } from "@/lib/agency/constants";
import { premiumLabel, type StatementLine } from "@/lib/agency/statementCore";

/**
 * A producer statement's client parts (round 7, 7·1, owner 2026-11-10): the Policies table (search, a Chargebacks
 * chip; the client and the policy link to the book) and the owner's ⋯ (Void this run, with its reason; Open
 * {name}'s pay; Open the pay plan).
 */
export type PolicyLine = StatementLine & { carrierId: string | null };

export function StatementPolicies({ lines, showLevel }: { lines: PolicyLine[]; showLevel: boolean }) {
  const [search, setSearch] = useState("");
  const [backs, setBacks] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(380, 45);
  const chargebacks = lines.filter((l) => l.chargebackCents !== null).length;
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((l) => (!backs || l.chargebackCents !== null) && (!needle || `${l.client} ${l.policy} ${l.carrier}`.toLowerCase().includes(needle)));
  const shown = paginate(visible, page, pageSize);
  return (
    <TableCard
      toolbar={lines.length === 0 ? undefined : (
        <DataToolbar actions={<StatusChip tone="action" dot={false}>Reported basis</StatusChip>}>
          <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Client or policy" />
          <ToggleChip selected={backs} onClick={() => { setBacks(!backs); setPage(1); }} count={chargebacks} countTone={chargebacks ? "danger" : undefined}>Chargebacks</ToggleChip>
        </DataToolbar>
      )}
      footer={visible.length > pageSize ? <Pager page={shown.current} total={visible.length} noun="policies" pageSize={pageSize} onPage={setPage} /> : undefined}
    >
      {lines.length === 0 ? <EmptyState title="No policy movements in this period" hint="Only payouts or adjustments moved this period; see the other tabs." />
        : visible.length === 0 ? <NoMatches noun="policies" onClear={() => { setSearch(""); setBacks(false); }} /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Client</TableHead><TableHead>Carrier · policy</TableHead><TableHead className="text-right">Premium</TableHead>
            {showLevel ? <TableHead className="text-right">Level</TableHead> : null}
            <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Chargeback</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.rows.map((l) => {
              const policyHref = l.carrierId && l.policy !== "—" ? `/app/policies/carrier/${l.carrierId}/${encodeURIComponent(l.policy)}` : null;
              const none = <span className="text-muted-foreground">—</span>;
              return (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap font-medium">{l.client === "—" ? none : policyHref ? <Link className="hover:underline" href={`/app/policies?q=${encodeURIComponent(l.client)}`}>{l.client}</Link> : l.client}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.carrier}{l.policy !== "—" ? <> · {policyHref ? <Link className="hover:underline" href={policyHref}>{l.policy}</Link> : l.policy}</> : null}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{premiumLabel(l.premiumCents, l.premiumMode)}</TableCell>
                  {showLevel ? <TableCell className="text-right tabular-nums">{bpsToPercent(l.levelBps)}</TableCell> : null}
                  <TableCell className="text-right tabular-nums">{l.grossCents === null ? none : dollars(l.grossCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.chargebackCents === null ? none : dollars(l.chargebackCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dollars(l.netCents)}</TableCell>
                  {/* The row's one chip: a chargeback says so; otherwise a figure not on the reported basis names its basis. */}
                  <TableCell>{l.chargebackCents !== null ? <StatusChip tone="danger">Chargeback</StatusChip> : l.basis !== "reported" ? <BasisChip basis={l.basis} /> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

/** The owner's ⋯ on a statement. A void run keeps only the links. */
export function StatementMore({ runId, name, period, canVoid, payHref, planHref }: { runId: string; name: string; period: string; canVoid: boolean; payHref: string | null; planHref: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = name.split(/\s+/)[0] || name;
  async function go() {
    if (!reason.trim()) return;
    setBusy(true);
    setProblem(null);
    const { error } = await sendJson(`/api/app/accounting/producer-runs/${runId}`, "POST", { action: "void", reason: reason.trim() });
    setBusy(false);
    if (error) { setProblem(error); return; }
    notify.done("The run is void. Its amount is back on their balance.");
    setAsking(false);
    setReason("");
    router.refresh();
  }
  return (
    <>
      <MoreMenu label={`More for ${name}'s statement`} items={[
        canVoid && { label: "Void this run", onSelect: () => { setProblem(null); setAsking(true); } },
        payHref && { label: `Open ${first}'s pay`, href: payHref },
        { label: "Open the pay plan", href: planHref },
      ]} />
      <ConfirmDialog
        open={asking}
        onOpenChange={(next) => { if (!next) setAsking(false); }}
        title={`Void ${name}'s run for ${period}?`}
        description="Use this when the month was paid wrong. The pay goes back on their balance, their statement shows the run as void, and you can run the month again. It cannot be undone."
        confirmLabel={busy ? "Saving…" : "Void this run"}
        cancelLabel="Keep it"
        busy={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={() => void go()}
        fields={<>
          <Field label="Why? (kept on the record)" htmlFor="void-run-why"><input id="void-run-why" className={control} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid the wrong month" /></Field>
          {problem ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{problem}</p> : null}
        </>}
      />
    </>
  );
}
