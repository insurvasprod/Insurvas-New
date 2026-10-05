import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { LICENCE_WARNING_DAYS, MATCH_LABEL, SKIP_REASON_LABEL, daysUntil, shortName, type AssignmentMember, type AssignmentRule, type AssignmentWorkspace as Workspace, type LicenceExpiry } from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";
import { weekdayDayMonth } from "@/lib/format/dates";
import { type ConditionDraft, type PreviewState, type RuleDraft, draftFromRule, draftProblem, fetchPreview, matchValuesOf, pinFallbacks, readJson, splitList, conditionsOf, serialise, titleCase } from "./model";

/** The state and handlers of AssignmentWorkspace (UX-6), moved verbatim; the component renders. */
export function useAssignmentWorkspace(canManage: boolean) {
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

  return {
    workspace,
    loading,
    busy,
    preview,
    drafts,
    setDrafts,
    openKey,
    setOpenKey,
    dragKey,
    setDragKey,
    publishError,
    moveNotice,
    campaignFilter,
    setCampaignFilter,
    editingMember,
    setEditingMember,
    memberForm,
    setMemberForm,
    memberError,
    setMemberError,
    editingRest,
    setEditingRest,
    restForm,
    setRestForm,
    restError,
    restCardRef,
    restInputRef,
    workItemId,
    setWorkItemId,
    returnReason,
    setReturnReason,
    reassignWorkItemId,
    setReassignWorkItemId,
    reassignTargetUserId,
    setReassignTargetUserId,
    reassignReason,
    setReassignReason,
    adopt,
    loadPreview,
    refresh,
    members,
    memberById,
    publishedOrder,
    dirty,
    problems,
    sinceLabel,
    post,
    publish,
    saveMember,
    saveRest,
    saveAutoRoute,
    openRestEditor,
    updateDraft,
    reorder,
    moveDraft,
    dropOn,
    handleKeys,
    addCondition,
    restore,
    licensedMembers,
    setters,
    agencyReach,
    atCeiling,
    routedFor,
    topCapacitySkip,
    ruleSkipLine,
    personSkipLine,
    warnable,
    ceilings,
    ceilingChip,
    valueChip,
    assigneeSummary,
  };
}
