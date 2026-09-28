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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { Field, KeyValues, LockIcon, Pill, PlusIcon, SearchBox, SettingsCard, SettingsMeter, control, st } from "@/components/app/settings/primitives";
import {
  CONDITION_TYPES,
  LICENCE_WARNING_DAYS,
  MATCH_LABEL,
  MATCH_OPERATOR,
  MATCH_TYPES,
  MAX_EXTRA_CONDITIONS,
  RULE_STRATEGIES,
  SCHEMA_PENDING_MESSAGE,
  SKIP_REASON_LABEL,
  STRATEGY_LABEL,
  WEEKDAYS,
  WEEKDAY_NAMES,
  daysUntil,
  lapseDay,
  nobodySentence,
  shortDate,
  shortName,
  stateName,
  type AssignmentMember,
  type AssignmentRule,
  type AssignmentWorkspace as Workspace,
  type ConditionType,
  type LicenceExpiry,
  type MatchType,
  type PreviewRow,
  type RuleCondition,
  type RuleStrategy,
} from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";
import { weekdayDayMonth } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

/** One extra AND-condition on a rule, as the editor holds it. */
type ConditionDraft = {
  key: string;
  type: ConditionType;
  listText: string;
  campaignIds: string[];
  licensedOnly: boolean;
};

type RuleDraft = {
  key: string;
  id?: string;
  matchType: MatchType;
  seconds: string;
  listText: string;
  campaignIds: string[];
  licensedOnly: boolean;
  assigneeIds: string[];
  strategy: RuleStrategy;
  conditions: ConditionDraft[];
};

type PreviewState = { rows: PreviewRow[] | null; pending: boolean; loading: boolean; error: string | null };

function listOf(values: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = values[key];
    if (Array.isArray(value) && value.length) return value.map((item) => String(item));
  }
  return [];
}

function draftFromRule(rule: AssignmentRule): RuleDraft {
  const values = rule.match_values ?? {};
  const listText = rule.match_type === "language" ? listOf(values, "languages", "values").join(", ")
    : rule.match_type === "product" ? listOf(values, "products", "product_codes", "values").join(", ")
    : rule.match_type === "state" ? listOf(values, "states", "values").join(", ")
    : "";
  return {
    key: rule.id,
    id: rule.id,
    matchType: rule.match_type,
    seconds: typeof values.seconds === "number" ? String(values.seconds) : "60",
    listText,
    campaignIds: rule.match_type === "campaign" ? listOf(values, "campaign_ids", "values") : [],
    licensedOnly: values.licensed_only === true,
    assigneeIds: rule.assignee_ids ?? [],
    strategy: rule.strategy === "least_loaded" ? "least_loaded" : "round_robin",
    conditions: (rule.conditions ?? []).filter((condition) => CONDITION_TYPES.includes(condition.match_type)).map((condition, index) => conditionDraftFrom(condition, `${rule.id}-c${index}`)),
  };
}

function conditionDraftFrom(condition: RuleCondition, key: string): ConditionDraft {
  const values = condition.match_values ?? {};
  return {
    key,
    type: condition.match_type,
    listText: condition.match_type === "language" ? listOf(values, "languages", "values").join(", ")
      : condition.match_type === "product" ? listOf(values, "products", "product_codes", "values").join(", ")
      : condition.match_type === "state" ? listOf(values, "states", "values").join(", ")
      : "",
    campaignIds: condition.match_type === "campaign" ? listOf(values, "campaign_ids", "values") : [],
    licensedOnly: values.licensed_only === true,
  };
}

const splitList = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);

function conditionValuesOf(condition: ConditionDraft): RuleCondition {
  switch (condition.type) {
    case "language": return { match_type: "language", match_values: { languages: splitList(condition.listText).map((value) => value.toLowerCase()) } };
    case "product": return { match_type: "product", match_values: condition.licensedOnly ? { products: splitList(condition.listText).map((value) => value.toLowerCase()), licensed_only: true } : { products: splitList(condition.listText).map((value) => value.toLowerCase()) } };
    case "state": return { match_type: "state", match_values: { states: splitList(condition.listText).map((value) => value.toUpperCase()) } };
    default: return { match_type: "campaign", match_values: { campaign_ids: condition.campaignIds } };
  }
}

function conditionProblem(condition: ConditionDraft): string | null {
  switch (condition.type) {
    case "language": return splitList(condition.listText).length ? null : "Add at least one language to the extra condition.";
    case "product": return splitList(condition.listText).length ? null : "Add at least one product code to the extra condition.";
    case "state": {
      const states = splitList(condition.listText);
      if (!states.length) return "Add at least one state to the extra condition.";
      return states.every((state) => /^[A-Za-z]{2}$/.test(state)) ? null : "Use two-letter state codes in the extra condition, such as TX, NM.";
    }
    default: return condition.campaignIds.length ? null : "Pick at least one campaign for the extra condition.";
  }
}

/** A fallback matches every lead, so it is kept after every other rule (the database does the same). */
function pinFallbacks(drafts: RuleDraft[]) {
  return [...drafts.filter((draft) => draft.matchType !== "fallback"), ...drafts.filter((draft) => draft.matchType === "fallback")];
}

function matchValuesOf(draft: RuleDraft): Record<string, unknown> {
  switch (draft.matchType) {
    case "realtime": return { seconds: Number(draft.seconds) };
    case "language": return { languages: splitList(draft.listText).map((value) => value.toLowerCase()) };
    case "product": return draft.licensedOnly ? { products: splitList(draft.listText).map((value) => value.toLowerCase()), licensed_only: true } : { products: splitList(draft.listText).map((value) => value.toLowerCase()) };
    case "state": return { states: splitList(draft.listText).map((value) => value.toUpperCase()) };
    case "campaign": return { campaign_ids: draft.campaignIds };
    default: return {};
  }
}

function draftProblem(draft: RuleDraft): string | null {
  const own = ownProblem(draft);
  if (own) return own;
  if (draft.matchType === "fallback") return null;
  for (const condition of draft.conditions) {
    const problem = conditionProblem(condition);
    if (problem) return problem;
  }
  return null;
}

function ownProblem(draft: RuleDraft): string | null {
  switch (draft.matchType) {
    case "realtime": {
      const seconds = Number(draft.seconds);
      return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? null : "Enter a number of seconds from 1 to 86,400.";
    }
    case "language": return splitList(draft.listText).length ? null : "Add at least one language.";
    case "product": return splitList(draft.listText).length ? null : "Add at least one product code.";
    case "state": {
      const states = splitList(draft.listText);
      if (!states.length) return "Add at least one state.";
      return states.every((state) => /^[A-Za-z]{2}$/.test(state)) ? null : "Use two-letter state codes, such as TX, NM.";
    }
    case "campaign": return draft.campaignIds.length ? null : "Pick at least one campaign.";
    default: return null;
  }
}

/** The conditions a draft publishes: none on a fallback, which matches everything. */
const conditionsOf = (draft: RuleDraft): RuleCondition[] => (draft.matchType === "fallback" ? [] : draft.conditions.map(conditionValuesOf));

const serialise = (drafts: RuleDraft[]) => JSON.stringify(drafts.map((draft) => ({ id: draft.id ?? null, type: draft.matchType, values: matchValuesOf(draft), assignees: draft.assigneeIds, strategy: draft.strategy, conditions: conditionsOf(draft) })));

const titleCase = (value: string) => value.replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function fetchPreview(): Promise<PreviewState> {
  try {
    const response = await fetch("/api/app/assignments?view=preview", { cache: "no-store" });
    const body = await readJson(response);
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not preview routing");
    return { rows: Array.isArray(body?.rows) ? body.rows as PreviewRow[] : null, pending: body?.pending === true, loading: false, error: null };
  } catch (error) {
    return { rows: null, pending: false, loading: false, error: error instanceof Error ? error.message : "Could not preview routing" };
  }
}

export function AssignmentWorkspace({ canManage }: { canManage: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ rows: null, pending: false, loading: canManage, error: null });

  // The rule chain as a draft: edited here, published whole.
  const [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const newKey = useRef(0);

  // Capacity rows open for editing, and the household settings editor.
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({ capacity: "", languages: "", weekdayOff: "" });
  const [memberError, setMemberError] = useState<string | null>(null);
  const [editingRest, setEditingRest] = useState(false);
  const [restForm, setRestForm] = useState({ restDays: "", attempts: "" });
  const [restError, setRestError] = useState<string | null>(null);
  const restCardRef = useRef<HTMLDivElement>(null);
  const restInputRef = useRef<HTMLInputElement>(null);

  // Pool actions — the strings the LA-2.24 contract test reads are kept as they were.
  const [workItemId, setWorkItemId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [reassignWorkItemId, setReassignWorkItemId] = useState("");
  const [reassignTargetUserId, setReassignTargetUserId] = useState("");
  const [reassignReason, setReassignReason] = useState("");

  // A reload after a capacity or settings save must not throw away a half-edited rule chain, so an
  // unpublished draft survives it; publishing and Discard take the server's chain whole.
  const baselineRef = useRef("[]");
  const adopt = useCallback((next: Workspace, keepDraft = false) => {
    setWorkspace(next);
    const active = next.rules.filter((rule) => rule.is_active).map(draftFromRule);
    // A chain published before the fallback was pinned may have it mid-chain. The draft shows it
    // last, and the baseline stays the published order, so Publish rules applies the move.
    const pinned = pinFallbacks(active);
    const previous = baselineRef.current;
    setDrafts((current) => (keepDraft && serialise(current) !== previous ? current : pinned));
    baselineRef.current = serialise(active);
    setBaseline(baselineRef.current);
    if (!keepDraft) setPublishError(null);
  }, []);

  const load = useCallback(async (keepDraft = true) => {
    const response = await fetch("/api/app/assignments", { cache: "no-store" });
    const body = await readJson(response);
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not load assignment workspace");
    adopt(body as unknown as Workspace, keepDraft);
  }, [adopt]);

  const loadPreview = useCallback(async () => {
    if (!canManage) return;
    setPreview((current) => ({ ...current, loading: true, error: null }));
    setPreview(await fetchPreview());
  }, [canManage]);

  useEffect(() => {
    let active = true;
    void fetch("/api/app/assignments", { cache: "no-store" })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not load assignment workspace"); if (active) adopt(body as unknown as Workspace); })
      .catch((error) => { if (active) notify.block(error instanceof Error ? error.message : "Could not load assignment workspace"); })
      .finally(() => { if (active) setLoading(false); });
    if (canManage) void fetchPreview().then((next) => { if (active) setPreview(next); });
    return () => { active = false; };
  }, [adopt, canManage]);

  const refresh = useCallback(async (keepDraft = true) => { await load(keepDraft); void loadPreview(); }, [load, loadPreview]);

  const members = useMemo(() => workspace?.members ?? [], [workspace]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const campaignName = useMemo(() => new Map((workspace?.campaigns ?? []).map((campaign) => [campaign.id, campaign.name])), [workspace]);
  const publishedOrder = useMemo(() => new Map((workspace?.rules ?? []).filter((rule) => rule.is_active).map((rule, index) => [rule.id, index + 1])), [workspace]);
  const dirty = serialise(drafts) !== baseline;
  const problems = drafts.map(draftProblem);
  const sinceLabel = workspace ? weekdayDayMonth(workspace.since, "UTC") : "";

  /* ── actions ────────────────────────────────────────────────────────── */

  async function post(body: Record<string, unknown>, success: string) {
    setBusy("action");
    try {
      const response = await fetch("/api/app/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readJson(response);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Assignment action failed");
      // `assign_lead` refuses in two ways and only one of them is an error. No eligible assignee —
      // everyone at capacity, or nobody licensed for the lead's state — raises NO_ELIGIBLE_ASSIGNEE
      // and arrives here as a failed response. **Sticky ownership returns 200** with the lead
      // exactly where it was: "Active ownership is sticky until disposition", which is LA-2.24
      // working as specified, an agent mid-conversation keeping their lead.
      //
      // The response body was parsed and then discarded, so that refusal was announced as a
      // success — the one case where the screen says a lead moved and it did not.
      if (result?.sticky) notify.warn(typeof result.reason === "string" ? result.reason : "That lead is mid-conversation and stayed with its current owner.");
      else {
        const owner = typeof result?.owner_user_id === "string" ? memberById.get(result.owner_user_id) : undefined;
        const skipped = typeof result?.leads_skipped === "number" ? result.leads_skipped : 0;
        const detail = [owner ? `Given to ${owner.name}.` : "", skipped ? `${skipped} lead${skipped === 1 ? "" : "s"} ahead of it had nobody eligible and stay in the pool.` : ""].filter(Boolean).join(" ");
        notify.done(success, detail ? { detail } : undefined);
      }
      await refresh();
    }
    catch (error) { notify.fail(error instanceof Error ? error.message : "Assignment action failed"); }
    finally { setBusy(null); }
  }

  async function publish() {
    if (!canManage || !dirty || problems.some(Boolean)) return;
    setBusy("publish");
    setPublishError(null);
    try {
      const rules = pinFallbacks(drafts).map((draft) => ({ id: draft.id, matchType: draft.matchType, matchValues: matchValuesOf(draft), assigneeIds: draft.assigneeIds, isActive: true, strategy: draft.strategy, conditions: conditionsOf(draft) }));
      const response = await fetch("/api/app/assignments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not publish rules");
      setOpenKey(null);
      notify.done("Rules published. They apply to the next assignment.");
      await refresh(false);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Could not publish rules");
    } finally { setBusy(null); }
  }

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/app/assignments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await readJson(response);
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Could not save");
    return result;
  }

  async function saveMember(member: AssignmentMember) {
    const capacity = Number(memberForm.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100000) { setMemberError("Capacity is a whole number of open leads, 0 or more."); return; }
    const languages = splitList(memberForm.languages).map((value) => value.toLowerCase());
    const weekdayOff = memberForm.weekdayOff === "" ? null : Number(memberForm.weekdayOff);
    setBusy(`member:${member.id}`);
    setMemberError(null);
    try {
      if (capacity !== member.capacity) await patch({ userId: member.id, maxOpenLeads: capacity });
      const languagesChanged = languages.join(",") !== member.languages.join(",");
      if (languagesChanged || weekdayOff !== member.weekdayOff) {
        await patch({ userId: member.id, ...(languagesChanged ? { languages } : {}), ...(weekdayOff !== member.weekdayOff ? { weekdayOff } : {}) });
      }
      notify.done(`${member.name} updated`);
      setEditingMember(null);
      await refresh();
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Could not save");
      await load().catch(() => undefined);
    } finally { setBusy(null); }
  }

  async function saveRest() {
    if (!workspace) return;
    const restDays = Number(restForm.restDays || 0);
    const attempts = restForm.attempts.trim() === "" ? null : Number(restForm.attempts);
    if (!Number.isInteger(restDays) || restDays < 0 || restDays > 3650) { setRestError("Rest between owners is a whole number of days, 0 to 3,650."); return; }
    if (attempts !== null && (!Number.isInteger(attempts) || attempts < 0 || attempts > 50)) { setRestError("Attempts before rotate is a whole number from 0 to 50, or empty for off."); return; }
    setBusy("settings");
    setRestError(null);
    try {
      if (restDays !== workspace.settings.rest_days) await patch({ restDays });
      if (attempts !== workspace.settings.attempts_before_rotate) await patch({ attemptsBeforeRotate: attempts });
      notify.done("Household rules updated");
      setEditingRest(false);
      await refresh();
    } catch (error) {
      setRestError(error instanceof Error ? error.message : "Could not save");
      await load().catch(() => undefined);
    } finally { setBusy(null); }
  }

  async function saveAutoRoute(next: boolean) {
    setBusy("auto-route");
    try {
      await patch({ autoRoutePosted: next });
      notify.done(next ? "Posted leads are routed on arrival" : "Posted leads wait in the pool again");
      await refresh();
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not save");
    } finally { setBusy(null); }
  }

  function openRestEditor() {
    restCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!canManage || !workspace) { restCardRef.current?.focus({ preventScroll: true }); return; }
    setRestForm({ restDays: String(workspace.settings.rest_days), attempts: workspace.settings.attempts_before_rotate ? String(workspace.settings.attempts_before_rotate) : "" });
    setRestError(null);
    setEditingRest(true);
    requestAnimationFrame(() => restInputRef.current?.focus({ preventScroll: true }));
  }

  /* ── draft editing ──────────────────────────────────────────────────── */

  // Changing a rule to or from Fallback re-pins the fallback last.
  const updateDraft = (key: string, next: Partial<RuleDraft>) => setDrafts((current) => {
    const updated = current.map((draft) => (draft.key === key ? { ...draft, ...next } : draft));
    return next.matchType ? pinFallbacks(updated) : updated;
  });

  function reorder(from: number, to: number) {
    if (from < 0 || to < 0 || from >= drafts.length || to >= drafts.length || from === to) return false;
    const next = [...drafts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const firstFallback = next.findIndex((draft) => draft.matchType === "fallback");
    if (firstFallback >= 0 && next.slice(firstFallback).some((draft) => draft.matchType !== "fallback")) {
      setMoveNotice("The fallback stays last: it matches every lead, so nothing after it would be reached.");
      return false;
    }
    setDrafts(next);
    setMoveNotice(`Rule moved to position ${to + 1} of ${next.length}.`);
    return true;
  }

  function moveDraft(key: string, delta: number) {
    const from = drafts.findIndex((draft) => draft.key === key);
    if (reorder(from, from + delta)) requestAnimationFrame(() => document.getElementById(`rule-handle-${key}`)?.focus());
  }

  function dropOn(targetKey: string) {
    if (dragKey && dragKey !== targetKey) reorder(drafts.findIndex((draft) => draft.key === dragKey), drafts.findIndex((draft) => draft.key === targetKey));
    setDragKey(null);
  }

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    if (event.key === "ArrowUp") { event.preventDefault(); moveDraft(key, -1); }
    if (event.key === "ArrowDown") { event.preventDefault(); moveDraft(key, 1); }
  }

  function addCondition() {
    newKey.current += 1;
    const key = `new-${newKey.current}`;
    setDrafts((current) => {
      // New conditions go above the fallback, which only makes sense last.
      const fallbackAt = current.findIndex((draft) => draft.matchType === "fallback");
      const next = [...current];
      next.splice(fallbackAt >= 0 ? fallbackAt : next.length, 0, { key, matchType: "state", seconds: "60", listText: "", campaignIds: [], licensedOnly: false, assigneeIds: [], strategy: "round_robin", conditions: [] });
      return next;
    });
    setOpenKey(key);
  }

  function restore(rule: AssignmentRule) {
    setDrafts((current) => pinFallbacks([...current, draftFromRule(rule)]));
  }

  /* ── derived figures ────────────────────────────────────────────────── */

  const licensedMembers = members.filter((member) => member.role === "owner" || member.role === "producer");
  const setters = members.filter((member) => member.role === "setter");
  const agencyReach = new Set(licensedMembers.flatMap((member) => member.eligibleStates ?? [])).size;
  const atCeiling = members.filter((member) => member.currentOpen >= member.capacity);

  const routedFor = (ruleId: string | undefined) => (ruleId && workspace?.insights ? workspace.insights.routed[ruleId] ?? 0 : null);
  const capacitySkips = (workspace?.insights?.skippedLeads ?? []).filter((row) => row.reason === "capacity").sort((a, b) => b.leads - a.leads);
  const topCapacitySkip = capacitySkips[0] ?? null;

  /** "skipped R. Alvarez 47× (full) · licence 12× · → rule 4 (40), whole roster (7)", from this week's skips. */
  function ruleSkipLine(ruleId: string | undefined): string | null {
    const insights = workspace?.insights;
    if (!ruleId || !insights) return null;
    const mine = insights.skips.filter((row) => row.rule_id === ruleId);
    if (!mine.length) return null;
    const parts: string[] = [];
    const people = mine.filter((row) => row.user_id).sort((a, b) => b.count - a.count);
    if (people.length) {
      const top = people[0];
      const others = new Set(people.map((row) => row.user_id)).size - 1;
      parts.push(`skipped ${shortName(memberById.get(top.user_id!)?.name ?? "someone")} ${top.count.toLocaleString()}× (${SKIP_REASON_LABEL[top.reason] ?? top.reason})${others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}`);
    }
    const licence = mine.filter((row) => row.reason === "licence").reduce((sum, row) => sum + row.count, 0);
    if (licence) parts.push(`nobody licensed ${licence.toLocaleString()}×`);
    const landed = insights.landed.filter((row) => row.rule_id === ruleId && row.landed_rule_id !== ruleId).sort((a, b) => b.leads - a.leads);
    if (landed.length) {
      const where = landed.slice(0, 2).map((row) => `${row.landed_rule_id && publishedOrder.get(row.landed_rule_id) ? `rule ${publishedOrder.get(row.landed_rule_id)}` : row.landed_rule_id ? "a retired rule" : "whole roster"} (${row.leads.toLocaleString()})`);
      parts.push(`→ ${where.join(", ")}${landed.length > 2 ? ` +${landed.length - 2}` : ""}`);
    }
    return parts.length ? parts.join(" · ") : null;
  }

  /** "passed over 12× this week (full 10, day off 2)" for one person. */
  function personSkipLine(userId: string): string | null {
    const rows = (workspace?.insights?.skippedLeads ?? []).filter((row) => row.user_id === userId && row.leads > 0).sort((a, b) => b.leads - a.leads);
    if (!rows.length) return null;
    const total = rows.reduce((sum, row) => sum + row.leads, 0);
    return `Passed over ${total.toLocaleString()}× this week (${rows.map((row) => `${SKIP_REASON_LABEL[row.reason] ?? row.reason} ${row.leads.toLocaleString()}`).join(", ")})`;
  }

  /** Personal licences inside the warning window, or lapsed and still holding leads. */
  const warnable = (member: AssignmentMember): LicenceExpiry[] => (member.licenceExpiring ?? []).filter((entry) => daysUntil(entry.expiresOn) <= LICENCE_WARNING_DAYS && (daysUntil(entry.expiresOn) >= 0 || entry.openLeads > 0));

  const ceilings = members.map((member) => member.capacity);
  const ceilingChip = !ceilings.length ? "no agents" : Math.min(...ceilings) === Math.max(...ceilings) ? `${ceilings[0]} open leads` : `${Math.min(...ceilings)}–${Math.max(...ceilings)} open leads`;

  function valueChip(draft: RuleDraft): string {
    const own = ownValueChip(draft);
    if (draft.matchType === "fallback" || !draft.conditions.length) return own;
    return `${own} · and ${draft.conditions.map(conditionChip).join(" · and ")}`;
  }

  function ownValueChip(draft: RuleDraft): string {
    switch (draft.matchType) {
      case "realtime": return draft.seconds ? `${draft.seconds} seconds` : "no time set";
      case "language": return splitList(draft.listText).map(titleCase).join(", ") || "no languages";
      case "campaign": return draft.campaignIds.map((id) => campaignName.get(id) ?? "Unknown campaign").join(", ") || "no campaigns";
      case "product": return `${splitList(draft.listText).join(", ") || "no products"}${draft.licensedOnly ? " · licensed only" : ""}`;
      case "state": return splitList(draft.listText).map((value) => value.toUpperCase()).join(", ") || "no states";
      default: return assigneeSummary(draft.assigneeIds, true);
    }
  }

  function conditionChip(condition: ConditionDraft): string {
    const label = MATCH_LABEL[condition.type].toLowerCase();
    switch (condition.type) {
      case "language": return `${label} ${splitList(condition.listText).map(titleCase).join(", ") || "—"}`;
      case "campaign": return `${label} ${condition.campaignIds.map((id) => campaignName.get(id) ?? "Unknown campaign").join(", ") || "—"}`;
      case "product": return `${label} ${splitList(condition.listText).join(", ") || "—"}${condition.licensedOnly ? " (licensed only)" : ""}`;
      default: return `${label} ${splitList(condition.listText).map((value) => value.toUpperCase()).join(", ") || "—"}`;
    }
  }

  function assigneeSummary(ids: string[], fallback = false): string {
    if (!ids.length) return fallback ? "whole roster" : "the whole roster";
    const people = ids.map((id) => memberById.get(id)).filter((member): member is AssignmentMember => Boolean(member));
    if (fallback && people.length && people.every((member) => member.role === "setter")) return "setters";
    const names = people.map((member) => shortName(member.name));
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ") || "nobody active";
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  const header = (
    <PageHeader
      title="Lead assignment"
      actions={(
        <>
          <Button type="button" variant="outline" onClick={openRestEditor} disabled={!workspace}>Rest days</Button>
          <Button type="button" disabled={!workspace || busy === "action"} onClick={() => void post({ action: "assign" }, "Next eligible lead assigned")}>Assign next eligible lead</Button>
        </>
      )}
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

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* ── left column ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TableCard
            title="Rules"
            description="Evaluated top to bottom; they apply to the next assignment."
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
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[12px] font-semibold text-[var(--muted)]" aria-hidden><LockIcon /></span>
                <span className="w-[130px] shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Agent capacity</span>
                <span className="w-[110px] shrink-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">ceilings below</span>
                <span className="min-w-0 flex-1"><Pill>{ceilingChip}</Pill></span>
                <span className="w-[120px] shrink-0 text-right text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
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
                          className="w-[22px] cursor-grab text-[14px] leading-none text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                          aria-label={`Rule ${index + 1}. Drag, or press the up and down arrow keys, to reorder`}
                          // Pressing the handle takes focus, so the arrow keys reorder straight after a
                          // click as well as after Tab. The drag itself belongs to the row.
                          onPointerDown={(event) => event.currentTarget.focus()}
                          onKeyDown={(event) => handleKeys(event, draft.key)}
                        >&#8942;&#8942;</button>
                      ) : <span className="w-[22px] text-[14px] leading-none text-[var(--muted)]" aria-hidden>&#8942;&#8942;</span>}
                      <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[12px] leading-[1.5] font-semibold tracking-[-0.01em]">{index + 1}</span>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                        onClick={() => setOpenKey(open ? null : draft.key)}
                        aria-expanded={open}
                        aria-controls={`rule-editor-${draft.key}`}
                      >
                        <span className="w-[130px] shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{MATCH_LABEL[draft.matchType]}</span>
                        <span className="w-[110px] shrink-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{operator}</span>
                        <span className="min-w-0 flex-1" title={draft.matchType === "fallback" ? undefined : goesTo}>
                          <Pill tone={problem ? "warning" : "neutral"} className="max-w-full overflow-hidden text-ellipsis">{valueChip(draft)}</Pill>
                        </span>
                        <span className="w-[120px] shrink-0 text-right text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]" title={workspace.insights ? `Since ${sinceLabel}, 00:00 UTC` : undefined}>
                          {!draft.id ? "not published" : routed === null ? "" : `${routed.toLocaleString()} routed this week`}
                        </span>
                      </button>
                      {canManage ? (
                        <button type="button" className="border-0 bg-transparent px-1 text-[16px] leading-none text-[var(--muted)] hover:text-[var(--error-ink)]" aria-label={`Remove rule ${index + 1}`} onClick={() => { setDrafts((current) => current.filter((item) => item.key !== draft.key)); if (open) setOpenKey(null); }}>&times;</button>
                      ) : <span className="w-[18px]" />}
                    </div>
                    {skipLine && (
                      <p className="m-0 -mt-1.5 pr-4 pb-2.5 pl-[80px] text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]" title={`Since ${sinceLabel}, 00:00 UTC. "→" is where the leads it passed over were routed in the end.`}>This week: {skipLine}</p>
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
            {!drafts.length && <p className="border-t border-[var(--border)] px-4 py-3 text-[14px] text-[var(--muted)]">No rules. Every lead goes round-robin across the whole roster, licence and capacity permitting.</p>}
            {canManage && (
              <div className="border-t border-dashed border-[var(--border-strong)] px-4 py-3">
                <Button type="button" variant="ghost" onClick={addCondition}><PlusIcon />Add condition</Button>
              </div>
            )}
            {inactiveRules.length > 0 && (
              <details className="border-t border-[var(--border)] px-4 py-3 text-[14px]">
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
              <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
                The published fallback sits above other rules, so they only see the leads it cannot place. It is shown last here; publish to apply.
              </p>
            )}
            {publishError && <p role="alert" className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] leading-[1.5] text-[var(--error-ink)]">{publishError}</p>}
          </TableCard>

          {/* ── capacity ──────────────────────────────────────────────── */}
          <TableCard
            title="Capacity"
            action={atCeiling.length ? <Pill tone="error" dot>{atCeiling.length} agent{atCeiling.length === 1 ? "" : "s"} at the ceiling</Pill> : <Pill tone="success" dot>Nobody at the ceiling</Pill>}
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
              <tbody className="m-seq">
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
                        <td className={st.td}><Pill tone={member.role === "setter" ? "info" : "neutral"}>{roleLabel(member.role)}</Pill></td>
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
                              <Field label="Languages" htmlFor={`lang-${member.id}`} hint="Comma-separated, as leads carry them: spanish, es. Used by language rules.">
                                <input id={`lang-${member.id}`} className={control} value={memberForm.languages} disabled={!workspace.boardSchema} onChange={(event) => setMemberForm({ ...memberForm, languages: event.target.value })} placeholder="spanish, english" />
                              </Field>
                              <Field label="Rest day" htmlFor={`off-${member.id}`} hint="Skipped by automatic assignment that day, in your agency's timezone.">
                                <select id={`off-${member.id}`} className={control} value={memberForm.weekdayOff} disabled={!workspace.boardSchema} onChange={(event) => setMemberForm({ ...memberForm, weekdayOff: event.target.value })}>
                                  <option value="">Works every day</option>
                                  {WEEKDAY_NAMES.map((day, value) => <option key={day} value={value}>{day}</option>)}
                                </select>
                              </Field>
                            </div>
                            {!workspace.boardSchema && <p className="text-[12px] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE} Capacity can still be changed.</p>}
                            {memberError && <p role="alert" className="text-[12px] text-[var(--error-ink)]">{memberError}</p>}
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
                {!members.length && <tr><td colSpan={6} className={cn(st.td, "text-[var(--muted)]")}>Nobody on this workspace can be handed leads yet.</td></tr>}
              </tbody>
            </table>
          </TableCard>
        </div>

        {/* ── right column ────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 lg:w-[460px] lg:shrink-0">
          <TableCard
            title="Routing preview"
            action={(
              <>
                {preview.rows && preview.rows.length > 0 && <Pill tone={routedCount === preview.rows.length ? "success" : "warning"} dot>{routedCount} of {preview.rows.length} routed</Pill>}
                {canManage && <RefreshButton onClick={() => void loadPreview()} refreshing={preview.loading} />}
              </>
            )}
          >
            {!canManage ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-[14px] text-[var(--muted)]">Owners and producers can preview where the next leads in the pool would go.</p>
            ) : preview.loading && !preview.rows ? (
              <div className="border-t border-[var(--border)]"><SectionLoading rows={4} columns={4} label="Loading the routing preview" /></div>
            ) : preview.error ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-[14px] text-[var(--error-ink)]" role="alert">{preview.error}</p>
            ) : preview.pending ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-[14px] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>
            ) : !previewRows.length ? (
              <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-[14px] text-[var(--muted)]">Nothing is waiting in the pool.</p>
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
                <tbody className="m-seq">
                  {previewRows.map((row) => {
                    const owner = row.owner_user_id ? memberById.get(row.owner_user_id) : undefined;
                    const unrouted = row.outcome !== "routed" && row.outcome !== "taken";
                    return (
                      <tr key={row.work_item_id} className={cn("m-row", unrouted && "bg-[var(--brand-50)]")}>
                        <td className={st.td}>{row.name}</td>
                        <td className={st.td}>{row.state ?? "—"}</td>
                        <td className={st.td}>
                          {row.outcome === "routed" || row.outcome === "taken" ? (owner ? shortName(owner.name) : "Someone") : <Pill tone="error" dot>Nobody</Pill>}
                        </td>
                        <td className={st.td}><PreviewWhy row={row} ruleNumber={row.rule_id ? publishedOrder.get(row.rule_id) ?? null : null} memberName={(id) => shortName(memberById.get(id)?.name ?? "someone")} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {canManage && dirty && previewRows.length > 0 && <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--muted)]">The preview uses the published rules, not your unpublished changes.</p>}
          </TableCard>

          <div ref={restCardRef} tabIndex={-1} className="outline-none">
            <SettingsCard
              title="Household rest days"
              pad={20}
              action={canManage && !editingRest ? <Button type="button" variant="outline" onClick={openRestEditor}>Edit</Button> : undefined}
            >
              {editingRest ? (
                <div className="flex flex-col gap-4">
                  <Field label="Rest between owners" htmlFor="rest-days" hint="Days after a household is given to someone before anyone else may be given it — by the rules, a rotation or a manager's reassignment. 0 is off.">
                    <input ref={restInputRef} id="rest-days" className={control} type="number" min={0} max={3650} value={restForm.restDays} onChange={(event) => setRestForm({ ...restForm, restDays: event.target.value })} />
                  </Field>
                  <Field label="Attempts before rotate" htmlFor="rotate-attempts" hint="After this many unanswered calls by the same owner (no answer, voicemail, busy, dropped) since anyone last reached the household, the lead is offered to another eligible agent. Checked every 15 minutes, never during a call or a booked callback. Empty or 0 is off.">
                    <input id="rotate-attempts" className={control} type="number" min={0} max={50} value={restForm.attempts} disabled={!workspace.boardSchema} onChange={(event) => setRestForm({ ...restForm, attempts: event.target.value })} placeholder="Off" />
                  </Field>
                  {!workspace.boardSchema && <p className="m-0 text-[12px] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE} Rest between owners can still be changed.</p>}
                  {restError && <p role="alert" className="m-0 text-[12px] text-[var(--error-ink)]">{restError}</p>}
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
            {!workspace.routerSchema && <p id="auto-route-pending" className="mt-2 mb-0 text-[12px] leading-[1.5] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>}
          </SettingsCard>
        </div>
      </div>

      {/* ── pool actions ─────────────────────────────────────────────── */}
      <SettingsCard title="Pool actions">
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
      </SettingsCard>
    </div>
  );
}

function PreviewWhy({ row, ruleNumber, memberName }: { row: PreviewRow; ruleNumber: number | null; memberName: (id: string) => string }) {
  if (row.outcome === "taken") return <Pill>Already taken</Pill>;
  if (row.outcome === "error") return <Pill tone="error">{row.error ?? "Could not route"}</Pill>;
  if (row.outcome === "nobody") {
    const d = row.detail ?? {};
    const other = (d.capacity ?? 0) + (d.rest ?? 0) + (d.household ?? 0) + (d.day_off ?? 0) + (d.language ?? 0);
    const label = !d.candidates ? "No one on the rule"
      : !d.state && (d.licence ?? 0) > 0 && !other ? "No state"
      : (d.licence ?? 0) > 0 && !other ? "Off-territory"
      : (d.capacity ?? 0) > 0 && (d.capacity ?? 0) + (d.licence ?? 0) === d.candidates ? "Everyone full"
      : (d.household ?? 0) > 0 || (d.rest ?? 0) > 0 ? "Household held"
      : "No one eligible";
    return <span title={nobodySentence(row.detail)}><Pill tone="error">{label}</Pill></span>;
  }
  if (row.setter_without_licensed_agent) return <Pill tone="info">No licence &mdash; setter</Pill>;
  const base = ruleNumber ? `Rule ${ruleNumber}` : "Whole roster";
  const full = row.full_user_ids[0];
  return <Pill>{full ? <>{base} &mdash; {memberName(full)} full</> : base}</Pill>;
}

/** The expanded editor under a rule row. */
function RuleEditor({
  draft, index, total, members, campaigns, allCampaigns, routerSchema, campaignCount, campaignFilter, onCampaignFilter, problem, canManage, boardSchema, onChange, onMove, onClose,
}: {
  draft: RuleDraft;
  index: number;
  total: number;
  members: AssignmentMember[];
  campaigns: { id: string; name: string }[];
  allCampaigns: { id: string; name: string }[];
  routerSchema: boolean;
  campaignCount: number;
  campaignFilter: string;
  onCampaignFilter: (value: string) => void;
  problem: string | null;
  canManage: boolean;
  boardSchema: boolean;
  onChange: (next: Partial<RuleDraft>) => void;
  onMove: (delta: number) => void;
  onClose: () => void;
}) {
  const id = `rule-editor-${draft.key}`;
  const note: Record<MatchType, string> = {
    realtime: "Leads posted in the last N seconds go to these assignees. Posted leads already sort first in the queue, so this decides who gets them — and, with Posted leads › Route on arrival on, it runs the moment they land.",
    language: "Only assignees with the lead's language recorded in the capacity table take these leads. If none of them has it, the lead falls through to the next rule.",
    campaign: "Leads bought on these campaigns.",
    product: "Leads for these product codes. Licensed only keeps setters off them, here and in every rule after this one.",
    state: "Leads in these states. Licence still decides who in the list may take each one.",
    fallback: "Everything that reaches this rule, which always runs last, across the assignees. None ticked is the whole roster.",
  };
  return (
    <div id={id} className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-4">
      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <Field label="Match" htmlFor={`${id}-type`} hint={note[draft.matchType]}>
          <select id={`${id}-type`} className={control} value={draft.matchType} disabled={!canManage} onChange={(event) => onChange({ matchType: event.target.value as MatchType })}>
            {MATCH_TYPES.map((type) => <option key={type} value={type} disabled={type === "realtime" && !boardSchema && draft.matchType !== "realtime"}>{MATCH_LABEL[type]}</option>)}
          </select>
        </Field>
        <div className="min-w-0">
          {draft.matchType === "realtime" && (
            <Field label="Arrived within (seconds)" htmlFor={`${id}-seconds`} error={problem ?? undefined} hint={!boardSchema ? SCHEMA_PENDING_MESSAGE : undefined}>
              <input id={`${id}-seconds`} className={control} type="number" min={1} max={86400} value={draft.seconds} disabled={!canManage} onChange={(event) => onChange({ seconds: event.target.value })} />
            </Field>
          )}
          {(draft.matchType === "language" || draft.matchType === "product" || draft.matchType === "state") && (
            <Field
              label={draft.matchType === "language" ? "Languages" : draft.matchType === "product" ? "Product codes" : "States"}
              htmlFor={`${id}-values`}
              error={problem ?? undefined}
              hint="Comma-separated."
            >
              <input id={`${id}-values`} className={control} value={draft.listText} disabled={!canManage} onChange={(event) => onChange({ listText: event.target.value })} placeholder={draft.matchType === "language" ? "spanish, english" : draft.matchType === "product" ? "final_expense, term_life" : "TX, NM"} />
            </Field>
          )}
          {draft.matchType === "product" && (
            <label className="mt-2 flex items-center gap-2 text-[14px] text-[var(--body)]">
              <input type="checkbox" checked={draft.licensedOnly} disabled={!canManage} onChange={(event) => onChange({ licensedOnly: event.target.checked })} />
              Licensed agents only
            </label>
          )}
          {draft.matchType === "campaign" && (
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Campaigns</legend>
              {campaignCount > 8 && <div className="mt-1.5"><SearchBox value={campaignFilter} onChange={onCampaignFilter} placeholder="Find a campaign" label="Find a campaign" /></div>}
              {campaignCount === 0 ? <p className="mt-1.5 text-[12px] text-[var(--muted)]">This workspace has no campaigns yet. Add them on Lead vendors.</p> : (
                <div className="mt-2 flex max-h-44 flex-wrap gap-x-4 gap-y-2 overflow-y-auto">
                  {campaigns.map((campaign) => (
                    <label key={campaign.id} className="flex items-center gap-1.5 text-[14px] text-[var(--body)]">
                      <input type="checkbox" checked={draft.campaignIds.includes(campaign.id)} disabled={!canManage} onChange={(event) => onChange({ campaignIds: event.target.checked ? [...draft.campaignIds, campaign.id] : draft.campaignIds.filter((value) => value !== campaign.id) })} />
                      {campaign.name}
                    </label>
                  ))}
                </div>
              )}
              {problem && <span role="alert" className="mt-1.5 block text-[12px] text-[var(--error-ink)]">{problem}</span>}
            </fieldset>
          )}
        </div>
      </div>
      {draft.matchType !== "fallback" && (
        <ConditionsEditor
          id={id}
          conditions={draft.conditions}
          campaigns={allCampaigns}
          canManage={canManage}
          routerSchema={routerSchema}
          onChange={(conditions) => onChange({ conditions })}
        />
      )}
      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Goes to</legend>
        <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">
          {draft.strategy === "least_loaded" ? "Whoever holds the fewest open leads first; this order breaks ties." : "In this order, round-robin."} None ticked is the whole roster.
        </span>
        <div className="mt-2 max-w-[260px]">
          <label htmlFor={`${id}-strategy`} className="sr-only">How this rule picks</label>
          <select
            id={`${id}-strategy`}
            className={control}
            value={draft.strategy}
            disabled={!canManage || (!routerSchema && draft.strategy === "round_robin")}
            aria-describedby={!routerSchema ? `${id}-strategy-pending` : undefined}
            onChange={(event) => onChange({ strategy: event.target.value as RuleStrategy })}
          >
            {RULE_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{STRATEGY_LABEL[strategy]}</option>)}
          </select>
          {!routerSchema && <span id={`${id}-strategy-pending`} className="mt-1 block text-[12px] leading-[1.5] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {members.map((member) => (
            <label key={member.id} className="flex items-center gap-1.5 text-[14px] text-[var(--body)]">
              <input type="checkbox" checked={draft.assigneeIds.includes(member.id)} disabled={!canManage} onChange={(event) => onChange({ assigneeIds: event.target.checked ? [...draft.assigneeIds, member.id] : draft.assigneeIds.filter((value) => value !== member.id) })} />
              {member.name} <span className="text-[var(--muted)]">· {roleLabel(member.role)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {canManage && (
        <div className="mt-3 flex flex-wrap justify-end gap-2.5">
          <Button type="button" variant="ghost" size="sm" disabled={draft.matchType === "fallback" || index === 0} title={draft.matchType === "fallback" ? "The fallback always runs last" : undefined} onClick={() => onMove(-1)}>Move up</Button>
          <Button type="button" variant="ghost" size="sm" disabled={draft.matchType === "fallback" || index >= total - 1} title={draft.matchType === "fallback" ? "The fallback always runs last" : undefined} onClick={() => onMove(1)}>Move down</Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}

/** Up to MAX_EXTRA_CONDITIONS more conditions, all of which must match as well as the rule's own. */
function ConditionsEditor({
  id, conditions, campaigns, canManage, routerSchema, onChange,
}: {
  id: string;
  conditions: ConditionDraft[];
  campaigns: { id: string; name: string }[];
  canManage: boolean;
  routerSchema: boolean;
  onChange: (next: ConditionDraft[]) => void;
}) {
  const update = (key: string, next: Partial<ConditionDraft>) => onChange(conditions.map((condition) => (condition.key === key ? { ...condition, ...next } : condition)));
  const add = () => {
    onChange([...conditions, { key: `${id}-extra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type: "state", listText: "", campaignIds: [], licensedOnly: false }]);
  };
  const full = conditions.length >= MAX_EXTRA_CONDITIONS;
  return (
    <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
      <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">And also</legend>
      <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">
        Every condition here must match as well, such as a state and a product. Up to {MAX_EXTRA_CONDITIONS + 1} conditions per rule.
      </span>
      {conditions.map((condition, position) => {
        const cid = `${id}-and-${position}`;
        const problem = conditionProblem(condition);
        return (
          <div key={condition.key} className="mt-2 grid gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-start">
            <div>
              <label htmlFor={`${cid}-type`} className="sr-only">Condition {position + 2} type</label>
              <select id={`${cid}-type`} className={cn(control, "mt-0")} value={condition.type} disabled={!canManage} onChange={(event) => update(condition.key, { type: event.target.value as ConditionType })}>
                {CONDITION_TYPES.map((type) => <option key={type} value={type}>{MATCH_LABEL[type]}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              {condition.type === "campaign" ? (
                campaigns.length === 0 ? <p className="m-0 text-[12px] text-[var(--muted)]">This workspace has no campaigns yet.</p> : (
                  <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-2 overflow-y-auto" role="group" aria-label={`Condition ${position + 2} campaigns`}>
                    {campaigns.map((campaign) => (
                      <label key={campaign.id} className="flex items-center gap-1.5 text-[14px] text-[var(--body)]">
                        <input type="checkbox" checked={condition.campaignIds.includes(campaign.id)} disabled={!canManage} onChange={(event) => update(condition.key, { campaignIds: event.target.checked ? [...condition.campaignIds, campaign.id] : condition.campaignIds.filter((value) => value !== campaign.id) })} />
                        {campaign.name}
                      </label>
                    ))}
                  </div>
                )
              ) : (
                <>
                  <label htmlFor={`${cid}-values`} className="sr-only">Condition {position + 2} values</label>
                  <input
                    id={`${cid}-values`}
                    className={cn(control, "mt-0")}
                    value={condition.listText}
                    disabled={!canManage}
                    onChange={(event) => update(condition.key, { listText: event.target.value })}
                    placeholder={condition.type === "language" ? "spanish, es" : condition.type === "product" ? "final_expense" : "TX, NM"}
                  />
                  {condition.type === "product" && (
                    <label className="mt-2 flex items-center gap-2 text-[14px] text-[var(--body)]">
                      <input type="checkbox" checked={condition.licensedOnly} disabled={!canManage} onChange={(event) => update(condition.key, { licensedOnly: event.target.checked })} />
                      Licensed agents only
                    </label>
                  )}
                </>
              )}
              {problem && <span role="alert" className="mt-1.5 block text-[12px] text-[var(--error-ink)]">{problem}</span>}
            </div>
            {canManage && (
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove condition ${position + 2}`} onClick={() => onChange(conditions.filter((item) => item.key !== condition.key))}>Remove</Button>
            )}
          </div>
        );
      })}
      {canManage && (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            disabled={full || !routerSchema}
            aria-describedby={`${id}-and-why`}
            onClick={add}
          >
            <PlusIcon />Add an AND condition
          </Button>
          <span id={`${id}-and-why`} className="ml-2 text-[12px] text-[var(--muted)]">
            {!routerSchema ? SCHEMA_PENDING_MESSAGE : full ? `A rule has at most ${MAX_EXTRA_CONDITIONS + 1} conditions.` : ""}
          </span>
        </div>
      )}
    </fieldset>
  );
}
