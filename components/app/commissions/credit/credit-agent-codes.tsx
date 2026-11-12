"use client";

import { useMemo, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MapCodeDialog, policiesHref, policiesLabel, type Member, type Outcome } from "@/components/app/book/setup/agent-codes-dialogs";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { UnmappedAgent } from "@/lib/ingestion/policyMatchingStore";
import { notify } from "@/lib/notify";

const AGENT_CODES_HREF = "/app/book-setup/agent-codes?show=unmapped";

/**
 * Who gets the credit › Agent codes (round 7, mockups-r7/commissions.html 3·A): the agent codes nobody in the agency
 * has. A row opens Carrier sync's own "Map the code" dialog (the same call, /api/app/policy-matching map_agent), so a
 * code is mapped in one place; mapping it credits every line on it.
 */
export function CreditAgentCodes({ unmapped, members, readOnly }: { unmapped: UnmappedAgent[]; members: Member[]; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<UnmappedAgent | null>(null);
  const pageSize = useFittingPageSize(420, 45);
  const carriers = useMemo(() => {
    const names = new Map(unmapped.map((a) => [a.carrierId, a.carrierName]));
    return [{ value: "", label: "All carriers" }, ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [unmapped]);
  const needle = query.trim().toLowerCase();
  const rows = unmapped
    .filter((a) => (!carrier || a.carrierId === carrier) && (!needle || [a.agentIdentifier, a.carrierName].some((v) => v.toLowerCase().includes(needle))))
    .sort((a, b) => b.policies - a.policies || a.agentIdentifier.localeCompare(b.agentIdentifier));
  const shown = paginate(rows, page, pageSize);
  const filtered = Boolean(needle || carrier);
  const clear = () => { setQuery(""); setCarrier(""); setPage(1); };

  async function map(agent: UnmappedAgent, userId: string): Promise<Outcome> {
    try {
      const response = await fetch("/api/app/policy-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "map_agent", carrier_id: agent.carrierId, agent_identifier: agent.agentIdentifier, user_id: userId }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) return data.error ?? "That did not save.";
    } catch {
      return "That did not save.";
    }
    notify.done("Agent code mapped.");
    refreshStepCounts();
    router.refresh();
    return null;
  }
  const openRow = (agent: UnmappedAgent) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    setOpen(agent);
  };

  const toolbar = (
    <DataToolbar actions={<>
      {filtered && <ClearFiltersButton onClick={clear} />}
      <Button asChild variant="outline"><Link href={AGENT_CODES_HREF}>Every agent code</Link></Button>
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search agent codes" />
      {carriers.length > 2 && <SelectMenu label="Carrier" className="w-full sm:w-52" searchPlaceholder="Search carriers" value={carrier} defaultValue="" options={carriers} onChange={(v) => { setCarrier(v); setPage(1); }} />}
    </DataToolbar>
  );

  return (
    <>
      <TableCard toolbar={unmapped.length ? toolbar : undefined} footer={rows.length ? <Pager page={shown.current} total={rows.length} noun="agent codes" pageSize={pageSize} onPage={setPage} suffix="Most policies first" /> : undefined}>
        {unmapped.length === 0 ? (
          <EmptyState title="Every code is mapped" hint="Each carrier code now credits a person. A new code shows up here the first time a file carries it." action={<Button asChild variant="outline"><Link href="/app/book-setup/agent-codes?show=mapped">Open Agent codes</Link></Button>} />
        ) : rows.length === 0 ? <NoMatches noun="agent codes" onClear={clear} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent code</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Policies</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">What to do</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((a) => (
                <TableRow key={`${a.carrierId}|${a.agentIdentifier}`} className="cursor-pointer" onClick={openRow(a)}>
                  <TableCell className="whitespace-nowrap font-medium">{a.agentIdentifier}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.carrierName}</TableCell>
                  <TableCell className="text-right"><Link href={policiesHref(a.carrierId, null)} className="tabular-nums underline-offset-2 hover:underline">{policiesLabel(a.policies)}</Link></TableCell>
                  <TableCell><StatusChip tone="warning">No producer yet</StatusChip></TableCell>
                  <TableCell className="whitespace-nowrap text-right">{readOnly ? "Open ›" : "Map ›"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {open && <MapCodeDialog queue={[open]} stepping={false} members={members} readOnly={readOnly} onMap={map} onClose={() => setOpen(null)} />}
    </>
  );
}
