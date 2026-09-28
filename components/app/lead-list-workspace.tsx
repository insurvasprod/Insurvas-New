"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { LeadListIndex, type LeadListIndexRow } from "@/components/app/lead-list-index";

/**
 * The lead list: inventory, not progress.
 *
 * A pipeline board answers "where has this lead got to". This answers "what did I buy, how much of
 * it arrived, and how much of it has nobody touched" — and it is the screen assignment happens from,
 * because that is the question you are answering when you hand leads out.
 */

type LeadList = LeadListIndexRow;
type Lead = {
  leadId: string; workItemId: string | null; name: string; phone: string; state: string;
  leadState: string; queueStatus: string | null; ownerUserId: string | null; ownerName: string | null;
  attemptsMade: number; createdAt: string;
};
type Member = { id: string; name: string; role: string; capacity: number; currentOpen: number };

const STATE_LABEL: Record<string, string> = {
  fresh: "Never dialled", working: "In progress", retry: "Waiting on a retry",
  nurture: "Nurture", exhausted: "Exhausted", closed: "Closed", unknown: "Unknown",
};

export function LeadListWorkspace() {
  const router = useRouter();
  const [lists, setLists] = useState<LeadList[]>([]);
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  // Read once mounted: "stalling" is measured against now, and the server and browser must agree.
  const [nowAt, setNowAt] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState<LeadList | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      Promise.all([
        fetch("/api/app/lead-lists", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })),
        fetch("/api/app/assignments", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })),
      ])
        .then(([listResult, memberResult]) => {
          if (!listResult.ok) throw new Error(listResult.body?.error ?? "Could not load the lead lists");
          setLists(listResult.body.lists ?? []);
          setLicensedStates(listResult.body.licensedStates ?? []);
          setNowAt(Date.now());
          // The assignment screen already knows who can take work and how full they are. Reading it
          // here rather than re-deriving keeps one answer to "is this person at capacity".
          setMembers(memberResult.ok ? memberResult.body?.members ?? [] : []);
          setError("");
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the lead lists"))
        .then(() => setLoading(false)),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  const openList = useCallback(async (list: LeadList, onlyUnassigned: boolean) => {
    setOpen(list); setSelected(new Set()); setLeads([]); setListLoading(true);
    const params = new URLSearchParams({ campaign_id: list.campaignId });
    if (onlyUnassigned) params.set("unassigned", "1");
    try {
      const response = await fetch(`/api/app/lead-lists?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load this list");
      setLeads(body.leads ?? []);
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "Could not load this list");
    } finally {
      setListLoading(false);
    }
  }, []);

  // `#<campaignId>` opens that list — it is how a search result lands on the list it named rather
  // than on the index. Read on load and on `hashchange`, since search sets the hash when this page
  // is already open. The hash is consumed once used, so the reload after an assignment and the
  // "All lists" button are not dragged back to it.
  useEffect(() => {
    if (!lists.length) return;
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      const list = id ? lists.find((entry) => entry.campaignId === id) : undefined;
      if (!list) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      void openList(list, unassignedOnly);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
    // `unassignedOnly` is read at the moment the hash names a list; toggling it must not reopen one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, openList]);

  async function assignSelected() {
    if (!assignee || selected.size === 0 || busy) return;
    setBusy(true);
    const ids = [...selected];
    let done = 0;
    const failures: string[] = [];
    for (const workItemId of ids) {
      try {
        const response = await fetch("/api/app/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "assign", workItemId, targetUserId: assignee, reason: `Assigned from the ${open?.campaignName ?? "lead"} list` }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) failures.push(body?.error ?? "refused");
        // A sticky lead answers 200 and does not move — its owner is mid-conversation. Counting it
        // as assigned would overstate the result by exactly the leads somebody is talking to.
        else if (body?.sticky) failures.push("mid-conversation, left with its owner");
        else done += 1;
      } catch { failures.push("network"); }
    }
    setBusy(false);
    // Reported per lead, not as one verdict. The server skips a candidate who is at capacity or
    // cannot write the lead's state, so a partial result is the expected outcome rather than a bug,
    // and saying "12 assigned" when 3 were refused is the kind of lie this audit keeps removing.
    if (done) notify.arrive(`${done} of ${ids.length} assigned`);
    if (failures.length) notify.warn(`${failures.length} could not be assigned — ${failures[0]}`);
    if (open) await openList(open, unassignedOnly);
    await load();
  }

  const selectable = useMemo(() => leads.filter((lead) => lead.workItemId), [leads]);


  if (loading) return <TableCard><SectionLoading rows={6} columns={5} label="Loading lead lists" /></TableCard>;
  if (error)
    return <TableCard><ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => { setLoading(true); void load(); }}>Try again</Button>} /></TableCard>;

  if (open) {
    const chosen = members.find((member) => member.id === assignee);
    const atCapacity = chosen ? chosen.capacity > 0 && chosen.currentOpen >= chosen.capacity : false;
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => { setOpen(null); setSelected(new Set()); }} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />All lists
        </button>

        {atCapacity && (
          // Said before the attempt, not after. The server skips a full member anyway; being
          // told by a toast after selecting four hundred leads is a worse way to learn it.
          <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">{chosen?.name} is at capacity — the server will skip them. Choose somebody else or free some of their open leads.</p>
        )}

        <TableCard
          title={open.campaignName}
          description={`${open.vendorName} · ${open.leadsReceived.toLocaleString()} of ${open.recordsPurchased.toLocaleString()} records arrived · ${open.untouched.toLocaleString()} never dialled and unassigned`}
          toolbar={
            <DataToolbar
              actions={
                <>
                  <Button type="button" disabled={!assignee || selected.size === 0 || busy} onClick={() => void assignSelected()}>
                    <Users aria-hidden="true" />{busy ? "Assigning…" : `Assign ${selected.size || ""}`.trim()}
                  </Button>
                  <RefreshButton onClick={() => void openList(open, unassignedOnly)} refreshing={listLoading} />
                </>
              }
            >
              <select aria-label="Assign to" className={toolbarControl} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Assign to…</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.currentOpen}{member.capacity > 0 ? ` of ${member.capacity}` : ""} open</option>)}
              </select>
              <label className="inline-flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={unassignedOnly} onChange={(event) => { setUnassignedOnly(event.target.checked); void openList(open, event.target.checked); }} />
                Unassigned only
              </label>
            </DataToolbar>
          }
        >
          {listLoading ? (
            <SectionLoading rows={6} columns={5} label="Loading leads" />
          ) : (
            <>
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3 font-medium">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label="Select every lead that can be assigned"
                        checked={selectable.length > 0 && selected.size === selectable.length}
                        onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map((lead) => lead.workItemId as string)) : new Set())}
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Lead</th><th className="px-4 py-3 font-medium">State</th><th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Attempts</th><th className="px-4 py-3 font-medium">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => (
                    <tr key={lead.leadId} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          aria-label={`Select ${lead.name}`}
                          disabled={!lead.workItemId}
                          checked={Boolean(lead.workItemId && selected.has(lead.workItemId))}
                          onChange={(event) => setSelected((current) => {
                            const next = new Set(current);
                            if (!lead.workItemId) return next;
                            if (event.target.checked) next.add(lead.workItemId); else next.delete(lead.workItemId);
                            return next;
                          })}
                        />
                      </td>
                      <td className="px-4 py-3"><span className="font-semibold">{lead.name}</span><span className="block text-xs text-muted-foreground">{lead.phone || "No phone"}{lead.state ? ` · ${lead.state}` : ""}</span></td>
                      <td className="px-4 py-3">{STATE_LABEL[lead.leadState] ?? lead.leadState}</td>
                      <td className="px-4 py-3">{lead.queueStatus ?? <span className="text-muted-foreground">Not queued</span>}</td>
                      <td className="px-4 py-3 tabular-nums">{lead.attemptsMade}</td>
                      <td className="px-4 py-3">{lead.ownerName ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length === 0 && (
                // Three different nothings, and they need three different sentences. "Every lead is
                // assigned" is a claim about leads that exist; saying it about a list that received
                // none is asserting something nothing measured, which is the empty state this audit
                // has spent a week removing elsewhere.
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {open.leadsReceived === 0
                    ? "No leads have arrived against this list yet, so there is nothing to hand out."
                    : unassignedOnly
                      ? "Every lead in this list is already assigned."
                      : "No leads match this filter."}
                </p>
              )}
            </>
          )}
        </TableCard>
      </div>
    );
  }

  // A row opens the list itself (/app/lead-lists/[campaignId]); its drawer's "Pick leads one by one"
  // (and "See the N unassigned" for everyone else) comes back here through the hash, which is what
  // opens the per-lead assignment view above.
  return <LeadListIndex lists={lists} licensedStates={licensedStates} nowAt={nowAt} onOpen={(list) => router.push(`/app/lead-lists/${list.campaignId}`)} onRefresh={() => void load()} />;
}
