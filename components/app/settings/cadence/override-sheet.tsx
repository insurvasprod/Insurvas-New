"use client";

/**
 * Settings › Dialing cadence · a campaign's own cadence (round 8, board A "Campaign override sheet").
 * A campaign runs the agency cadence until it is given its own, which then replaces the agency's
 * completely (schedule_next_attempt never merges the two). Here the owner picks which, starts from the
 * agency cadence or a preset, sets max calls, and sees the result on the campaign's own hours. Saved
 * through the same PUT /api/app/cadence as the page; call-by-call edits then happen on the page.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { control } from "@/components/ui/field";
import { DEFAULT_CEILING, MAX_ATTEMPTS_RANGE, type CadenceRow } from "@/lib/cadence/engine";
import { effectiveLadder } from "@/lib/cadence/ladder";
import { PRESETS, applyPreset, materialize, type PresetKey } from "@/lib/cadence/draft";
import { simulateCadence, summarize, type CallingRules } from "@/lib/cadence/timeline";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { CadenceTimeline } from "./timeline";
import { Seg, Stepper, callingRules, compact, windowWords, type CallingSettings } from "./shared";

type Start = PresetKey | "agency";

export function OverrideSheet({
  campaigns,
  initialCampaignId,
  agencyRows,
  agencyMax,
  limitsReady,
  calling,
  startDate,
  arrival,
  onClose,
  onSaved,
}: {
  /** Campaigns that run the agency cadence today. */
  campaigns: { id: string; name: string }[];
  initialCampaignId: string;
  agencyRows: CadenceRow[];
  agencyMax: number;
  limitsReady: boolean;
  calling: CallingSettings | null | "error";
  startDate: string;
  arrival: number;
  onClose: () => void;
  onSaved: (campaignId: string) => void;
}) {
  const [campaignId, setCampaignId] = useState(initialCampaignId || campaigns[0]?.id || "");
  const [own, setOwn] = useState(true);
  const [start, setStart] = useState<Start>("agency");
  const [max, setMax] = useState(agencyMax);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = campaigns.find((campaign) => campaign.id === campaignId)?.name ?? "This campaign";

  const rows = useMemo(() => {
    if (start === "agency") return materialize(agencyRows, [], max);
    const preset = PRESETS.find((entry) => entry.key === start);
    return preset ? materialize(applyPreset([], preset), [], max) : [];
  }, [start, agencyRows, max]);

  const rules = callingRules(calling, campaignId || null);
  const agencyRules: CallingRules = callingRules(calling, null);
  const simulate = (cadence: CadenceRow[], last: number, on: CallingRules) =>
    simulateCadence({ steps: effectiveLadder(cadence, [], { lastAttempt: last, outcome: "no_answer" }), startDate, arrival, rules: on });
  const sim = simulate(rows, max, rules);
  const agencySim = simulate(agencyRows, agencyMax, agencyRules);
  const words = summarize(sim);
  const agencyWords = summarize(agencySim);
  const days = Math.max(14, Math.min(21, (sim.calls.at(-1)?.day ?? 0) + 1));
  const outside: Record<string, string> = {};
  if (rules.campaignWindow) {
    if (rules.campaignWindow.start >= 12 * 60) outside.morning = `from ${compact(rules.campaignWindow.start)}`;
    if (rules.campaignWindow.end <= 17 * 60) outside.evening = `after ${compact(rules.campaignWindow.end)}`;
  }
  const busiest = Math.max(0, ...Array.from({ length: days }, (_, day) => sim.calls.filter((call) => call.day === day).length));
  const movedBy = (because: (reason: string | null) => boolean) => sim.calls.filter((call) => call.moved && because(call.movedBecause)).length;
  const movedHours = movedBy((reason) => reason === "after your calling hours");
  const movedDays = movedBy((reason) => reason !== "after your calling hours");

  async function save() {
    if (!campaignId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/app/cadence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          rows: own ? rows.map(({ attemptNumber, delayInterval, preferredSlot, dispositionScope }) => ({ attemptNumber, delayInterval, preferredSlot: preferredSlot ?? null, dispositionScope: dispositionScope ?? null })) : [],
          // Max calls only where it can be stored (20260929201100); before that every campaign stops at seven.
          ...(limitsReady ? { maxAttempts: own ? max : null } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not save this campaign's cadence");
        return;
      }
      notify.done(own ? `${name} now runs its own cadence.` : `${name} runs the agency cadence.`);
      onSaved(campaignId);
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={name}
      status={own ? <StatusChip tone="info">Own cadence</StatusChip> : <StatusChip tone="neutral">Agency cadence</StatusChip>}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <span role="alert" className="mr-auto text-xs text-[var(--error-ink)]">{error}</span>}
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={saving || !campaignId} onClick={() => void save()}>{saving ? "Saving…" : `Save ${name} cadence`}</Button>
        </div>
      }
    >
      {campaigns.length > 1 && (
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
          Campaign
          <select className={cn(control, "mt-0")} value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
      )}
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-xs font-semibold text-[var(--ink)]">Which cadence does this campaign run?</legend>
        <label className="flex items-center gap-2 text-sm text-[var(--body)]">
          <input type="radio" name="cadence-own" checked={!own} onChange={() => setOwn(false)} className="accent-[var(--primary)]" />
          Use the agency cadence <span className="text-xs text-[var(--muted)]">{agencyWords.headline}</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <input type="radio" name="cadence-own" checked={own} onChange={() => setOwn(true)} className="accent-[var(--primary)]" />
          This campaign uses its own cadence
        </label>
        <p className="m-0 ml-6 text-xs text-[var(--muted)]">It replaces the agency cadence completely for this campaign. The two never mix.</p>
      </fieldset>

      {own && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              label="Start from"
              options={[{ key: "agency", label: "Agency" }, ...PRESETS.map((preset) => ({ key: preset.key, label: preset.label, title: preset.hint, disabled: !limitsReady && preset.maxAttempts !== DEFAULT_CEILING }))]}
              value={start}
              onChange={(key) => {
                setStart(key);
                const preset = PRESETS.find((entry) => entry.key === key);
                setMax(preset && limitsReady ? preset.maxAttempts : key === "agency" ? agencyMax : max);
              }}
            />
            <span className="ml-auto text-xs font-semibold text-[var(--muted)]">Max calls</span>
            <Stepper
              id="cadence-campaign-max"
              label="Max calls"
              value={max}
              min={MAX_ATTEMPTS_RANGE.min}
              max={MAX_ATTEMPTS_RANGE.max}
              disabled={!limitsReady}
              title={limitsReady ? undefined : "Max calls needs a database update. Every campaign stops at seven until then."}
              onChange={setMax}
            />
          </div>
          <p className="m-0 text-base leading-[1.4] text-[var(--ink)]">
            A lead in {name} that never answers gets <span className="font-semibold text-[var(--accent-ink)]">{words.headline}</span>{words.when}.
          </p>
          <CadenceTimeline calls={sim.calls} startDate={startDate} days={days} rules={rules} compact outsideBand={outside} editable={false} label={`${name}: the example lead's calls`} />
          <h3 className="m-0 mt-2 text-xs font-semibold text-[var(--muted)]">Rules that shape this campaign</h3>
          <ul className="m-0 list-none p-0">
            <RuleRow
              title={rules.campaignWindow ? `Campaign hours ${compact(rules.campaignWindow.start)}–${compact(rules.campaignWindow.end)}` : `Agency hours ${compact(rules.window.start)}–${compact(rules.window.end)}`}
              sub={rules.campaignWindow ? "Narrower than your agency hours · from Calling windows" : "This campaign keeps your agency hours · from Calling windows"}
              moved={movedHours}
            />
            {(rules.noSunday || rules.noHolidays) && (
              <RuleRow title={[rules.noSunday ? "No Sundays" : null, rules.noHolidays ? "no federal holidays" : null].filter(Boolean).join(", ")} sub={movedDays ? "Calls due on those days move to the next allowed time" : "Nothing planned on those days"} moved={movedDays} />
            )}
            <RuleRow title={`Busiest day: ${busiest} ${busiest === 1 ? "call" : "calls"}`} sub="State limits on calls per day depend on the lead's state; Calling windows lists the ones in force" />
          </ul>
          <Link href="/app/settings#calling-windows" className="self-start text-xs font-medium text-[var(--accent-ink)] hover:underline">Edit calling windows</Link>
          <p className="m-0 text-xs text-[var(--muted)]">After saving, pick {name} in Applies to and edit it call by call. Calling windows: {windowWords(rules)}.</p>
        </>
      )}
    </Sheet>
  );
}

function RuleRow({ title, sub, moved }: { title: string; sub: string; moved?: number }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-border py-2.5">
      <div className="min-w-0">
        <b className="block text-sm font-semibold text-[var(--ink)]">{title}</b>
        <small className="block text-xs text-[var(--muted)]">{sub}</small>
      </div>
      {moved !== undefined && (moved > 0 ? <StatusChip tone="warning" className="ml-auto">Moves {moved}</StatusChip> : <StatusChip tone="good" className="ml-auto">Fits</StatusChip>)}
    </li>
  );
}
