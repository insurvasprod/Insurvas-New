"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Clock3, Handshake, Package, UserRoundCheck, type LucideIcon } from "lucide-react";

import { ScreeningCard } from "@/components/app/inbound/call-cockpit-parts";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";

/**
 * The caller on the left of both call steps, Verification and Finish the call (owner 2026-10-27:
 * the same card on both): who is on the line, the product, where the call came from, who took it,
 * how long it has run, and the screening checked before it reached the agent.
 */

export type CallerFacts = { name: string; product: string; from: string; takenBy: string; callStartedAt: string | null };

type PanelLike = {
  workItem: { productLine: string };
  lead: { values: Record<string, unknown> };
  template: { product_name: string };
  context?: { claim: { at: string | null; byName: string | null; isYou: boolean }; partnerName: string | null; callStartedAt: string | null } | null;
};

export function clock(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; }

export function elapsed(from: string, now: number) {
  const total = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // A call open for days was never finished; an hour count that long hides that.
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** The card's facts from the verification panel (GET /api/app/inbound/verification). */
export function callerFacts(panel: PanelLike): CallerFacts {
  const values = panel.lead.values;
  const context = panel.context ?? null;
  return {
    name: String(values.full_name ?? values.name ?? ([values.first_name, values.last_name].filter(Boolean).join(" ") || "Customer")),
    product: panel.template.product_name || productLineLabel(panel.workItem.productLine),
    from: context?.partnerName ?? String(values.source ?? values.lead_source ?? "Partner transfer"),
    takenBy: context?.claim.byName ? `${context.claim.isYou ? "You" : context.claim.byName}, ${clock(context.claim.at)}` : "—",
    callStartedAt: context?.callStartedAt ?? null,
  };
}

/** Counts up once a second while there is an open call. */
export function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/** A fact about the call: an icon, a small label, the value. */
function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Icon className="size-4" /></span>
      <span className="min-w-0">
        <span className="block text-xs leading-[1.33] text-[var(--muted)]">{label}</span>
        <span className="block truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{value}</span>
      </span>
    </div>
  );
}

const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

export function CallerCard({ workItemId, facts, now }: { workItemId: string; facts: CallerFacts | null; now: number }) {
  const onTheCall = facts?.callStartedAt ? elapsed(facts.callStartedAt, now) : null;
  const name = facts?.name ?? "";
  return (
    <section className="m-glass flex min-w-0 flex-col rounded-[16px] border border-[var(--border)]">
      <div className="flex items-center gap-3 p-4">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]" aria-hidden="true">{name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "·"}</span>
        <span className="min-w-0">
          <span className={cn(label12, "block")}>On the line</span>
          <strong className="block truncate text-title-sm leading-[1.3] font-semibold tracking-[-0.015em] text-[var(--ink)]">{name || <span aria-hidden="true" className="block h-5 w-40 animate-pulse rounded bg-[var(--surface-alt)]" />}</strong>
        </span>
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border)] p-4">
        <Fact icon={Package} label="Product" value={facts?.product ?? "—"} />
        <Fact icon={Handshake} label="From" value={facts?.from ?? "—"} />
        <Fact icon={UserRoundCheck} label="Taken by" value={facts?.takenBy ?? "—"} />
        <Fact icon={Clock3} label="On the call" value={onTheCall ?? "No open call record"} />
      </div>
      {/* What was checked before the call (DNC, consent, the partner's screening). */}
      <div className="border-t border-[var(--border)] p-4">
        <ScreeningCard workItemId={workItemId} embedded />
      </div>
    </section>
  );
}

/** The card on a page that does not already hold the verification panel (Finish the call). */
export function CallerCardForCall({ workItemId }: { workItemId: string }) {
  const [facts, setFacts] = useState<CallerFacts | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? callerFacts(await response.json() as PanelLike) : null))
      .catch(() => null)
      .then((value) => { if (live && value) setFacts(value); });
    return () => { live = false; };
  }, [workItemId]);
  const now = useNow(Boolean(facts?.callStartedAt));
  return <CallerCard workItemId={workItemId} facts={facts} now={now} />;
}
