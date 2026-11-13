"use client";

/**
 * Settings › Calling windows (round 8) — a campaign that calls less, as a right sheet (board screen 3).
 * The agency's hours are a hatched ghost; the campaign's hours are drawn and dragged inside them; the
 * reason is a line of its own. The sheet saves itself, like every record (PUT scope "campaign").
 *
 * Storage is one window per campaign (tenant_campaigns.calling_window_*), so the campaign's hours are
 * the same on every day the agency calls.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { control } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Seg } from "@/components/app/settings/cadence/shared";
import { campaignMinutes, stateRuleMinutes, type CampaignWindow, type MinuteWindow, type StateRuleInForce } from "@/lib/callingWindow/engine";
import { clock, daysLabel, envelope, openDays, rangeLabel, type Week } from "@/lib/callingWindows/week";
import { cn } from "@/lib/utils";

import { GridLegend, WeekGrid } from "./week-grid";
import { stateName } from "./state-rules";

const REASONS = ["Vendor consent is daytime-only", "Customers answer after work", "Carrier asked us to", "Testing"];

export function CampaignSheet({
  campaign,
  campaigns,
  week,
  noSunday,
  schemaReady,
  rule,
  onClose,
  onSave,
}: {
  /** The campaign opened, or null to pick one ("+ Narrow a campaign"). */
  campaign: CampaignWindow | null;
  campaigns: CampaignWindow[];
  week: Week;
  noSunday: boolean;
  schemaReady: boolean;
  /** The state picked on the page's grid, if any: the sheet says whether the campaign fits it. */
  rule?: StateRuleInForce;
  onClose: () => void;
  onSave: (campaignId: string, window: MinuteWindow | null, reason: string | null) => Promise<void>;
}) {
  const agency = envelope(week) ?? { start: 9 * 60, end: 20 * 60 };
  const initial = campaign ? campaignMinutes(campaign) : null;
  const firstFree = campaigns.find((item) => campaignMinutes(item) === null) ?? campaigns[0];
  const [campaignId, setCampaignId] = useState(campaign?.id ?? firstFree?.id ?? "");
  const [narrower, setNarrower] = useState(true);
  const [hours, setHours] = useState<MinuteWindow>(() => ({ start: initial?.start ?? agency.start, end: initial?.end ?? agency.end }));
  const [reason, setReason] = useState(campaign?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const name = campaigns.find((item) => item.id === campaignId)?.name ?? "Campaign";
  const narrowed = Boolean(campaign && initial);

  const clamp = (next: MinuteWindow): MinuteWindow => {
    const start = Math.max(agency.start, next.start);
    const end = Math.min(agency.end, next.end);
    return start < end ? { start, end } : { start, end: Math.min(agency.end, start + 30) };
  };

  const fit = rule
    ? (() => {
        const law = stateRuleMinutes(rule);
        if (hours.start >= law.start && hours.end <= law.end) return `${stateName(rule.state)} law allows ${rangeLabel(law, "long")}, so this campaign already fits the state rule.`;
        return `${stateName(rule.state)} law allows ${rangeLabel(law, "long")}; the dialer stops at the stricter of the two.`;
      })()
    : null;

  async function submit(clear: boolean) {
    if (!campaignId) return;
    if (!clear && narrower && schemaReady && !reason.trim()) {
      setProblem("Say why this campaign calls less. Anyone who wonders why these leads wait reads it here.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const keep = !clear && narrower;
      await onSave(campaignId, keep ? hours : null, keep ? reason.trim() || null : null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Could not save this campaign's hours");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={campaign ? campaign.name : "Narrow a campaign"}
      subtitle={narrowed && initial?.start != null && initial.end != null ? `Calls ${daysLabel(openDays(week, noSunday))} ${rangeLabel({ start: initial.start, end: initial.end })}` : "Uses your agency's hours today"}
      status={narrowed ? <StatusChip tone="info">Calls less</StatusChip> : undefined}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {problem && <span role="alert" className="basis-full text-xs text-[var(--error-ink)]">{problem}</span>}
          {narrowed && (
            <Button type="button" variant="destructive" className="mr-auto" disabled={saving} onClick={() => void submit(true)}>Use agency hours again</Button>
          )}
          <Button type="button" variant="ghost" className={cn(!narrowed && "ml-auto")} disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={saving || !campaignId} onClick={() => void submit(false)}>{saving ? "Saving…" : "Save campaign"}</Button>
        </div>
      }
    >
      {!campaign && (
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
          Campaign
          <select className={cn(control, "mt-0")} value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            {campaigns.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{campaignMinutes(item) ? " (already calls less)" : ""}</option>
            ))}
          </select>
        </label>
      )}

      <section className="flex flex-col gap-2">
        <h4 className="m-0 text-base font-semibold text-[var(--ink)]">When {campaign ? "this campaign" : name} may call</h4>
        <p className="m-0 text-xs text-[var(--muted)]">Drag inside the hatched agency hours. It can start later or stop earlier, never the other way.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="Hours" value={narrower ? "narrow" : "same"} onChange={(key) => setNarrower(key === "narrow")} options={[{ key: "same", label: "Same as agency" }, { key: "narrow", label: "Narrower" }]} />
          <span className="ml-auto"><GridLegend items={["agency", "campaign"]} /></span>
        </div>
        <WeekGrid
          mini
          week={week}
          noSunday={noSunday}
          editable={narrower}
          campaign={narrower ? hours : envelope(week)}
          onCampaign={(next) => setHours(clamp(next))}
          label={`${name}: when it may call`}
        />
        <p className="m-0 text-xs text-[var(--muted)]">
          {narrower ? `${clock(hours.start)} to ${clock(hours.end)} on every day your agency calls.` : "This campaign calls whenever your agency does."}
          {fit && narrower ? ` ${fit}` : ""}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h4 className="m-0 text-base font-semibold text-[var(--ink)]">Why it calls less</h4>
        <p className="m-0 text-xs text-[var(--muted)]">Shown to anyone who wonders why these leads aren&rsquo;t dialled in the morning.</p>
        <label htmlFor="campaign-reason" className="sr-only">Why it calls less</label>
        <input
          id="campaign-reason"
          className={cn(control, "mt-0")}
          value={reason}
          maxLength={200}
          disabled={!narrower || !schemaReady}
          placeholder="Vendor consent language is daytime-only"
          onChange={(event) => setReason(event.target.value)}
        />
        {!schemaReady && <p className="m-0 text-xs text-[var(--muted)]">Reasons can be saved once a pending database update is applied.</p>}
        <div role="radiogroup" aria-label="Common reasons" className="flex flex-wrap gap-1.5">
          {REASONS.map((text) => (
            <ToggleChip key={text} role="radio" selected={reason === text} disabled={!narrower || !schemaReady} onClick={() => setReason(text)}>{text}</ToggleChip>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1 border-t border-border pt-4">
        <h4 className="m-0 text-base font-semibold text-[var(--ink)]">What happens to leads outside these hours</h4>
        <div className="flex items-start gap-2.5 py-2">
          <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-[5px] border-[var(--primary)]" />
          <div>
            <b className="block text-sm font-medium text-[var(--ink)]">Wait until the window opens</b>
            <small className="block text-xs text-[var(--muted)]">They stay in the list and are dialled from {clock(narrower ? hours.start : agency.start)}</small>
          </div>
        </div>
      </section>
    </Sheet>
  );
}
