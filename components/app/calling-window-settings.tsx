"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  ToggleRow,
  btn,
  control,
  st,
} from "@/components/app/settings/primitives";
import {
  FEDERAL_MINUTES,
  campaignMinutes,
  effectiveMinutes,
  inputToMinute,
  minuteLabel,
  minuteToInput,
  statesToList,
  toMinutes,
  type CallingWindowOptions,
  type CallingWindowSettings,
  type CampaignWindow,
  type MinuteWindow,
} from "@/lib/callingWindow/engine";
import { US_STATES } from "@/lib/appointments/constants";
import { dayMonthYear } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

/**
 * LA-2.4 · Calling windows.
 *
 * The agency's own hours and its three switches are one draft (Discard / Save changes in the
 * header). A campaign's narrowing is edited in its own dialog and saved from there, because each
 * campaign is its own row with its own busy state — the header does not pretend to hold it.
 */

type Loaded = CallingWindowSettings & { canEdit: boolean };
type Draft = { start: string; end: string; options: CallingWindowOptions };

const STATE_NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
const stateName = (code: string) => STATE_NAMES.get(code) ?? code;

/** `8am`, `7:30pm` — the callout's compact voice. */
function compact(minutes: number) {
  const label = minuteLabel(minutes).replace(" ", "");
  return label.replace(":00", "");
}

function draftFrom(loaded: CallingWindowSettings): Draft {
  const window = loaded.tenant ? toMinutes(loaded.tenant) : null;
  return {
    start: minuteToInput(window?.start ?? null),
    end: minuteToInput(window?.end ?? null),
    options: { ...loaded.options },
  };
}

/** Validation shared by the agency form and the campaign dialog, in the route's own words. */
function checkWindow(start: string, end: string): { window: MinuteWindow | null; problem: string | null } {
  if (!start && !end) return { window: null, problem: null };
  if (!start || !end) return { window: null, problem: "Set both hours, or neither. One alone is ambiguous and is refused." };
  const window = { start: inputToMinute(start) ?? 0, end: inputToMinute(end, true) ?? 0 };
  if (window.start >= window.end) return { window, problem: "A calling window has to end after it starts." };
  if (window.start < FEDERAL_MINUTES.start || window.end > FEDERAL_MINUTES.end)
    return {
      window,
      problem: `That is wider than federal law allows (${minuteLabel(FEDERAL_MINUTES.start)}–${minuteLabel(FEDERAL_MINUTES.end)}), so it will be refused rather than saved and quietly ignored.`,
    };
  return { window, problem: null };
}

export function CallingWindowSettingsPanel() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [campaignEditor, setCampaignEditor] = useState<{ campaign: CampaignWindow | null } | null>(null);

  // A promise chain, not async/await: the effect below calls this on mount and every setState has
  // to land in a callback rather than anywhere the linter can reach it synchronously.
  const load = useCallback(
    () =>
      fetch("/api/app/calling-windows", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load your calling windows");
          return body as Loaded;
        })
        .then((body) => {
          setError(null);
          setLoaded(body);
          setDraft(draftFrom(body));
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not load your calling windows");
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const baseline = useMemo(() => (loaded ? draftFrom(loaded) : null), [loaded]);
  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const check = draft ? checkWindow(draft.start, draft.end) : { window: null, problem: null };

  async function put(body: Record<string, unknown>): Promise<Loaded | null> {
    const response = await fetch("/api/app/calling-windows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Could not save the calling window");
    return { ...(result as CallingWindowSettings), canEdit: loaded?.canEdit ?? false };
  }

  async function saveAgency(clear = false) {
    if (!draft || !baseline || !loaded) return;
    if (!clear && check.problem) return;
    setBusy(true);
    setSaveError("");
    try {
      const hoursChanged = clear || draft.start !== baseline.start || draft.end !== baseline.end;
      const optionsChanged = !clear && JSON.stringify(draft.options) !== JSON.stringify(baseline.options);
      const window = clear ? null : check.window;
      const next = hoursChanged
        ? await put({
            scope: "tenant",
            window: window ? { startMinute: window.start, endMinute: window.end } : null,
            ...(optionsChanged ? { options: draft.options } : {}),
          })
        : await put({ scope: "options", options: draft.options });
      if (next) {
        setLoaded(next);
        setDraft(clear ? { ...draftFrom(next), options: draft.options } : draftFrom(next));
      }
      notify.done(clear ? "Your own narrowing was cleared." : "Calling window saved.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save the calling window");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <SettingsSectionHeader
      actions={
        loaded?.canEdit && draft ? (
          <DraftActions
            dirty={dirty}
            saving={busy}
            disabled={Boolean(check.problem)}
            onDiscard={() => { if (baseline) setDraft(baseline); setSaveError(""); }}
            onSave={() => void saveAgency()}
          />
        ) : undefined
      }
    />
  );

  if (error)
    return (
      <SettingsStack>
        {header}
        <Callout tone="error" title="Could not load your calling windows">{error}</Callout>
      </SettingsStack>
    );
  if (!loaded || !draft)
    return (
      <SettingsStack>
        {header}
        <p role="status" className="text-[14px] text-[var(--muted)]">Loading your calling windows…</p>
      </SettingsStack>
    );

  const readOnly = !loaded.canEdit;
  const tenantWindow = loaded.tenant ? toMinutes(loaded.tenant) : null;

  // Only the states whose statute actually bites, given what the agency has set. Fifty-two rows
  // that mostly repeat the federal hours bury the six that do not.
  //
  // `noHolidays` is deliberately NOT one of the tests. It is true for every state in the table, so
  // including it qualified all fifty-two and produced exactly the list this filter exists to avoid
  // — verified in the browser, where the panel listed every state with an identical badge. A rule
  // that applies everywhere is said once, below the list.
  const everyStateBansHolidays =
    loaded.stateRules.length > 0 && loaded.stateRules.every((rule) => rule.noHolidays);
  const withoutState = effectiveMinutes(undefined, tenantWindow, null);
  // The board lists the states this agency works in — federal-hours states included — and falls
  // back to the states whose rule bites only when it cannot tell which states those are.
  const { rules: listed, basis } = statesToList(loaded.stateRules, loaded.dialingStates, (rule) => {
    const effective = effectiveMinutes(rule, tenantWindow, null);
    return (
      effective.start !== withoutState.start ||
      effective.end !== withoutState.end ||
      rule.noSunday ||
      (rule.noHolidays && !everyStateBansHolidays)
    );
  });
  const feed = loaded.rulesFeed ?? null;
  const refreshed = feed ? new Date(feed.lastRefreshedAt) : null;
  const refreshedLabel =
    refreshed && !Number.isNaN(refreshed.getTime())
      ? `${refreshed.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, ${refreshed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : null;

  // The callout's example comes from a real rule, never from the board's sample state.
  const example = loaded.stateRules.find(
    (rule) => rule.startHour * 60 > FEDERAL_MINUTES.start || rule.endHour * 60 < FEDERAL_MINUTES.end,
  );

  const narrowing = loaded.campaigns.filter((campaign) => campaignMinutes(campaign) !== null);
  const holidays = loaded.federalHolidays;
  const holidayHelp =
    holidays === null
      ? "Reads the platform’s federal holiday calendar. It could not be read here; the dialer still checks it."
      : holidays.length === 0
        ? "Reads the platform’s federal holiday calendar, which has no upcoming dates — so today this blocks nothing."
        : `Reads the platform’s federal holiday calendar: next ${holidays[0].name}, ${dayMonthYear(holidays[0].date)}. It currently runs to ${dayMonthYear(holidays[holidays.length - 1].date)}.`;

  return (
    <SettingsStack>
      {header}

      {saveError && <Callout tone="error" title={saveError} />}

      <Callout tone="error" title="Nothing on this page can widen a legal window">
        Federal rules allow {compact(FEDERAL_MINUTES.start)}&ndash;{compact(FEDERAL_MINUTES.end)} in the called
        party&rsquo;s time.
        {example && (
          <>
            {" "}
            {stateName(example.state)} narrows that to {compact(Math.max(FEDERAL_MINUTES.start, example.startHour * 60))}&ndash;
            {compact(Math.min(FEDERAL_MINUTES.end, example.endHour * 60))}.
          </>
        )}{" "}
        Whatever you set here is intersected with {example ? "both" : "the federal and state limits"}, and the
        narrowest wins. If you type 7am, it is refused rather than saved.
      </Callout>

      {!loaded.schemaReady && (
        <Callout tone="warning" title="This setting needs a database update that has not been applied yet.">
          Until it is, the agency&rsquo;s hours save in whole hours only, and the three switches and campaign reasons
          cannot be saved.
        </Callout>
      )}

      {readOnly && (
        <Callout tone="info" title="Only an owner can change calling windows.">
          You are seeing what is in force.
        </Callout>
      )}

      <SettingsGrid>
        <SettingsCard title="Your agency’s hours" sub="Applied in the customer’s timezone, not yours.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Earliest" htmlFor="window-start">
              <input
                id="window-start"
                type="time"
                step={loaded.schemaReady ? 60 : 3600}
                className={control}
                value={draft.start}
                disabled={readOnly || busy}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
              />
            </Field>
            <Field label="Latest" htmlFor="window-end">
              <input
                id="window-end"
                type="time"
                step={loaded.schemaReady ? 60 : 3600}
                className={control}
                value={draft.end}
                disabled={readOnly || busy}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
              />
            </Field>
          </div>
          {check.problem ? (
            <p role="alert" className="mt-3 mb-0 text-[12px] leading-[1.5] text-[var(--error-ink)]">{check.problem}</p>
          ) : (
            <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-[var(--muted)]">
              Set both hours, or neither. One alone is ambiguous and is refused.
              {tenantWindow
                ? ` In force now: ${minuteLabel(tenantWindow.start)}–${minuteLabel(tenantWindow.end)}.`
                : " Empty means no narrowing of your own — only the federal and state limits apply."}
            </p>
          )}
          {!readOnly && loaded.tenant && (
            <button type="button" className={btn("row", "mt-2 -ml-3")} disabled={busy} onClick={() => void saveAgency(true)}>
              Clear my narrowing
            </button>
          )}
          <div className="mt-[18px] flex flex-col gap-4">
            <ToggleRow
              id="window-no-sunday"
              title="No Sunday"
              help="Nothing dials on a Sunday in the customer’s timezone, in any state."
              checked={draft.options.noSunday}
              disabled={readOnly || busy || !loaded.schemaReady}
              onChange={(next) => setDraft({ ...draft, options: { ...draft.options, noSunday: next } })}
            />
            <ToggleRow
              id="window-no-holidays"
              title="No federal holidays"
              help={holidayHelp}
              checked={draft.options.noFederalHolidays}
              disabled={readOnly || busy || !loaded.schemaReady}
              onChange={(next) => setDraft({ ...draft, options: { ...draft.options, noFederalHolidays: next } })}
            />
            <ToggleRow
              id="window-campaign-overrides"
              title="Per-campaign overrides"
              help="A campaign may narrow further. It may never widen. Off, every campaign dials in the agency’s hours and its own narrowing is ignored."
              checked={draft.options.campaignOverrides}
              disabled={readOnly || busy || !loaded.schemaReady}
              onChange={(next) => setDraft({ ...draft, options: { ...draft.options, campaignOverrides: next } })}
            />
          </div>
        </SettingsCard>

        <SettingsCard title="State rules in force" sub="Read live from the compliance source, not typed here.">
          {!loaded.stateRulesAvailable ? (
            <Callout tone="warning" title="State rules could not be read on this deployment.">
              The dialer still enforces whatever is stored &mdash; this panel just cannot show it, so do not read the
              absence as &ldquo;no state rules apply&rdquo;.
            </Callout>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className={st.table}>
                  <thead>
                    <tr className={st.headRow}>
                      <th scope="col" className={cn(st.th, "w-[110px]")}>State</th>
                      <th scope="col" className={st.th}>Law allows</th>
                      <th scope="col" className={cn(st.th, st.num, "w-[130px]")}>Dialer uses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.length === 0 ? (
                      <tr>
                        <td colSpan={3} className={cn(st.td, "text-[var(--muted)]")}>
                          No state currently narrows things beyond what you and federal law already do.
                        </td>
                      </tr>
                    ) : (
                      listed.map((rule) => {
                        const law = effectiveMinutes(rule, null, null);
                        const used = effectiveMinutes(rule, tenantWindow, null);
                        const closed = used.start >= used.end;
                        return (
                          <tr key={rule.state}>
                            <td className={st.td}>{stateName(rule.state)}</td>
                            <td className={st.td}>
                              <span className="mr-2">{minuteLabel(law.start)} &ndash; {minuteLabel(law.end)}</span>
                              {rule.noSunday && <Pill className="mr-1">No Sunday</Pill>}
                              {rule.noHolidays && !everyStateBansHolidays && <Pill>No holidays</Pill>}
                            </td>
                            <td className={cn(st.td, st.num)}>
                              {closed ? (
                                <Pill tone="error">Closed</Pill>
                              ) : (
                                <Pill tone="success">{minuteLabel(used.start, true)} &ndash; {minuteLabel(used.end, true)}</Pill>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {feed?.stale && (
                <Callout tone="error" className="mt-3" title="The state rules are stale, so nothing is being dialled">
                  They were last refreshed {refreshedLabel ?? "at an unknown time"}, more than {feed.staleAfterDays} days
                  ago. The dialer refuses every call until the platform refreshes them.
                </Callout>
              )}
              <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-[var(--muted)]">
                {feed && refreshedLabel
                  ? `Last refreshed ${refreshedLabel}. A stale feed refuses the dial rather than guessing.`
                  : "When the state rules were last refreshed is recorded once a pending database update is applied; from then a stale feed refuses the dial rather than guessing."}
                {basis === "notable" && " Listing the states whose rule is tighter than yours, until your leads or licences say which states you work."}
                {everyStateBansHolidays &&
                  " A state’s own holidays are blocked wherever the calendar lists them; federal holidays only when No federal holidays is on."}
              </p>
            </>
          )}
        </SettingsCard>
      </SettingsGrid>

      <SettingsTableCard
        title="Per-campaign narrowing"
        actions={
          <>
            {!loaded.options.campaignOverrides && <Pill tone="warning">Overrides off &mdash; none applied</Pill>}
            <Pill>
              {narrowing.length === 0
                ? "No campaign narrows further"
                : `${narrowing.length} ${narrowing.length === 1 ? "campaign narrows" : "campaigns narrow"} further`}
            </Pill>
            {!readOnly && loaded.campaigns.length > 0 && (
              <button type="button" className={btn("secondary")} onClick={() => setCampaignEditor({ campaign: null })}>
                <PlusIcon />Narrow a campaign
              </button>
            )}
          </>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Campaign</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Earliest</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Latest</th>
              <th scope="col" className={st.th}>Reason</th>
              <th scope="col" className={cn(st.th, st.num, "w-[110px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loaded.campaigns.length === 0 ? (
              <tr><td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>You have no campaigns yet.</td></tr>
            ) : narrowing.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>
                  No campaign narrows further. A campaign can be tighter still &mdash; useful when one lead source only
                  ever converts in the evening.
                </td>
              </tr>
            ) : (
              narrowing.map((campaign) => {
                const window = campaignMinutes(campaign);
                return (
                  <tr key={campaign.id}>
                    <td className={cn(st.td, st.strong)}>{campaign.name}</td>
                    <td className={st.td}>{window?.start == null ? "—" : minuteLabel(window.start)}</td>
                    <td className={st.td}>{window?.end == null ? "—" : minuteLabel(window.end)}</td>
                    <td className={cn(st.td, !campaign.reason && "text-[var(--muted)]")}>{campaign.reason ?? "No reason recorded"}</td>
                    <td className={cn(st.td, st.num)}>
                      {!readOnly && (
                        <button
                          type="button"
                          className={btn("row")}
                          aria-label={`Edit ${campaign.name}’s calling window`}
                          onClick={() => setCampaignEditor({ campaign })}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </SettingsTableCard>

      <Dialog open={campaignEditor !== null} onOpenChange={(next) => { if (!next) setCampaignEditor(null); }}>
        <DialogContent className="border-[var(--border)] bg-[var(--surface)] sm:max-w-lg">
          {campaignEditor && (
            <CampaignForm
              key={campaignEditor.campaign?.id ?? "new"}
              campaign={campaignEditor.campaign}
              campaigns={loaded.campaigns}
              schemaReady={loaded.schemaReady}
              onClose={() => setCampaignEditor(null)}
              onSave={async (campaignId, window, reason) => {
                const next = await put({
                  scope: "campaign",
                  campaignId,
                  window: window ? { startMinute: window.start, endMinute: window.end } : null,
                  reason,
                });
                if (next) setLoaded(next);
                notify.done(window ? "Campaign calling window saved." : "That campaign's narrowing was cleared.");
                setCampaignEditor(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}

function CampaignForm({
  campaign,
  campaigns,
  schemaReady,
  onClose,
  onSave,
}: {
  campaign: CampaignWindow | null;
  campaigns: CampaignWindow[];
  schemaReady: boolean;
  onClose: () => void;
  onSave: (campaignId: string, window: MinuteWindow | null, reason: string | null) => Promise<void>;
}) {
  const initial = campaign ? campaignMinutes(campaign) : null;
  const [campaignId, setCampaignId] = useState(campaign?.id ?? campaigns.find((item) => campaignMinutes(item) === null)?.id ?? campaigns[0]?.id ?? "");
  const [start, setStart] = useState(minuteToInput(initial?.start ?? null));
  const [end, setEnd] = useState(minuteToInput(initial?.end ?? null));
  const [reason, setReason] = useState(campaign?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const check = checkWindow(start, end);

  async function submit(clear: boolean) {
    if (!campaignId) return;
    if (!clear && (check.problem || !check.window)) {
      setProblem(check.problem ?? "Set both hours, or clear this campaign’s narrowing.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      await onSave(campaignId, clear ? null : check.window, clear ? null : reason.trim() || null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Could not save that campaign’s calling window");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
      <DialogHeader>
        <DialogTitle className="text-[var(--ink)]">{campaign ? `Narrow ${campaign.name}` : "Narrow a campaign"}</DialogTitle>
        <DialogDescription className="text-[var(--muted)]">
          In the customer&rsquo;s timezone. A campaign can only narrow the agency&rsquo;s hours; it is saved as soon as you
          choose Save.
        </DialogDescription>
      </DialogHeader>
      {!campaign && (
        <Field label="Campaign" htmlFor="campaign-window-id">
          <select id="campaign-window-id" className={control} value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            {campaigns.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{campaignMinutes(item) ? " (already narrowed)" : ""}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Earliest" htmlFor="campaign-window-start">
          <input id="campaign-window-start" type="time" step={schemaReady ? 60 : 3600} className={control} value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="Latest" htmlFor="campaign-window-end">
          <input id="campaign-window-end" type="time" step={schemaReady ? 60 : 3600} className={control} value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
      </div>
      <Field
        label="Reason"
        htmlFor="campaign-window-reason"
        hint={schemaReady ? "Why this campaign stops earlier — for whoever reads this next." : "Reasons can be saved once the pending database update is applied."}
      >
        <input
          id="campaign-window-reason"
          className={control}
          value={reason}
          maxLength={200}
          disabled={!schemaReady}
          placeholder="Vendor consent language is daytime-only"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {(problem || check.problem) && (
        <p role="alert" className="m-0 text-[12px] leading-[1.5] text-[var(--error-ink)]">{problem || check.problem}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        {campaign && (
          <button type="button" className={btn("ghost", "mr-auto text-[var(--error-ink)]")} disabled={saving} onClick={() => void submit(true)}>
            Clear narrowing
          </button>
        )}
        <button type="button" className={btn("ghost")} disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className={btn("primary")} disabled={saving || !campaignId || Boolean(check.problem) || !check.window}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
