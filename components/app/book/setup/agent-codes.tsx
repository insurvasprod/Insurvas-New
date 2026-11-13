"use client";

import { useMemo, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AddCodeDialog, MapCodeDialog, MappedCodeDialog, policiesHref, policiesLabel, type Carrier, type Member, type Outcome } from "@/components/app/book/setup/agent-codes-dialogs";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { MappedAgent, UnmappedAgent } from "@/lib/ingestion/policyMatchingStore";
import { notify } from "@/lib/notify";

/**
 * Setup › Agent codes (owner 2026-11-02, round 2; round 7 direction A, owner 2026-11-10 "Build all four",
 * docs/la4/mockups-r7/carrier-sync-setup.html board 3·A): each carrier's writing-agent code and the person it
 * credits. To map · Mapped · All are the title line's tabs (the page hands in `show`); a row opens its dialog, never
 * a choice inside the row; "Map one by one" walks the codes to map, biggest first. The same data and actions as
 * Policy matching › Agent codes (/api/app/policy-matching: map_agent, unmap_agent, add_agent).
 */
export type AgentCodesShow = "unmapped" | "mapped" | "all";

export const AGENT_CODES_HREF = "/app/book-setup/agent-codes";
export const READ_ONLY_REASON = "Paused while the account is read-only.";

/** One call to the matching API: null when it saved, else what went wrong, for the dialog's error line. */
async function send(body: Record<string, unknown>): Promise<Outcome> {
  try {
    const response = await fetch("/api/app/policy-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok ? null : data.error ?? "That did not save.";
  } catch {
    return "That did not save.";
  }
}

const mapBody = (carrierId: string, agentIdentifier: string, userId: string) => ({ action: "map_agent", carrier_id: carrierId, agent_identifier: agentIdentifier, user_id: userId });

/** The calls and their toasts, shared by the list and the title line's buttons. */
function useCodeActions() {
  const router = useRouter();
  const map = async (agent: { carrierId: string; agentIdentifier: string }, userId: string): Promise<Outcome> => {
    const failed = await send(mapBody(agent.carrierId, agent.agentIdentifier, userId));
    if (!failed) { notify.done("Agent code mapped."); router.refresh(); }
    return failed;
  };
  const add = async (draft: { carrierId: string; code: string; userId: string }): Promise<Outcome> => {
    const failed = await send({ action: "add_agent", carrier_id: draft.carrierId, agent_identifier: draft.code, user_id: draft.userId });
    if (!failed) { notify.done("Agent code added."); router.refresh(); }
    return failed;
  };
  // A loss asks first (UI-CONSISTENCY §11): the code stops pointing at its person and goes back to the codes to map.
  // Undo maps it back to the same person with the same map_agent call.
  const unmap = async (agent: MappedAgent) => {
    const ok = await confirmAction({
      title: `Unmap ${agent.agentIdentifier}?`,
      description: `${agent.agentIdentifier} at ${agent.carrierName} stops pointing to ${agent.userName}. It goes back to the codes to map.`,
      confirmLabel: "Unmap",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    const failed = await send({ action: "unmap_agent", map_id: agent.id });
    if (failed) { notify.block(failed); return; }
    router.refresh();
    notify.done("Mapping removed.", {
      action: {
        label: "Undo",
        onClick: () => void send(mapBody(agent.carrierId, agent.agentIdentifier, agent.userId)).then((again) => {
          if (again) notify.block(again);
          else { notify.done("Agent code mapped."); router.refresh(); }
        }),
      },
    });
  };
  return { map, add, unmap };
}

const biggestFirst = (codes: UnmappedAgent[]) => [...codes].sort((a, b) => b.policies - a.policies || a.agentIdentifier.localeCompare(b.agentIdentifier));

/** The title line's buttons: Add agent code, and Map one by one (the page's job, so the primary). */
export function AgentCodesActions({ unmapped, members, carriers, readOnly }: { unmapped: UnmappedAgent[]; members: Member[]; carriers: Carrier[]; readOnly: boolean }) {
  const actions = useCodeActions();
  const [open, setOpen] = useState<null | "add" | { queue: UnmappedAgent[] }>(null);
  const paused = readOnly ? READ_ONLY_REASON : undefined;
  return (
    <>
      <Button type="button" variant="outline" disabled={readOnly} title={paused} onClick={() => setOpen("add")}>Add agent code</Button>
      {unmapped.length > 0 && <Button type="button" disabled={readOnly} title={paused} onClick={() => setOpen({ queue: biggestFirst(unmapped) })}>Map one by one</Button>}
      {open === "add" && <AddCodeDialog carriers={carriers} members={members} onAdd={actions.add} onClose={() => setOpen(null)} />}
      {open && open !== "add" && <MapCodeDialog queue={open.queue} stepping members={members} readOnly={readOnly} onMap={actions.map} onClose={() => setOpen(null)} />}
    </>
  );
}

type Row = ({ kind: "unmapped" } & UnmappedAgent) | ({ kind: "mapped" } & MappedAgent);
const rowKey = (row: Row) => (row.kind === "mapped" ? row.id : `${row.carrierId}|${row.agentIdentifier}`);

export function AgentCodes({ unmapped, mapped, members, carriers, readOnly, show }: { unmapped: UnmappedAgent[]; mapped: MappedAgent[]; members: Member[]; carriers: Carrier[]; readOnly: boolean; show: AgentCodesShow }) {
  const router = useRouter();
  const actions = useCodeActions();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<null | "add" | Row>(null);
  const q = query.trim().toLowerCase();
  const listed = useMemo<Row[]>(() => [
    ...(show === "mapped" ? [] : biggestFirst(unmapped).map((a) => ({ kind: "unmapped" as const, ...a }))),
    ...(show === "unmapped" ? [] : mapped.map((m) => ({ kind: "mapped" as const, ...m }))),
  ], [unmapped, mapped, show]);
  // The carrier filter offers the carriers this tab's codes are at.
  const carrierOptions = useMemo(() => {
    const names = new Map(listed.map((row) => [row.carrierId, row.carrierName]));
    return [{ value: "", label: "Every carrier" }, ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [listed]);
  const rows = useMemo(() => listed.filter((a) =>
    (!carrier || a.carrierId === carrier) &&
    (!q || [a.agentIdentifier, a.carrierName, a.kind === "mapped" ? a.userName : ""].some((v) => v.toLowerCase().includes(q))),
  ), [listed, carrier, q]);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(rows, page, pageSize);
  const filtered = Boolean(q || carrier);

  const search = (value: string) => { setQuery(value); setPage(1); };
  const clear = () => { setQuery(""); setCarrier(""); setPage(1); };
  // The whole row opens its dialog; its own links and buttons keep their click.
  const openRow = (row: Row) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    setOpen(row);
  };

  const toolbar = (
    <DataToolbar actions={<>
      {filtered && <ClearFiltersButton onClick={clear} />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={search} placeholder="Search agent codes" />
      {carrierOptions.length > 2 && <SelectMenu label="Carrier" className="w-full sm:w-52" searchPlaceholder="Search carriers" value={carrier} defaultValue="" options={carrierOptions} onChange={(value) => { setCarrier(value); setPage(1); }} />}
    </DataToolbar>
  );

  const policies = (row: Row) => (
    <Link href={policiesHref(row.carrierId, row.kind === "mapped" ? row.userId : null)} className="whitespace-nowrap tabular-nums text-foreground underline-offset-2 hover:underline">{policiesLabel(row.policies)}</Link>
  );
  // The row's one chip: a code nobody is mapped to.
  const person = (row: Row) => (row.kind === "mapped" ? row.userName : <StatusChip tone="warning" title="No producer gets the credit">Nobody</StatusChip>);
  const opener = (row: Row) => (
    <button type="button" className="whitespace-nowrap hover:underline" aria-label={`${row.kind === "unmapped" && !readOnly ? "Map" : "Open"} ${row.agentIdentifier}`} onClick={() => setOpen(row)}>
      {row.kind === "unmapped" && !readOnly ? "Map ›" : row.kind === "mapped" && !readOnly ? "Change ›" : "Open ›"}
    </button>
  );

  const empty = unmapped.length === 0 && mapped.length === 0;
  const footer = rows.length ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="agent codes" onPage={setPage} suffix={unmapped.length ? `${unmapped.length.toLocaleString("en-US")} to map` : "all mapped"} /> : undefined;

  return (
    <>
      <TableCard toolbar={empty ? undefined : toolbar} footer={footer}>
        {empty ? (
          <EmptyState title="No agent codes yet" hint="Each carrier's writing-agent code appears here the first time a file carries it, or add one yourself." action={!readOnly ? <Button type="button" onClick={() => setOpen("add")}>Add agent code</Button> : undefined} />
        ) : rows.length === 0 ? (
          !filtered && show === "unmapped" ? (
            <EmptyState title="Every code is mapped" hint="Each carrier code now credits a person. A new code shows up here the first time a file carries it." action={<Button asChild variant="outline"><Link href={`${AGENT_CODES_HREF}?show=mapped`}>Show Mapped</Link></Button>} />
          ) : !filtered && show === "mapped" ? (
            <EmptyState title="No code is mapped yet" hint="A code credits a person once you map it. The codes waiting for a person are on To map." action={<Button asChild variant="outline"><Link href={`${AGENT_CODES_HREF}?show=unmapped`}>Show To map</Link></Button>} />
          ) : (
            <NoMatches noun="agent codes" onClear={clear} />
          )
        ) : (
          <>
            <table className="portal-lead-table hidden w-full min-w-[820px] text-left text-sm sm:table">
              <thead><tr><th>Code</th><th>Carrier</th><th className="w-[130px] text-right">Policies</th><th>Person</th><th className="w-[110px]">Next step</th></tr></thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr key={rowKey(row)} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={openRow(row)}>
                    <td className="whitespace-nowrap font-mono font-medium text-foreground">{row.agentIdentifier}</td>
                    <td className="whitespace-nowrap">{row.carrierName}</td>
                    <td className="text-right">{policies(row)}</td>
                    <td className="whitespace-nowrap">{person(row)}</td>
                    <td>{opener(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phone (board 3·2): a code is a card; it opens the same dialog. */}
            <ul className="m-0 flex list-none flex-col gap-2 p-3 sm:hidden" aria-label="Agent codes">
              {shown.rows.map((row) => (
                <li key={rowKey(row)} className="cursor-pointer rounded-md border border-border px-3 py-2" onClick={openRow(row)}>
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" className="min-w-0 truncate text-left font-mono text-sm text-foreground" onClick={() => setOpen(row)}>{row.agentIdentifier}</button>
                    {policies(row)}
                  </div>
                  <span className="block truncate text-xs text-muted-foreground">{row.carrierName} · {row.kind === "mapped" ? row.userName : "nobody"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </TableCard>
      {open === "add" && <AddCodeDialog carriers={carriers} members={members} onAdd={actions.add} onClose={() => setOpen(null)} />}
      {open && open !== "add" && open.kind === "unmapped" && <MapCodeDialog queue={[open]} stepping={false} members={members} readOnly={readOnly} onMap={actions.map} onClose={() => setOpen(null)} />}
      {open && open !== "add" && open.kind === "mapped" && <MappedCodeDialog agent={open} members={members} readOnly={readOnly} onSave={actions.map} onUnmap={(agent) => { setOpen(null); void actions.unmap(agent); }} onClose={() => setOpen(null)} />}
    </>
  );
}
