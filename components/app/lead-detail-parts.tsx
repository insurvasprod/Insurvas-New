"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Copy, FileText, Phone, StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { textareaControl } from "@/components/ui/field";
import { Segmented } from "@/components/ui/view-tabs";
import { durationLabel } from "@/components/app/pipeline-views";
import { MONTHS } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * The lead page, owner pick 2026-11-10: direction C's stage path over direction B's three columns
 * (mockup docs/uiux-mockups/lead-page/index.html). The page component wires these to its data.
 */

export type PathStage = { id: string; name: string; stage_type: string; color: string };

const stampOf = (value: string) => { const d = new Date(value); if (Number.isNaN(d.getTime())) return "—"; const h = d.getHours(); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };

/** "(205) 233-7210" from any US 10-digit number; anything else as it was typed. */
export function phoneText(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : raw;
}

/**
 * The stage path (direction C): the pipeline's open and won stages in order, the ones passed in green, the current one in
 * its own colour with the time there, and the closed stages as one end cap. A click moves the lead straight there — the
 * board's rule, the outcome mapped to that stage — so the page and the board move a lead the same way.
 */
export function StagePath({ stages, currentId, enteredAt, now, disabled, onMove }: { stages: PathStage[]; currentId: string | null; enteredAt: string | null; now: number; disabled: boolean; onMove: (stageId: string) => void }) {
  const path = stages.filter((stage) => stage.stage_type !== "lost");
  const closed = stages.filter((stage) => stage.stage_type === "lost");
  const at = path.findIndex((stage) => stage.id === currentId);
  const closedHere = closed.find((stage) => stage.id === currentId);
  const here = enteredAt && now ? durationLabel(Math.max(0, now - Date.parse(enteredAt))) : null;
  const chevron = "[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%,12px_50%)]";
  const first = "[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%)] rounded-l-lg";
  return (
    <nav aria-label="Stage" className="flex min-w-0 gap-1 overflow-x-auto pb-0.5">
      {path.map((stage, index) => {
        const current = index === at;
        const done = at >= 0 && index < at;
        return (
          <button
            key={stage.id}
            type="button"
            disabled={disabled || current}
            aria-current={current ? "step" : undefined}
            onClick={() => onMove(stage.id)}
            title={current ? `In ${stage.name}` : `Move to ${stage.name}`}
            className={cn(
              "flex min-w-[8.5rem] flex-1 shrink-0 flex-col items-start py-2 pr-5 text-left text-sm font-semibold transition-[filter] duration-[var(--t-micro)] enabled:hover:brightness-125 disabled:cursor-default",
              index === 0 ? cn(first, "pl-3.5") : cn(chevron, "pl-6"),
              current ? "text-foreground" : done ? "bg-[var(--primary-soft)] text-foreground" : "bg-[var(--surface-alt)] text-muted-foreground",
            )}
            style={current ? { background: `color-mix(in srgb, ${stage.color} 55%, var(--color-card))` } : undefined}
          >
            <span className="max-w-full truncate">{stage.name}</span>
            <span className={cn("text-xs font-medium tabular-nums", current ? "text-foreground/80" : "text-muted-foreground")}>{current ? (here ? `${here} here` : "Here now") : done ? "Done" : " "}</span>
          </button>
        );
      })}
      {closed.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn("flex shrink-0 flex-col items-start rounded-r-lg py-2 pr-4 pl-6 text-left text-sm font-semibold", chevron.replace("calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%", "100%_0,100%_100%"), closedHere ? "text-foreground" : "bg-[var(--surface-alt)] text-muted-foreground")}
              style={closedHere ? { background: `color-mix(in srgb, ${closedHere.color} 50%, var(--color-card))` } : undefined}
            >
              <span className="flex items-center gap-1">{closedHere ? closedHere.name : `Closed · ${closed.length}`}<ChevronDown aria-hidden="true" className="size-3.5" /></span>
              <span className="text-xs font-medium text-muted-foreground">{closedHere ? (here ? `${here} here` : "Closed") : "Close this lead"}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {closed.map((stage) => (
              <DropdownMenuItem key={stage.id} disabled={stage.id === currentId} onSelect={() => onMove(stage.id)}>
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: stage.color }} />{stage.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}

/** Their clock, from the lead's own time zone: "3:12 pm in America/Chicago". Ticks once a minute. */
function clockIn(zone: string, at: number) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(at)).toLowerCase(); } catch { return null; }
}
export function LocalTime({ zone }: { zone: string }) {
  const [now, setNow] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's clock, read after hydration, then once a minute
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const time = now === null ? null : clockIn(zone, now);
  if (!time) return null;
  return <span>{time} their time · {zone.replace(/_/g, " ")}</span>;
}

export type PersonRow = { key: string; label: string; value: string; empty: boolean; note?: string | null };

/**
 * The person (direction B, left): their number, their time, and what they told us. A call goes through the dialer, never a
 * raw tel: link, so the calling window, do-not-call and the attempt record all apply.
 */
export function PersonCard({ phone, zone, rows, callHref, children }: { phone: string | null; zone: string | null; rows: PersonRow[]; callHref: string; children?: React.ReactNode }) {
  return (
    <section aria-label="The person" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      {phone ? (
        <div>
          <p className="m-0 text-xl font-bold tabular-nums tracking-[-0.01em] text-foreground">{phone}</p>
          {zone && <p className="m-0 mt-0.5 text-xs text-muted-foreground"><LocalTime zone={zone} /></p>}
        </div>
      ) : <p className="m-0 text-sm text-muted-foreground">No phone number on this lead.</p>}
      {phone && (
        <div className="flex gap-2">
          <Button asChild variant="outline" className="flex-1"><Link href={callHref}><Phone aria-hidden="true" />Call in the dialer</Link></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Copy the number" title="Copy the number" onClick={() => { void navigator.clipboard?.writeText(phone).then(() => notify.done("Number copied")); }}><Copy aria-hidden="true" /></Button>
        </div>
      )}
      <dl className="m-0">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2 last:border-b-0">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className={cn("m-0 min-w-0 text-sm break-words", row.empty ? "text-muted-foreground" : "font-medium text-foreground")}>
              {row.empty ? "—" : row.value}
              {row.note && <span className="mt-0.5 block text-xs font-normal text-[var(--warning-ink)]">{row.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

export type StreamItem = { id: string; kind: "call" | "note" | "event"; at: string; title: string; detail: string | null; body?: string | null };
type StreamFilter = "all" | "call" | "note" | "event";

/**
 * One activity stream (direction B, centre): calls, notes and every recorded event, newest first, with the note box on
 * top. The Activity and Conversation tabs keep the full tables and the partner channel.
 */
export function ActivityStream({ items, canWrite, partnerLabel, onAddNote, onOpenAll }: { items: StreamItem[]; canWrite: boolean; partnerLabel: string | null; onAddNote: (body: string, visibility: "internal" | "shared") => Promise<boolean>; onOpenAll: () => void }) {
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "shared">("internal");
  const [busy, setBusy] = useState(false);
  const counts = { all: items.length, call: items.filter((item) => item.kind === "call").length, note: items.filter((item) => item.kind === "note").length, event: items.filter((item) => item.kind === "event").length };
  const shown = items.filter((item) => filter === "all" || item.kind === filter);
  const SHOWN = 40;
  const icon = { call: Phone, note: StickyNote, event: FileText } as const;
  const tone = { call: "bg-[var(--info-surface)] text-[var(--info-ink)]", note: "bg-[var(--success-surface)] text-[var(--success-ink)]", event: "bg-[var(--surface-alt)] text-muted-foreground" } as const;
  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    const ok = await onAddNote(body.trim(), visibility);
    setBusy(false);
    if (ok) { setBody(""); setVisibility("internal"); }
  }
  return (
    <section aria-label="Activity" className="m-glass flex min-w-0 flex-col rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
        <h2 className="m-0 text-card-title font-semibold text-foreground">Activity</h2>
        <span className="flex-1" />
        <Segmented label="Show" options={[{ key: "all", label: `All ${counts.all}` }, { key: "call", label: `Calls ${counts.call}` }, { key: "note", label: `Notes ${counts.note}` }, { key: "event", label: `Events ${counts.event}` }]} value={filter} onChange={(value) => setFilter(value as StreamFilter)} />
      </div>
      {canWrite && (
        <div className="mx-4 mt-3 rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)]">
          <label htmlFor="lead-quick-note" className="sr-only">Write a note</label>
          <textarea id="lead-quick-note" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a note…" className={cn(textareaControl, "mt-0 min-h-16 rounded-b-none border-0 bg-transparent focus-visible:ring-0")} />
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
            {partnerLabel ? <Segmented label="Who sees it" options={[{ key: "internal", label: "Internal" }, { key: "shared", label: `Shared with ${partnerLabel}` }]} value={visibility} onChange={(value) => setVisibility(value as "internal" | "shared")} /> : <span className="px-1 text-xs text-muted-foreground">Internal note</span>}
            <span className="flex-1" />
            <Button type="button" size="sm" variant="outline" disabled={busy || !body.trim()} onClick={() => void add()}>{busy ? "Adding…" : "Add note"}</Button>
          </div>
        </div>
      )}
      <ol className="m-0 flex list-none flex-col px-4 pt-1 pb-3">
        {shown.slice(0, SHOWN).map((item) => {
          const Icon = icon[item.kind];
          return (
            <li key={`${item.kind}-${item.id}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-3 border-b border-border py-3 last:border-b-0">
              <span aria-hidden="true" className={cn("grid size-7 place-items-center rounded-md", tone[item.kind])}><Icon className="size-3.5" /></span>
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-foreground">{item.title}</p>
                {item.detail && <p className="m-0 mt-0.5 text-xs text-muted-foreground break-words">{item.detail}</p>}
                {item.body && <p className="m-0 mt-1.5 rounded-md border border-border bg-[var(--color-card)] px-2.5 py-2 text-sm whitespace-pre-wrap break-words text-foreground">{item.body}</p>}
              </div>
              <time className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">{stampOf(item.at)}</time>
            </li>
          );
        })}
        {!shown.length && <li className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</li>}
      </ol>
      {shown.length > SHOWN && <button type="button" onClick={onOpenAll} className="border-t border-border px-4 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-[var(--surface-alt)]">All {shown.length} in Activity ›</button>}
    </section>
  );
}

/** What happens next (direction B, right): where the lead is, what is due, who has it. */
export function NextStepCard({ stage, inStage, next, rows, children }: { stage: PathStage | null; inStage: string | null; next: { label: string; due: boolean } | null; rows: Array<{ label: string; value: string; muted?: boolean }>; children?: React.ReactNode }) {
  return (
    <section aria-label="What happens next" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <h2 className="m-0 text-card-title font-semibold text-foreground">What happens next</h2>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-badge border border-border px-2 py-0.5 text-xs font-semibold text-foreground" style={stage ? { background: `color-mix(in srgb, ${stage.color} 22%, transparent)` } : undefined}>
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: stage?.color ?? "var(--muted-foreground)" }} />{stage?.name ?? "No stage"}
        </span>
        {inStage && <span className="text-xs tabular-nums text-muted-foreground">for {inStage}</span>}
      </div>
      {next && (
        <p className={cn("m-0 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold", next.due ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--surface-alt)] text-foreground")}>
          <Clock aria-hidden="true" className="size-4 shrink-0" />{next.label}
        </p>
      )}
      <dl className="m-0">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2 last:border-b-0">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className={cn("m-0 min-w-0 text-sm break-words", row.muted ? "text-muted-foreground" : "font-medium text-foreground")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}
