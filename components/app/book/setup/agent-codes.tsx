"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { inputControl } from "@/components/ui/field";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { MappedAgent, UnmappedAgent } from "@/lib/ingestion/policyMatchingStore";
import { notify } from "@/lib/notify";

/**
 * Setup › Agent codes (owner 2026-11-02, round 2): each carrier's writing-agent code and the person it
 * credits, edited in the row. The same data and actions as Policy matching › Agent codes
 * (/api/app/policy-matching: map_agent, unmap_agent, add_agent); the codes to map come first.
 */
export function AgentCodes({ unmapped, mapped, members, carriers, readOnly }: { unmapped: UnmappedAgent[]; mapped: MappedAgent[]; members: Array<{ userId: string; name: string }>; carriers: Array<{ id: string; name: string }>; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState({ carrierId: "", code: "", userId: "" });
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => [
    ...unmapped.map((a) => ({ kind: "unmapped" as const, ...a })),
    ...mapped.map((m) => ({ kind: "mapped" as const, ...m })),
  ].filter((a) => !q || [a.agentIdentifier, a.carrierName, a.kind === "mapped" ? a.userName : ""].some((v) => v.toLowerCase().includes(q))), [unmapped, mapped, q]);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(rows, page, pageSize);

  async function post(key: string, body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(key);
    try {
      const response = await fetch("/api/app/policy-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      router.refresh();
      return true;
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const search = (value: string) => { setQuery(value); setPage(1); };
  const toolbar = (
    <DataToolbar actions={<>
      {q && <ClearFiltersButton onClick={() => search("")} />}
      {!readOnly && <Button type="button" variant="outline" disabled={adding} onClick={() => setAdding(true)}>Add agent code</Button>}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={search} placeholder="Search agent codes" />
    </DataToolbar>
  );

  const addRow = adding && (
    <tr>
      <td><input aria-label="Agent code" className={`${inputControl} font-mono`} spellCheck={false} autoComplete="off" placeholder="As the carrier writes it" value={code.code} onChange={(e) => setCode({ ...code, code: e.target.value })} /></td>
      <td>
        <select aria-label="Carrier" className={`${toolbarControl} w-full`} value={code.carrierId} onChange={(e) => setCode({ ...code, carrierId: e.target.value })}>
          <option value="">Choose the carrier</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td className="text-right text-muted-foreground">—</td>
      <td>
        <select aria-label="Person" className={`${toolbarControl} w-full`} value={code.userId} onChange={(e) => setCode({ ...code, userId: e.target.value })}>
          <option value="">Choose the person</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
      </td>
      <td className="text-right">
        <span className="inline-flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => setAdding(false)}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy !== null || !code.carrierId || !code.code.trim() || !code.userId} onClick={() => void post("add", { action: "add_agent", carrier_id: code.carrierId, agent_identifier: code.code.trim(), user_id: code.userId }, "Agent code added.").then((ok) => { if (ok) { setAdding(false); setCode({ carrierId: "", code: "", userId: "" }); } })}>Add</Button>
        </span>
      </td>
    </tr>
  );

  return (
    <TableCard toolbar={toolbar} footer={rows.length ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="agent codes" onPage={setPage} suffix={unmapped.length ? `${unmapped.length} to map` : "all mapped"} /> : undefined}>
      {!adding && unmapped.length === 0 && mapped.length === 0 ? (
        <EmptyState title="No agent codes yet" hint="Each carrier's writing-agent code appears here the first time a file carries it, or add one yourself." action={!readOnly ? <Button type="button" onClick={() => setAdding(true)}>Add agent code</Button> : undefined} />
      ) : !adding && rows.length === 0 ? (
        <NoMatches noun="agent codes" onClear={() => search("")} />
      ) : (
        <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
          <thead><tr><th>Code</th><th>Carrier</th><th className="w-[110px] text-right">Policies</th><th className="w-[260px]">Person</th><th className="w-[170px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {addRow}
            {shown.rows.map((agent) => {
              if (agent.kind === "mapped") return (
                <tr key={agent.id}>
                  <td className="font-mono text-xs text-foreground">{agent.agentIdentifier}</td>
                  <td>{agent.carrierName}</td>
                  <td className="text-right tabular-nums">{agent.policies.toLocaleString("en-US")}</td>
                  <td>{agent.userName}</td>
                  <td className="text-right">{!readOnly && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void post(`unmap-${agent.id}`, { action: "unmap_agent", map_id: agent.id }, "Mapping removed.")}>Unmap</Button>}</td>
                </tr>
              );
              const key = `${agent.carrierId}|${agent.agentIdentifier}`;
              return (
                <tr key={key}>
                  <td className="font-mono text-xs text-foreground">{agent.agentIdentifier}</td>
                  <td>{agent.carrierName}</td>
                  <td className="text-right"><StatusChip tone="warning">{`${agent.policies.toLocaleString("en-US")} ${agent.policies === 1 ? "policy" : "policies"}`}</StatusChip></td>
                  <td>
                    <select aria-label={`Person for ${agent.agentIdentifier}`} className={`${toolbarControl} w-full`} disabled={readOnly} value={assign[key] ?? ""} onChange={(e) => setAssign((current) => ({ ...current, [key]: e.target.value }))}>
                      <option value="">Choose…</option>
                      {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                    </select>
                  </td>
                  <td className="text-right">{!readOnly && <Button type="button" size="sm" disabled={!assign[key] || busy !== null} onClick={() => void post(`map-${key}`, { action: "map_agent", carrier_id: agent.carrierId, agent_identifier: agent.agentIdentifier, user_id: assign[key] }, "Agent code mapped.")}>Map</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
