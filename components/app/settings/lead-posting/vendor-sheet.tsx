"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { control, Field, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import {
  callbackUrlProblem,
  centsFromInput,
  describeHours,
  STATUS_LABEL,
  STATUS_TONE,
  type LeadPostBoard,
  type PostingHours,
  type VendorRow,
} from "@/lib/leadPost/board";
import type { CampaignSpeedRow } from "@/lib/leadPost/campaignSpeed";
import type { PostActivity } from "@/lib/leadPost/types";
import { cn } from "@/lib/utils";
import { SheetActivityTab } from "./activity";
import { FieldMapTab } from "./field-map-tab";
import { copyInstructions, copyInstructionsLink, downloadInstructions, emailInstructions, tellVendor } from "./instructions";
import { ago, CopyField, maskedAddress, NeedsUpdate, send, SheetSection, TechnicalDetails, US_ZONES } from "./shared";
import { SheetTestTab } from "./sheet-test-tab";

export type SheetTab = "setup" | "map" | "test" | "activity";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const when = (value: string | null) => (value ? dayMonthYear(value, viewerTimeZone()) : "—");
const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

type Draft = {
  campaignId: string;
  price: string;
  cap: string;
  hoursOn: boolean;
  hours: PostingHours;
  callbackUrl: string;
  events: string[];
  notes: string;
};

function draftOf(row: VendorRow): Draft {
  const s = row.settings;
  return {
    campaignId: row.key.campaignId ?? "",
    price: money(s?.priceCents ?? null),
    cap: s?.dailyCap ? String(s.dailyCap) : "",
    hoursOn: Boolean(s?.postingHours),
    hours: s?.postingHours ?? { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "20:00", timeZone: "America/Chicago" },
    callbackUrl: s?.callbackUrl ?? "",
    events: s?.callbackEvents ?? [],
    notes: s?.notes ?? "",
  };
}

/**
 * The vendor sheet (board A2, A7, A8): a right sheet over the vendor table with four sections —
 * Setup (campaign, price, cap, hours, the key, the instructions, the status callback, notes),
 * Field map, Test and Activity. Setup saves with the footer's one button; the field map has its
 * own save bar, as drawn.
 */
export function VendorSheet({
  row,
  board,
  origin,
  tab,
  onTab,
  onClose,
  onChanged,
  onRotate,
  onRevoke,
  onEnable,
  activity,
  activityError,
  speed,
}: {
  row: VendorRow;
  board: LeadPostBoard;
  origin: string;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onRotate: () => void;
  onRevoke: () => void;
  onEnable: () => void;
  activity: PostActivity | null;
  activityError: string | null;
  speed: CampaignSpeedRow[] | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [saving, setSaving] = useState(false);
  const [emailTo, setEmailTo] = useState(row.settings?.instructionsEmail ?? "");
  const base = useMemo(() => draftOf(row), [row]);
  const r8 = board.r8Ready;
  const campaigns = board.campaigns.filter((campaign) => campaign.vendorId === row.vendorId);
  const campaign = campaigns.find((item) => item.id === (draft.campaignId || null)) ?? (draft.campaignId ? null : campaigns.find((item) => item.servable) ?? null);
  const priceCents = centsFromInput(draft.price);
  const capValue = draft.cap.trim() ? Number(draft.cap) : null;
  const callbackProblem = draft.callbackUrl.trim() ? callbackUrlProblem(draft.callbackUrl) : null;
  const problems = {
    price: priceCents !== null && Number.isNaN(priceCents) ? "Enter dollars and cents, like 15.00." : null,
    cap: capValue !== null && (!Number.isInteger(capValue) || capValue < 1 || capValue > 100000) ? "A whole number of leads, 1 or more." : null,
    hours: draft.hoursOn && draft.hours.days.length === 0 ? "Pick at least one day." : null,
    callback: callbackProblem,
  };
  const invalid = Object.values(problems).some(Boolean);
  const campaignChanged = draft.campaignId !== base.campaignId;
  const settingsChanged = r8 && (draft.price !== base.price || draft.cap !== base.cap || draft.hoursOn !== base.hoursOn || (draft.hoursOn && JSON.stringify(draft.hours) !== JSON.stringify(base.hours)) || draft.callbackUrl.trim() !== base.callbackUrl || draft.events.join() !== base.events.join() || draft.notes !== base.notes);
  const dirty = campaignChanged || settingsChanged;
  const postingUrl = `${origin}${board.postingPath}`;
  const isActive = row.key.isActive;

  async function save(): Promise<boolean> {
    if (invalid) return false;
    setSaving(true);
    try {
      if (campaignChanged) await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: "campaign", campaignId: draft.campaignId || null });
      if (settingsChanged) {
        await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", {
          action: "settings",
          settings: {
            priceCents: priceCents === null || Number.isNaN(priceCents) ? null : priceCents,
            dailyCap: capValue,
            postingHours: draft.hoursOn ? draft.hours : null,
            callbackUrl: draft.callbackUrl.trim() || null,
            callbackEvents: draft.events,
            notes: draft.notes,
          },
        });
      }
      notify.done(`${row.vendorName} saved.`);
      await onChanged();
      return true;
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (dirty && !(await confirmAction({ title: "Discard your changes?", description: `The unsaved changes to ${row.vendorName} are lost.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    onClose();
  }

  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));
  const toggleDay = (day: number) => set({ hours: { ...draft.hours, days: draft.hours.days.includes(day) ? draft.hours.days.filter((item) => item !== day) : [...draft.hours.days, day].sort() } });
  const toggleEvent = (event: string) => set({ events: draft.events.includes(event) ? draft.events.filter((item) => item !== event) : [...draft.events, event] });

  const sectionTabs = (
    <UnderlineTabs
      label={`${row.vendorName}'s sections`}
      tabs={[
        { key: "setup", label: "Setup" },
        { key: "map", label: "Field map", count: row.unreadGuesses.length || null, tone: "danger" },
        { key: "test", label: "Test" },
        { key: "activity", label: "Activity" },
      ]}
      value={tab}
      onChange={(next) => onTab(next as SheetTab)}
      className="w-full"
    />
  );

  const subtitle = [
    campaign?.name ?? (row.key.campaignId ? "A campaign no longer on your list" : "Their accepting campaign"),
    `connected ${when(row.keys[row.keys.length - 1]?.createdAt ?? row.key.createdAt)}`,
    `${row.week.accepted.toLocaleString("en-US")} accepted this week`,
  ].join(" · ");

  return (
    <Sheet
      title={row.vendorName}
      subtitle={subtitle}
      status={<><StatusChip tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}{row.needsYou ? ` · ${row.needsYou}` : ""}</StatusChip>{sectionTabs}</>}
      onClose={() => void close()}
      closeLabel={`Close ${row.vendorName}`}
      className="lg:w-[640px]"
      bodyClassName={tab === "map" ? "flex min-h-0 flex-col p-0" : "flex flex-col gap-5 p-4"}
      footer={tab === "setup" ? (
        <>
          <span className="text-xs text-[var(--muted)]">{dirty ? "Unsaved changes" : "No changes"}</span>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={() => void close()}>Close</Button>
            <Button type="button" disabled={!dirty || saving || invalid} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</Button>
          </span>
        </>
      ) : undefined}
    >
      {tab === "setup" && (
        <>
          <SheetSection title="Campaign and price" help="Where accepted leads land and what each one costs.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Campaign" htmlFor="sheet-campaign" hint={!board.schemaReady ? "Choosing a campaign needs a database update." : campaign ? (campaign.intakeForm ? `Product form: ${campaign.productLabel} intake` : `${campaign.productLabel} has no intake form, so posts would be refused`) : "Posts go to their first active, scrubbed campaign"}>
                <select id="sheet-campaign" className={control} value={draft.campaignId} disabled={!board.schemaReady} onChange={(event) => set({ campaignId: event.target.value })}>
                  <option value="">Their accepting campaign</option>
                  {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== "active" ? ` (${item.status})` : ""}</option>)}
                </select>
              </Field>
              <Field label={<>Price per accepted lead{!r8 && <NeedsUpdate />}</>} htmlFor="sheet-price" hint="Refused and test posts are never charged" error={problems.price}>
                <input id="sheet-price" className={control} inputMode="decimal" placeholder="$0.00" value={draft.price} disabled={!r8} onChange={(event) => set({ price: event.target.value })} />
              </Field>
              <Field label={<>Daily cap{!r8 && <NeedsUpdate />}</>} htmlFor="sheet-cap" hint="Posts past the cap are refused politely" error={problems.cap}>
                <input id="sheet-cap" className={control} inputMode="numeric" placeholder="No cap" value={draft.cap} disabled={!r8} onChange={(event) => set({ cap: event.target.value.replace(/[^0-9]/g, "") })} />
              </Field>
              <Field label={<>Accept posts{!r8 && <NeedsUpdate />}</>} htmlFor="sheet-hours" hint={draft.hoursOn ? describeHours(draft.hours) : "Any time, every day"} error={problems.hours}>
                <select id="sheet-hours" className={control} value={draft.hoursOn ? "set" : "any"} disabled={!r8} onChange={(event) => set({ hoursOn: event.target.value === "set" })}>
                  <option value="any">Any time</option>
                  <option value="set">Only at set hours</option>
                </select>
              </Field>
            </div>
            {r8 && draft.hoursOn && (
              <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-alt)] p-3">
                <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                  {DAYS.map((label, day) => <ToggleChip key={label} selected={draft.hours.days.includes(day)} onClick={() => toggleDay(day)}>{label}</ToggleChip>)}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="From" htmlFor="sheet-from"><input id="sheet-from" type="time" className={control} value={draft.hours.start} onChange={(event) => set({ hours: { ...draft.hours, start: event.target.value } })} /></Field>
                  <Field label="Until" htmlFor="sheet-until"><input id="sheet-until" type="time" className={control} value={draft.hours.end} onChange={(event) => set({ hours: { ...draft.hours, end: event.target.value } })} /></Field>
                  <Field label="Time zone" htmlFor="sheet-zone">
                    <select id="sheet-zone" className={control} value={draft.hours.timeZone} onChange={(event) => set({ hours: { ...draft.hours, timeZone: event.target.value } })}>
                      {US_ZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            )}
          </SheetSection>

          <SheetSection title="Posting key" help="The vendor sends this with every lead. The full key was shown once, when it was made.">
            <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm">
              <dt className="text-xs font-semibold text-[var(--muted)]">Key</dt>
              <dd className="m-0 text-[var(--body)]">
                {isActive ? "Working" : row.settings?.graceUntil && row.settings.graceUntil > new Date().toISOString() ? `Rotated · works until ${when(row.settings.graceUntil)}` : "Revoked"}
                <span className="text-xs text-[var(--muted)]"> · made {when(row.key.createdAt)} · {row.key.lastUsedAt ? `used ${ago(row.key.lastUsedAt)}` : "never used"}</span>
              </dd>
              <dt className="text-xs font-semibold text-[var(--muted)]">Posting address</dt>
              <dd className="m-0 min-w-0"><CopyField label="Posting address" value={postingUrl} shown={maskedAddress(postingUrl)} /></dd>
            </dl>
            <TechnicalDetails rows={[{ label: "Key starts with", value: `${row.key.keyPrefix}…` }, { label: "Posting address", value: postingUrl }, { label: "Older address", value: `${origin}/api/leads/post` }]} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onRotate}>{isActive ? "Rotate key" : "Make a new key"}</Button>
              {isActive
                ? <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" onClick={onRevoke}>Revoke</Button>
                : <Button type="button" variant="outline" size="sm" onClick={onEnable}>Turn this key back on</Button>}
            </div>
          </SheetSection>

          <SheetSection title={`Instructions for ${row.vendorName}`} help="A page written for their developer: address, key, fields, replies and a sample.">
            <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-xs font-semibold text-[var(--muted)]">Sent</dt>
              <dd className="m-0 text-[var(--body)]">
                {!r8 ? <>Not tracked yet<NeedsUpdate /></>
                  : row.settings?.instructionsSentAt ? <>{when(row.settings.instructionsSentAt)}{row.settings.instructionsEmail ? <> to <b className="text-[var(--ink)]">{row.settings.instructionsEmail}</b></> : null}{row.settings.instructionsLink ? ` · opened ${row.settings.instructionsOpened === 1 ? "once" : `${row.settings.instructionsOpened} times`}` : ""}</>
                  : row.settings?.instructionsLink ? `Link made · opened ${row.settings.instructionsOpened === 1 ? "once" : `${row.settings.instructionsOpened} times`}` : "Not sent yet"}
              </dd>
            </dl>
            <Field label="Their developer's email" htmlFor="sheet-email">
              <input id="sheet-email" type="email" className={control} placeholder="integrations@vendor.com" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {r8
                ? <Button type="button" variant="outline" size="sm" onClick={() => void copyInstructionsLink(row.key.id).then((made) => { if (made) void onChanged(); })}>Copy link</Button>
                : <Button type="button" variant="outline" size="sm" onClick={() => void copyInstructions(row.key.id)}>Copy instructions</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => downloadInstructions(row.key.id)}>Download PDF</Button>
              <Button type="button" variant="outline" size="sm" disabled={!emailTo.trim()} onClick={() => void emailInstructions({ keyId: row.key.id, vendorName: row.vendorName, to: emailTo, agencyName: board.agencyName, recordSent: r8 }).then(() => { if (r8) void onChanged(); })}>
                {row.settings?.instructionsSentAt ? "Email again" : "Email to vendor"}
              </Button>
            </div>
          </SheetSection>

          <SheetSection title={`Tell ${row.vendorName} what happened`} tag={!r8 ? <NeedsUpdate /> : undefined} help="We call their address when a lead is accepted or refused, so they can stop billing bad leads.">
            <Field label="Their status address" htmlFor="sheet-callback" error={problems.callback}>
              <input id="sheet-callback" className={control} placeholder="https://partners.vendor.com/status" value={draft.callbackUrl} disabled={!r8} onChange={(event) => set({ callbackUrl: event.target.value })} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleChip selected={draft.events.includes("accepted")} disabled={!r8} onClick={() => toggleEvent("accepted")}>Accepted</ToggleChip>
              <ToggleChip selected={draft.events.includes("refused")} disabled={!r8} onClick={() => toggleEvent("refused")}>Refused</ToggleChip>
              {row.settings?.callbackLastAt && (
                <span className="text-xs text-[var(--muted)]">Last call {ago(row.settings.callbackLastAt)}, {row.settings.callbackLastStatus && row.settings.callbackLastStatus < 300 ? "answered" : row.settings.callbackLastStatus ? `answered ${row.settings.callbackLastStatus}` : "no answer"}</span>
              )}
            </div>
          </SheetSection>

          <SheetSection title="Notes" tag={!r8 ? <NeedsUpdate /> : undefined}>
            <textarea aria-label={`Notes about ${row.vendorName}`} className={cn(textareaControl, "mt-0")} maxLength={2000} placeholder="Account rep, billing terms, anything worth remembering" value={draft.notes} disabled={!r8} onChange={(event) => set({ notes: event.target.value })} />
          </SheetSection>
          <LeaveGuard dirty={dirty} onSave={save} onDiscard={() => setDraft(base)} what={`${row.vendorName}'s setup`} />
        </>
      )}

      {tab === "map" && <FieldMapTab key={row.key.id} row={row} schemaReady={board.schemaReady} onSaved={onChanged} />}
      {tab === "test" && <SheetTestTab key={row.key.id} row={row} r8Ready={r8} onChanged={onChanged} />}
      {tab === "activity" && (
        <SheetActivityTab
          row={row}
          activity={activity}
          activityError={activityError}
          speed={speed}
          onFixMap={() => onTab("map")}
          onRotate={onRotate}
          onTellVendor={(reasonCode, count) => tellVendor({ to: emailTo || row.settings?.instructionsEmail || "", vendorName: row.vendorName, agencyName: board.agencyName, reasonCode, count, days: 7 })}
        />
      )}
    </Sheet>
  );
}
