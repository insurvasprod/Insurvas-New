"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { History, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { DefaultChip } from "@/components/app/settings/defaults";
import { CallPopover } from "@/components/app/settings/cadence/call-popover";
import { HistorySheet, type ViewedVersion } from "@/components/app/settings/cadence/history-sheet";
import { OverrideSheet } from "@/components/app/settings/cadence/override-sheet";
import { ScopePicker, type ScopeCampaign } from "@/components/app/settings/cadence/scope-picker";
import { Seg, StatusLine, Stepper, callingRules, nextMonday, useCallingWindows, windowWords, type StatusTone } from "@/components/app/settings/cadence/shared";
import { CadenceTimeline, TimelineLegend, type TimelineMove } from "@/components/app/settings/cadence/timeline";
import { WhatHappens } from "@/components/app/settings/cadence/what-happens";
import { describeChanges } from "@/lib/cadence/changes";
import {
  BAND_PREFERENCE,
  OUTCOMES,
  OUTCOME_LABELS,
  OUTCOME_SUBJECT,
  PRESETS,
  applyPreset,
  differingCalls,
  joinOutcome,
  materialize,
  matchPreset,
  patchCall,
  removeCall,
  shiftWait,
  splitOutcome,
  type Outcome,
  type PresetKey,
} from "@/lib/cadence/draft";
import { DEFAULT_CEILING, MAX_ATTEMPTS_RANGE, parseInterval, type CadenceRow } from "@/lib/cadence/engine";
import { LAST_DIALLED_ATTEMPT, effectiveLadder } from "@/lib/cadence/ladder";
import { callLabel, dayLabel, longDayLabel, clockLabel, simulateCadence, summarize } from "@/lib/cadence/timeline";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings › Dialing cadence — round 8, board A "Visual timeline" (owner pick 2026-11-12).
 *
 * The cadence is drawn as what it does: one example lead, a dot per call on a 14-day timeline across
 * the parts of the day, days calling windows close striped, and calls they push marked with where the
 * rule wanted them. A tab per outcome (the real disposition codes), presets, max calls, a live
 * sentence, a "What happens" list, History from tenant_cadence_versions and a reset that says who is
 * affected. Problems and pending database updates go in the status line, never a notice card.
 *
 * The storage is unchanged: tenant_cadence_rules, where the rule stored as attempt N is the wait
 * before dial N (lib/cadence/ladder.ts). lib/cadence/draft.ts turns "call N on the timeline" into that.
 */

/** The dialer before 20260924230300: it stopped after the sixth dial. */
const LEGACY_LAST_ATTEMPT = LAST_DIALLED_ATTEMPT - 1;
/** The example lead arrives at 9:40am on a Monday, as on the board. */
const ARRIVAL = 9 * 60 + 40;
/** The outcome tabs' accessible name; the leave guard knows them by it (they sit in the frame's header). */
const OUTCOME_TABS_LABEL = "Outcome the cadence shows";

type StoredRow = CadenceRow & { id?: string; campaignId?: string | null };
type Loaded = {
  rows: StoredRow[];
  usingDefaults: boolean;
  defaults: CadenceRow[];
  campaigns: { id: string; name: string }[];
  fallbackRows?: StoredRow[];
  /** 20260924230300 applied: day parts, seven dials, a campaign cadence never merged, atomic saves. */
  schemaReady?: boolean;
  /** LA-2.7-8 · this scope's max attempts (20260929201100). */
  maxAttempts?: { own: number | null; inherited: number; effective: number; ready: boolean };
  campaignCadences?: { campaignId: string; ruleCount: number; maxAttempts: number }[];
  agency?: { ownRules: boolean; maxAttempts: number };
  canEdit: boolean;
};
type LastSave = { by: string | null; at: string } | null;

/** The rule fields only, in one order, so a draft and what is stored compare as equal when they are. */
function clean(rows: CadenceRow[]): CadenceRow[] {
  return rows
    .map(({ attemptNumber, delayInterval, preferredSlot, dispositionScope }) => ({ attemptNumber, delayInterval, preferredSlot: preferredSlot ?? null, dispositionScope: dispositionScope ?? null }))
    .sort((a, b) => a.attemptNumber - b.attemptNumber || String(a.dispositionScope ?? "").localeCompare(String(b.dispositionScope ?? "")));
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function CadenceSettings() {
  // /app/campaigns links a campaign's cadence here as ?cadenceCampaign=<id>#cadence, so the editor
  // opens on that campaign's scope. Read once on mount; the settings tabs render this panel only on
  // the client (the tab comes from the hash), and the loading state holds no scope-dependent markup.
  const [campaignId, setCampaignId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const linked = new URLSearchParams(window.location.search).get("cadenceCampaign") ?? "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linked) ? linked : "";
  });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lastSave, setLastSave] = useState<LastSave>(null);
  const [draft, setDraft] = useState<CadenceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  // Max calls as typed: "" means this scope inherits (the tenant default, else seven).
  const [maxDraft, setMaxDraft] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("no_answer");
  const [openCall, setOpenCall] = useState<number | null>(null);
  const [viewing, setViewing] = useState<ViewedVersion | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [startDate] = useState(() => nextMonday(new Date()));
  const calling = useCallingWindows();

  // Clicks on this page's own controls (its tabs sit in the frame's header, outside this column) are
  // the editor's, not a way out, so the leave guard lets them through.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const guardScope = useMemo(
    () => ({
      get current() {
        // A link (Calling windows) leaves the page even from inside it, so it is still held.
        const contains = (node: Node | null) =>
          Boolean(node && !(node instanceof Element && node.closest("a[href]")) && (rootRef.current?.contains(node) || (node instanceof Element && node.closest(`[role=tablist][aria-label="${OUTCOME_TABS_LABEL}"]`))));
        return { contains } as unknown as HTMLElement;
      },
    }) as RefObject<HTMLElement | null>,
    [],
  );

  // A promise chain rather than async/await, for the same reason as the calendar panel: the effect
  // below calls this on mount, and the linter can reach a setState synchronously through an async
  // function body even when it sits after an await. Every setState here lands in a callback.
  const load = useCallback(
    (campaign: string) =>
      Promise.all([
        fetch(`/api/app/cadence${campaign ? `?campaignId=${campaign}` : ""}`, { cache: "no-store" }).then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load the cadence");
          return body as Loaded;
        }),
        // Who saved last, for the status line. History is optional: its absence never blocks the page.
        fetch(`/api/app/cadence/history${campaign ? `?campaignId=${campaign}` : ""}`, { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null) as Promise<{ versions?: { savedBy: string | null; savedAt: string; source: string }[] } | null>,
      ])
        .then(([body, history]) => {
          setError(null);
          setLoaded(body);
          setDraft(clean(body.rows));
          setMaxDraft(body.maxAttempts?.own == null ? "" : String(body.maxAttempts.own));
          setOpenCall(null);
          setViewing(null);
          const latest = history?.versions?.[0];
          setLastSave(latest && latest.source === "save" ? { by: latest.savedBy, at: latest.savedAt } : null);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not load the cadence");
          setLoaded(null);
        }),
    [],
  );

  useEffect(() => {
    void load(campaignId);
  }, [campaignId, load]);

  const fallback = useMemo(() => clean(loaded?.fallbackRows ?? []), [loaded]);
  const saved = useMemo(() => clean(loaded?.rows ?? []), [loaded]);
  const ready = loaded?.schemaReady !== false;
  const limits = loaded?.maxAttempts;
  const limitsReady = limits?.ready === true;
  const savedMax = limits?.own == null ? "" : String(limits.own);
  const maxDirty = Boolean(loaded) && maxDraft.trim() !== savedMax;
  const maxValue = maxDraft.trim() === "" ? null : Number(maxDraft);
  const maxInvalid = maxValue !== null && (!Number.isInteger(maxValue) || maxValue < MAX_ATTEMPTS_RANGE.min || maxValue > MAX_ATTEMPTS_RANGE.max);
  const runningLast = ready ? limits?.effective ?? LAST_DIALLED_ATTEMPT : LEGACY_LAST_ATTEMPT;
  // The dialer as deployed: before 20260924230300 it stops at the sixth dial and merges a campaign's
  // rules with the tenant default. After it, the last dial is this scope's max calls (the draft's).
  const last = ready ? (maxInvalid ? runningLast : maxValue ?? limits?.inherited ?? LAST_DIALLED_ATTEMPT) : LEGACY_LAST_ATTEMPT;
  const rulesDirty = Boolean(loaded) && JSON.stringify(draft) !== JSON.stringify(saved);
  const dirty = rulesDirty || maxDirty;

  // The route re-checks all of this; here it is said where it happened, in the status line.
  const problem = useMemo(() => {
    const seen = new Set<string>();
    for (const row of draft) {
      const parsed = parseInterval(row.delayInterval);
      if (!parsed.ok) return `Call ${row.attemptNumber}: ${parsed.error}`;
      const key = `${row.attemptNumber}|${row.dispositionScope ?? ""}`;
      if (seen.has(key)) return `Call ${row.attemptNumber} has two rules for the same outcome.`;
      seen.add(key);
    }
    const numbers = [...new Set(draft.map((row) => row.attemptNumber))].sort((a, b) => a - b);
    const base = numbers[0] === 1 ? 1 : 2;
    const gap = numbers.findIndex((value, index) => value !== index + base);
    if (gap !== -1) return `Call ${gap + base} has no rule, so it would fall back to the built-in wait.`;
    if (maxInvalid) return `Max calls is a whole number from ${MAX_ATTEMPTS_RANGE.min} to ${MAX_ATTEMPTS_RANGE.max}.`;
    return null;
  }, [draft, maxInvalid]);

  const readOnly = !loaded?.canEdit;
  const editable = !readOnly && !viewing && !busy;
  const shownRows = viewing ? viewing.rules : draft;
  const ladder = useMemo(() => effectiveLadder(shownRows, fallback, { lastAttempt: last, merge: !ready, outcome }), [shownRows, fallback, last, ready, outcome]);
  const rules = useMemo(() => callingRules(calling, campaignId || null), [calling, campaignId]);
  const sim = useMemo(() => simulateCadence({ steps: ladder, startDate, arrival: ARRIVAL, rules }), [ladder, startDate, rules]);
  const words = summarize(sim);
  const ownCalls = useMemo(() => new Set(ladder.filter((step) => step.outcomeRule).map((step) => step.attempt)), [ladder]);
  const days = Math.max(14, Math.min(21, (sim.calls.at(-1)?.day ?? 0) + 1));
  const moved = sim.calls.filter((call) => call.moved);
  const preset: PresetKey | null = useMemo(() => matchPreset(materialize(draft, fallback, last), last), [draft, fallback, last]);

  /** Every edit starts from the ladder that runs, written out as rows, so nothing is saved with a gap. */
  const edit = useCallback(
    (change: (rows: CadenceRow[]) => CadenceRow[]) => {
      setSaveError("");
      setDraft((rows) => clean(change(materialize(rows, fallback, last))));
    },
    [fallback, last],
  );

  const onMove = ({ n, deltaDays, band }: TimelineMove) => {
    const step = ladder.find((entry) => entry.attempt === n);
    if (!step?.delayInterval) return;
    const patch: Partial<CadenceRow> = {};
    if (deltaDays) patch.delayInterval = shiftWait(step.delayInterval, deltaDays);
    if (band) patch.preferredSlot = BAND_PREFERENCE[band];
    edit((rows) => patchCall(rows, n, outcome, patch));
  };

  const removeTitle = !limitsReady ? "Removing a call needs max calls, which needs a database update. The dialer makes seven calls until then." : undefined;
  const onRemove = (n: number) => {
    if (n < 2 || !editable) return;
    if (!limitsReady) {
      notify.block("Calls can't be removed yet", { detail: removeTitle });
      return;
    }
    const before = { draft, maxDraft };
    edit((rows) => removeCall(rows, n));
    setMaxDraft(String(Math.max(1, last - 1)));
    setOpenCall(null);
    notify.done(`Call ${n} removed`, { action: { label: "Undo", onClick: () => { setDraft(before.draft); setMaxDraft(before.maxDraft); } } });
  };

  function choosePreset(key: PresetKey | "custom") {
    const chosen = PRESETS.find((entry) => entry.key === key);
    if (!chosen) return;
    setSaveError("");
    setDraft((rows) => clean(applyPreset(materialize(rows, fallback, last), chosen)));
    // Back to "inherit" when the preset's count is what this scope would inherit anyway.
    setMaxDraft(chosen.maxAttempts === (limits?.inherited ?? DEFAULT_CEILING) && savedMax === "" ? "" : String(chosen.maxAttempts));
    setOpenCall(null);
  }

  async function save() {
    if (problem) return;
    setBusy(true);
    setSaveError("");
    try {
      const response = await fetch("/api/app/cadence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignId || null,
          rows: draft,
          // Sent only when changed, so a cadence still saves before 20260929201100 is applied.
          ...(maxDirty ? { maxAttempts: maxValue } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveError(body?.code === "schema_pending" ? `${body.error} Your changes are kept.` : body?.error ?? "Couldn't save the cadence.");
        return;
      }
      notify.done(body.usingDefaults ? (campaignId ? "This campaign runs the agency cadence again." : "The Insurvas default is back in force.") : "Cadence saved.");
      await load(campaignId);
    } catch {
      setSaveError("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setDraft(saved);
    setMaxDraft(savedMax);
    setSaveError("");
    setOpenCall(null);
  }

  /* ── the frame's header: outcome tabs, Applies to, History, Reset ───────── */

  const campaigns = loaded?.campaigns ?? [];
  const ownByCampaign = new Map((loaded?.campaignCadences ?? []).map((entry) => [entry.campaignId, entry]));
  const scopeCampaigns: ScopeCampaign[] = campaigns.map((campaign) => {
    const own = ownByCampaign.get(campaign.id);
    return { id: campaign.id, name: campaign.name, own: own ? { calls: ready ? own.maxAttempts : LEGACY_LAST_ATTEMPT } : null };
  });
  const agencyOwn = loaded?.agency?.ownRules ?? (!campaignId && !loaded?.usingDefaults);
  const agencyCalls = ready ? loaded?.agency?.maxAttempts ?? DEFAULT_CEILING : LEGACY_LAST_ATTEMPT;
  const campaignName = campaigns.find((campaign) => campaign.id === campaignId)?.name;
  const onAgency = scopeCampaigns.filter((campaign) => !campaign.own);
  const withOwn = scopeCampaigns.filter((campaign) => campaign.own);

  const pickScope = async (next: string) => {
    if (next === campaignId) return;
    if (dirty && !(await confirmAction({ title: "Switch scope?", description: "Switching drops the unsaved changes to this cadence.", confirmLabel: "Switch and discard", cancelLabel: "Keep editing" }))) return;
    setCampaignId(next);
  };

  const tabs = <UnderlineTabs
    label={OUTCOME_TABS_LABEL}
    value={outcome}
    onChange={(key) => { setOutcome(key); setOpenCall(null); }}
    tabs={OUTCOMES.map((code) => {
      const differ = differingCalls(shownRows, code, last).length;
      return { key: code, label: OUTCOME_LABELS[code], count: differ || null, srSuffix: differ ? `(${differ} ${differ === 1 ? "call differs" : "calls differ"})` : undefined };
    })}
  />;
  const canReset = !readOnly && (draft.length > 0 || maxDraft !== "" || saved.length > 0);
  const actions = loaded ? (
    <>
      <ScopePicker campaignId={campaignId} campaigns={scopeCampaigns} agency={{ own: agencyOwn, calls: agencyCalls }} disabled={busy} onPick={(id) => void pickScope(id)} onOverride={(id) => setOverrideFor(id)} />
      <Button type="button" variant="ghost" onClick={() => setHistoryOpen(true)}><History aria-hidden="true" />History</Button>
      {!readOnly && (
        <Button type="button" variant="outline" disabled={!canReset || busy} onClick={() => setResetOpen(true)}><RotateCcw aria-hidden="true" />Reset to default</Button>
      )}
    </>
  ) : null;

  /* ── loading and error keep the title and tabs; only the card changes ── */

  if (error || !loaded)
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        <SettingsSectionHeader tabs={tabs} />
        <div className={cn(cardSurface, "min-h-[260px]")}>
          {error ? (
            <ErrorState title="Couldn't load the cadence" detail="The dialer keeps using the last saved cadence. Check your connection." action={<Button type="button" variant="outline" onClick={() => { setError(null); void load(campaignId); }}>Try again</Button>} />
          ) : (
            <SectionLoading rows={4} columns={3} label="Loading the cadence" />
          )}
        </div>
      </SettingsStack>
    );

  /* ── the status line ─────────────────────────────────────────────────── */

  const changes = describeChanges(saved, draft, maxDirty ? { before: limits?.own ?? null, after: maxValue } : undefined);
  const scopeSentence = campaignId
    ? ownByCampaign.has(campaignId) || saved.length > 0
      ? `${campaignName ?? "This campaign"} runs its own cadence; the agency cadence does not apply to it`
      : `${campaignName ?? "This campaign"} runs the agency cadence; a change here gives it its own`
    : campaigns.length === 0
      ? `${agencyOwn ? "Yours" : "The Insurvas default"} is in force`
      : `${agencyOwn ? "Yours" : "The Insurvas default"} is in force on ${onAgency.length} of ${campaigns.length} ${campaigns.length === 1 ? "campaign" : "campaigns"}${withOwn.length ? ` (${list(withOwn.map((campaign) => campaign.name))} ${withOwn.length === 1 ? "runs its" : "run their"} own)` : ""}`;
  const movedSentence = moved.length
    ? `${moved.length} ${moved.length === 1 ? "call moves" : "calls move"}: ${moved.slice(0, 3).map((call) => `${dayLabel(startDate, call.wanted?.day ?? call.day)} ${call.movedBecause === "after your calling hours" ? "is after your calling hours" : call.movedBecause === "Sunday" ? "is a no-call day" : `is ${call.movedBecause}`}`).join(", ")}`
    : null;
  const pending = [
    !ready ? "the dialer stops after the sixth call until a database update is applied" : null,
    ready && !limitsReady ? "max calls needs a database update (seven until then)" : null,
    calling === "error" ? "calling windows could not be read, so no days are shaded" : null,
    readOnly ? "only an owner can change the cadence" : null,
  ].filter(Boolean);
  let tone: StatusTone = pending.length ? "warning" : "good";
  let lead: ReactNode = null;
  let retry: ReactNode = null;
  if (saveError) {
    tone = "danger";
    lead = saveError;
    retry = <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs text-[var(--error-ink)] underline" onClick={() => void save()}>Retry</Button>;
  } else if (dirty && problem) {
    tone = "warning";
    lead = problem;
  } else if (dirty) {
    tone = "warning";
    lead = `${changes.length || 1} unsaved ${changes.length === 1 ? "change" : "changes"}`;
  } else if (moved.length) tone = "warning";
  const status = [
    lead,
    scopeSentence,
    movedSentence,
    !dirty && lastSave ? `saved${lastSave.by ? ` by ${lastSave.by}` : ""} ${ago(lastSave.at)}` : null,
    ...pending,
  ].filter(Boolean) as ReactNode[];

  /* ── the cadence card ────────────────────────────────────────────────── */

  const firstEver = !campaignId && !dirty && draft.length === 0 && saved.length === 0 && !viewing && !readOnly;
  const defaultWords = summarize(simulateCadence({ steps: effectiveLadder([], [], { lastAttempt: ready ? DEFAULT_CEILING : LEGACY_LAST_ATTEMPT }), startDate, arrival: ARRIVAL, rules: callingRules(calling, null) }));
  const agencyRows = campaignId ? fallback : saved;
  const agencyMax = campaignId ? limits?.inherited ?? DEFAULT_CEILING : limits?.effective ?? DEFAULT_CEILING;
  const agencyWords = summarize(simulateCadence({ steps: effectiveLadder(agencyRows, [], { lastAttempt: ready ? agencyMax : LEGACY_LAST_ATTEMPT }), startDate, arrival: ARRIVAL, rules: callingRules(calling, null) }));
  const shownMaterialized = materialize(shownRows, fallback, last);

  const popover = (n: number) => {
    const step = ladder.find((entry) => entry.attempt === n);
    const call = sim.calls.find((entry) => entry.n === n);
    return (
      <CallPopover
        n={n}
        landsAt={call ? callLabel(startDate, call.at).replace(" · ", ", ") : "—"}
        rule={n === 1 || !step?.delayInterval ? null : { delayInterval: step.delayInterval, preferredSlot: step.preferredSlot }}
        outcome={outcome}
        ownRule={shownRows.some((row) => row.attemptNumber === n && row.dispositionScope === outcome)}
        rowsForCall={shownMaterialized.filter((row) => row.attemptNumber === n)}
        readOnly={!editable}
        canRemove={limitsReady && n > 1}
        removeTitle={removeTitle}
        onPatch={(patch) => edit((rows) => patchCall(rows, n, outcome, patch))}
        onSplit={(code) => edit((rows) => splitOutcome(rows, n, code))}
        onJoin={(code) => edit((rows) => joinOutcome(rows, n, code))}
        onRemove={() => onRemove(n)}
        onClose={() => setOpenCall(null)}
      />
    );
  };

  const firstCall = sim.calls[0];
  const exampleLine = `Example lead arriving ${longDayLabel(startDate, 0)}, ${clockLabel(firstCall?.at ?? ARRIVAL)}, in the lead's own time.${editable ? " Drag a call sideways to change its wait; click it to edit." : ""}`;

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader tabs={tabs} actions={actions} />
      <StatusLine tone={tone} action={retry}>{status.map((part, index) => <span key={index}>{index > 0 ? " · " : ""}{part}</span>)}</StatusLine>

      <div ref={rootRef} className="flex min-h-0 flex-1 gap-3 max-lg:flex-col">
        <section aria-label="Cadence" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[var(--surface-alt)] px-4 py-2.5">
            <b className="text-sm font-semibold text-[var(--ink)]">{campaignId ? `${campaignName ?? "Campaign"} cadence` : "Agency cadence"}</b>
            {viewing ? (
              <>
                <StatusChip tone="info">Viewing {viewing.label.toLowerCase()}</StatusChip>
                <span className="ml-auto flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(null)}>Back to your draft</Button>
                  {!readOnly && <Button type="button" size="sm" onClick={() => { setDraft(clean(viewing.rules)); setViewing(null); notify.done(`${viewing.label} is your draft. Save to put it in force.`); }}>Restore</Button>}
                </span>
              </>
            ) : (
              <>
                {draft.length === 0 && !campaignId && <DefaultChip />}
                <Seg
                  label="Preset"
                  className="ml-1"
                  disabled={!editable}
                  value={preset ?? "custom"}
                  onChange={(key) => key !== "custom" && choosePreset(key)}
                  options={[
                    ...PRESETS.map((entry) => ({
                      key: entry.key as PresetKey | "custom",
                      label: entry.label,
                      title: !limitsReady && entry.maxAttempts !== DEFAULT_CEILING ? "Needs max calls, which needs a database update" : entry.hint,
                      disabled: !limitsReady && entry.maxAttempts !== DEFAULT_CEILING,
                    })),
                    { key: "custom", label: "Custom", title: "Your own waits and times" },
                  ]}
                />
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--muted)]">Max calls</span>
                  <Stepper
                    id="cadence-max-attempts"
                    label="Max calls"
                    value={last}
                    min={MAX_ATTEMPTS_RANGE.min}
                    max={MAX_ATTEMPTS_RANGE.max}
                    disabled={!editable || !limitsReady}
                    invalid={maxInvalid}
                    text={maxDraft}
                    placeholder={String(limits?.inherited ?? LAST_DIALLED_ATTEMPT)}
                    onText={(text) => setMaxDraft(text)}
                    onChange={(value) => setMaxDraft(String(value))}
                    title={
                      !limitsReady
                        ? "Max calls needs a database update that has not been applied yet. The dialer stops at seven."
                        : campaignId
                          ? `Blank uses the agency's (${limits?.inherited ?? LAST_DIALLED_ATTEMPT}). A recycled lead keeps its own ceiling.`
                          : `Blank uses ${LAST_DIALLED_ATTEMPT}. A campaign may set its own. A recycled lead keeps its own ceiling.`
                    }
                  />
                </span>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3.5">
            {firstEver ? (
              <EmptyState
                title="No cadence of your own yet"
                hint={`The Insurvas default is in force: ${defaultWords.headline}, front-loaded.`}
                action={<Button type="button" onClick={() => setDraft(clean(materialize([], [], last)))}>Copy it and edit</Button>}
              />
            ) : (
              <>
                <p className="m-0 mb-1 text-base leading-[1.4] text-[var(--ink)]">
                  {OUTCOME_SUBJECT[outcome]} gets <span className="font-semibold text-[var(--accent-ink)]">{words.headline}</span>{words.when}.{words.share ? ` ${words.share}` : ""}
                </p>
                <p className="m-0 mb-3.5 text-xs text-[var(--muted)]">{exampleLine}</p>
                <CadenceTimeline
                  calls={sim.calls}
                  startDate={startDate}
                  days={days}
                  rules={rules}
                  ownCalls={ownCalls}
                  editable={editable}
                  openCall={openCall}
                  onOpenCall={setOpenCall}
                  onMove={onMove}
                  onRemove={onRemove}
                  renderPopover={popover}
                  label={`${OUTCOME_LABELS[outcome]}: the example lead's calls`}
                />
                <TimelineLegend hasMoved={moved.length > 0} link={<Link href="/app/settings#calling-windows" className="font-medium text-[var(--accent-ink)] hover:underline">Calling windows</Link>} />
              </>
            )}
          </div>

          {!readOnly && dirty && (
            <div role="region" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--surface-alt)] px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--body)]">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--warning)]" />
                <span className="truncate">
                  {changes.length || 1} {changes.length === 1 ? "change" : "changes"} not saved{changes[0] ? ` · ${changes[0].text[0].toLowerCase()}${changes[0].text.slice(1)}` : ""}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={discard}>Discard</Button>
                <Button type="button" size="sm" disabled={busy || Boolean(problem)} title={problem ?? undefined} onClick={() => void save()}>{busy ? "Saving…" : "Save cadence"}</Button>
              </span>
            </div>
          )}
        </section>

        <aside aria-label="What happens" className={cn(cardSurface, "flex min-h-0 flex-col overflow-hidden lg:w-[330px] lg:shrink-0")}>
          <div className="border-b border-border bg-[var(--surface-alt)] px-4 py-2.5">
            <b className="text-sm font-semibold text-[var(--ink)]">What happens</b>
            <span className="ml-2 text-xs text-[var(--muted)]">{OUTCOME_LABELS[outcome]} every time</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <WhatHappens
              calls={sim.calls}
              startDate={startDate}
              ownCalls={ownCalls}
              openCall={openCall}
              onOpenCall={(n) => setOpenCall(n)}
              unplaced={sim.unplaced}
              footer={
                <>
                  Your calling hours in the lead&apos;s time: {windowWords(rules)}{rules.campaignWindow ? ` (${campaignName}'s own hours)` : ""}. State rules can narrow them further for some leads;{" "}
                  <Link href="/app/settings#calling-windows" className="font-medium text-[var(--accent-ink)] hover:underline">Calling windows</Link> lists them.
                </>
              }
            />
          </div>
        </aside>
      </div>

      {!readOnly && <LeaveGuard dirty={dirty} scope={guardScope} onDiscard={discard} what="the cadence" />}

      {historyOpen && (
        <HistorySheet
          campaignId={campaignId}
          scopeName={campaignName ?? "Every campaign"}
          readOnly={readOnly}
          describe={(rows) => summarize(simulateCadence({ steps: effectiveLadder(rows, fallback, { lastAttempt: last, outcome: "no_answer" }), startDate, arrival: ARRIVAL, rules })).headline}
          onView={(version) => { setViewing(version); setHistoryOpen(false); setOpenCall(null); }}
          onRestore={(version) => {
            setDraft(clean(version.rules));
            setViewing(null);
            setHistoryOpen(false);
            notify.done(`${version.label} is your draft. Save to put it in force.`);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {overrideFor !== null && (
        <OverrideSheet
          campaigns={onAgency.map(({ id, name }) => ({ id, name }))}
          initialCampaignId={overrideFor}
          agencyRows={agencyRows}
          agencyMax={ready ? agencyMax : LEGACY_LAST_ATTEMPT}
          limitsReady={limitsReady}
          calling={calling}
          startDate={startDate}
          arrival={ARRIVAL}
          onClose={() => setOverrideFor(null)}
          onSaved={(id) => {
            setOverrideFor(null);
            if (!dirty && id !== campaignId) setCampaignId(id);
            else void load(campaignId);
          }}
        />
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={campaignId ? `Put ${campaignName ?? "this campaign"} back on the agency cadence?` : "Go back to the Insurvas default?"}
        description={
          campaignId
            ? `${campaignName ?? "This campaign"} goes back to the agency cadence: ${agencyWords.headline}.`
            : `${onAgency.length ? list(onAgency.map((campaign) => campaign.name)) : "Every campaign on the agency cadence"} ${onAgency.length === 1 ? "goes" : "go"} back to ${defaultWords.headline}.${withOwn.length ? ` ${list(withOwn.map((campaign) => campaign.name))} ${withOwn.length === 1 ? "keeps its" : "keep their"} own cadence.` : ""}`
        }
        confirmLabel="Reset to default"
        cancelLabel="Cancel"
        onConfirm={() => {
          setDraft([]);
          setMaxDraft("");
          setViewing(null);
          setOpenCall(null);
          setResetOpen(false);
        }}
      >
        <p className="m-0 text-xs text-[var(--muted)]">It becomes your draft: nothing changes for the dialer until you save. Leads already mid-cadence keep their next scheduled call. What you saved stays in History, so you can restore it.</p>
      </ConfirmDialog>
    </SettingsStack>
  );
}
