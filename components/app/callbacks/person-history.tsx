"use client";

import { useEffect, useState } from "react";
import { CalendarClock, MessageSquare, Phone, Dot } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CallbackView } from "@/lib/callbacks/service";
import { longTime } from "./time";

/**
 * "Conversation & history" in the Callbacks person panel (owner ask 2026-10-25: clicking someone
 * shows everything said and done with them). One feed, newest first: notes and partner messages,
 * every call attempt and its outcome, callback bookings, and the lead's other events — read from the
 * lead record (/api/app/leads/[id]), plus this callback's own history. Read-only; the lead page keeps
 * the editing.
 */
type Feed = { id: string; at: string; kind: "note" | "call" | "callback" | "event"; title: string; detail: string | null; actor: string | null };

type LeadRead = {
  timeline?: Array<{ id: string; label: string; at: string; actor: string; detail: string | null }>;
  attemptHistory?: Array<{ id: string; attempt_number: number; attempted_at: string; disposition: string | null }>;
};

const SHOWN = 8;

function words(value: string) {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindOf(id: string): Feed["kind"] {
  if (id.startsWith("note:") || id.startsWith("message:")) return "note";
  if (id.startsWith("callback:")) return "callback";
  return "event";
}

/** "Scheduled at 2026-10-26T13:30:00Z" reads as the customer's own clock. */
function readable(detail: string | null, timezone: string) {
  const match = detail ? /^Scheduled at (.+)$/.exec(detail) : null;
  if (!match || Number.isNaN(Date.parse(match[1]))) return detail;
  return `For ${longTime(match[1], timezone)} their time`;
}

function feedFrom(lead: LeadRead, callback: CallbackView): Feed[] {
  const items: Feed[] = [];
  for (const event of lead.timeline ?? []) {
    items.push({ id: event.id, at: event.at, kind: kindOf(event.id), title: event.label, detail: readable(event.detail, callback.customerTimezone), actor: event.actor });
  }
  for (const attempt of lead.attemptHistory ?? []) {
    items.push({ id: `attempt:${attempt.id}`, at: attempt.attempted_at, kind: "call", title: `Call · attempt ${attempt.attempt_number}`, detail: attempt.disposition ? words(attempt.disposition) : "No outcome recorded", actor: null });
  }
  // The callback's own history only when the lead read did not already carry it.
  if (!items.some((item) => item.kind === "callback")) {
    for (const entry of callback.history) {
      items.push({ id: `cbh:${entry.id}`, at: entry.createdAt, kind: "callback", title: `Callback ${entry.action.replaceAll("_", " ")}`, detail: entry.newScheduledAtUtc ? `For ${longTime(entry.newScheduledAtUtc, callback.customerTimezone)} their time` : entry.note, actor: entry.actorName });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

const ICON = { note: MessageSquare, call: Phone, callback: CalendarClock, event: Dot } as const;
const TINT: Record<Feed["kind"], string> = {
  note: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  call: "bg-[var(--surface-alt)] text-[var(--ink)]",
  callback: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  event: "bg-[var(--surface-alt)] text-muted-foreground",
};

export function PersonHistory({ callback, yourZone }: { callback: CallbackView; yourZone: string }) {
  const [state, setState] = useState<{ leadId: string; feed: Feed[] | null; error: string }>({ leadId: "", feed: null, error: "" });
  const [all, setAll] = useState(false);
  const leadId = callback.leadId;
  const demo = Boolean(callback.isDemo);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void fetch(`/api/app/leads/${encodeURIComponent(leadId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load this person's history.");
        setState({ leadId, feed: feedFrom(body as LeadRead, callback), error: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // The lead record sits behind Book of Business; without it the callback's own history still shows.
        setState({ leadId, feed: feedFrom({}, callback), error: error instanceof Error ? error.message : "Could not load this person's history." });
      });
    return () => controller.abort();
    // The callback object changes on every reload; the lead it belongs to is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, demo]);

  const feed = demo ? feedFrom({}, callback) : state.leadId === leadId ? state.feed : null;
  if (!feed) return <p className="m-0 text-sm text-muted-foreground" role="status">Loading their history…</p>;
  const shown = all ? feed : feed.slice(0, SHOWN);
  return (
    <div className="flex flex-col gap-2">
      {state.error && state.leadId === leadId && <p className="m-0 text-xs text-muted-foreground">Showing the callback&rsquo;s own history only: {state.error}</p>}
      {feed.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing recorded with them yet.</p> : (
        <ol className="m-0 flex list-none flex-col p-0">
          {shown.map((item) => {
            const Icon = ICON[item.kind];
            return (
              <li key={item.id} className="flex gap-3 border-t border-border py-2.5 first:border-t-0">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", TINT[item.kind])}><Icon className="size-3.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong className="truncate text-sm font-semibold text-[var(--ink)]">{words(item.title)}</strong>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{longTime(item.at, yourZone).replace(/ [A-Z]{2,5}$/, "")}</span>
                  </span>
                  {item.detail && <span className={cn("mt-0.5 block text-sm break-words", item.kind === "note" ? "text-[var(--body)]" : "text-muted-foreground")}>{item.detail}</span>}
                  {item.actor && <span className="block text-xs text-muted-foreground">{item.actor}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {feed.length > SHOWN && <button type="button" onClick={() => setAll((value) => !value)} className="self-start text-sm font-semibold text-[var(--accent-ink)] hover:underline">{all ? "Show less" : `Show all ${feed.length}`}</button>}
    </div>
  );
}
