"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { LeadListIndex, type LeadListIndexRow, type LeadListPanelIntent, type LeadListPanelTab } from "@/components/app/lead-list-index";
import { LeadListPanel, PANEL_TABS } from "@/components/app/lead-list-panel";
import type { AssignDrawerMember } from "@/components/app/lead-list-assign-drawer";
import { LeadListAutoAssign, type AutoAssignMember } from "@/components/app/lead-list-auto-assign";
import { useSolo } from "@/components/app/solo-context";

/**
 * The lead list: inventory, not progress.
 *
 * A pipeline board answers "where has this lead got to". This answers "what did I buy, how much of
 * it arrived, and how much of it has nobody touched" — and it is the screen assignment happens from,
 * because that is the question you are answering when you hand leads out.
 *
 * Owner 2026-10-29: a list opens in a wide side panel on this page (lead-list-panel.tsx) rather than
 * on its own page, and every row action happens in it. The open panel is in the address
 * (`?list=<campaignId>&tab=<tab>`, replaced, not pushed) so a refresh or a shared link reopens it;
 * `#<campaignId>` (global search, the list page's "See the N unassigned") opens its Leads tab.
 */

type LeadList = LeadListIndexRow;
type Lead = {
  leadId: string; workItemId: string | null; name: string; phone: string; state: string;
  leadState: string; queueStatus: string | null; ownerUserId: string | null; ownerName: string | null;
  attemptsMade: number; createdAt: string;
};
type Member = AssignDrawerMember & Pick<AutoAssignMember, "eligibleStates">;
type OpenPanel = { campaignId: string; tab: LeadListPanelTab; intent: LeadListPanelIntent; at: number };

const STATE_LABEL: Record<string, string> = {
  fresh: "Never dialled", working: "In progress", retry: "Waiting on a retry",
  nurture: "Nurture", exhausted: "Exhausted", closed: "Closed", unknown: "Unknown",
};

const isTab = (value: string | null): value is LeadListPanelTab => PANEL_TABS.includes(value as LeadListPanelTab);

/** Writes the open panel into the address without a navigation, keeping every other parameter. */
function writeAddress(panel: { campaignId: string; tab: LeadListPanelTab } | null) {
  const url = new URL(window.location.href);
  if (panel) { url.searchParams.set("list", panel.campaignId); url.searchParams.set("tab", panel.tab); }
  else { url.searchParams.delete("list"); url.searchParams.delete("tab"); }
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

export function LeadListWorkspace({ canClaim = false, scrubHref = null, canDelete = false, cleanHref = null, canAutoAssign = false }: {
  /** May this person draft a vendor claim? Drives the row's Claim button (the claim is in the list's panel). */
  canClaim?: boolean;
  /** Non-null when this person may run the scrub's step (the Source step); the scrub runs in the panel. */
  scrubHref?: string | null;
  /** May this person delete an empty list's campaign (2026-10-29 clean-up)? */
  canDelete?: boolean;
  /** The Clean step, when this person may open it: where a list's blocking problems are fixed. */
  cleanHref?: string | null;
  /** May this person route a whole list (owner / producer, not read-only, not a narrowed agency session)? */
  canAutoAssign?: boolean;
} = {}) {
  // Solo mode (owner 2026-10-29): an agent working alone has nobody to hand leads to, so there is no
  // roster to read, no Auto-assign and no assigning in the panel; the dialer serves the pool to them.
  const solo = useSolo();
  const [lists, setLists] = useState<LeadList[]>([]);
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  // Whether this person may see what the lists cost (the route strips it for an assistant).
  const [spend, setSpend] = useState(true);
  // Read once mounted: "stalling" is measured against now, and the server and browser must agree.
  const [nowAt, setNowAt] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  // Whether the roster read answered: the assign drawer reads it again only when it did not.
  const [membersRead, setMembersRead] = useState(false);
  const [panel, setPanel] = useState<OpenPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      Promise.all([
        fetch("/api/app/lead-lists", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })),
        solo
          ? Promise.resolve({ ok: false, body: null })
          : fetch("/api/app/assignments", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })),
      ])
        .then(([listResult, memberResult]) => {
          if (!listResult.ok) throw new Error(listResult.body?.error ?? "Could not load the lead lists");
          setLists(listResult.body.lists ?? []);
          setLicensedStates(listResult.body.licensedStates ?? []);
          setSpend(listResult.body.spend !== false);
          setNowAt(Date.now());
          // The assignment screen already knows who can take work and how full they are. Reading it
          // here rather than re-deriving keeps one answer to "is this person at capacity".
          setMembers(memberResult.ok ? memberResult.body?.members ?? [] : []);
          setMembersRead(memberResult.ok);
          setError("");
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the lead lists"))
        .then(() => setLoading(false)),
    [solo],
  );

  useEffect(() => { void load(); }, [load]);

  const openPanel = useCallback((campaignId: string, tab: LeadListPanelTab = "overview", intent: LeadListPanelIntent = null) => {
    setPanel((current) => ({ campaignId, tab, intent, at: (current?.at ?? 0) + 1 }));
    writeAddress({ campaignId, tab });
  }, []);
  const closePanel = useCallback(() => { setPanel(null); writeAddress(null); }, []);
  const changeTab = (tab: LeadListPanelTab) => {
    if (!panel) return;
    setPanel({ ...panel, tab, intent: null });
    writeAddress({ campaignId: panel.campaignId, tab });
  };

  // The address reopens a panel: `?list=&tab=` (a refresh, a shared link) and `#<campaignId>` (search
  // and the list page's per-lead link land on its Leads tab). The hash is consumed once used, so the
  // reload after an assignment does not drag the panel back open.
  useEffect(() => {
    if (!lists.length) return;
    const fromAddress = () => {
      const hash = window.location.hash.slice(1);
      if (hash && lists.some((entry) => entry.campaignId === hash)) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        openPanel(hash, "leads");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const id = params.get("list");
      const tab = params.get("tab");
      if (id && lists.some((entry) => entry.campaignId === id)) setPanel((current) => current ?? { campaignId: id, tab: isTab(tab) ? tab : "overview", intent: null, at: 1 });
    };
    fromAddress();
    window.addEventListener("hashchange", fromAddress);
    return () => window.removeEventListener("hashchange", fromAddress);
  }, [lists, openPanel]);

  if (loading) return <TableCard><SectionLoading rows={6} columns={5} label="Loading lead lists" /></TableCard>;
  if (error)
    return <TableCard><ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => { setLoading(true); void load(); }}>Try again</Button>} /></TableCard>;

  const openList = panel ? lists.find((entry) => entry.campaignId === panel.campaignId) ?? null : null;

  return (
    <>
      <LeadListIndex
        lists={lists}
        licensedStates={licensedStates}
        nowAt={nowAt}
        onOpen={(list, tab, intent) => openPanel(list.campaignId, tab, intent)}
        onRefresh={() => load()}
        canClaim={canClaim}
        canDelete={canDelete}
        spend={spend}
        cleanHref={cleanHref}
        autoAssign={canAutoAssign && !solo && lists.length > 0 ? <LeadListAutoAssign lists={lists} members={membersRead ? members : null} onDone={() => load()} /> : undefined}
      />
      {panel && openList && (
        <LeadListPanel
          // A new open (another row, or the same row's action) starts the panel afresh.
          key={`${panel.campaignId}:${panel.at}`}
          list={openList}
          nowAt={nowAt}
          tab={panel.tab}
          intent={panel.intent}
          onTab={changeTab}
          onClose={closePanel}
          onChanged={() => load()}
          canScrub={scrubHref !== null}
          members={membersRead ? members : null}
          leads={(reloadPanel) => <LeadListLeads open={openList} members={members} onAssigned={async () => { await Promise.all([load(), reloadPanel()]); }} />}
        />
      )}
    </>
  );
}

/**
 * The leads of one list, picked one by one and handed out: the Leads tab of the list's panel. Every
 * lead it shows is read for this list only (`/api/app/lead-lists?campaign_id=`).
 */
function LeadListLeads({ open, members, onAssigned }: { open: LeadList; members: Member[]; onAssigned: () => Promise<void> }) {
  // Solo mode: the list's leads to look at, with no picking, no "Assign to" and no owner column.
  const solo = useSolo();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(!solo);
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [leadPage, setLeadPage] = useState(1);
  const leadPageSize = 25;

  const openList = useCallback(async (list: LeadList, onlyUnassigned: boolean) => {
    setSelected(new Set()); setLeadPage(1); setListLoading(true);
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

  // Read once for the list this tab opened on; toggling "which leads" reads again.
  useEffect(() => { void openList(open, !solo); }, [open.campaignId]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

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
          body: JSON.stringify({ action: "assign", workItemId, targetUserId: assignee, reason: `Assigned from the ${open.campaignName} list` }),
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
    await openList(open, unassignedOnly);
    await onAssigned();
  }

  const selectable = useMemo(() => leads.filter((lead) => lead.workItemId), [leads]);
  const chosen = members.find((member) => member.id === assignee);
  const atCapacity = chosen ? chosen.capacity > 0 && chosen.currentOpen >= chosen.capacity : false;
  const { current: leadPageNow, rows: leadRows } = paginate(leads, leadPage, leadPageSize);
  const showUnassigned = (only: boolean) => { if (only === unassignedOnly) return; setUnassignedOnly(only); void openList(open, only); };

  return (
    <div className="flex flex-col gap-4">
      {atCapacity && (
        // Said before the attempt, not after. The server skips a full member anyway; being
        // told by a toast after selecting four hundred leads is a worse way to learn it.
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">Choose someone else — {chosen?.name} is at capacity.</p>
      )}

      <TableCard
        title={solo ? "Leads in this list" : "Pick leads one by one"}
        description={`${open.recordsPurchased > 0 ? `${open.leadsReceived.toLocaleString()} of ${open.recordsPurchased.toLocaleString()} records arrived` : `${open.leadsReceived.toLocaleString()} ${open.leadsReceived === 1 ? "lead" : "leads"}`} · ${open.untouched.toLocaleString()} never dialled${solo ? "" : " and unassigned"}`}
        toolbar={
          <DataToolbar
            actions={
              <>
                {!solo && (
                  <Button type="button" disabled={!assignee || selected.size === 0 || busy} onClick={() => void assignSelected()}>
                    <Users aria-hidden="true" />{busy ? "Assigning…" : `Assign ${selected.size || ""}`.trim()}
                  </Button>
                )}
                <RefreshButton onClick={() => void openList(open, unassignedOnly)} refreshing={listLoading} />
              </>
            }
          >
            {!solo && (
              <select aria-label="Assign to" className={toolbarControl} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Assign to…</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.currentOpen}{member.capacity > 0 ? ` of ${member.capacity}` : ""} open</option>)}
              </select>
            )}
            {/* Which leads to show, as segmented chips. Unassigned is what a person picking leads to
                hand out asked for, not a filter left on. */}
            {!solo && (
              <span role="radiogroup" aria-label="Which leads" className="inline-flex gap-1.5">
                {([[true, "Unassigned only"], [false, "All leads"]] as const).map(([only, text]) => (
                  <ToggleChip key={text} role="radio" selected={unassignedOnly === only} onClick={() => showUnassigned(only)}>{text}</ToggleChip>
                ))}
              </span>
            )}
          </DataToolbar>
        }
        footer={!listLoading && leads.length > 0 ? <Pager page={leadPageNow} total={leads.length} noun="leads" pageSize={leadPageSize} onPage={setLeadPage} suffix={!solo && selected.size ? `${selected.size.toLocaleString()} selected` : undefined} /> : undefined}
      >
        {listLoading ? (
          <SectionLoading rows={6} columns={5} label="Loading leads" />
        ) : (
          <>
            <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  {!solo && <th className="w-10">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      aria-label="Select every lead that can be assigned"
                      checked={selectable.length > 0 && selected.size === selectable.length}
                      onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map((lead) => lead.workItemId as string)) : new Set())}
                    />
                  </th>}
                  <th>Lead</th><th className="w-[150px]">Phone</th><th className="w-[70px]">State</th><th className="w-[160px]">Status</th>
                  <th className="w-[140px]">Queue</th><th className="w-[90px] text-right">Attempts</th>{!solo && <th className="w-[170px]">Owner</th>}
                </tr>
              </thead>
              <tbody className="m-seq">
                {leadRows.map((lead) => (
                  <tr key={lead.leadId} className="m-row">
                    {!solo && <td>
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
                    </td>}
                    <td className="max-w-[260px] truncate font-semibold" title={lead.name}>{lead.name}</td>
                    <td className="whitespace-nowrap tabular-nums">{lead.phone || <span className="text-muted-foreground">No phone</span>}</td>
                    <td>{lead.state || <span className="text-muted-foreground">—</span>}</td>
                    <td>{STATE_LABEL[lead.leadState] ?? lead.leadState}</td>
                    <td>{lead.queueStatus ?? <span className="text-muted-foreground">Not queued</span>}</td>
                    <td className="text-right tabular-nums">{lead.attemptsMade}</td>
                    {!solo && <td className="max-w-[170px] truncate" title={lead.ownerName ?? undefined}>{lead.ownerName ?? <span className="text-muted-foreground">Unassigned</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {leads.length === 0 && (
              // Three different nothings, and they need three different sentences. "Every lead is
              // assigned" is a claim about leads that exist; saying it about a list that received
              // none is asserting something nothing measured, which is the empty state this audit
              // has spent a week removing elsewhere.
              open.leadsReceived === 0 ? (
                <EmptyState
                  title="No leads have arrived against this list yet"
                  hint={solo ? "Import a file against it to start calling." : "Import a file against it to hand leads out."}
                  action={<Button asChild type="button" variant="outline"><Link href="/app/import">Import a list</Link></Button>}
                />
              ) : unassignedOnly ? (
                <EmptyState
                  title="Every lead in this list is already assigned"
                  hint="See who has them under All leads."
                  action={<Button type="button" variant="outline" onClick={() => showUnassigned(false)}>Show all leads</Button>}
                />
              ) : (
                <EmptyState title="No leads match this filter" hint="Switch back to unassigned only." />
              )
            )}
          </>
        )}
      </TableCard>
    </div>
  );
}
