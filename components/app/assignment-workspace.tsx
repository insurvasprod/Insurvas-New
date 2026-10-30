"use client";

/**
 * Step 5 · Route of the one Leads page: /app/assignments and the agency's /app/lead-routing.
 *
 * Board LirT1, "Route A · rules and room side by side" (Leads in round 3, owner pick 2026-10-30). One
 * screen, no page scroll. First, Next up (owner critique 2026-10-30): one sentence, ranked — leads that
 * can't go to anyone (the missing licence or appointment, per state), then what waits on a person
 * (unpublished rules, a rule naming someone inactive, everyone full → "Raise their limits"), then the
 * normal step, "N waiting · hand out N now" (N = what waits, less what no licence can take, capped by
 * the room the team has). Its button is the page's only primary; the corner (Edit rules, and the
 * hand-out when it is not Next up's) is outline. Then a strip of four figures (waiting and the oldest,
 * can't go to anyone, handed out today, room left); then two cards side by side: "Rules, first match
 * wins" (the chain in order, each row number · match · value · who, a row opens it in Edit rules) and
 * "Who has room" (a bar per person, a reason several share said once above them, with the Pool beside
 * it as a second tab: next-up preview, each nobody with its fix, and in an agency the whole pool).
 *
 * Edit rules is a sheet holding the whole chain editor (add, reorder by drag or arrow keys, remove,
 * restore, everyone else's strategy, publish or discard) and the household and posted-lead settings.
 *
 * Every figure on it is read, not drawn: the licence chips and the Licensed column come from the
 * eligibility gate itself (assignment_insights → assignment_candidate_is_eligible), "N this week" from
 * lead_assignment_events.rule_id, "skipped X N×" from assignment_skip_events, the preview from the real
 * router run inside a rolled-back savepoint, and the strip from lib/assignment/routeStats.ts. Before
 * migration 20260924300000 the page shows what it can and says what it cannot.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, GripVertical, House, Radio, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Sheet } from "@/components/ui/sheet";
import { PageLoading } from "@/components/ui/page-loading";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { Meter, StatStrip, StatTile } from "@/components/ui/stat";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { cardInset, cardSurface } from "@/components/ui/card";
import { Field, KeyValues, LockIcon, PlusIcon, control, pillTone } from "@/components/app/settings/primitives";
import { MATCH_LABEL, MATCH_OPERATOR, RULE_STRATEGIES, SCHEMA_PENDING_MESSAGE, WEEKDAY_NAMES, daysUntil, lapseDay, nobodySentence, shortDate, shortName, stateName, type AssignmentMember, type LicenceExpiry, type PreviewRow, type RouteStats, type RuleStrategy } from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { draftFromRule, pinFallbacks, roleLabel, serialise, titleCase, type RuleDraft } from "@/components/app/assignment/model";
import { PreviewWhy, RuleEditor } from "@/components/app/assignment/rule-editor";
import { useAssignmentWorkspace } from "@/components/app/assignment/use-assignment-workspace";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";
import { LeadsInSlot, useInLeadsFrame } from "@/components/app/lead-sources/leads-in-slot";
import { NextUp, type NextUpTone } from "@/components/app/lead-sources/next-up";

const STRATEGY_PHRASE = { round_robin: "in turn", least_loaded: "fewest open first", best_placement: "best recent placement first" } as const;
/** The board's chip words for how everyone else is picked. */
const STRATEGY_CHIP: Record<RuleStrategy, string> = { round_robin: "Round robin", least_loaded: "Fewest open first", best_placement: "Best recent placement" };
/** readUnassignedPool reads at most this many leads. */
const POOL_READ_CAP = 500;
/** The board's small-caps section label: the kit's label style (StatTile's), 12px/600 uppercase. */
const sectionLabel = "m-0 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
/** Where a personal licence is added (Team & access) and where an agency appointment is (Carriers › States). */
const LICENCES_HREF = "/app/settings#team-access";
const APPOINTMENTS_HREF = "/app/settings#carriers/carriers-states";
/**
 * Where a state licence is added: Appointments & licences › Licences (Settings › Carriers stopped editing
 * licences 2026-10-26); `state` opens Add licence on that state for an owner who can edit.
 */
const addLicenceHref = (state?: string) => `/app/appointments?tab=licences${state ? `&state=${state}` : ""}`;
/** "a TX licence", "an NY licence": the article the letter's name takes. */
const article = (code: string) => (/^[AEFHILMNORSX]/.test(code) ? "an" : "a");
const linkAction = "shrink-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline";
/** The most leads one press of "Hand out N now" gives, one router call each. */
const HAND_OUT_CAP = 2000;

/** A deactivated or suspended login: its leads go back to the pool and no rule can hand it more. */
const isInactive = (member: AssignmentMember) => member.status !== "active" && member.status !== "unknown";

/** Why the router placed a preview lead with nobody, as the fix it calls for (PreviewWhy's labels). */
function nobodyCause(row: PreviewRow): "no_state" | "licence" | "full" | "no_one" | "household" | "other" {
  const d = row.detail ?? {};
  const other = (d.capacity ?? 0) + (d.rest ?? 0) + (d.household ?? 0) + (d.day_off ?? 0) + (d.language ?? 0);
  if (!d.candidates) return "no_one";
  if (!d.state && (d.licence ?? 0) > 0 && !other) return "no_state";
  if ((d.licence ?? 0) > 0 && !other) return "licence";
  if ((d.capacity ?? 0) > 0 && (d.capacity ?? 0) + (d.licence ?? 0) === d.candidates) return "full";
  if ((d.household ?? 0) > 0 || (d.rest ?? 0) > 0) return "household";
  return "other";
}

/** The Next up line: one sentence, its one button (the page's only primary), and a quiet extra. */
type NextMove = { tone: NextUpTone; text: ReactNode; action?: ReactNode; more?: ReactNode; handOut?: boolean };
/** The strip's figures plus the oldest lead's age, worked out once when they arrive. */
type Stats = RouteStats & { oldestDays: number | null };

export function AssignmentWorkspace({ canManage, pool = false }: { canManage: boolean; /** The agency's unassigned pool, as a second view (owner and admins). */ pool?: boolean }) {
  const { workspace, loading, busy, preview, drafts, setDrafts, openKey, setOpenKey, dragKey, setDragKey, publishError, moveNotice, campaignFilter, setCampaignFilter, editingMember, setEditingMember, memberForm, setMemberForm, memberError, setMemberError, editingRest, setEditingRest, restForm, setRestForm, restError, restCardRef, restInputRef, workItemId, setWorkItemId, returnReason, setReturnReason, reassignWorkItemId, setReassignWorkItemId, reassignTargetUserId, setReassignTargetUserId, reassignReason, setReassignReason, adopt, loadPreview, refresh, members, memberById, publishedOrder, dirty, problems, sinceLabel, post, publish, saveMember, saveRest, saveAutoRoute, openRestEditor, updateDraft, moveDraft, dropOn, handleKeys, addCondition, restore, routedFor, topCapacitySkip, ruleSkipLine, personSkipLine, warnable, ceilingChip, valueChip, assigneeSummary } = useAssignmentWorkspace(canManage);

  const [reassignOpen, setReassignOpen] = useState(false);
  // Edit rules: the sheet with the whole chain editor and the household settings.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  // The right card's two tabs. "Who has room" first (the board's card); the Pool and its next-up preview beside it.
  const [side, setSide] = useState<"people" | "pool">("people");
  const [poolKey, setPoolKey] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsKey, setStatsKey] = useState(0);
  // "Hand out N now": how many have gone so far, while it runs; Stop sets the ref.
  const [handing, setHanding] = useState<number | null>(null);
  const stopHanding = useRef(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const firstNobodyRef = useRef<HTMLLIElement>(null);
  const newFallback = useRef(0);
  const inFrame = useInLeadsFrame();

  useEffect(() => {
    let active = true;
    void fetch("/api/app/assignments?view=stats", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as RouteStats) : null))
      .then((next) => {
        if (!active) return;
        const oldestDays = next?.oldestAt ? Math.max(0, Math.floor((Date.now() - new Date(next.oldestAt).getTime()) / 86_400_000)) : null;
        setStats(next ? { ...next, oldestDays: Number.isFinite(oldestDays) ? oldestDays : null } : null);
      })
      .catch(() => { if (active) setStats(null); });
    return () => { active = false; };
  }, [statsKey]);

  if (loading) return <PageLoading />;
  if (!workspace) return <section className={cn(cardSurface, "p-4")}><ErrorState detail="The assignment workspace could not be loaded." action={<Button type="button" variant="outline" onClick={() => { void refresh(false).catch(() => undefined); }}>Try again</Button>} /></section>;

  const inactiveRules = workspace.rules.filter((rule) => !drafts.some((draft) => draft.id === rule.id));
  const publishedActive = workspace.rules.filter((rule) => rule.is_active).map(draftFromRule);
  const fallbackMoved = serialise(pinFallbacks(publishedActive)) !== serialise(publishedActive);
  const previewRows = preview.rows ?? [];
  const routedCount = previewRows.filter((row) => row.outcome === "routed").length;
  const firstNobody = previewRows.find((row) => row.outcome === "nobody") ?? null;
  const nobodyCount = previewRows.filter((row) => row.outcome === "nobody").length;
  const setters = members.filter((member) => member.role === "setter");
  const filteredCampaigns = workspace.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(campaignFilter.trim().toLowerCase()));
  const conditionCount = drafts.filter((item) => item.matchType !== "fallback").length;
  const fallbackIndex = drafts.findIndex((draft) => draft.matchType === "fallback");
  const fallback = fallbackIndex >= 0 ? drafts[fallbackIndex] : null;
  // With no fallback rule the router hands what is left to the whole roster, in turn.
  const everyoneElse: RuleStrategy = fallback?.strategy ?? "round_robin";
  const working = members.filter((member) => !isInactive(member));
  const fullPeople = working.filter((member) => member.currentOpen >= member.capacity);
  const inactiveHolding = members.filter((member) => isInactive(member) && member.currentOpen > 0);
  /** A rule's ticked people who can still take leads; empty ticks mean the whole roster. */
  const deadAssignees = (draft: RuleDraft) => draft.assigneeIds.filter((id) => { const member = memberById.get(id); return !member || isInactive(member); });
  const nobodyActive = (draft: RuleDraft) => draft.assigneeIds.length > 0 && deadAssignees(draft).length === draft.assigneeIds.length;
  const firstProblem = problems.findIndex(Boolean);
  const deadRuleIndex = drafts.findIndex((draft) => deadAssignees(draft).length > 0);

  /* ── the strip's figures ── */
  // Waiting: the uncapped count; the agency pool's own read (capped at 500) only when that one failed.
  const waitingCount = stats?.waiting ?? (poolCount !== null && poolCount < POOL_READ_CAP ? poolCount : null);
  const waitingLabel = waitingCount !== null ? waitingCount : poolCount !== null ? `${POOL_READ_CAP}+` : null;
  // Can't go to anyone: pool leads in a state no working owner or producer can write (assignment_insights).
  const cantGo = workspace.insights?.unlicensedLeads ?? null;
  const roomLeft = working.reduce((sum, member) => sum + Math.max(member.capacity - member.currentOpen, 0), 0);
  // N = what waits, less what no licence can take, and never more than the room the team has.
  const handOutCount = waitingCount === null ? null : Math.max(0, Math.min(waitingCount - (cantGo ?? 0), roomLeft));
  // Which states those are: the next leads in line, against the states someone can write. Only when every
  // licensed member's states are known — an unknown one would flag states that are in fact covered.
  const licensed = members.filter((member) => member.role !== "setter" && !isInactive(member));
  const reachKnown = licensed.every((member) => member.eligibleStates !== null);
  const reach = new Set(licensed.flatMap((member) => member.eligibleStates ?? []));
  const stuckStates = stats?.sampleStates && reachKnown
    ? Object.entries(stats.sampleStates).filter(([state]) => state && !reach.has(state)).sort((a, b) => b[1] - a[1]).map(([state]) => state)
    : null;
  const stuckNoState = stats?.sampleStates && reachKnown ? (stats.sampleStates[""] ?? 0) > 0 : false;

  function editMember(member: AssignmentMember) {
    setDetailsFor(member.id);
    setEditingMember(member.id);
    setMemberError(null);
    setMemberForm({ capacity: String(member.capacity), languages: member.languages.join(", "), weekdayOff: member.weekdayOff === null ? "" : String(member.weekdayOff) });
  }

  /** Opens a person's capacity editor and puts the cursor in it (the fix for "everyone full"). */
  function raiseCapacity(member: AssignmentMember) {
    setSide("people");
    editMember(member);
    // Two frames: the People tab mounts first, then its editor.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const input = document.getElementById(`cap-${member.id}`) as HTMLInputElement | null;
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
      input?.select();
    }));
  }

  /** The page's one Refresh: the rules and people, the next-up preview, the strip's figures and the agency's pool. */
  function refreshAll() {
    void refresh().catch(() => undefined);
    setPoolKey((key) => key + 1);
    setStatsKey((key) => key + 1);
  }

  /** Opens Edit rules, with one rule's editor open when a row or a fix names it. */
  function openRule(key: string | null) {
    setRulesOpen(true);
    if (key) setOpenKey(key);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (key) document.getElementById(`rule-editor-${key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
  }

  function addRule() {
    setRulesOpen(true);
    addCondition();
  }

  function discard() {
    adopt(workspace!);
    setOpenKey(null);
  }

  /** Takes the people who can no longer take leads off every rule; Publish rules makes it live. */
  function dropDeadAssignees() {
    setDrafts((current) => current.map((draft) => {
      const dead = deadAssignees(draft);
      return dead.length ? { ...draft, assigneeIds: draft.assigneeIds.filter((id) => !dead.includes(id)) } : draft;
    }));
  }

  /** "Everyone else, in turn by …": the fallback rule's strategy, or a new fallback for the whole roster. */
  function pickEveryoneElse(strategy: RuleStrategy) {
    if (fallback) { updateDraft(fallback.key, { strategy }); return; }
    if (strategy === "round_robin") return;
    newFallback.current += 1;
    setDrafts((current) => pinFallbacks([...current, { key: `fallback-${newFallback.current}`, matchType: "fallback", seconds: "60", listText: "", campaignIds: [], licensedOnly: false, assigneeIds: [], strategy, conditions: [] }]));
  }

  function removeDraft(key: string) {
    setDrafts((current) => current.filter((item) => item.key !== key));
    if (openKey === key) setOpenKey(null);
  }

  /** The household and posted-lead settings: in Edit rules, below the chain. */
  function openSettings() {
    setRulesOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (canManage) openRestEditor(); else restCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }));
  }

  /**
   * "Hand out N now": the page's existing hand-out (POST assign, the router picks the next pool lead it
   * can place and who gets it), once per lead until N have gone, the router says nobody can take the
   * next one, or Stop. One summary at the end instead of a toast per lead.
   */
  async function handOut(limit: number) {
    stopHanding.current = false;
    setHanding(0);
    let given = 0;
    let stopped: string | null = null;
    while (given < limit && !stopHanding.current) {
      const response = await fetch("/api/app/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign" }) }).catch(() => null);
      const body = response ? await response.json().catch(() => null) : null;
      if (!response?.ok) { stopped = typeof body?.error === "string" ? body.error : "Could not hand out the next lead."; break; }
      if (body?.sticky) { stopped = typeof body.reason === "string" ? body.reason : "The next lead is mid-conversation and stayed with its owner."; break; }
      given += 1;
      setHanding(given);
    }
    setHanding(null);
    if (given) notify.done(`${given.toLocaleString()} lead${given === 1 ? "" : "s"} handed out`, stopped || stopHanding.current ? { detail: stopped ? `Stopped: ${stopped}` : "Stopped." } : undefined);
    else if (stopped) notify.fail(stopped);
    refreshAll();
  }

  const nobodyWhy = firstNobody
    ? `${nobodyCount === 1 ? "One of the next pool leads goes to nobody" : `${nobodyCount} of the next ${previewRows.length} pool leads go to nobody`}. ${firstNobody.name}, ${firstNobody.state ? stateName(firstNobody.state) : "no state"}: ${firstNobody.licence_reason ?? nobodySentence(firstNobody.detail)}${firstNobody.detail?.requires_licensed && setters.length > 0 ? " It needs a licensed agent, so no setter can take it either." : ""}`
    : "";

  /* ── the one thing to do next (owner 2026-10-29), each problem with its fix ── */
  const seeThem = side === "pool" ? null : <button type="button" className={linkAction} onClick={() => { setSide("pool"); requestAnimationFrame(() => requestAnimationFrame(() => firstNobodyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))); }}>See {nobodyCount === 1 ? "it" : "them"}</button>;
  const fullest = [...fullPeople].sort((a, b) => b.currentOpen - b.capacity - (a.currentOpen - a.capacity))[0] ?? null;

  /** "1 next pool lead goes" / "3 of the next 5 pool leads go", the count in bold. */
  const nobodyCountText = nobodyCount === 1
    ? <><strong>1</strong> next pool lead goes</>
    : <><strong>{nobodyCount}</strong> of the next {previewRows.length} pool leads go</>;
  const whySr = nobodyWhy ? <span className="sr-only"> {nobodyWhy}</span> : null;

  /** A nobody in the next-up preview, as its sentence and its fix (PreviewWhy's causes). */
  function nobodyMove(row: PreviewRow): NextMove {
    const cause = nobodyCause(row);
    const where = row.state ? stateName(row.state) : "no state";
    if (cause === "no_state") return { tone: "danger", text: <>{nobodyCountText} to nobody: {row.name} has no state, so no licence can match.{whySr}</>, more: seeThem, action: <Button asChild><Link href={`/app/leads/${row.lead_id}`}>Add the state</Link></Button> };
    if (cause === "licence") {
      // The gate says which half is missing: the agency's carrier appointment, or an agent's licence.
      const appointment = /appointment/i.test(row.licence_reason ?? "");
      const st = row.state ? `${row.state} ` : "";
      return {
        tone: "danger",
        text: <>{nobodyCountText} to nobody: no one can sell in {where}.{whySr}</>,
        more: seeThem,
        action: <Button asChild><Link href={appointment ? APPOINTMENTS_HREF : addLicenceHref(row.state ?? undefined)}>{appointment ? `Add ${st}appointment` : `Add ${st}licence`}</Link></Button>,
      };
    }
    if (cause === "full" && fullest) return { tone: "warning", text: <>{nobodyCountText} to nobody: everyone who could take them is full.{whySr}</>, more: seeThem, action: <Button type="button" onClick={() => raiseCapacity(fullest)}>Raise their limits</Button> };
    if (cause === "no_one") {
      const rule = row.rule_id ? drafts.find((draft) => draft.id === row.rule_id) : null;
      const target = rule ?? fallback;
      return { tone: "warning", text: <>{nobodyCountText} to nobody: the rule {target ? "it matches" : "chain"} has nobody active on it.{whySr}</>, more: seeThem, action: target ? <Button type="button" onClick={() => openRule(target.key)}>Edit {target.matchType === "fallback" ? "everyone else" : `rule ${drafts.indexOf(target) + 1}`}</Button> : <Button type="button" onClick={addRule}>Add a rule</Button> };
    }
    if (cause === "household") return { tone: "warning", text: <>{nobodyCountText} to nobody: another agent holds the household, or it is resting.{whySr}</>, more: seeThem, action: <Button type="button" onClick={openSettings}>Household rules</Button> };
    return { tone: "warning", text: <>{nobodyCountText} to nobody. {nobodySentence(row.detail)}{whySr}</>, more: seeThem };
  }

  /* ── what can't go to anyone (was the bottom strip): where they are, and the licence that fixes it ── */
  const stuckShown = (stuckStates ?? []).slice(0, 3);
  const stuckMore = (stuckStates?.length ?? 0) > stuckShown.length;
  const stuckWhere = stuckShown.length
    ? `nobody can sell in ${stuckShown.join(", ")}${stuckMore ? " and more" : ""}${stuckNoState ? ", and some have no state" : ""}`
    : stuckNoState
      ? "they have no state, so no licence can match"
      : "nobody on the team can write their state";
  // The gate names the agency's missing carrier appointment when that is the half that is missing.
  const appointmentGap = firstNobody !== null && nobodyCause(firstNobody) === "licence" && /appointment/i.test(firstNobody.licence_reason ?? "");
  const cantGoMove = (count: number): NextMove => ({
    tone: "danger",
    text: <><strong>{count.toLocaleString()}</strong> lead{count === 1 ? "" : "s"} can’t go to anyone: {stuckWhere}.</>,
    action: appointmentGap
      ? <Button asChild><Link href={APPOINTMENTS_HREF}>{`Add ${firstNobody?.state ? `${firstNobody.state} ` : "an "}appointment`}</Link></Button>
      : <Button asChild><Link href={addLicenceHref(stuckShown.length === 1 ? stuckShown[0] : undefined)}>{stuckShown.length === 1 ? `Add ${article(stuckShown[0])} ${stuckShown[0]} licence` : "Add a licence"}</Link></Button>,
    // More than one state: the button adds any, and each state keeps its own link.
    more: (stuckShown.length > 1 || seeThem) ? (
      <span className="inline-flex flex-wrap gap-x-3">
        {stuckShown.length > 1 && !appointmentGap && stuckShown.map((state) => <Link key={state} href={addLicenceHref(state)} className={linkAction}>Add {article(state)} {state} licence →</Link>)}
        {seeThem}
      </span>
    ) : null,
  });

  /*
   * ── Next up (owner 2026-10-30): the one thing to do, ranked — what blocks work first, then what waits
   * on a person, then the normal next step. Its button is the page's only primary.
   */
  const bulk = canManage && handOutCount !== null;
  const handOutN = Math.min(handOutCount ?? 0, HAND_OUT_CAP);
  let move: NextMove;
  if (!members.length) {
    move = { tone: "danger", text: "Nobody can take leads yet.", action: <Button asChild><Link href={LICENCES_HREF}>Invite a teammate</Link></Button> };
  } else if (canManage && cantGo !== null && cantGo > 0) {
    move = cantGoMove(cantGo);
  } else if (canManage && firstNobody && (nobodyCause(firstNobody) === "licence" || nobodyCause(firstNobody) === "no_state")) {
    move = nobodyMove(firstNobody);
  } else if (canManage && dirty) {
    move = firstProblem >= 0
      ? { tone: "warning", text: <>Rule {drafts[firstProblem].matchType === "fallback" ? "“everyone else”" : firstProblem + 1} needs a fix before the rules can go live{problems[firstProblem] ? `: ${problems[firstProblem]}` : "."}</>, action: <><Button type="button" variant="ghost" disabled={busy === "publish"} onClick={discard}>Discard</Button><Button type="button" onClick={() => openRule(drafts[firstProblem].key)}>Fix it</Button></> }
      : { tone: "warning", text: "Your rule changes aren’t live yet. Publish them and they apply from the next assignment.", action: <><Button type="button" variant="ghost" disabled={busy === "publish"} onClick={discard}>Discard</Button><Button type="button" disabled={busy === "publish"} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish rules"}<span className="sr-only"> (unpublished changes)</span></Button></> };
  } else if (canManage && deadRuleIndex >= 0) {
    const draft = drafts[deadRuleIndex];
    const names = deadAssignees(draft).map((id) => shortName(memberById.get(id)?.name ?? "someone no longer on the team"));
    move = { tone: "warning", text: `${draft.matchType === "fallback" ? "Everyone else" : `Rule ${deadRuleIndex + 1}`} still names ${names.join(", ")}, who can’t take leads${nobodyActive(draft) ? ", so its leads fall through" : ""}.`, more: <button type="button" className={linkAction} onClick={() => openRule(draft.key)}>Open the rule</button>, action: <Button type="button" onClick={dropDeadAssignees}>Take {names.length === 1 ? "them" : "them all"} off</Button> };
  } else if (canManage && working.length > 0 && fullPeople.length === working.length && fullest) {
    move = { tone: "warning", text: working.length === 1 ? <><strong>{working[0].name}</strong> is full, so nobody gets new leads.</> : <>All <strong>{working.length}</strong> people are full, so nobody gets new leads.</>, action: <Button type="button" onClick={() => raiseCapacity(fullest)}>Raise their limits</Button> };
  } else if (canManage && firstNobody) {
    move = nobodyMove(firstNobody);
  } else if (canManage && inactiveHolding.length > 0) {
    const member = inactiveHolding[0];
    move = { tone: "warning", text: <>{member.name} is inactive and still holds <strong>{member.currentOpen.toLocaleString()}</strong> open lead{member.currentOpen === 1 ? "" : "s"}.</>, action: <Button type="button" onClick={() => setReassignOpen(true)}>Reassign a lead</Button> };
  } else if (bulk ? handOutN > 0 : waitingCount !== 0) {
    // The normal next step: hand out what waits. The hand-out button moves here from the corner.
    move = {
      tone: "action",
      handOut: true,
      text: bulk
        ? <><strong>{(waitingCount ?? 0).toLocaleString()}</strong> waiting · hand out {handOutN.toLocaleString()} now{handOutN < (waitingCount ?? 0) ? (handOutN === handOutCount ? ", all the room the team has" : `, ${HAND_OUT_CAP.toLocaleString()} at a time`) : ""}.</>
        : waitingLabel !== null
          ? <><strong>{waitingLabel.toLocaleString()}</strong> waiting · hand out the next one.</>
          : "Hand out the next lead in the pool.",
    };
  } else if (canManage && workspace.settings.auto_route_posted && !workspace.rules.some((rule) => rule.is_active && rule.match_type === "realtime")) {
    move = { tone: "action", text: "Posted leads are routed on arrival, but no real-time rule says who gets them, so they go to the whole roster.", action: <Button type="button" onClick={addRule}>Add a rule</Button> };
  } else if (waitingCount !== null && waitingCount > 0) {
    // Leads wait but nobody working has room or can take them (everyone inactive, say).
    move = { tone: "warning", text: <><strong>{waitingCount.toLocaleString()}</strong> waiting, but nobody on the team can take them now.</>, action: <Button asChild><Link href={LICENCES_HREF}>Check the team</Link></Button> };
  } else {
    move = { tone: "done", text: "Nothing is waiting in the pool.", more: canManage ? <Link href="/app/import" className={linkAction}>Import a list →</Link> : null };
  }
  const handOutIsNext = move.handOut === true;

  /* ── the hand-out control: Next up's primary when it is the next step, otherwise outline in the corner ── */
  const handOutLabel = !bulk ? "Hand out the next lead" : handOutCount === 0 ? "Nothing to hand out" : `Hand out ${handOutN.toLocaleString()} now`;
  const handOutControl = (primary: boolean) => handing !== null ? (
    <>
      <Button type="button" variant="outline" onClick={() => { stopHanding.current = true; }}>Stop</Button>
      <Button type="button" variant={primary ? "default" : "outline"} disabled aria-live="polite">Handing out… {handing.toLocaleString()}</Button>
    </>
  ) : (
    <Button
      data-guide="assignments-assign"
      type="button"
      variant={primary ? "default" : "outline"}
      disabled={busy === "action" || (bulk && handOutCount === 0)}
      title={bulk ? "Each lead goes through the rules, one at a time, to someone licensed with room. Stop at any time." : undefined}
      onClick={() => { if (bulk) void handOut(handOutN); else void post({ action: "assign" }, "Next eligible lead assigned"); }}
    >{busy === "action" ? "Handing out…" : handOutLabel}</Button>
  );

  const nextUp = (
    <NextUp tone={move.tone} action={handOutIsNext ? handOutControl(true) : move.action ?? null} more={move.more ?? null}>{move.text}</NextUp>
  );

  /* ── the corner: Refresh, Edit rules, and the hand-out (outline) when Next up is something else ── */
  const corner = (
    <>
      <RefreshButton onClick={refreshAll} refreshing={preview.loading} />
      <Button type="button" variant="outline" onClick={() => openRule(null)}>{canManage ? "Edit rules" : "View rules"}</Button>
      {!handOutIsNext && handOutControl(false)}
    </>
  );

  const insightsLine = workspace.insights
    ? [`${workspace.insights.autoRouted.toLocaleString()} routed on arrival since ${sinceLabel}`, (workspace.insights.unlicensedLeads ?? 0) > 0 ? `${(workspace.insights.unlicensedLeads ?? 0).toLocaleString()} pool leads match no licensed agent` : null].filter(Boolean).join(" · ")
    : null;

  const restDays = workspace.settings.rest_days;
  const facts = [
    restDays > 0 ? `Rest ${restDays} day${restDays === 1 ? "" : "s"} before a new owner calls a household` : "No rest between owners of a household",
    "Mid-conversation leads stay with their agent",
    "Leads of someone inactive go back to the pool",
    "Reassigning asks for a reason",
    workspace.settings.attempts_before_rotate ? `Moves on after ${workspace.settings.attempts_before_rotate} unanswered calls` : null,
    workspace.settings.auto_route_posted ? "Posted leads are routed on arrival" : null,
  ].filter((fact): fact is string => Boolean(fact));
  const attempts = workspace.settings.attempts_before_rotate;

  /** A nobody row's own fix, beside it in Next up. */
  function rowFix(row: PreviewRow): ReactNode {
    if (!canManage || row.outcome !== "nobody") return null;
    const cause = nobodyCause(row);
    if (cause === "licence") {
      const appointment = /appointment/i.test(row.licence_reason ?? "");
      return <Link href={appointment ? APPOINTMENTS_HREF : LICENCES_HREF} className={linkAction}>{appointment ? "Add appointment" : "Add licence"}</Link>;
    }
    if (cause === "no_state") return <Link href={`/app/leads/${row.lead_id}`} className={linkAction}>Add state</Link>;
    if (cause === "full" && fullest) return <button type="button" className={linkAction} onClick={() => raiseCapacity(fullest)}>Raise capacity</button>;
    if (cause === "no_one" && fallback) return <button type="button" className={linkAction} onClick={() => openRule(fallback.key)}>Edit rule</button>;
    if (cause === "household") return <button type="button" className={linkAction} onClick={openSettings}>Rules</button>;
    return null;
  }

  const editor = (draft: RuleDraft, index: number) => (
    <RuleEditor
      draft={draft}
      index={index}
      total={conditionCount}
      members={members}
      campaigns={filteredCampaigns}
      allCampaigns={workspace.campaigns}
      routerSchema={workspace.routerSchema}
      campaignCount={workspace.campaigns.length}
      campaignFilter={campaignFilter}
      onCampaignFilter={setCampaignFilter}
      problem={problems[index]}
      canManage={canManage}
      boardSchema={workspace.boardSchema}
      onChange={(next) => updateDraft(draft.key, next)}
      onMove={(delta) => moveDraft(draft.key, delta)}
      onClose={() => setOpenKey(null)}
    />
  );

  const editLink = (draft: RuleDraft, label: string) => {
    const open = openKey === draft.key;
    return (
      <button
        type="button"
        className={linkAction}
        onClick={() => setOpenKey(open ? null : draft.key)}
        aria-expanded={open}
        aria-controls={`rule-editor-${draft.key}`}
        aria-label={`${open ? "Close" : canManage ? "Edit" : "View"} ${label}`}
      >{open ? "Close" : canManage ? "Edit" : "View"}</button>
    );
  };

  const liveChip = dirty
    ? <StatusChip tone={pillTone("warning")} dot>Not published</StatusChip>
    : <StatusChip tone="good" dot={false}><Check className="size-3.5" aria-hidden="true" />Live</StatusChip>;

  /* ── left card: the chain in order, one line each; a row opens it in Edit rules ── */
  const ruleNumber = "grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold tabular-nums text-[var(--ink)]";
  const ruleRow = cn(cardInset, "flex w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]");
  const rulesCard = (
    <section aria-labelledby="route-rules-title" className={cn(cardSurface, "flex min-w-0 flex-col gap-2 p-4 lg:min-h-0")}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="route-rules-title" className={sectionLabel}>Rules, first match wins</h2>
        {canManage && liveChip}
      </div>
      <ol aria-labelledby="route-rules-title" className="m-0 flex min-w-0 list-none flex-col gap-1.5 p-0 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        {drafts.map((draft, index) => {
          if (draft.matchType === "fallback") return null;
          const routed = routedFor(draft.id);
          const skipLine = ruleSkipLine(draft.id);
          const how = draft.strategy === "round_robin" ? "" : `, ${STRATEGY_PHRASE[draft.strategy]}`;
          const flag = problems[index] ? "needs a fix" : deadAssignees(draft).length > 0 ? (nobodyActive(draft) ? "nobody active" : "names someone inactive") : null;
          const week = !draft.id ? "not published" : routed === null ? null : `${routed.toLocaleString()} this week`;
          return (
            <li key={draft.key} className="min-w-0">
              <button type="button" className={ruleRow} onClick={() => openRule(draft.key)} title={[week, skipLine ? `this week: ${skipLine}` : null].filter(Boolean).join(" · ") || undefined} aria-label={`Rule ${index + 1}: ${MATCH_LABEL[draft.matchType]} ${valueChip(draft)}, to ${assigneeSummary(draft.assigneeIds)}${how}. ${canManage ? "Edit" : "View"}`}>
                <span className={ruleNumber}>{index + 1}</span>
                <strong className="w-[110px] shrink-0 truncate font-semibold text-[var(--ink)]">{MATCH_LABEL[draft.matchType]}</strong>
                <span className="line-clamp-2 min-w-0 flex-1 break-words text-[var(--ink)]" title={valueChip(draft)}>{valueChip(draft)}</span>
                {flag && <StatusChip dot={false} tone={pillTone("warning")}>{flag}</StatusChip>}
                <span className="line-clamp-2 min-w-0 max-w-[40%] shrink break-words text-xs text-[var(--body)]" title={`${assigneeSummary(draft.assigneeIds)}${how}`}>{assigneeSummary(draft.assigneeIds)}{how}</span>
              </button>
            </li>
          );
        })}
        {/* The fallback, always last: everyone else, how they are picked, and who. */}
        <li className="min-w-0">
          <button type="button" className={ruleRow} onClick={() => openRule(fallback?.key ?? null)} aria-label={`Rule ${conditionCount + 1}: everyone else, ${STRATEGY_CHIP[everyoneElse]}, to ${fallback ? assigneeSummary(fallback.assigneeIds) : "the whole roster"}. ${canManage ? "Edit" : "View"}`}>
            <span className={ruleNumber}>{conditionCount + 1}</span>
            <strong className="w-[110px] shrink-0 truncate font-semibold text-[var(--ink)]">Everyone else</strong>
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-[var(--ink)]">{STRATEGY_CHIP[everyoneElse]}</span>
            {fallback && (problems[fallbackIndex] || nobodyActive(fallback)) && <StatusChip dot={false} tone={pillTone("warning")}>{problems[fallbackIndex] ? "needs a fix" : "nobody active"}</StatusChip>}
            <span className="line-clamp-2 min-w-0 max-w-[40%] shrink break-words text-xs text-[var(--body)]" title={fallback ? assigneeSummary(fallback.assigneeIds) : "the whole roster"}>{fallback ? assigneeSummary(fallback.assigneeIds) : "the whole roster"}</span>
          </button>
        </li>
      </ol>
      <p className="m-0 text-xs leading-[1.5] text-[var(--body)]">Licensing sits above every rule: nobody gets a state they can’t write.</p>
    </section>
  );

  /* ── Edit rules: the whole chain editor ── */
  const rulesEditor = (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Above every rule, never removable: the licence gate and the ceiling — one chip, the rest behind the tip. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[var(--body)]">
        <StatusChip dot={false} tone="info" title={topCapacitySkip ? `The ceiling skipped ${shortName(memberById.get(topCapacitySkip.user_id)?.name ?? "someone")} ${topCapacitySkip.leads}× this week` : "Always enforced; cannot be removed"}>
          <span className="inline-flex" aria-hidden="true"><LockIcon /></span>Licensed only · max {ceilingChip}
        </StatusChip>
        <InfoTip label="About the rules every lead passes">An agent only gets leads in states they may sell in, and never more than their ceiling of open leads. Setters can get any lead that does not need a licence. The rules below run top to bottom; the first that matches wins.</InfoTip>
        {insightsLine && <span className="min-w-0 truncate" title={insightsLine}>{insightsLine}</span>}
      </div>
      {publishError && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{publishError}</p>}

      <p className="sr-only" aria-live="polite">{moveNotice}</p>
      <ol aria-label="Rules, first match wins" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {drafts.map((draft, index) => {
          if (draft.matchType === "fallback") return null;
          const open = openKey === draft.key;
          const routed = routedFor(draft.id);
          const problem = problems[index];
          const skipLine = ruleSkipLine(draft.id);
          const how = draft.strategy === "round_robin" ? "" : ` · ${STRATEGY_PHRASE[draft.strategy]}`;
          const dead = deadAssignees(draft).length > 0;
          return (
            <li
              key={draft.key}
              className={cn(cardInset, "min-w-0", dragKey === draft.key && "opacity-60", open && "border-[var(--primary)]")}
              draggable={canManage && !open}
              onDragStart={() => setDragKey(draft.key)}
              onDragOver={(event) => { if (dragKey) event.preventDefault(); }}
              onDrop={() => dropOn(draft.key)}
              onDragEnd={() => setDragKey(null)}
            >
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-alt)] text-xs font-bold text-[var(--ink)]">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <strong className="line-clamp-2 break-words text-sm font-semibold text-[var(--ink)]" title={`${MATCH_LABEL[draft.matchType]} · ${valueChip(draft)}`}>{MATCH_LABEL[draft.matchType]} · {valueChip(draft)}</strong>
                  <span className="line-clamp-2 break-words text-xs text-[var(--body)]" title={`→ ${assigneeSummary(draft.assigneeIds)}${how}${skipLine ? ` · this week: ${skipLine}` : ""}`}>→ {assigneeSummary(draft.assigneeIds)}{how}{skipLine ? ` · this week: ${skipLine}` : ""}</span>
                </span>
                {problem && <StatusChip dot={false} tone={pillTone("warning")}>needs a fix</StatusChip>}
                {!problem && dead && <StatusChip dot={false} tone={pillTone("warning")}>{nobodyActive(draft) ? "nobody active" : "names someone inactive"}</StatusChip>}
                <span className="shrink-0 text-xs text-[var(--body)]" title={workspace.insights ? `Since ${sinceLabel}, 00:00 UTC` : undefined}>
                  {!draft.id ? "not published" : routed === null ? "" : `${routed.toLocaleString()} this week`}
                </span>
                {editLink(draft, `rule ${index + 1}`)}
                {canManage && <button type="button" className="border-0 bg-transparent px-1 text-base leading-none text-[var(--muted)] hover:text-[var(--error-ink)]" aria-label={`Remove rule ${index + 1}`} onClick={() => removeDraft(draft.key)}>&times;</button>}
                {canManage && (
                  <button
                    id={`rule-handle-${draft.key}`}
                    type="button"
                    className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                    aria-label={`Rule ${index + 1}. Drag, or press the up and down arrow keys, to reorder`}
                    title="Drag to reorder"
                    // Pressing the handle takes focus, so the arrow keys reorder straight after a
                    // click as well as after Tab. The drag itself belongs to the row.
                    onPointerDown={(event) => event.currentTarget.focus()}
                    onKeyDown={(event) => handleKeys(event, draft.key)}
                  ><GripVertical className="size-4" aria-hidden="true" /></button>
                )}
              </div>
              {open && editor(draft, index)}
            </li>
          );
        })}
      </ol>
      {conditionCount === 0 && (
        <div className={cn(cardInset, "flex items-center justify-between gap-3 px-3 py-2 text-sm text-[var(--body)]")}>
          <span>No rules yet: every lead goes to everyone, in turn.</span>
        </div>
      )}

      {/* The fallback, pinned last: everyone else, and how they are picked. */}
      <div className="flex min-w-0 flex-col gap-1.5 pt-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-[var(--body)]">Everyone else, in turn by</span>
          <span role="radiogroup" aria-label="How everyone else is picked" className="flex flex-wrap gap-1.5">
            {RULE_STRATEGIES.map((strategy) => (
              <ToggleChip
                key={strategy}
                role="radio"
                selected={everyoneElse === strategy}
                disabled={!canManage || (!workspace.routerSchema && strategy !== "round_robin")}
                onClick={() => pickEveryoneElse(strategy)}
              >{STRATEGY_CHIP[strategy]}</ToggleChip>
            ))}
          </span>
        </div>
        {fallback && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--body)]">
            <span className="min-w-0 flex-1">→ {assigneeSummary(fallback.assigneeIds)}{problems[fallbackIndex] ? " · needs a fix" : nobodyActive(fallback) ? " · nobody active" : ""}</span>
            <span title={workspace.insights ? `Since ${sinceLabel}, 00:00 UTC` : undefined}>{!fallback.id ? "not published" : routedFor(fallback.id) === null ? "" : `${(routedFor(fallback.id) ?? 0).toLocaleString()} this week`}</span>
            {editLink(fallback, "everyone else")}
            {canManage && <button type="button" className="border-0 bg-transparent px-1 text-base leading-none text-[var(--muted)] hover:text-[var(--error-ink)]" aria-label="Remove the everyone-else rule" onClick={() => removeDraft(fallback.key)}>&times;</button>}
          </div>
        )}
        {fallback && ruleSkipLine(fallback.id) && <p className="m-0 text-xs leading-[1.5] text-[var(--body)]">This week: {ruleSkipLine(fallback.id)}</p>}
        {fallback && openKey === fallback.key && <div className={cn(cardInset, "overflow-hidden")}>{editor(fallback, fallbackIndex)}</div>}
      </div>

      {inactiveRules.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-[var(--body)]">{inactiveRules.length} inactive rule{inactiveRules.length === 1 ? "" : "s"}</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {inactiveRules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3">
                <span className="text-[var(--body)]"><strong className="font-semibold text-[var(--ink)]">{MATCH_LABEL[rule.match_type] ?? rule.match_type}</strong> <span className="text-[var(--muted)]">{MATCH_OPERATOR[rule.match_type] ?? ""}</span> {valueChip(draftFromRule(rule))}</span>
                {canManage && <Button type="button" variant="outline" size="sm" onClick={() => restore(rule)}>Restore</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {fallbackMoved && canManage && (
        <p className="m-0 flex items-center gap-0.5 text-xs leading-[1.5] text-[var(--warning-ink)]">
          Publish to move the fallback rule last.
          <InfoTip label="About the fallback rule">The published fallback sits above other rules, so they only see the leads it cannot place. It is shown last here.</InfoTip>
        </p>
      )}
    </div>
  );

  /* ── Edit rules: household and posted leads (was a dialog off the rules card) ── */
  const householdSection = (
    <section aria-labelledby="route-household-title" className="flex min-w-0 flex-col gap-4 border-t border-[var(--border)] pt-4">
      <h3 id="route-household-title" className={sectionLabel}>Household and posted leads</h3>
      {/* The settings as one icon row, the facts behind its tip. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--body)]">
        <span className="inline-flex items-center gap-1" title="Rest between owners of a household"><House className="size-3.5 text-[var(--muted)]" aria-hidden="true" />{restDays > 0 ? `Rest ${restDays} day${restDays === 1 ? "" : "s"}` : "No household rest"}</span>
        <span className="inline-flex items-center gap-1" title="Unanswered calls before the lead moves on"><RotateCw className="size-3.5 text-[var(--muted)]" aria-hidden="true" />{attempts ? `Rotate after ${attempts}` : "No rotation"}</span>
        <span className="inline-flex items-center gap-1" title="Posted leads"><Radio className="size-3.5 text-[var(--muted)]" aria-hidden="true" />{workspace.settings.auto_route_posted ? "Posted: routed on arrival" : "Posted: wait in the pool"}</span>
        <InfoTip label="Household rules">{facts.join(". ")}.</InfoTip>
      </div>
      <ul aria-label="Household rules" className="m-0 grid list-none gap-1.5 p-0 text-xs leading-[1.5] text-[var(--body)] sm:grid-cols-2">
        {facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
      <div ref={restCardRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Household rest days</h4>
        {canManage && editingRest ? (
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
            {!workspace.boardSchema && <p className="m-0 text-xs text-[var(--body)]">{SCHEMA_PENDING_MESSAGE} Rest between owners can still be changed.</p>}
            {restError && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{restError}</p>}
            <div className="flex justify-end gap-2.5">
              <Button type="button" variant="ghost" size="sm" disabled={busy === "settings"} onClick={() => setEditingRest(false)}>Cancel</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy === "settings"} onClick={() => void saveRest()}>{busy === "settings" ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <KeyValues
              cols={2}
              items={[
                { label: "Rest between owners", value: restDays > 0 ? `${restDays} day${restDays === 1 ? "" : "s"}` : "Off" },
                { label: "Attempts before rotate", value: workspace.settings.attempts_before_rotate ? String(workspace.settings.attempts_before_rotate) : "Off" },
                { label: "Same household", value: workspace.boardSchema ? "one agent at a time" : "not enforced yet" },
              ]}
            />
            {canManage && <Button type="button" variant="outline" size="sm" onClick={openRestEditor}>Edit</Button>}
          </div>
        )}
      </div>

      {/* ── routing on arrival (concept board: real-time leads go straight to someone) ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Posted leads</h4>
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!workspace.routerSchema || busy === "auto-route"}
              aria-describedby={!workspace.routerSchema ? "auto-route-pending" : undefined}
              onClick={() => void saveAutoRoute(!workspace.settings.auto_route_posted)}
            >
              {busy === "auto-route" ? "Saving…" : workspace.settings.auto_route_posted ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
        <KeyValues
          cols={2}
          items={[
            { label: "Route on arrival", value: workspace.settings.auto_route_posted ? "On" : "Off" },
            { label: "Real-time rules", value: realtimeRulesLabel(workspace.rules), tone: workspace.settings.auto_route_posted && !workspace.rules.some((rule) => rule.is_active && rule.match_type === "realtime") ? "warning" : undefined },
            ...(workspace.insights ? [{ label: "Routed on arrival this week", value: workspace.insights.autoRouted.toLocaleString() }] : []),
          ]}
        />
        {!workspace.routerSchema && <p id="auto-route-pending" className="m-0 text-xs leading-[1.5] text-[var(--body)]">{SCHEMA_PENDING_MESSAGE}</p>}
      </div>
    </section>
  );

  /* ── right card, Who has room: a bar per person ── */
  // People with no state they can sell in (and no lapsing licence to say instead): said once when 2 or more.
  const noStatePeople = members.filter((member) => !isInactive(member) && member.role !== "setter" && member.eligibleStates !== null && member.eligibleStates.length === 0);
  const groupNoState = noStatePeople.length > 1;
  const peoplePanel = (
    <div role="tabpanel" id="route-side-people-panel" aria-labelledby="route-side-people" className={cn("flex min-w-0 flex-col gap-2 lg:min-h-0 lg:flex-1", side !== "people" && "hidden")}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--body)]">{working.length ? `${fullPeople.length ? `${fullPeople.length} of ${working.length} full` : "Everyone has room"} · open leads each can hold` : ""}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setReassignOpen(true)}>{canManage ? "Reassign a lead" : "Return a lead"}</Button>
      </div>
      {/* A reason several people share is said once here, not on every row (owner 2026-10-30). */}
      {groupNoState && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-[var(--warning-ink)]">
          <span><strong className="font-semibold">{noStatePeople.length} of {members.length}</strong> can sell in no state yet, so the rules pass them over.</span>
          {canManage && <Link href={LICENCES_HREF} className={linkAction}>Check licences →</Link>}
        </p>
      )}
      {members.length ? (
        <ul aria-label="Your team's room" className="m-0 flex list-none flex-col gap-1 p-0 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
          {members.map((member) => (
            <PersonRow
              key={member.id}
              member={member}
              canManage={canManage}
              open={detailsFor === member.id}
              editing={editingMember === member.id}
              onToggle={() => {
                if (detailsFor === member.id) { setDetailsFor(null); setEditingMember(null); }
                else if (canManage) editMember(member);
                else setDetailsFor(member.id);
              }}
              skipLine={personSkipLine(member.id)}
              warnings={warnable(member)}
              boardSchema={workspace.boardSchema}
              noStateShared={groupNoState}
            >
              {canManage && editingMember === member.id && (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-3">
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
                  {!workspace.boardSchema && <p className="m-0 text-xs text-[var(--body)]">{SCHEMA_PENDING_MESSAGE} Capacity can still be changed.</p>}
                  {memberError && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{memberError}</p>}
                  <div className="flex justify-end gap-2.5">
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingMember(null); setDetailsFor(null); }} disabled={busy === `member:${member.id}`}>Cancel</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void saveMember(member)} disabled={busy === `member:${member.id}`}>{busy === `member:${member.id}` ? "Saving…" : "Save"}</Button>
                  </div>
                </div>
              )}
            </PersonRow>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody can take leads yet" hint="Agents and setters appear here once they join." action={<Button asChild variant="outline"><Link href={LICENCES_HREF}>Invite a teammate</Link></Button>} />
      )}
    </div>
  );

  /* ── right card, Pool: where the next leads go (each nobody with its fix), and the agency's whole pool ── */
  const poolPanel = (
    <div role="tabpanel" id="route-side-pool-panel" aria-labelledby="route-side-pool" className={cn("flex min-w-0 flex-col gap-2 lg:min-h-0 lg:flex-1", side !== "pool" && "hidden")}>
      <div className="flex min-w-0 flex-col gap-2 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 id="route-next-title" className="m-0 text-xs font-semibold text-[var(--body)]">Next up</h3>
            {canManage && firstNobody && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--warning-ink)]" title={nobodyWhy}>
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                {nobodyCount} to nobody
                <span className="sr-only">. {nobodyWhy}</span>
              </span>
            )}
          </span>
          {previewRows.length > 0 && <StatusChip tone={pillTone(routedCount === previewRows.length ? "success" : "warning")} dot>{routedCount} of {previewRows.length} routed</StatusChip>}
        </div>
        <div aria-labelledby="route-next-title" className="min-w-0">
        {!canManage ? (
          <p className="m-0 text-sm text-[var(--body)]">Owners and producers see where the next pool leads would go.</p>
        ) : preview.loading && !preview.rows ? (
          <SectionLoading rows={2} columns={3} label="Loading the routing preview" />
        ) : preview.error ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-[var(--error-ink)]" role="alert">{preview.error}<Button type="button" size="sm" variant="outline" onClick={() => void loadPreview()}>Try again</Button></p>
        ) : preview.pending ? (
          <p className="m-0 text-sm text-[var(--body)]">{SCHEMA_PENDING_MESSAGE}</p>
        ) : !previewRows.length ? (
          <EmptyState title="Nothing waiting in the pool" hint="Import a list to fill it." action={<Button asChild type="button" variant="outline"><Link href="/app/import">Import a list</Link></Button>} />
        ) : (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {previewRows.map((row) => {
              const owner = row.owner_user_id ? memberById.get(row.owner_user_id) : undefined;
              const placed = row.outcome === "routed" || row.outcome === "taken";
              return (
                <li key={row.work_item_id} ref={row === firstNobody ? firstNobodyRef : undefined} className={cn(cardInset, "grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-1.5 text-sm")}>
                  <Link href={`/app/leads/${row.lead_id}`} className="truncate text-[var(--body)] hover:underline" title={row.outcome === "nobody" ? (row.licence_reason ?? nobodySentence(row.detail)) : undefined}>{row.name}{row.state ? ` · ${row.state}` : ""}</Link>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <strong className={cn("truncate font-semibold", placed ? "text-[var(--ink)]" : "text-[var(--warning-ink)]")}>→ {placed ? (owner ? shortName(owner.name) : "Someone") : "Nobody"}</strong>
                    <PreviewWhy row={row} ruleNumber={row.rule_id ? publishedOrder.get(row.rule_id) ?? null : null} memberName={(id) => shortName(memberById.get(id)?.name ?? "someone")} />
                  </span>
                  <span className="min-w-0 text-right">{rowFix(row)}</span>
                </li>
              );
            })}
          </ol>
        )}
        {canManage && dirty && previewRows.length > 0 && <p className="m-0 mt-1.5 text-xs text-[var(--body)]">The preview uses the published rules, not your unpublished changes.</p>}
        </div>

        {/* The agency's whole pool, oldest first, under the next-up preview. */}
        {pool && (
          <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border)] pt-2">
            <h3 className="m-0 text-xs font-semibold text-[var(--body)]">Everyone waiting, oldest first</h3>
            <UnassignedPool onCount={setPoolCount} bare refreshKey={poolKey} />
          </div>
        )}
      </div>
    </div>
  );

  const sideCard = (
    <section aria-label="Who has room and the pool" className={cn(cardSurface, "flex min-w-0 flex-col gap-2 px-4 pt-1 pb-4 lg:min-h-0")}>
      <UnderlineTabs
        label="Who has room and the pool"
        idPrefix="route-side"
        controls={(key) => `route-side-${key}-panel`}
        value={side}
        onChange={setSide}
        tabs={[
          { key: "people", label: "Who has room", count: fullPeople.length || null, tone: "danger", srSuffix: fullPeople.length ? `(${fullPeople.length} full)` : undefined },
          { key: "pool", label: "Pool", count: typeof waitingLabel === "number" ? waitingLabel : null },
        ]}
      />
      {peoplePanel}
      {poolPanel}
    </section>
  );

  const sheet = rulesOpen ? (
    <Sheet
      title={canManage ? "Edit rules" : "Rules"}
      subtitle="First match wins. Licensing sits above every rule."
      status={canManage ? liveChip : undefined}
      onClose={() => { setRulesOpen(false); setEditingRest(false); }}
      className="lg:w-[600px]"
      footer={canManage ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="mr-auto" onClick={addCondition}><PlusIcon />Add a rule</Button>
          {dirty && <Button type="button" variant="ghost" disabled={busy === "publish"} onClick={discard}>Discard</Button>}
          <Button type="button" disabled={!dirty || problems.some(Boolean) || busy === "publish"} onClick={() => void publish()}>{busy === "publish" ? "Publishing…" : "Publish rules"}</Button>
        </div>
      ) : undefined}
    >
      {rulesEditor}
      {householdSection}
    </Sheet>
  ) : null;

  return (
    <div ref={scopeRef} className="m-stagger flex w-full min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1">
      {/* The corner holds the step's own moves; Next up, first in the content, the one thing to do (2026-10-30). */}
      {inFrame
        ? <LeadsInSlot slot="continue">{corner}</LeadsInSlot>
        : <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{corner}</div>}
      {nextUp}

      {!workspace.boardSchema && (
        <p role="status" className="m-0 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2 text-sm text-[var(--warning-ink)]">
          Real-time rules, language pairing, rest days, rotation, routed counts and the preview need migration 20260924300000.
        </p>
      )}

      {/* Four figures, each read: a tile whose figure has no source is left off, never guessed. */}
      <StatStrip label="Route at a glance" className="shrink-0">
        {waitingLabel !== null && <StatTile label="Waiting for someone" value={typeof waitingLabel === "number" ? waitingLabel.toLocaleString() : waitingLabel} footnote={stats?.oldestDays === null || stats?.oldestDays === undefined ? undefined : stats.oldestDays === 0 ? "oldest today" : `oldest ${stats.oldestDays} day${stats.oldestDays === 1 ? "" : "s"}`} reserveFootnote />}
        {cantGo !== null && <StatTile label="Can’t go to anyone" value={cantGo.toLocaleString()} valueTone={cantGo > 0 ? "warning" : undefined} footnote="no licence in their state" />}
        {stats?.handedOutToday !== null && stats?.handedOutToday !== undefined && <StatTile label="Handed out today" labelTitle="Assigned or pulled to someone since 00:00 UTC." value={stats.handedOutToday.toLocaleString()} reserveFootnote />}
        <StatTile label="Room left on the team" labelTitle="Open leads the working team can still take before everyone is at their ceiling." value={roomLeft.toLocaleString()} reserveFootnote />
      </StatStrip>

      {/* Two cards side by side, each scrolling inside itself: the rules, and who has room. */}
      <div className="grid min-w-0 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.3fr_1fr] lg:grid-rows-[minmax(0,1fr)]">
        {rulesCard}
        {sideCard}
      </div>

      {sheet && createPortal(sheet, document.body)}

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

      {/* Unpublished rule changes stop a move away: publish them, drop them, or stay. */}
      <LeaveGuard dirty={canManage && dirty} scope={scopeRef} onSave={publish} onDiscard={discard} what="the routing rules" />
    </div>
  );
}

function realtimeRulesLabel(rules: { is_active: boolean; match_type: string }[]): string {
  const n = rules.filter((rule) => rule.is_active && rule.match_type === "realtime").length;
  return n ? `${n} published` : "None published";
}

/** One person: open leads against the ceiling, room left, and — opened — what keeps leads from them. */
function PersonRow({ member, canManage, open, editing, onToggle, skipLine, warnings, boardSchema, noStateShared = false, children }: { member: AssignmentMember; canManage: boolean; open: boolean; editing: boolean; onToggle: () => void; skipLine: string | null; warnings: LicenceExpiry[]; boardSchema: boolean; /** The list says "N can sell in no state yet" once above, so the row keeps a short status only. */ noStateShared?: boolean; children?: ReactNode }) {
  const inactive = isInactive(member);
  const full = member.currentOpen >= member.capacity;
  const room = Math.max(member.capacity - member.currentOpen, 0);
  const reach = member.role === "setter" ? "any state except term life" : member.eligibleStates === null ? "—" : `${member.eligibleStates.length} state${member.eligibleStates.length === 1 ? "" : "s"}`;
  const warning = warnings[0];
  const detailId = `person-${member.id}`;
  const noStatesAtAll = member.role !== "setter" && member.eligibleStates !== null && member.eligibleStates.length === 0;
  // Said once above the list when several share it; this row then only says "No state yet".
  const sharedNoState = noStatesAtAll && noStateShared && !inactive;
  const noStates = noStatesAtAll && !sharedNoState;
  // A full person's way out is more room, so the row says so.
  const toggleLabel = !canManage ? "Details" : full && !inactive ? "Raise" : "Edit";
  return (
    <li className={cn("min-w-0 rounded-lg", open && cardInset)}>
      {/* The board's two lines: name and room, then the bar (open leads against the ceiling). */}
      <div className="flex min-w-0 flex-col gap-1 px-2 py-1.5 text-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate" title={`${member.name} · ${roleLabel(member.role)}`}><span className="text-[var(--ink)]">{member.name}</span><span className="text-xs text-[var(--body)]"> · {roleLabel(member.role)}</span></span>
          <span className={cn("shrink-0 text-right text-xs tabular-nums", inactive || full || sharedNoState ? "text-[var(--warning-ink)]" : "text-[var(--ink)]")} title={`${member.currentOpen} open of ${member.capacity}`}>{inactive ? `Inactive${member.currentOpen ? ` · holds ${member.currentOpen}` : ""}` : full ? "Full · skipped" : sharedNoState ? `No state yet · ${room} room` : `${room} room`}</span>
          <button type="button" className={linkAction} aria-expanded={open} aria-controls={detailId} aria-label={`${open ? "Close" : toggleLabel === "Details" ? "Details for" : toggleLabel} ${member.name}${canManage ? "'s capacity, languages and rest day" : ""}`} onClick={onToggle}>{open ? "Close" : toggleLabel}</button>
        </div>
        <Meter value={member.currentOpen} max={Math.max(member.capacity, 1)} tone={inactive || full ? "warning" : "primary"} label={`${member.name}: ${member.currentOpen} of ${member.capacity} open leads`} />
      </div>
      {!open && (warning || noStates) && (
        <span className={cn("flex flex-wrap items-center gap-x-2 px-2 pb-1 text-xs", warning && daysUntil(warning.expiresOn) < 0 ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]")}>
          {warning
            ? `${daysUntil(warning.expiresOn) < 0 ? `${warning.state} licence lapsed ${shortDate(warning.expiresOn)}` : `${warning.state} licence lapses ${shortDate(warning.expiresOn)}`}${warning.openLeads ? ` · ${warning.openLeads} open lead${warning.openLeads === 1 ? "" : "s"} return to the pool` : ""}`
            : "Can sell in no state yet, so the rules pass them over"}
          {canManage && <Link href={LICENCES_HREF} className="font-semibold text-[var(--accent-ink)] hover:underline">{warning ? "Renew" : "Check licences"}</Link>}
        </span>
      )}
      {open && (
        <div id={detailId} className="flex flex-col gap-3 px-2 pb-3">
          <KeyValues
            cols={2}
            items={[
              { label: "Open", value: `${member.currentOpen} of ${member.capacity}` },
              { label: "Licensed", value: reach },
              { label: "Languages", value: member.languages.length ? member.languages.map(titleCase).join(", ") : boardSchema ? "None recorded" : "—" },
              { label: "Rest day", value: member.weekdayOff === null ? "Works every day" : WEEKDAY_NAMES[member.weekdayOff] },
            ]}
          />
          {skipLine && <span className="text-xs text-[var(--muted)]">{skipLine}</span>}
          {warnings.map((entry) => {
            const lapsed = daysUntil(entry.expiresOn) < 0;
            const leadsText = `${entry.openLeads.toLocaleString()} open ${entry.state} lead${entry.openLeads === 1 ? "" : "s"}`;
            return (
              <span key={entry.state} className={cn("text-xs", lapsed ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]")}>
                {lapsed
                  ? `${entry.state} licence lapsed ${shortDate(entry.expiresOn)} · ${leadsText} go back to the pool (never mid-call or with a booked callback)`
                  : `${entry.state} licence valid through ${shortDate(entry.expiresOn)}${entry.openLeads ? ` · ${leadsText} return to the pool on ${lapseDay(entry)}` : ""}`}
              </span>
            );
          })}
          {editing && children}
        </div>
      )}
    </li>
  );
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
  // Teammates who can take a lead: inactive logins are not offered, and the current owner is not a move.
  const targets = members.filter((member) => !isInactive(member) && member.id !== picked?.ownerUserId);
  const ready = giving ? Boolean(reassign.workItemId && reassign.targetUserId && reassign.reason.trim()) : Boolean(giveBack.workItemId && giveBack.reason.trim());
  // What is still missing, said beside the disabled button instead of leaving it silent.
  const missing = giving
    ? [!reassign.workItemId && "a lead", !reassign.targetUserId && "a teammate", !reassign.reason.trim() && "a reason"].filter(Boolean)
    : [!giveBack.workItemId && (canManage ? "a lead" : "the work item"), !giveBack.reason.trim() && "a reason"].filter(Boolean);
  const panel = (
    <DetailPanel
      mode="overlay"
      title={canManage ? "Reassign a lead" : "Return a lead to the pool"}
      subtitle="Licence, ceiling and household rules are checked"
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-end gap-2">
          {!ready && !busy && <span className="mr-auto text-xs text-[var(--muted)]">Add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}</span>}
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
          <button type="button" className={linkAction} onClick={() => { setPicked(null); reassign.setWorkItemId(""); giveBack.setWorkItemId(""); }}>Change</button>
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
              {targets.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}{member.currentOpen >= member.capacity ? " · full" : ""}</option>)}
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
