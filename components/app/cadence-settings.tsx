"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import {
  Callout,
  Field,
  LockIcon,
  Pill,
  SettingsSectionHeader,
  SettingsStack,
  control,
  st,
} from "@/components/app/settings/primitives";
import { DAY_PARTS, SLOTS, parseInterval, type CadenceRow } from "@/lib/cadence/engine";
import { LAST_DIALLED_ATTEMPT, builtInRule, effectiveLadder, ladderSummary } from "@/lib/cadence/ladder";
import { cn } from "@/lib/utils";

/**
 * LA-2.7 · the cadence editor.
 *
 * The table this writes had no writer at all, so every tenant ran the built-in cadence and could
 * not see that they were. The panel therefore leads with which of the two is actually in force —
 * that is the fact an owner is missing, more than the row editor itself.
 *
 * Numbering follows the SQL, not the task page: the rule stored as attempt N is the wait before
 * the Nth dial. Attempt 1 is the first dial and has no rule; the seventh dial is the last
 * (20260924230300 — the sixth until it is applied). See lib/cadence/ladder.ts.
 */

/** The dialer before 20260924230300: it stopped after the sixth dial. */
const LEGACY_LAST_ATTEMPT = LAST_DIALLED_ATTEMPT - 1;

const SLOT_LABELS: Record<string, string> = {
  opposite_half: "Opposite half of the day",
  morning: "Morning",
  evening: "Evening",
  early_morning: "Early morning",
  late_morning: "Late morning",
  afternoon: "Afternoon",
  early_evening: "Early evening",
  late_evening: "Late evening",
  weekend: "Weekend",
};

const ordinal = (value: number) => (["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][value] ?? `${value}th`);

// The dispositions worth giving their own delay. "No-answer and voicemail should not behave
// identically" is the criterion; leaving the scope blank applies a row to every outcome.
const DISPOSITION_SCOPES = ["no_answer", "voicemail", "busy", "callback", "not_interested"] as const;
const scopeLabel = (scope: string | null | undefined) => {
  if (!scope) return "Any outcome";
  const text = scope.replace(/_/g, " ");
  return text[0].toUpperCase() + text.slice(1);
};

type Draft = CadenceRow & { key: string };

/** The render key is local bookkeeping; the API takes the cadence row without it. */
function withoutKey(draft: Draft): CadenceRow {
  const copy: Partial<Draft> = { ...draft };
  delete copy.key;
  return copy as CadenceRow;
}

type Loaded = {
  rows: CadenceRow[];
  usingDefaults: boolean;
  defaults: CadenceRow[];
  campaigns: { id: string; name: string }[];
  fallbackRows?: CadenceRow[];
  /** 20260924230300 applied: day parts, seven dials, a campaign cadence never merged, atomic saves. */
  schemaReady?: boolean;
  canEdit: boolean;
};

let nextKey = 0;
const withKeys = (rows: CadenceRow[]): Draft[] => rows.map((row) => ({ ...row, key: `row-${(nextKey += 1)}` }));

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
  const [draft, setDraft] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // A promise chain rather than async/await, for the same reason as the calendar panel: the effect
  // below calls this on mount, and the linter can reach a setState synchronously through an async
  // function body even when it sits after an await. Every setState here lands in a callback.
  const load = useCallback(
    (campaign: string) =>
      fetch(`/api/app/cadence${campaign ? `?campaignId=${campaign}` : ""}`, { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load the cadence");
          return body as Loaded;
        })
        .then((body) => {
          setError(null);
          setLoaded(body);
          setDraft(withKeys(body.rows));
          setOpenKey(null);
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

  // Validation runs on the draft rather than on submit, because a cadence is read down the page
  // and an error attached to the row it belongs to is worth more than one toast naming a row
  // number. The route re-checks all of it — this is the explanation, not the enforcement.
  const problems = useMemo(() => {
    const byRow = new Map<string, string>();
    const seen = new Map<string, string>();
    draft.forEach((row) => {
      const parsed = parseInterval(row.delayInterval);
      if (!parsed.ok) byRow.set(row.key, parsed.error);
      const key = `${row.attemptNumber}|${row.dispositionScope ?? ""}`;
      const first = seen.get(key);
      if (first) byRow.set(row.key, row.dispositionScope
        ? `Attempt ${row.attemptNumber} already has a rule for “${row.dispositionScope}”.`
        : `Attempt ${row.attemptNumber} already has a catch-all rule.`);
      else seen.set(key, row.key);
    });
    const numbers = [...new Set(draft.map((row) => row.attemptNumber))].sort((a, b) => a - b);
    const base = numbers[0] === 1 ? 1 : 2;
    const gap = numbers.findIndex((value, index) => value !== index + base);
    return { byRow, gap: gap === -1 ? null : gap + base };
  }, [draft]);

  const dirty = Boolean(loaded) && JSON.stringify(draft.map(withoutKey)) !== JSON.stringify(loaded?.rows ?? []);
  const invalid = problems.byRow.size > 0 || problems.gap !== null;

  function update(key: string, patch: Partial<CadenceRow>) {
    setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow(attempt?: number) {
    const numbers = draft.map((row) => row.attemptNumber);
    const next = attempt ?? (numbers.length === 0 ? 2 : Math.max(...numbers) + 1);
    const key = `row-${(nextKey += 1)}`;
    const built = builtInRule(next);
    setDraft((rows) => [...rows, { key, attemptNumber: next, delayInterval: built.delayInterval, preferredSlot: built.preferredSlot, dispositionScope: null }]);
    setOpenKey(key);
  }

  function startFromDefaults() {
    if (!loaded) return;
    // The built-in table's attempt-1 row ("2 hours") is never read by the scheduler, so it is not
    // copied: the draft starts with the rules that actually run.
    setDraft(withKeys(loaded.defaults.filter((row) => row.attemptNumber >= 2)));
  }

  async function save() {
    if (invalid) return;
    setBusy(true);
    setSaveError("");
    try {
      const response = await fetch("/api/app/cadence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignId || null,
          rows: draft.map(withoutKey),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveError(body?.error ?? "Could not save the cadence");
        return;
      }
      notify.done(
        body.usingDefaults
          ? "Cadence cleared — the built-in schedule is back in force."
          : campaignId
            ? "Campaign cadence saved."
            : "Cadence saved.",
      );
      await load(campaignId);
    } catch {
      setSaveError("Could not save the cadence. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !loaded?.canEdit;

  if (error)
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title={error} />
      </SettingsStack>
    );
  if (!loaded)
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <TableCard><SectionLoading label="Loading the cadence" /></TableCard>
      </SettingsStack>
    );

  const fallback = loaded.fallbackRows ?? [];
  const ready = loaded.schemaReady !== false;
  // The dialer as deployed: before 20260924230300 it stops at the sixth dial and merges a
  // campaign's rules with the tenant default attempt by attempt.
  const lastAttempt = ready ? LAST_DIALLED_ATTEMPT : LEGACY_LAST_ATTEMPT;
  const ladderOptions = { lastAttempt, merge: !ready };
  const running = effectiveLadder(loaded.rows, fallback, ladderOptions);
  const runningSummary = ladderSummary(running);
  const planned = effectiveLadder(draft, fallback, ladderOptions);
  const plannedSummary = ladderSummary(planned);
  const covered = new Set(draft.filter((row) => !row.dispositionScope).map((row) => row.attemptNumber));
  const fillers = planned.filter((step) => step.attempt >= 2 && !covered.has(step.attempt));
  const sorted = [...draft].sort(
    (a, b) => a.attemptNumber - b.attemptNumber || Number(Boolean(a.dispositionScope)) - Number(Boolean(b.dispositionScope)),
  );
  const campaignName = loaded.campaigns.find((campaign) => campaign.id === campaignId)?.name;

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <StatStrip label="Cadence in force">
        <StatTile
          label="In force"
          value={loaded.usingDefaults ? "Built-in" : "Yours"}
          footnote={loaded.usingDefaults && campaignId && fallback.length > 0 ? "tenant default for this campaign" : `${runningSummary.total} attempts running`}
        />
        <StatTile label="Planned attempts" value={plannedSummary.total} footnote={`over ${plannedSummary.days} ${plannedSummary.days === 1 ? "day" : "days"}`} />
        <StatTile label="First 72 hours" value={plannedSummary.first72} footnote={plannedSummary.first72 === 1 ? "attempt" : "attempts"} />
        <StatTile label="Days 4–7" value={plannedSummary.week} footnote={plannedSummary.week === 1 ? "attempt" : "attempts"} />
        <StatTile label={plannedSummary.lastDay > 7 ? `Days 8–${plannedSummary.lastDay}` : "After day 7"} value={plannedSummary.later} footnote={plannedSummary.later === 1 ? "attempt" : "attempts"} />
      </StatStrip>

      {saveError && <Callout tone="error" title={saveError} />}
      {readOnly && <Callout tone="info" title="Only an owner can change the cadence. You are seeing what is in force." />}
      {!ready && <Callout tone="warning" title={`Until a pending database update is applied, the dialer stops after the ${ordinal(lastAttempt)} dial.`} />}

      <TableCard
        title="Attempt ladder"
        toolbar={
          <DataToolbar
            actions={
              !readOnly ? (
                <>
                  {draft.length === 0 && (
                    <Button type="button" variant="outline" disabled={busy} onClick={startFromDefaults}>
                      Start from the built-in cadence
                    </Button>
                  )}
                  <Button type="button" disabled={busy} onClick={() => addRow()}>
                    <Plus aria-hidden="true" />
                    Add a rule
                  </Button>
                </>
              ) : undefined
            }
          >
            <label htmlFor="cadence-scope" className="sr-only">Applies to</label>
            <select
              id="cadence-scope"
              className={cn(toolbarControl, "max-w-full")}
              value={campaignId}
              disabled={busy}
              title={ready ? "A campaign cadence replaces the tenant default entirely." : "A campaign rule wins over the tenant default for the same attempt."}
              onChange={(event) => {
                if (dirty && !window.confirm("Switching scope drops the unsaved changes to this cadence. Continue?")) return;
                setCampaignId(event.target.value);
              }}
            >
              <option value="">Every campaign (tenant default)</option>
              {loaded.campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
            {dirty && <Pill tone="warning">Unsaved changes</Pill>}
          </DataToolbar>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[110px]")}>Attempt</th>
              <th scope="col" className={cn(st.th, "w-[220px]")}>Wait from previous</th>
              <th scope="col" className={cn(st.th, "w-[230px]")}>Preferred time</th>
              <th scope="col" className={st.th}>Applies after</th>
              <th scope="col" className={cn(st.th, st.num, "w-[110px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={st.td}>1</td>
              <td className={st.td}>Immediately on import</td>
              <td className={st.td}>Any time that is legal</td>
              <td className={st.td}>Any outcome</td>
              <td className={cn(st.td, st.num)}>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]" title="The first dial has no wait, so there is no rule to edit.">
                  <LockIcon />
                  <span className="sr-only">The first dial has no wait, so there is no rule to edit.</span>
                </span>
              </td>
            </tr>
            {sorted.map((row) => {
              const problem = problems.byRow.get(row.key);
              const expanded = openKey === row.key;
              const unread =
                row.attemptNumber === 1
                  ? "Never read: attempt 1 is the first dial and has no wait."
                  : row.attemptNumber > lastAttempt
                    ? `Never read: the dialer stops after attempt ${lastAttempt}.`
                    : null;
              const isLast = !row.dispositionScope && row.attemptNumber === Math.min(lastAttempt, Math.max(...draft.filter((r) => !r.dispositionScope).map((r) => r.attemptNumber)));
              return (
                <RuleRows
                  key={row.key}
                  row={row}
                  expanded={expanded}
                  problem={problem}
                  unread={unread}
                  restsAfter={isLast && row.attemptNumber === lastAttempt}
                  dayPartsReady={ready}
                  readOnly={readOnly}
                  disabled={busy}
                  onToggle={() => setOpenKey(expanded ? null : row.key)}
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => { setDraft((rows) => rows.filter((entry) => entry.key !== row.key)); setOpenKey(null); }}
                />
              );
            })}
            {fillers.map((step) => (
              <tr key={`filler-${step.attempt}`}>
                <td className={st.td}>{step.attempt}</td>
                <td className={st.td}>
                  {step.delayInterval}
                  <span className={st.sub}>{step.source === "tenant" ? "From the tenant default" : "Built-in"}</span>
                </td>
                <td className={st.td}>{step.preferredSlot ? SLOT_LABELS[step.preferredSlot] : "Any time that is legal"}</td>
                <td className={st.td}>
                  {step.attempt === lastAttempt ? "Any outcome — then rests" : "Any outcome"}
                </td>
                <td className={cn(st.td, st.num)}>
                  {!readOnly && problems.gap === null && step.attempt === (draft.length ? Math.max(...draft.map((r) => r.attemptNumber)) + 1 : 2) && (
                    <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Set a rule for attempt ${step.attempt}`} onClick={() => addRow(step.attempt)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(problems.gap !== null || (!readOnly && draft.length > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
            {problems.gap !== null ? (
              <p role="alert" className="m-0 text-[14px] text-[var(--error-ink)]">
                Attempt {problems.gap} is missing — add it, or the dialer uses the built-in delay there.
              </p>
            ) : (
              <span />
            )}
            {!readOnly && draft.length > 0 && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft([]); setOpenKey(null); }}>
                Clear and use the built-in cadence
              </Button>
            )}
          </div>
        )}
      </TableCard>

      {!readOnly && (
        <SettingsSaveBar visible={dirty} note={campaignName ? `Unsaved changes to ${campaignName}'s cadence` : "Unsaved changes to the cadence"}>
          <Button type="button" variant="outline" onClick={() => { setDraft(withKeys(loaded.rows)); setSaveError(""); setOpenKey(null); }} disabled={busy}>Discard</Button>
          <Button type="button" onClick={() => void save()} disabled={busy || invalid}>{busy ? "Saving…" : "Save changes"}</Button>
        </SettingsSaveBar>
      )}
    </SettingsStack>
  );
}

function RuleRows({
  row,
  expanded,
  problem,
  unread,
  restsAfter,
  dayPartsReady,
  readOnly,
  disabled,
  onToggle,
  onChange,
  onRemove,
}: {
  row: Draft;
  expanded: boolean;
  problem: string | undefined;
  unread: string | null;
  restsAfter: boolean;
  /** False until 20260924230300 is applied: the scheduler cannot honour a day part yet. */
  dayPartsReady: boolean;
  readOnly: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<CadenceRow>) => void;
  onRemove: () => void;
}) {
  const id = row.key;
  return (
    <>
      <tr>
        <td className={st.td}>{row.attemptNumber}</td>
        <td className={st.td}>
          {row.delayInterval || "—"}
          {problem && <span role="alert" className="block text-[12px] leading-[1.5] text-[var(--error-ink)]">{problem}</span>}
          {!problem && unread && <span className={cn(st.sub, "text-[var(--warning-ink)]")}>{unread}</span>}
        </td>
        <td className={st.td}>{row.preferredSlot ? SLOT_LABELS[row.preferredSlot] ?? row.preferredSlot : "Any time that is legal"}</td>
        <td className={st.td}>{scopeLabel(row.dispositionScope)}{restsAfter ? " — then rests" : ""}</td>
        <td className={cn(st.td, st.num)}>
          {!readOnly && (
            <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-label={`Edit the rule for attempt ${row.attemptNumber}`} onClick={onToggle}>
              {expanded ? "Done" : "Edit"}
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className={cn(st.td, "bg-[var(--surface-alt)]")}>
            <div className="grid gap-3 py-1 sm:grid-cols-[7rem_1fr_1fr_1fr_auto] sm:items-end">
              <Field label="Attempt" htmlFor={`${id}-attempt`}>
                <input
                  id={`${id}-attempt`}
                  type="number"
                  min={1}
                  max={50}
                  className={control}
                  disabled={disabled}
                  value={row.attemptNumber}
                  onChange={(event) => onChange({ attemptNumber: Number(event.target.value) })}
                />
              </Field>
              <Field label="Wait from previous" htmlFor={`${id}-wait`}>
                <input
                  id={`${id}-wait`}
                  className={control}
                  disabled={disabled}
                  placeholder="2 hours"
                  value={row.delayInterval}
                  onChange={(event) => onChange({ delayInterval: event.target.value })}
                />
              </Field>
              <Field label="Preferred time" htmlFor={`${id}-slot`}>
                <select
                  id={`${id}-slot`}
                  className={control}
                  disabled={disabled}
                  value={row.preferredSlot ?? ""}
                  onChange={(event) => onChange({ preferredSlot: (event.target.value || null) as CadenceRow["preferredSlot"] })}
                >
                  <option value="">Any time that is legal</option>
                  {DAY_PARTS.map((part) => (
                    <option key={part} value={part} disabled={!dayPartsReady && row.preferredSlot !== part}>
                      {SLOT_LABELS[part]}{dayPartsReady ? "" : " (needs a database update)"}
                    </option>
                  ))}
                  <optgroup label="A specific part of the day">
                    {SLOTS.map((slot) => (
                      <option key={slot} value={slot}>{SLOT_LABELS[slot] ?? slot}</option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              <Field label="Applies after" htmlFor={`${id}-scope`}>
                <select
                  id={`${id}-scope`}
                  className={control}
                  disabled={disabled}
                  value={row.dispositionScope ?? ""}
                  onChange={(event) => onChange({ dispositionScope: event.target.value || null })}
                >
                  <option value="">Any outcome</option>
                  {DISPOSITION_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>{scopeLabel(scope)}</option>
                  ))}
                  {row.dispositionScope && !(DISPOSITION_SCOPES as readonly string[]).includes(row.dispositionScope) && (
                    <option value={row.dispositionScope}>{scopeLabel(row.dispositionScope)}</option>
                  )}
                </select>
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-1.5 text-[var(--error-ink)]"
                disabled={disabled}
                onClick={onRemove}
                aria-label={`Remove the rule for attempt ${row.attemptNumber}`}
              >
                Delete
              </Button>
            </div>
            <p className="mt-2 mb-0 text-[12px] leading-[1.5] text-[var(--muted)]">A number and a unit: minutes, hours, days or weeks. The dialer always stays inside the legal calling window.</p>
          </td>
        </tr>
      )}
    </>
  );
}
