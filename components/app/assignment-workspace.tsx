"use client";

/**
 * /app/assignments — Lead assignment, built to the p-app-assignments board.
 *
 * Every figure on it is read, not drawn: the licence chips and the Licensed column come from the
 * eligibility gate itself (assignment_insights → assignment_candidate_is_eligible), "N routed" from
 * lead_assignment_events.rule_id, "skipped X N×" from assignment_skip_events, and the preview from
 * the real router run inside a rolled-back savepoint. Before migration 20260924300000 the page
 * shows what it can and says what it cannot.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { Fragment, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { Field, KeyValues, LockIcon, PlusIcon, SettingsCard, SettingsMeter, control, st, pillTone } from "@/components/app/settings/primitives";
import { MATCH_LABEL, MATCH_OPERATOR, SCHEMA_PENDING_MESSAGE, WEEKDAYS, WEEKDAY_NAMES, daysUntil, lapseDay, nobodySentence, shortDate, shortName, stateName } from "@/lib/assignment/constants";
import { cn } from "@/lib/utils";
import { draftFromRule, pinFallbacks, roleLabel, serialise, titleCase } from "@/components/app/assignment/model";
import { PreviewWhy, RuleEditor } from "@/components/app/assignment/rule-editor";
import { useAssignmentWorkspace } from "@/components/app/assignment/use-assignment-workspace";
import { ViewTabs, fullHeightCard } from "@/components/app/lead-ops-view-tabs";

/** The conditions a draft publishes: none on a fallback, which matches everything. */

export function AssignmentWorkspace({ canManage }: { canManage: boolean }) {
  const { workspace, loading, busy, preview, drafts, setDrafts, openKey, setOpenKey, dragKey, setDragKey, publishError, moveNotice, campaignFilter, setCampaignFilter, editingMember, setEditingMember, memberForm, setMemberForm, memberError, setMemberError, editingRest, setEditingRest, restForm, setRestForm, restError, restCardRef, restInputRef, workItemId, setWorkItemId, returnReason, setReturnReason, reassignWorkItemId, setReassignWorkItemId, reassignTargetUserId, setReassignTargetUserId, reassignReason, setReassignReason, adopt, loadPreview, refresh, members, memberById, publishedOrder, dirty, problems, sinceLabel, post, publish, saveMember, saveRest, saveAutoRoute, openRestEditor, updateDraft, moveDraft, dropOn, handleKeys, addCondition, restore, licensedMembers, setters, agencyReach, atCeiling, routedFor, topCapacitySkip, ruleSkipLine, personSkipLine, warnable, ceilingChip, valueChip, assigneeSummary } = useAssignmentWorkspace(canManage);

  // One title; the page actions sit on the tab row (2026-10-06 redesign).
  const header = <PageHeader title="Lead assignment" />;
  const [tab, setTab] = useState<"rules" | "capacity" | "preview" | "settings">("rules");
  const [poolOpen, setPoolOpen] = useState(false);
  /** Rest days live on their own tab: bring it forward, then open the editor once it has rendered. */
  const openRest = () => { setTab("settings"); requestAnimationFrame(() => openRestEditor()); };

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
  const filteredCampaigns = workspace.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(campaignFilter.trim().toLowerCase()));

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      <StatStrip label="Assignment totals">
        <StatTile label="Licensed agents" value={licensedMembers.length} footnote={agencyReach ? `${agencyReach} state${agencyReach === 1 ? "" : "s"} covered` : "no licensed states recorded"} />
        <StatTile label="Setters" value={setters.length} footnote="any state except term life" />
        <StatTile label="At the ceiling" value={atCeiling.length} valueTone={atCeiling.length ? "danger" : undefined} footnote={ceilingChip} />
        {workspace.insights && <StatTile label="Match no licensed agent" value={(workspace.insights.unlicensedLeads ?? 0).toLocaleString()} valueTone={(workspace.insights.unlicensedLeads ?? 0) > 0 ? "danger" : undefined} footnote="leads in the pool" />}
        {workspace.insights && <StatTile label="Routed on arrival" value={workspace.insights.autoRouted.toLocaleString()} footnote={`since ${sinceLabel}`} />}
      </StatStrip>

      {!workspace.boardSchema && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          Real-time rules, language pairing, rest days, rotation, routed counts and the preview need migration 20260924300000.
        </p>
      )}
      {firstNobody && (
        <p role="alert" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
          <span className="font-semibold">{nobodyCount === 1 ? "One lead routed to nobody" : `${nobodyCount} leads routed to nobody`}:</span> {firstNobody.name}&rsquo;s lead is {firstNobody.state ? `in ${stateName(firstNobody.state)}` : "missing a state"}. {firstNobody.licence_reason ?? nobodySentence(firstNobody.detail)}{firstNobody.detail?.requires_licensed && setters.length > 0 ? " It needs a licensed agent, so no setter can take it either." : ""}
        </p>
      )}

      <ViewTabs
        label="Assignment views"
        controls="assignment-panel"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "rules", label: "Rules", count: drafts.length },
          { key: "capacity", label: "Capacity", count: members.length },
          { key: "preview", label: "Routing preview", count: preview.rows ? preview.rows.length : null },
          { key: "settings", label: "Rest days & posted leads" },
        ]}
        actions={(
          <>
            <Button type="button" variant="outline" onClick={() => setPoolOpen(true)} disabled={!workspace}>Pool actions</Button>
            <Button type="button" variant="outline" onClick={openRest} disabled={!workspace}>Rest days</Button>
            <Button type="button" disabled={!workspace || busy === "action"} onClick={() => void post({ action: "assign" }, "Next eligible lead assigned")}>Assign next eligible lead</Button>
          </>
        )}
      />

      <div key={tab} role="tabpanel" id="assignment-panel" aria-labelledby={`assignment-panel-tab-${tab}`} className="min-w-0">
      {tab === "rules" && (
          <TableCard
            className={fullHeightCard(340)}
            description="Checked top to bottom, from the next assignment."
            footer={canManage ? (
              <span className="ml-auto flex items-center gap-2">
                {dirty && <Button type="button" variant="ghost" disabled={busy === "publish"} onClick={() => { adopt(workspace); setOpenKey(null); }}>Discard</Button>}
                <Button type="button" disabled={!dirty || busy === "publish" || problems.some(Boolean)} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish rules"}</Button>
              </span>
            ) : undefined}
          >
            <p className="sr-only" aria-live="polite">{moveNotice}</p>
            <ol className="m-0 list-none border-t border-[var(--border)] p-0">
              {/* Capacity: pinned, checked under every rule, never removable. */}
              <li className="m-row flex items-center gap-2.5 px-4 py-3" title="Checked under every rule">
                <span className="w-[22px] text-center text-[var(--muted)]" aria-hidden><LockIcon /></span>
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold text-[var(--muted)]" aria-hidden><LockIcon /></span>
                <span className="w-[130px] shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Agent capacity</span>
                <span className="w-[110px] shrink-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">ceilings below</span>
                <span className="min-w-0 flex-1"><StatusChip dot={false}>{ceilingChip}</StatusChip></span>
                <span className="w-[120px] shrink-0 text-right text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                  {topCapacitySkip ? <>skipped {shortName(memberById.get(topCapacitySkip.user_id)?.name ?? "someone")} {topCapacitySkip.leads}&times; this week</> : workspace.insights ? "always enforced" : ""}
                </span>
                <span className="inline-flex w-[18px] justify-center text-[var(--muted)]" aria-label="Always enforced; cannot be removed" role="img"><LockIcon /></span>
              </li>
              {drafts.map((draft, index) => {
                const open = openKey === draft.key;
                const routed = routedFor(draft.id);
                const problem = problems[index];
                const pinned = draft.matchType === "fallback";
                const skipLine = ruleSkipLine(draft.id);
                const operator = draft.matchType === "fallback" && draft.strategy === "least_loaded" ? "fewest open first" : MATCH_OPERATOR[draft.matchType];
                const goesTo = `Goes to ${assigneeSummary(draft.assigneeIds)}${draft.strategy === "least_loaded" ? ", fewest open first" : ", in turn"}`;
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
                    <div className="m-row flex items-center gap-2.5 px-4 py-3">
                      {pinned ? (
                        // Pinned last: a fallback matches every lead, so nothing after it would be reached.
                        <span className="inline-flex w-[22px] justify-center text-[var(--muted)]" role="img" aria-label={`Rule ${index + 1}, the fallback, always runs last`} title="The fallback always runs last"><LockIcon /></span>
                      ) : canManage ? (
                        <button
                          id={`rule-handle-${draft.key}`}
                          type="button"
                          className="w-[22px] cursor-grab text-sm leading-none text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                          aria-label={`Rule ${index + 1}. Drag, or press the up and down arrow keys, to reorder`}
                          // Pressing the handle takes focus, so the arrow keys reorder straight after a
                          // click as well as after Tab. The drag itself belongs to the row.
                          onPointerDown={(event) => event.currentTarget.focus()}
                          onKeyDown={(event) => handleKeys(event, draft.key)}
                        >&#8942;&#8942;</button>
                      ) : <span className="w-[22px] text-sm leading-none text-[var(--muted)]" aria-hidden>&#8942;&#8942;</span>}
                      <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs leading-[1.5] font-semibold tracking-[-0.01em]">{index + 1}</span>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                        onClick={() => setOpenKey(open ? null : draft.key)}
                        aria-expanded={open}
                        aria-controls={`rule-editor-${draft.key}`}
                      >
                        <span className="w-[130px] shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{MATCH_LABEL[draft.matchType]}</span>
                        <span className="w-[110px] shrink-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{operator}</span>
                        <span className="min-w-0 flex-1" title={draft.matchType === "fallback" ? undefined : goesTo}>
                          <StatusChip dot={false} tone={pillTone(problem ? "warning" : "neutral")} className="max-w-full overflow-hidden text-ellipsis">{valueChip(draft)}</StatusChip>
                        </span>
                        <span className="w-[120px] shrink-0 text-right text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]" title={workspace.insights ? `Since ${sinceLabel}, 00:00 UTC` : undefined}>
                          {!draft.id ? "not published" : routed === null ? "" : `${routed.toLocaleString()} routed this week`}
                        </span>
                      </button>
                      {canManage ? (
                        <button type="button" className="border-0 bg-transparent px-1 text-base leading-none text-[var(--muted)] hover:text-[var(--error-ink)]" aria-label={`Remove rule ${index + 1}`} onClick={() => { setDrafts((current) => current.filter((item) => item.key !== draft.key)); if (open) setOpenKey(null); }}>&times;</button>
                      ) : <span className="w-[18px]" />}
                    </div>
                    {skipLine && (
                      <p className="m-0 -mt-1.5 pr-4 pb-2.5 pl-[80px] text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]" title={`Since ${sinceLabel}, 00:00 UTC. "→" is where the leads it passed over were routed in the end.`}>This week: {skipLine}</p>
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
                  action={canManage ? <Button type="button" variant="outline" onClick={addCondition}><PlusIcon />Add condition</Button> : undefined}
                />
              </div>
            )}
            {canManage && drafts.length > 0 && (
              <div className="border-t border-dashed border-[var(--border-strong)] px-4 py-3">
                <Button type="button" variant="ghost" onClick={addCondition}><PlusIcon />Add condition</Button>
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
      {tab === "preview" && (
          <PagedTableCard
            total={canManage && !preview.error && !preview.pending ? previewRows.length : 0}
            noun="leads"
            className={fullHeightCard(340)}
            action={(
              <>
                {preview.rows && preview.rows.length > 0 && <StatusChip tone={pillTone(routedCount === preview.rows.length ? "success" : "warning")} dot>{routedCount} of {preview.rows.length} routed</StatusChip>}
                {canManage && <RefreshButton onClick={() => void loadPreview()} refreshing={preview.loading} />}
              </>
            )}
          >
            {!canManage ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">Owners and producers can preview where the next leads in the pool would go.</p>
            ) : preview.loading && !preview.rows ? (
              <div className="border-t border-[var(--border)]"><SectionLoading rows={4} columns={4} label="Loading the routing preview" /></div>
            ) : preview.error ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--error-ink)]" role="alert">{preview.error}</p>
            ) : preview.pending ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>
            ) : !previewRows.length ? (
              <div className="border-t border-[var(--border)]">
                <EmptyState
                  title="Nothing waiting in the pool"
                  hint="Import a list to fill it."
                  action={<Button asChild type="button" variant="outline"><Link href="/app/import">Import a list</Link></Button>}
                />
              </div>
            ) : (
              <table className={cn(st.table, "border-t border-[var(--border)]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th className={st.th}>Lead</th>
                    <th className={cn(st.th, "w-[64px]")}>State</th>
                    <th className={cn(st.th, "w-[110px]")}>Goes to</th>
                    <th className={cn(st.th, "w-[150px]")}>Why</th>
                  </tr>
                </thead>
                <PagedBody className="m-seq">
                  {previewRows.map((row) => {
                    const owner = row.owner_user_id ? memberById.get(row.owner_user_id) : undefined;
                    const unrouted = row.outcome !== "routed" && row.outcome !== "taken";
                    return (
                      <tr key={row.work_item_id} className={cn("m-row", unrouted && "bg-[var(--warning-surface)]")}>
                        <td className={st.td}>{row.name}</td>
                        <td className={st.td}>{row.state ?? "—"}</td>
                        <td className={st.td}>
                          {row.outcome === "routed" || row.outcome === "taken" ? (owner ? shortName(owner.name) : "Someone") : <StatusChip tone="danger" dot>Nobody</StatusChip>}
                        </td>
                        <td className={st.td}><PreviewWhy row={row} ruleNumber={row.rule_id ? publishedOrder.get(row.rule_id) ?? null : null} memberName={(id) => shortName(memberById.get(id)?.name ?? "someone")} /></td>
                      </tr>
                    );
                  })}
                </PagedBody>
              </table>
            )}
            {canManage && dirty && previewRows.length > 0 && <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">The preview uses the published rules, not your unpublished changes.</p>}
          </PagedTableCard>
      )}
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


      {/* ── pool actions: a dialog opened from the tab row (2026-10-06 redesign) ── */}
      <Dialog open={poolOpen} onOpenChange={setPoolOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Pool actions</DialogTitle>
            <DialogDescription>Reassign a lead, or put one back in the pool.</DialogDescription>
          </DialogHeader>
        <div className={cn("grid gap-6", canManage && "lg:grid-cols-2")}>
          {canManage && (
            <div className="flex flex-col gap-3">
              <Field label="Reassign work item" htmlFor="reassign-work-item" hint="A lead someone owns needs a reason. The target must be licensed for it, below their ceiling, and clear of the household rules.">
                <input id="reassign-work-item" className={control} value={reassignWorkItemId} onChange={(event) => setReassignWorkItemId(event.target.value)} placeholder="Work item ID" />
              </Field>
              <select className={cn(control, "mt-0")} value={reassignTargetUserId} onChange={(event) => setReassignTargetUserId(event.target.value)} aria-label="Reassignment target">
                <option value="">Select eligible teammate</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
              </select>
              <input className={cn(control, "mt-0")} value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} placeholder="Reason for reassignment" aria-label="Reason for reassignment" />
              <div><Button type="button" variant="outline" disabled={!reassignWorkItemId || !reassignTargetUserId || !reassignReason || busy === "action"} onClick={() => void post({ action: "assign", workItemId: reassignWorkItemId, targetUserId: reassignTargetUserId, reason: reassignReason }, "Lead reassigned")}>Reassign lead</Button></div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <Field label="Return owned work item" htmlFor="return-work-item" hint="Puts the lead back in the pool for the next assignment.">
              <input id="return-work-item" className={control} value={workItemId} onChange={(event) => setWorkItemId(event.target.value)} placeholder="Work item ID" />
            </Field>
            <input className={cn(control, "mt-0")} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Reason for returning to pool" aria-label="Reason for returning to pool" />
            <div><Button type="button" variant="outline" disabled={!workItemId || !returnReason || busy === "action"} onClick={() => void post({ action: "return_to_pool", workItemId, reason: returnReason }, "Lead returned to assignment pool")}>Return to pool</Button></div>
          </div>
        </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
