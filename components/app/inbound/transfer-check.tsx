"use client";

/**
 * Inbound step 2, Caller profile (owner 2026-10-28; first named Transfer check): everything we already know about the caller,
 * before the agent says hello — the phone first (in the caller card), the lead's details as the
 * partner sent them, how many times we have called them and how the last call went, how many times
 * they have been transferred in, and the notes on the lead. Read-only; the details are checked with
 * the caller on the next step, Verification.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, PhoneCall, Repeat, StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/page-loading";
import { Callout } from "@/components/app/settings/primitives";
import { CallerCard, callerFacts, useNow } from "@/components/app/inbound/caller-card";
import { ago } from "@/components/app/applications/outcome/model";

type Field = { field_key: string; label: string };
type Panel = Parameters<typeof callerFacts>[0] & { sections: Array<{ section_key: string; label: string; fields: Field[] }> };
type Caller = {
  notes: Array<{ id: string; body: string; author: string; createdAt: string }> | null;
  calls: { count: number; last: { at: string; outcome: string | null; by: string } | null } | null;
  transfers: number | null;
};

const shown = (value: unknown) => (Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? null : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Stat({ icon: Icon, label, value, detail }: { icon: typeof PhoneCall; label: string; value: string; detail?: string | null }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] px-3.5 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[var(--body)]">{label}</span>
        <span className="block text-xl font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{value}</span>
        {detail && <span className="block text-xs text-[var(--body)]">{detail}</span>}
      </span>
    </div>
  );
}

export function TransferCheck({ workItemId, onNext }: { workItemId: string; onNext: () => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [caller, setCaller] = useState<Caller | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(Boolean(panel?.context?.callStartedAt));

  useEffect(() => {
    let live = true;
    const read = (url: string) => fetch(url, { cache: "no-store" }).then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error ?? "Could not load the caller"); return b; });
    read(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`).then((b) => { if (live) setPanel(b as Panel); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the caller"); });
    // The extras are best-effort: the step works without them.
    read(`/api/app/inbound/caller?work_item_id=${encodeURIComponent(workItemId)}`).then((b) => { if (live) setCaller(b as Caller); }).catch(() => { if (live) setCaller({ notes: null, calls: null, transfers: null }); });
    return () => { live = false; };
  }, [workItemId]);

  if (error) return <Callout tone="error" title={error} />;
  if (!panel) return <PageLoading strip={false} rows={6} />;

  const facts = callerFacts(panel);
  const values = panel.lead.values;
  // Every detail the partner sent, in the template's order, once each; empty ones are left out.
  const seen = new Set<string>();
  const details = panel.sections.flatMap((section) => section.fields).filter((f) => { if (seen.has(f.field_key)) return false; seen.add(f.field_key); return shown(values[f.field_key]) !== null; });
  const calls = caller?.calls ?? null;
  const notes = caller?.notes ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
      <aside aria-label="The caller" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:w-[320px] lg:shrink-0">
        <CallerCard workItemId={workItemId} facts={facts} now={now} />
      </aside>

      <section aria-label="Before you answer" className="m-glass flex min-w-0 flex-1 flex-col gap-5 rounded-[16px] border border-[var(--border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-card-title text-[var(--ink)]">Before you answer</h2>
            <p className="m-0 mt-0.5 text-sm text-[var(--body)]">Who {facts.name} is to us so far. You check the details with them on the next step.</p>
          </div>
          {/* Owner 2026-10-28: Back to the line on the left of the way on. The call stays yours. */}
          <span className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost"><Link href="/app/inbound"><ChevronLeft aria-hidden="true" />Back to Incoming calls</Link></Button>
            <Button type="button" onClick={onNext}>Next: Verification<ArrowRight aria-hidden="true" /></Button>
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat icon={PhoneCall} label="Times we called them" value={caller === null ? "…" : calls ? String(calls.count) : "—"} detail={calls?.last ? `Last ${ago(calls.last.at, now)}${calls.last.outcome ? ` · ${calls.last.outcome.replace(/_/g, " ")}` : ""}` : calls ? "Never called" : null} />
          <Stat icon={Repeat} label="Transferred in" value={caller === null ? "…" : caller?.transfers != null ? String(caller.transfers) : "—"} detail={caller?.transfers && caller.transfers > 1 ? "They have called in before" : caller?.transfers === 1 ? "First time in" : null} />
          <Stat icon={StickyNote} label="Notes" value={caller === null ? "…" : notes ? String(notes.length) : "—"} detail={notes && notes.length ? `Newest ${day(notes[0].createdAt)}` : notes ? "None yet" : null} />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">What the partner sent</h3>
          {details.length === 0 ? (
            <p className="m-0 text-sm text-[var(--body)]">No details came with this caller.</p>
          ) : (
            <dl className="m-0 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {details.map((f) => (
                <div key={f.field_key} className="flex min-w-0 flex-col border-b border-[var(--border)] pb-2">
                  <dt className="text-xs text-[var(--body)]">{f.label}</dt>
                  <dd className="m-0 truncate text-sm font-semibold text-[var(--ink)]" title={shown(values[f.field_key]) ?? undefined}>{shown(values[f.field_key])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Notes</h3>
          {notes === null ? (
            <p className="m-0 text-sm text-[var(--body)]">{caller === null ? "Loading the notes…" : "The notes could not be read."}</p>
          ) : notes.length === 0 ? (
            <p className="m-0 text-sm text-[var(--body)]">Nobody has written a note on this lead yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {notes.map((n) => (
                <li key={n.id} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-alt)] px-3.5 py-2.5">
                  <p className="m-0 whitespace-pre-wrap text-sm text-[var(--ink)]">{n.body}</p>
                  <p className="m-0 mt-1 text-xs text-[var(--body)]">{n.author} · {day(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
