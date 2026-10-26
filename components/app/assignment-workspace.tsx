"use client";

/**
 * /app/assignments and the agency's /app/lead-routing — one page, "Lead routing" (redesign 2026-10-26,
 * owner pick B "Team first", canvas M2 · Assignment). The two routes were the same workspace under two
 * names; the agency's unassigned pool is a tab here now.
 *
 * Rules tab: a card per person (room left, rest day, passed over, licence lapsing), the rule chain read
 * as sentences, and the next pool leads as a strip. Team and Settings tabs keep the capacity table and
 * the household rules. Reassigning opens a panel that finds the lead by name or phone.
 *
 * Every figure on it is read, not drawn: the licence chips and the Licensed column come from the
 * eligibility gate itself (assignment_insights → assignment_candidate_is_eligible), "N routed" from
 * lead_assignment_events.rule_id, "skipped X N×" from assignment_skip_events, and the preview from
 * the real router run inside a rolled-back savepoint. Before migration 20260924300000 the page
 * shows what it can and says what it cannot.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { Field, KeyValues, LockIcon, PlusIcon, SettingsCard, SettingsMeter, control, st, pillTone } from "@/components/app/settings/primitives";
import { MATCH_LABEL, MATCH_OPERATOR, SCHEMA_PENDING_MESSAGE, WEEKDAYS, WEEKDAY_NAMES, daysUntil, lapseDay, nobodySentence, shortDate, shortName, stateName, type AssignmentMember, type LicenceExpiry } from "@/lib/assignment/constants";
import { cn } from "@/lib/utils";
import { draftFromRule, pinFallbacks, roleLabel, serialise, titleCase, type RuleDraft } from "@/components/app/assignment/model";
import { PreviewWhy, RuleEditor } from "@/components/app/assignment/rule-editor";
import { useAssignmentWorkspace } from "@/components/app/assignment/use-assignment-workspace";
import { ViewTabs, fullHeightCard } from "@/components/app/lead-ops-view-tabs";
import { NextStepLine } from "@/components/app/next-step-line";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";

type Tab = "rules" | "capacity" | "pool" | "settings";
const STRATEGY_PHRASE = { round_robin: "in turn", least_loaded: "fewest open first", best_placement: "best recent placement first" } as const;

export function AssignmentWorkspace({ canManage, pool = false }: { canManage: boolean; /** The agency's unassigned pool, as a tab (owner and admins). */ pool?: boolean }) {
  const { workspace, loading, busy, preview, drafts, setDrafts, openKey, setOpenKey, dragKey, setDragKey, publishError, moveNotice, campaignFilter, setCampaignFilter, editingMember, setEditingMember, memberForm, setMemberForm, memberError, setMemberError, editingRest, setEditingRest, restForm, setRestForm, restError, restCardRef, restInputRef, workItemId, setWorkItemId, returnReason, setReturnReason, reassignWorkItemId, setReassignWorkItemId, reassignTargetUserId, setReassignTargetUserId, reassignReason, setReassignReason, adopt, loadPreview, refresh, members, memberById, publishedOrder, dirty, problems, sinceLabel, post, publish, saveMember, saveRest, saveAutoRoute, openRestEditor, updateDraft, moveDraft, dropOn, handleKeys, addCondition, restore, atCeiling, routedFor, topCapacitySkip, ruleSkipLine, personSkipLine, warnable, ceilingChip, valueChip, assigneeSummary } = useAssignmentWorkspace(canManage);

  const [tab, setTab] = useState<Tab>("rules");
  const [reassignOpen, setReassignOpen] = useState(false);
  const stripRef = useRef<HTMLElement>(null);

  const header = (
    <PageHeader
      title="Lead routing"
      actions={workspace ? (
        <>
          <Button type="button" variant="outline" onClick={() => setReassignOpen(true)}>{canManage ? "Reassign a lead" : "Return a lead"}</Button>
          <Button data-guide="assignments-assign" type="button" disabled={busy === "action"} onClick={() => void post({ action: "assign" }, "Next eligible lead assigned")}>Assign next lead</Button>
        </>
      ) : undefined}
    />
  );

  if (loading) return <PageLoading />;
  if (!workspace) return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">{header}<TableCard><ErrorState detail="The assignment workspace could not be loaded." action={<Button type="button" variant="outline" onClick={() => { void refresh(false).catch(() => undefined); }}>Try again</Button>} /></TableCard></div>;

  const inactiveRules = workspace.rules.filter((rule) => !drafts.some((draft) => draft.id === rule.id));
  const publishedActive = workspace.rules.filter((rule) => rule.is_active).map(draftFromRule);
  const fallbackMoved = serialise(pinFallbacks(publishedActive)) !== serialise(publishedActive);
  const realtimeRules = workspace.rules.filter((rule) => rule.is_active && rule.match_type === "realtime").length;
  const previewRows = preview.rows ?? [];
  const routedCount = previewRows.filter((row) => row.outcome === "routed").length;
  const firstNobody = previewRows.find((row) => row.outcome === "nobody") ?? null;
  const nobodyCount = previewRows.filter((row) => row.outcome === "nobody").length;
  const setters = members.filter((member) => member.role === "setter");
  const filteredCampaigns = workspace.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(campaignFilter.trim().toLowerCase()));

  /** Open a person's row on the Team tab for editing. */
  function editMember(member: AssignmentMember) {
    setTab("capacity");
    setEditingMember(member.id);
    setMemberError(null);
    setMemberForm({ capacity: String(member.capacity), languages: member.languages.join(", "), weekdayOff: member.weekdayOff === null ? "" : String(member.weekdayOff) });
  }

  // The one thing to do next: a lead the rules can't place, then unpublished changes, then someone full.
  let nextStep: { text: ReactNode; action: ReactNode } | null = null;
  if (canManage && firstNobody) {
    nextStep = {
      text: <><strong className="font-semibold text-[var(--ink)]">{nobodyCount === 1 ? "One of the next pool leads goes to nobody" : `${nobodyCount} of the next ${previewRows.length} pool leads go to nobody`}</strong> — {firstNobody.name}, {firstNobody.state ? stateName(firstNobody.state) : "no state"}: {firstNobody.licence_reason ?? nobodySentence(firstNobody.detail)}{firstNobody.detail?.requires_licensed && setters.length > 0 ? " It needs a licensed agent, so no setter can take it either." : ""}</>,
      action: <Button type="button" size="sm" variant="outline" onClick={() => { setTab("rules"); requestAnimationFrame(() => stripRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>See {nobodyCount === 1 ? "it" : "them"}</Button>,
    };
  } else if (canManage && dirty) {
    nextStep = {
      text: <><strong className="font-semibold text-[var(--ink)]">Your rule changes aren&rsquo;t live yet.</strong> Publish them and they apply from the next assignment.</>,
      action: <Button type="button" size="sm" disabled={busy === "publish" || problems.some(Boolean)} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish rules"}</Button>,
    };
  } else if (canManage && atCeiling.length) {
    const names = atCeiling.slice(0, 2).map((member) => shortName(member.name)).join(" and ") + (atCeiling.length > 2 ? ` +${atCeiling.length - 2}` : "");
    nextStep = {
      text: <><strong className="font-semibold text-[var(--ink)]">{names} {atCeiling.length === 1 ? "is" : "are"} at the ceiling</strong> — skipped until a lead closes or you raise the capacity.</>,
      action: <Button type="button" size="sm" variant="outline" onClick={() => setTab("capacity")}>Open Team</Button>,
    };
  }

  const insightsLine = workspace.insights
    ? [`${workspace.insights.autoRouted.toLocaleString()} routed on arrival since ${sinceLabel}`, (workspace.insights.unlicensedLeads ?? 0) > 0 ? `${(workspace.insights.unlicensedLeads ?? 0).toLocaleString()} pool leads match no licensed agent` : null].filter(Boolean).join(" · ")
    : undefined;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      {nextStep && <NextStepLine action={nextStep.action}>{nextStep.text}</NextStepLine>}

      {!workspace.boardSchema && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          Real-time rules, language pairing, rest days, rotation, routed counts and the preview need migration 20260924300000.
        </p>
      )}

      <ViewTabs
        label="Lead routing views"
        controls="assignment-panel"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "rules", label: "Rules", count: drafts.length },
          { key: "capacity", label: "Team", count: members.length },
          ...(pool ? [{ key: "pool" as const, label: "Unassigned pool" }] : []),
          { key: "settings", label: "Settings" },
        ]}
      />

      <div key={tab} role="tabpanel" id="assignment-panel" aria-labelledby={`assignment-panel-tab-${tab}`} className="flex min-w-0 flex-col gap-6">
      {tab === "rules" && (
        <>
          {/* Who can take more: one card a person. */}
          {members.length > 0 ? (
            <ul aria-label="Your team's room" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {members.map((member) => <PersonCard key={member.id} member={member} canManage={canManage} onEdit={() => editMember(member)} skipLine={personSkipLine(member.id)} warnings={warnable(member)} />)}
            </ul>
          ) : (
            <TableCard><EmptyState title="Nobody can take leads yet" hint="Agents and setters appear here once they join." /></TableCard>
          )}

          <TableCard
            title="The rules, in plain words"
            description={insightsLine ? `First match wins · ${insightsLine}` : "First match wins"}
            action={canManage ? (
              <span className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={addCondition}><PlusIcon />Add a rule</Button>
                {dirty && <Button type="button" variant="ghost" disabled={busy === "publish"} onClick={() => { adopt(workspace); setOpenKey(null); }}>Discard</Button>}
                <Button type="button" disabled={!dirty || busy === "publish" || problems.some(Boolean)} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish rules"}</Button>
              </span>
            ) : undefined}
          >
            <p className="sr-only" aria-live="polite">{moveNotice}</p>
            <ol className="m-0 list-none border-t border-[var(--border)] p-0">
              {/* Capacity: pinned, checked under every rule, never removable. */}
              <li className="m-row flex items-center gap-3 px-4 py-3" title="Checked under every rule">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]" role="img" aria-label="Always enforced; cannot be removed"><LockIcon /></span>
                <span className="min-w-0 flex-1 text-sm text-[var(--body)]">Nobody is given more than their ceiling <StatusChip dot={false}>{ceilingChip}</StatusChip></span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {topCapacitySkip ? <>skipped {shortName(memberById.get(topCapacitySkip.user_id)?.name ?? "someone")} {topCapacitySkip.leads}&times; this week</> : workspace.insights ? "always enforced" : ""}
                </span>
              </li>
              {drafts.map((draft, index) => {
                const open = openKey === draft.key;
                const routed = routedFor(draft.id);
                const problem = problems[index];
                const pinned = draft.matchType === "fallback";
                const skipLine = ruleSkipLine(draft.id);
                return (
                  <li
                    key={draft.key}
                    className={cn("border-t border-[var(--border)]", dragKey === draft.key && "opacity-60")}
                    draggable={canManage && !open && !pinned}
                    onDragStart={() => setDragKey(draft.key)}
                    onDragOver={(event) => { if (dragKey) event.preventDefault(); }}
                    onDrop={() => dropOn(draft.key)}
                    onDragEnd={() => setDragKey(null)}
                  >
                    <div className={cn("m-row flex items-center gap-3 px-4 py-3", open && "bg-[var(--primary-soft)]")}>
                      {pinned ? (
                        // Pinned last: a fallback matches every lead, so nothing after it would be reached.
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold" role="img" aria-label={`Rule ${index + 1}, the fallback, always runs last`} title="The fallback always runs last">{index + 1}</span>
                      ) : canManage ? (
                        <button
                          id={`rule-handle-${draft.key}`}
                          type="button"
                          className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                          aria-label={`Rule ${index + 1}. Drag, or press the up and down arrow keys, to reorder`}
                          title="Drag to reorder"
                          // Pressing the handle takes focus, so the arrow keys reorder straight after a
                          // click as well as after Tab. The drag itself belongs to the row.
                          onPointerDown={(event) => event.currentTarget.focus()}
                          onKeyDown={(event) => handleKeys(event, draft.key)}
                        >{index + 1}</button>
                      ) : <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold">{index + 1}</span>}
                      <span className="min-w-0 flex-1 text-sm leading-[1.5] text-[var(--body)]">
                        <RuleSentence draft={draft} value={valueChip(draft)} who={assigneeSummary(draft.assigneeIds)} />
                        {problem && <StatusChip dot={false} tone={pillTone("warning")} className="ml-2">needs a fix</StatusChip>}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]" title={workspace.insights ? `Since ${sinceLabel}, 00:00 UTC` : undefined}>
                        {!draft.id ? "not published" : routed === null ? "" : `${routed.toLocaleString()} this week`}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                        onClick={() => setOpenKey(open ? null : draft.key)}
                        aria-expanded={open}
                        aria-controls={`rule-editor-${draft.key}`}
                      >{open ? "Close" : canManage ? "Edit" : "View"}</button>
                      {canManage ? (
                        <button type="button" className="border-0 bg-transparent px-1 text-base leading-none text-[var(--muted)] hover:text-[var(--error-ink)]" aria-label={`Remove rule ${index + 1}`} onClick={() => { setDrafts((current) => current.filter((item) => item.key !== draft.key)); if (open) setOpenKey(null); }}>&times;</button>
                      ) : null}
                    </div>
                    {skipLine && (
                      <p className="m-0 -mt-1.5 pr-4 pb-2.5 pl-[52px] text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]" title={`Since ${sinceLabel}, 00:00 UTC. "→" is where the leads it passed over were routed in the end.`}>This week: {skipLine}</p>
                    )}
                    {open && (
                      <RuleEditor
                        draft={draft}
                        index={index}
                        total={drafts.filter((item) => item.matchType !== "fallback").length}
                        members={members}
                        campaigns={filteredCampaigns}
                        allCampaigns={workspace.campaigns}
                        routerSchema={workspace.routerSchema}
                        campaignCount={workspace.campaigns.length}
                        campaignFilter={campaignFilter}
                        onCampaignFilter={setCampaignFilter}
                        problem={problem}
                        canManage={canManage}
                        boardSchema={workspace.boardSchema}
                        onChange={(next) => updateDraft(draft.key, next)}
                        onMove={(delta) => moveDraft(draft.key, delta)}
                        onClose={() => setOpenKey(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
            {!drafts.length && (
              <div className="border-t border-[var(--border)]">
                <EmptyState
                  title="No rules yet"
                  hint="Leads go round-robin to agents licensed for them, with room."
                  action={canManage ? <Button type="button" variant="outline" onClick={addCondition}><PlusIcon />Add a rule</Button> : undefined}
                />
              </div>
            )}
            {inactiveRules.length > 0 && (
              <details className="border-t border-[var(--border)] px-4 py-3 text-sm">
                <summary className="cursor-pointer text-[var(--muted)]">{inactiveRules.length} inactive rule{inactiveRules.length === 1 ? "" : "s"}</summary>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {inactiveRules.map((rule) => (
                    <li key={rule.id} className="flex items-center justify-between gap-3">
                      <span><strong className="font-semibold text-[var(--ink)]">{MATCH_LABEL[rule.match_type] ?? rule.match_type}</strong> <span className="text-[var(--muted)]">{MATCH_OPERATOR[rule.match_type] ?? ""}</span> {valueChip(draftFromRule(rule))}</span>
                      {canManage && <Button type="button" variant="outline" size="sm" onClick={() => restore(rule)}>Restore</Button>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {fallbackMoved && canManage && (
              <p className="m-0 flex items-center gap-0.5 border-t border-[var(--border)] px-4 py-2.5 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
                Publish to move the fallback rule last.
                <InfoTip label="About the fallback rule">The published fallback sits above other rules, so they only see the leads it cannot place. It is shown last here.</InfoTip>
              </p>
            )}
            {publishError && <p role="alert" className="border-t border-[var(--border)] px-4 py-2.5 text-xs leading-[1.5] text-[var(--error-ink)]">{publishError}</p>}
          </TableCard>

          {/* Where the next pool leads would go: the real router, rolled back. */}
          <section ref={stripRef} aria-label="Next up from the pool" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-base font-semibold tracking-[-0.015em] text-[var(--ink)]">Next up from the pool</h2>
              <span className="flex items-center gap-2">
                {previewRows.length > 0 && <StatusChip tone={pillTone(routedCount === previewRows.length ? "success" : "warning")} dot>{routedCount} of {previewRows.length} routed</StatusChip>}
                {canManage && <RefreshButton onClick={() => void loadPreview()} refreshing={preview.loading} />}
              </span>
            </div>
            {!canManage ? (
              <p className="m-0 text-sm text-[var(--muted)]">Owners and producers can preview where the next leads in the pool would go.</p>
            ) : preview.loading && !preview.rows ? (
              <SectionLoading rows={2} columns={5} label="Loading the routing preview" />
            ) : preview.error ? (
              <p className="m-0 text-sm text-[var(--error-ink)]" role="alert">{preview.error}</p>
            ) : preview.pending ? (
              <p className="m-0 text-sm text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>
            ) : !previewRows.length ? (
              <EmptyState title="Nothing waiting in the pool" hint="Import a list to fill it." action={<Button asChild type="button" variant="outline"><Link href="/app/import">Import a list</Link></Button>} />
            ) : (
              <ol className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-5">
                {previewRows.map((row) => {
                  const owner = row.owner_user_id ? memberById.get(row.owner_user_id) : undefined;
                  const placed = row.outcome === "routed" || row.outcome === "taken";
                  return (
                    <li key={row.work_item_id} className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2.5", placed ? "border-[var(--border)] bg-[var(--surface-alt)]/30" : "border-[var(--error)]/40 bg-[var(--error-surface)]")}>
                      <strong className="truncate text-sm font-semibold text-[var(--ink)]">{row.name}{row.state ? ` · ${row.state}` : ""}</strong>
                      <span className={cn("text-xs", placed ? "text-[var(--body)]" : "text-[var(--error-ink)]")}>→ {placed ? (owner ? shortName(owner.name) : "Someone") : "Nobody"}</span>
                      <span><PreviewWhy row={row} ruleNumber={row.rule_id ? publishedOrder.get(row.rule_id) ?? null : null} memberName={(id) => shortName(memberById.get(id)?.name ?? "someone")} /></span>
                    </li>
                  );
                })}
              </ol>
            )}
            {canManage && dirty && previewRows.length > 0 && <p className="m-0 text-xs text-[var(--muted)]">The preview uses the published rules, not your unpublished changes.</p>}
          </section>
        </>
      )}

      {tab === "capacity" && (
          <PagedTableCard
            total={members.length}
            noun="agents"
            className={fullHeightCard(340)}
            action={atCeiling.length ? <StatusChip tone="danger" dot>{atCeiling.length} agent{atCeiling.length === 1 ? "" : "s"} at the ceiling</StatusChip> : <StatusChip tone="good" dot>Nobody at the ceiling</StatusChip>}
          >
            <table className={cn(st.table, "border-t border-[var(--border)]")}>
              <thead>
                <tr className={st.headRow}>
                  <th className={st.th}>Agent</th>
                  <th className={cn(st.th, "w-[100px]")}>Role</th>
                  <th className={cn(st.th, "w-[80px]")}>Licensed</th>
                  <th className={cn(st.th, "w-[64px]")}>Open</th>
                  <th className={cn(st.th, "w-[130px]")}>Capacity</th>
                  <th className={cn(st.th, "w-[84px]")}>Rest day</th>
                </tr>
              </thead>
              <PagedBody className="m-seq">
                {members.map((member) => {
                  const pct = member.capacity > 0 ? member.currentOpen / member.capacity : 1;
                  const full = member.currentOpen >= member.capacity;
                  const editing = editingMember === member.id;
                  return (
                    <Fragment key={member.id}>
                      <tr className="m-row">
                        <td className={st.td}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block whitespace-nowrap">{shortName(member.name)}</span>
                              <span className={st.sub}>{member.languages.length ? member.languages.map(titleCase).join(", ") : workspace.boardSchema ? "No languages recorded" : ""}</span>
                              {personSkipLine(member.id) && <span className={st.sub}>{personSkipLine(member.id)}</span>}
                              {warnable(member).map((entry) => {
                                const lapsed = daysUntil(entry.expiresOn) < 0;
                                const leadsText = `${entry.openLeads.toLocaleString()} open ${entry.state} lead${entry.openLeads === 1 ? "" : "s"}`;
                                return (
                                  <span key={entry.state} className={cn(st.sub, lapsed ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]")}>
                                    {lapsed
                                      ? `${entry.state} licence lapsed ${shortDate(entry.expiresOn)} · ${leadsText} go back to the pool (never mid-call or with a booked callback)`
                                      : `${entry.state} licence valid through ${shortDate(entry.expiresOn)}${entry.openLeads ? ` · ${leadsText} return to the pool on ${lapseDay(entry)}` : ""}`}
                                  </span>
                                );
                              })}
                            </span>
                            {canManage && !editing && (
                              <Button type="button" variant="outline" size="sm" aria-label={`Edit ${member.name}'s capacity, languages and rest day`} onClick={() => { setEditingMember(member.id); setMemberError(null); setMemberForm({ capacity: String(member.capacity), languages: member.languages.join(", "), weekdayOff: member.weekdayOff === null ? "" : String(member.weekdayOff) }); }}>Edit</Button>
                            )}
                          </span>
                        </td>
                        <td className={st.td}><StatusChip dot={false} tone={pillTone(member.role === "setter" ? "info" : "neutral")}>{roleLabel(member.role)}</StatusChip></td>
                        <td className={cn(st.td, "tabular-nums")} title={member.eligibleStates?.length ? member.eligibleStates.join(", ") : undefined}>{member.role === "setter" || member.eligibleStates === null ? "—" : member.eligibleStates.length}</td>
                        <td className={cn(st.td, "tabular-nums")}>{member.currentOpen}</td>
                        <td className={st.td}>
                          <SettingsMeter
                            value={member.currentOpen}
                            max={Math.max(member.capacity, 1)}
                            tone={full ? "error" : pct >= 0.7 ? "warning" : "success"}
                            caption={full ? "at the ceiling" : `${member.currentOpen} of ${member.capacity}`}
                            ariaLabel={`${member.name}: ${member.currentOpen} of ${member.capacity} open leads`}
                          />
                        </td>
                        <td className={st.td}>{member.weekdayOff === null ? "—" : WEEKDAYS[member.weekdayOff]}</td>
                      </tr>
                      {editing && (
                        <tr>
                          <td colSpan={6} className={cn(st.td, "bg-[var(--canvas)]")}>
                            <div className="grid gap-4 py-2 sm:grid-cols-3">
                              <Field label="Capacity" htmlFor={`cap-${member.id}`} hint="Most open leads at once.">
                                <input id={`cap-${member.id}`} className={control} type="number" min={0} max={100000} value={memberForm.capacity} onChange={(event) => setMemberForm({ ...memberForm, capacity: event.target.value })} />
                              </Field>
                              <Field label="Languages" htmlFor={`lang-${member.id}`} hint="Comma-separated, e.g. spanish, es.">
                                <input id={`lang-${member.id}`} className={control} value={memberForm.languages} disabled={!workspace.boardSchema} onChange={(event) => setMemberForm({ ...memberForm, languages: event.target.value })} placeholder="spanish, english" />
                              </Field>
                              <Field label="Rest day" htmlFor={`off-${member.id}`} hint="No automatic assignment that day (agency time).">
                                <select id={`off-${member.id}`} className={control} value={memberForm.weekdayOff} disabled={!workspace.boardSchema} onChange={(event) => setMemberForm({ ...memberForm, weekdayOff: event.target.value })}>
                                  <option value="">Works every day</option>
                                  {WEEKDAY_NAMES.map((day, value) => <option key={day} value={value}>{day}</option>)}
                                </select>
                              </Field>
                            </div>
                            {!workspace.boardSchema && <p className="text-xs text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE} Capacity can still be changed.</p>}
                            {memberError && <p role="alert" className="text-xs text-[var(--error-ink)]">{memberError}</p>}
                            <div className="mt-2 flex justify-end gap-2.5">
                              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingMember(null)} disabled={busy === `member:${member.id}`}>Cancel</Button>
                              <Button type="button" size="sm" onClick={() => void saveMember(member)} disabled={busy === `member:${member.id}`}>{busy === `member:${member.id}` ? "Saving…" : "Save"}</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </PagedBody>
              {!members.length && <tbody><tr><td colSpan={6}><EmptyState title="Nobody can take leads yet" hint="Agents and setters appear here once they join." /></td></tr></tbody>}
            </table>
          </PagedTableCard>
      )}
      {tab === "pool" && pool && <UnassignedPool />}
      {tab === "settings" && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start">
          <div ref={restCardRef} tabIndex={-1} className="outline-none">
            <SettingsCard
              title="Household rest days"
              pad={20}
              action={canManage && !editingRest ? <Button type="button" variant="outline" onClick={openRestEditor}>Edit</Button> : undefined}
            >
              {editingRest ? (
                <div className="flex flex-col gap-4">
                  <Field
                    label="Rest between owners"
                    htmlFor="rest-days"
                    hint={<span className="inline-flex items-center gap-0.5">Days before another agent may take the household. 0 is off.<InfoTip label="About rest between owners">Counts from the day a household is given to someone, whether by the rules, a rotation or a manager&apos;s reassignment.</InfoTip></span>}
                  >
                    <input ref={restInputRef} id="rest-days" className={control} type="number" min={0} max={3650} value={restForm.restDays} onChange={(event) => setRestForm({ ...restForm, restDays: event.target.value })} />
                  </Field>
                  <Field
                    label="Attempts before rotate"
                    htmlFor="rotate-attempts"
                    hint={<span className="inline-flex items-center gap-0.5">Unanswered calls before the lead moves on. Empty or 0 is off.<InfoTip label="About attempts before rotate">Counts no answer, voicemail, busy and dropped calls by the same owner since anyone last reached the household; the lead then goes to another eligible agent. Checked every 5 minutes, never during a call or a booked callback.</InfoTip></span>}
                  >
                    <input id="rotate-attempts" className={control} type="number" min={0} max={50} value={restForm.attempts} disabled={!workspace.boardSchema} onChange={(event) => setRestForm({ ...restForm, attempts: event.target.value })} placeholder="Off" />
                  </Field>
                  {!workspace.boardSchema && <p className="m-0 text-xs text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE} Rest between owners can still be changed.</p>}
                  {restError && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{restError}</p>}
                  <div className="flex justify-end gap-2.5">
                    <Button type="button" variant="ghost" disabled={busy === "settings"} onClick={() => setEditingRest(false)}>Cancel</Button>
                    <Button type="button" disabled={busy === "settings"} onClick={() => void saveRest()}>{busy === "settings" ? "Saving…" : "Save"}</Button>
                  </div>
                </div>
              ) : (
                <KeyValues
                  cols={1}
                  items={[
                    { label: "Rest between owners", value: workspace.settings.rest_days > 0 ? `${workspace.settings.rest_days} day${workspace.settings.rest_days === 1 ? "" : "s"}` : "Off" },
                    { label: "Attempts before rotate", value: workspace.settings.attempts_before_rotate ? String(workspace.settings.attempts_before_rotate) : "Off" },
                    { label: "Same household", value: workspace.boardSchema ? "one agent at a time" : "not enforced yet" },
                  ]}
                />
              )}
            </SettingsCard>
          </div>

          {/* ── routing on arrival (concept board: real-time leads go straight to someone) ── */}
          <SettingsCard
            title="Posted leads"
            pad={20}
            action={canManage ? (
              <Button
                type="button"
                variant={workspace.settings.auto_route_posted ? "outline" : "default"}
                disabled={!workspace.routerSchema || busy === "auto-route"}
                aria-describedby={!workspace.routerSchema ? "auto-route-pending" : undefined}
                onClick={() => void saveAutoRoute(!workspace.settings.auto_route_posted)}
              >
                {busy === "auto-route" ? "Saving…" : workspace.settings.auto_route_posted ? "Turn off" : "Turn on"}
              </Button>
            ) : undefined}
          >
            <KeyValues
              cols={1}
              items={[
                { label: "Route on arrival", value: workspace.settings.auto_route_posted ? "On" : "Off" },
                { label: "Real-time rules", value: realtimeRules ? `${realtimeRules} published` : "None published", tone: workspace.settings.auto_route_posted && !realtimeRules ? "warning" : undefined },
                ...(workspace.insights ? [{ label: "Routed on arrival this week", value: workspace.insights.autoRouted.toLocaleString() }] : []),
              ]}
            />
            {!workspace.routerSchema && <p id="auto-route-pending" className="mt-2 mb-0 text-xs leading-[1.5] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>}
          </SettingsCard>
        </div>
      )}
      </div>

      {reassignOpen && (
        <ReassignPanel
          canManage={canManage}
          members={members}
          busy={busy === "action"}
          onClose={() => setReassignOpen(false)}
          reassign={{ workItemId: reassignWorkItemId, setWorkItemId: setReassignWorkItemId, targetUserId: reassignTargetUserId, setTargetUserId: setReassignTargetUserId, reason: reassignReason, setReason: setReassignReason }}
          giveBack={{ workItemId, setWorkItemId, reason: returnReason, setReason: setReturnReason }}
          onReassign={() => void post({ action: "assign", workItemId: reassignWorkItemId, targetUserId: reassignTargetUserId, reason: reassignReason }, "Lead reassigned").then((ok) => { if (ok) setReassignOpen(false); })}
          onReturn={() => void post({ action: "return_to_pool", workItemId, reason: returnReason }, "Lead returned to assignment pool").then((ok) => { if (ok) setReassignOpen(false); })}
        />
      )}
    </div>
  );
}

/** One person: how much room is left, and anything that keeps leads from them. */
function PersonCard({ member, canManage, onEdit, skipLine, warnings }: { member: AssignmentMember; canManage: boolean; onEdit: () => void; skipLine: string | null; warnings: LicenceExpiry[] }) {
  const full = member.currentOpen >= member.capacity;
  const pct = member.capacity > 0 ? member.currentOpen / member.capacity : 1;
  const tone = full ? "error" : pct >= 0.7 ? "warning" : "success";
  const reach = member.role === "setter" ? "any state except term life" : member.eligibleStates === null ? null : `${member.eligibleStates.length} state${member.eligibleStates.length === 1 ? "" : "s"}`;
  const sub = [roleLabel(member.role), member.languages.length ? member.languages.map((value) => value.slice(0, 2).toUpperCase()).join(", ") : null, reach].filter(Boolean).join(" · ");
  const initials = member.name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  const warning = warnings[0];
  return (
    <li className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--accent-ink)]">{initials}</span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold text-[var(--ink)]">{member.name}</strong>
          <span className="block text-xs text-[var(--muted)]">{sub}</span>
        </span>
        {canManage && <button type="button" className="shrink-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline" aria-label={`Edit ${member.name}'s capacity, languages and rest day`} onClick={onEdit}>Edit</button>}
      </div>
      <SettingsMeter
        value={member.currentOpen}
        max={Math.max(member.capacity, 1)}
        tone={tone}
        caption={full ? `${member.currentOpen} open of ${member.capacity} · full` : `${member.currentOpen} open of ${member.capacity} · ${member.capacity - member.currentOpen} room`}
        ariaLabel={`${member.name}: ${member.currentOpen} of ${member.capacity} open leads`}
      />
      {warning ? (
        <span className={cn("text-xs", daysUntil(warning.expiresOn) < 0 ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]")}>
          {daysUntil(warning.expiresOn) < 0 ? `${warning.state} licence lapsed ${shortDate(warning.expiresOn)}` : `${warning.state} licence lapses ${shortDate(warning.expiresOn)}`}{warning.openLeads ? ` · ${warning.openLeads} open lead${warning.openLeads === 1 ? "" : "s"} return to the pool` : ""}
        </span>
      ) : skipLine ? (
        <span className="text-xs text-[var(--error-ink)]">{skipLine}</span>
      ) : (
        <span className="text-xs text-[var(--muted)]">{member.weekdayOff === null ? "Works every day" : `Rest day: ${WEEKDAY_NAMES[member.weekdayOff]}`}</span>
      )}
    </li>
  );
}

/** A rule as a sentence: "A lead whose state is TX, FL goes to Ana, Maya, in turn." */
function RuleSentence({ draft, value, who }: { draft: RuleDraft; value: string; who: string }) {
  const how = STRATEGY_PHRASE[draft.strategy] ?? "in turn";
  const to = <> goes to <strong className="font-semibold text-[var(--accent-ink)]">{who}</strong>, {how}.</>;
  if (draft.matchType === "fallback") return <><strong className="font-semibold text-[var(--ink)]">Anything else</strong>{to}</>;
  if (draft.matchType === "realtime") return <>A lead that arrived within <strong className="font-semibold text-[var(--ink)]">{value}</strong>{to}</>;
  return <>A lead whose <strong className="font-semibold text-[var(--ink)]">{MATCH_LABEL[draft.matchType].toLowerCase()}</strong> is <strong className="font-semibold text-[var(--ink)]">{value}</strong>{to}</>;
}

type Candidate = { workItemId: string; leadId: string; name: string; state: string | null; phone: string | null; ownerUserId: string | null; status: string };

/**
 * Reassign a lead (2026-10-26): find it by name or phone, then give it to a teammate or put it back in
 * the pool, with a reason. A manager searches; anyone else returns a lead they hold by its work-item ID,
 * as before. The server checks licence, ceiling and household rules.
 */
function ReassignPanel({ canManage, members, busy, onClose, reassign, giveBack, onReassign, onReturn }: {
  canManage: boolean;
  members: AssignmentMember[];
  busy: boolean;
  onClose: () => void;
  reassign: { workItemId: string; setWorkItemId: (value: string) => void; targetUserId: string; setTargetUserId: (value: string) => void; reason: string; setReason: (value: string) => void };
  giveBack: { workItemId: string; setWorkItemId: (value: string) => void; reason: string; setReason: (value: string) => void };
  onReassign: () => void;
  onReturn: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"give" | "return">(canManage ? "give" : "return");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [picked, setPicked] = useState<Candidate | null>(null);
  const memberName = (id: string | null) => (id ? members.find((member) => member.id === id)?.name ?? "someone" : null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the panel portals to the body once mounted
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!canManage || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/app/assignments?view=find&q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not search leads"); setSearchError(""); setFound(body.leads ?? []); })
        .catch((error) => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Could not search leads"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canManage, query]);

  function pick(candidate: Candidate) {
    setPicked(candidate);
    reassign.setWorkItemId(candidate.workItemId);
    giveBack.setWorkItemId(candidate.workItemId);
  }

  const giving = mode === "give";
  const ready = giving ? Boolean(reassign.workItemId && reassign.targetUserId && reassign.reason.trim()) : Boolean(giveBack.workItemId && giveBack.reason.trim());
  const panel = (
    <DetailPanel
      mode="overlay"
      title={canManage ? "Reassign a lead" : "Return a lead to the pool"}
      subtitle="Licence, ceiling and household rules are checked"
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready || busy} onClick={giving ? onReassign : onReturn}>{busy ? "Saving…" : giving ? "Reassign lead" : "Return to pool"}</Button>
        </div>
      )}
    >
      {canManage ? (
        <Field label="Lead" htmlFor="reassign-search" hint="Search by name or phone.">
          <input id="reassign-search" type="search" className={control} value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim().length < 2) setFound(null); }} placeholder="Name or phone" autoComplete="off" />
        </Field>
      ) : (
        <Field label="Work item" htmlFor="return-work-item" hint="Puts the lead back in the pool for the next assignment.">
          <input id="return-work-item" className={control} value={giveBack.workItemId} onChange={(event) => giveBack.setWorkItemId(event.target.value)} placeholder="Work item ID" />
        </Field>
      )}
      {searchError && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{searchError}</p>}
      {canManage && found && !picked && (
        found.length ? (
          <ul aria-label="Matching leads" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {found.map((candidate) => (
              <li key={candidate.workItemId}>
                <button type="button" onClick={() => pick(candidate)} className="flex w-full flex-col rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--primary)]">
                  <strong className="text-sm font-semibold text-[var(--ink)]">{candidate.name}{candidate.state ? ` · ${candidate.state}` : ""}</strong>
                  <span className="text-xs text-[var(--muted)]">{candidate.ownerUserId ? `Owned by ${memberName(candidate.ownerUserId)}` : "In the pool"}{candidate.phone ? ` · ${candidate.phone}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-[var(--muted)]">No lead in the queue matches “{query.trim()}”.</p>
      )}
      {picked && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-2.5">
          <span className="min-w-0">
            <strong className="block text-sm font-semibold text-[var(--ink)]">{picked.name}{picked.state ? ` · ${picked.state}` : ""}</strong>
            <span className="block text-xs text-[var(--muted)]">{picked.ownerUserId ? `Owned by ${memberName(picked.ownerUserId)}` : "In the pool"}</span>
          </span>
          <button type="button" className="text-xs font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => { setPicked(null); reassign.setWorkItemId(""); giveBack.setWorkItemId(""); }}>Change</button>
        </div>
      )}
      {canManage && (
        <div role="radiogroup" aria-label="What to do with it" className="flex gap-2">
          {(["give", "return"] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={mode === value ? "default" : "outline"} role="radio" aria-checked={mode === value} onClick={() => setMode(value)}>{value === "give" ? "Give to a teammate" : "Return to the pool"}</Button>
          ))}
        </div>
      )}
      {giving ? (
        <>
          <Field label="Teammate" htmlFor="reassign-target">
            <select id="reassign-target" className={control} value={reassign.targetUserId} onChange={(event) => reassign.setTargetUserId(event.target.value)}>
              <option value="">Select eligible teammate</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
            </select>
          </Field>
          <Field label="Reason" htmlFor="reassign-reason" hint="Required. Kept with the lead’s assignment history.">
            <input id="reassign-reason" className={control} value={reassign.reason} onChange={(event) => reassign.setReason(event.target.value)} placeholder="Reason for reassignment" />
          </Field>
        </>
      ) : (
        <Field label="Reason" htmlFor="return-reason" hint="Required. The lead goes back in the pool for the next assignment.">
          <input id="return-reason" className={control} value={giveBack.reason} onChange={(event) => giveBack.setReason(event.target.value)} placeholder="Reason for returning to pool" />
        </Field>
      )}
    </DetailPanel>
  );
  // Portalled: the page's entrance animation leaves a transform that would trap a fixed panel.
  return mounted ? createPortal(panel, document.body) : null;
}
