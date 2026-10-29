"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Field, inputControl, textareaControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { insideWindow, STATE_NAMES, windowSummary, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import type { CallbackBookingFacts } from "@/lib/callbacks/service";
import type { NearestLegalTime } from "@/lib/callbacks/nearest";
import { ScheduleDialog } from "@/components/app/dialer/schedule-dialog";
import { CallbackPicker } from "./callback-picker";
import { Chip } from "./day-plan";
import { longTime, shortTime, zonedToUtc } from "./time";

/**
 * Add callback (owner 2026-10-28: "add a callback"): pick a lead, a day and a time in the customer's
 * own timezone, and a note. The same dialog and calendar the Dialer books with (ScheduleDialog,
 * CallbackPicker), and the same rules: the calling window is shown while the agent picks, the server
 * checks it again before anything is stored, and a refused time comes back with the nearest legal one.
 *
 * A lead keeps one open callback. When the chosen lead already has one, this moves it (the page's
 * own reschedule) instead of booking a second, and says so.
 */
export type LeadPick = { id: string; name: string; meta: string };

type Facts = { lead: CallbackBookingFacts; window: CallbackWindowFacts | null; timezones: string[] };

const ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "America/Adak": "Aleutian", "Pacific/Honolulu": "Hawaii",
  "America/Indiana/Indianapolis": "Eastern (Indiana)", "America/Boise": "Mountain (Idaho)", "America/Detroit": "Eastern (Michigan)",
  "America/Kentucky/Louisville": "Eastern (Kentucky)", "America/North_Dakota/Center": "Central (North Dakota)", "America/Puerto_Rico": "Atlantic",
};

export function AddCallbackDialog({ open, onOpenChange, initialLead, suggestions, yourZone, now, onBooked }: {
  open: boolean;
  /** The page's clock (it ticks every 30 s); the server refuses a past time either way. */
  now: number;
  onOpenChange: (open: boolean) => void;
  /** Opened from a person: that lead, already chosen. */
  initialLead: LeadPick | null;
  /** Leads offered before anything is typed (the page's late callbacks). */
  suggestions: LeadPick[];
  yourZone: string;
  onBooked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadPick[] | null>(null);
  const [lead, setLead] = useState<LeadPick | null>(initialLead);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsError, setFactsError] = useState("");
  const [zoneChoice, setZoneChoice] = useState("");
  const [local, setLocal] = useState("");
  const [note, setNote] = useState("");
  const [nearest, setNearest] = useState<{ local: string; value: NearestLegalTime | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per opening, so a double submit or a retry books once (book_callback's idempotency).
  const requestKey = useRef("");

  // Each opening starts clean, on the person it was opened from.
  useEffect(() => {
    if (!open) return;
    requestKey.current = crypto.randomUUID();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLead(initialLead); setQuery(""); setResults(null); setLocal(""); setNote(""); setError(""); setNearest(null); setZoneChoice("");
  }, [open, initialLead]);

  // Lead search: the workspace search's Leads, as the top bar finds them (scoped the same way).
  const needle = query.trim();
  useEffect(() => {
    if (lead || needle.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/app/search?q=${encodeURIComponent(needle)}&limit=8`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { hits?: Array<{ group: string; title: string; meta: string; href: string }> } | null) => {
          const hits = (body?.hits ?? []).filter((hit) => hit.group === "Leads" && /^\/app\/leads\/[0-9a-f-]{36}$/.test(hit.href));
          setResults(hits.map((hit) => ({ id: hit.href.slice("/app/leads/".length), name: hit.title, meta: hit.meta })));
        })
        .catch(() => undefined);
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [lead, needle]);

  // The chosen lead's timezone, calling window and open callback.
  const leadId = lead?.id ?? null;
  useEffect(() => {
    if (!leadId || !open) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFacts(null); setFactsError("");
    void fetch(`/api/app/callbacks?lead_id=${encodeURIComponent(leadId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) setFactsError(body?.error ?? "That lead could not be read.");
        else setFacts(body as Facts);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [leadId, open]);

  const ready = facts && facts.lead.leadId === leadId ? facts : null;
  const moving = ready?.lead.open ?? null;
  // A move keeps the callback's own zone (reschedule_callback reads the time in it).
  const zone = ready ? moving?.customerTimezone ?? ready.lead.timezone ?? (zoneChoice || null) : null;
  const at = zone && local ? zonedToUtc(local, zone) : null;
  const [hour, minute] = local ? local.slice(11).split(":").map(Number) : [NaN, NaN];
  const inWindow = ready?.window && Number.isFinite(hour) ? insideWindow(ready.window, hour, minute) : null;
  const stateName = ready?.lead.state ? STATE_NAMES[ready.lead.state] ?? ready.lead.state : null;
  const suggestion = nearest && nearest.local === local ? nearest.value : null;
  const movingId = moving?.id ?? null;
  const leadZone = ready?.lead.timezone ?? null;
  const canSubmit = Boolean(ready && zone && at && ready.lead.state && inWindow !== false && at.getTime() > now);

  // Outside the window: ask the server for the next time that is not (holidays and the campaign weighed too).
  useEffect(() => {
    if (!leadId || inWindow !== false || !local || !zone) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const ask = movingId ? `callback_id=${encodeURIComponent(movingId)}` : `lead_id=${encodeURIComponent(leadId)}${leadZone ? "" : `&timezone=${encodeURIComponent(zone)}`}`;
      void fetch(`/api/app/callbacks?${ask}&suggest_local=${encodeURIComponent(local)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (body) setNearest({ local, value: (body.nearest ?? null) as NearestLegalTime | null }); })
        .catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [leadId, inWindow, local, zone, leadZone, movingId]);

  async function submit() {
    if (!ready || !zone || !local) return;
    setBusy(true); setError("");
    const response = moving
      ? await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reschedule", callback_id: moving.id, callback_local: local }) })
      : await fetch("/api/app/callbacks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: ready.lead.leadId, callback_local: local, timezone: ready.lead.timezone ? undefined : zone, note: note.trim() || undefined, idempotency_key: requestKey.current }) });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(body?.error ?? "The callback was not booked. Your choice is still here.");
      if (body && "nearest" in body) setNearest({ local, value: (body.nearest ?? null) as NearestLegalTime | null });
      return;
    }
    notify.done(moving ? `${ready.lead.customerName}'s callback moved` : `Callback booked with ${ready.lead.customerName}`);
    onOpenChange(false);
    onBooked();
  }

  const pickList = (items: LeadPick[], label: string) => (
    <ul aria-label={label} className="m-seq m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" onClick={() => setLead(item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)] focus-visible:outline-none">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{item.name}</span>
            <span className="shrink-0 truncate text-xs text-[var(--body)]">{item.meta}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <ScheduleDialog
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title={moving ? "Move callback" : "Add callback"}
      description="Pick the person, then a day and time in their own timezone. The calling window is checked again before it is saved."
      submitLabel={moving ? "Move callback" : "Book callback"}
      busyLabel="Booking…"
      busy={busy}
      submitDisabled={!canSubmit}
      onSubmit={() => void submit()}
    >
      {!lead ? (
        <div className="flex flex-col gap-2">
          <label className="relative block">
            <span className="sr-only">Find a lead</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a lead by name, phone or email" className={cn(inputControl, "pl-9")} />
          </label>
          {needle.length >= 2
            ? results === null ? null
              : results.length ? pickList(results, "Matching leads")
              : <p className="m-0 px-2 py-2 text-sm text-[var(--body)]">No lead matches &ldquo;{needle}&rdquo;.</p>
            : suggestions.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-2 text-xs font-semibold text-[var(--body)]">Waiting on a callback</span>
                {pickList(suggestions, "Leads waiting on a callback")}
              </div>
            )}
        </div>
      ) : (
        <div className="m-in flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--surface-alt)] px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--ink)]">{ready?.lead.customerName ?? lead.name}</span>
              <span className="block truncate text-xs text-[var(--body)]">{[stateName, ready?.lead.phone, zone ? ZONE_NAMES[zone] ?? zone : null].filter(Boolean).join(" · ") || lead.meta}</span>
            </span>
            {!initialLead && <Button type="button" size="sm" variant="ghost" onClick={() => { setLead(null); setLocal(""); setNearest(null); setError(""); }}><X aria-hidden="true" />Change</Button>}
          </div>

          {factsError && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{factsError}</p>}
          {moving && ready && (
            <p className="m-0 text-sm text-[var(--ink)]">
              Already booked for <strong className="font-semibold">{longTime(moving.scheduledAtUtc, moving.customerTimezone)}</strong>. A lead keeps one callback, so this moves it{moving.note ? <> and keeps its note: &ldquo;{moving.note}&rdquo;</> : null}.
            </p>
          )}
          {ready && !ready.lead.state && <p role="status" className="m-0 text-sm text-[var(--warning-ink)]">This lead has no state, so its calling window is unknown. Add the state on the lead first.</p>}
          {ready && ready.lead.state && !ready.lead.timezone && !moving && (
            <Field label="Their timezone" htmlFor="add-callback-zone" hint={ready.lead.timezoneProblem ?? undefined}>
              <select id="add-callback-zone" className={cn(inputControl, "mt-1.5")} value={zoneChoice} onChange={(event) => { setZoneChoice(event.target.value); setLocal(""); }}>
                <option value="">Choose…</option>
                {ready.timezones.map((option) => <option key={option} value={option}>{ZONE_NAMES[option] ?? option}</option>)}
              </select>
            </Field>
          )}

          {ready && ready.lead.state && zone && (
            <div className="m-in flex flex-col gap-3">
              <CallbackPicker key={`${ready.lead.leadId}-${zone}`} value={local} onChange={(value) => { setLocal(value); setError(""); }} zone={zone} disabled={busy} label="Callback time, their timezone" />
              <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2" aria-live="polite">
                {!local ? <span className="text-sm text-[var(--body)]">{ready.window ? windowSummary(ready.window) : "Times are in their timezone."}</span>
                  : <>
                    {inWindow === null ? <Chip tone="neutral">Window checked when booked</Chip>
                      : inWindow ? <Chip tone="success">Inside the {stateName} calling window</Chip>
                      : <Chip tone="error">Outside the {stateName} calling window</Chip>}
                    {at && <span className="text-sm text-[var(--ink)]">{shortTime(at, yourZone)} your time</span>}
                  </>}
                {suggestion && (
                  <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink)]">
                    Nearest legal time: <strong className="font-semibold">{longTime(suggestion.utc, zone)}</strong>
                    <Button type="button" size="sm" variant="outline" onClick={() => setLocal(suggestion.customerLocal)}>Use that</Button>
                  </span>
                )}
              </div>
              {!moving && (
                <Field label="Note" htmlFor="add-callback-note" hint="What to pick up on when you call. Optional.">
                  <textarea id="add-callback-note" className={textareaControl} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Wants to compare two quotes with their spouse" />
                </Field>
              )}
            </div>
          )}
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
        </div>
      )}
    </ScheduleDialog>
  );
}
