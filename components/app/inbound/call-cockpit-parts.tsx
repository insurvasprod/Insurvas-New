"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { productLineLabel } from "@/lib/format/productLine";
import { notify } from "@/lib/notify";
import { claimedMessage } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";
import type { RecordedOutcome } from "@/components/app/use-disposition-walk";

/**
 * The inbound call screen's parts (Inbound A, redesign 2026-10-25): the Dialer A cockpit, for a
 * transfer. The verification itself stays VerificationPanel's — every field confirmed, corrected or
 * marked outstanding (LA-1.11) — and the outcome stays the disposition walk; these are the frame.
 */

const card = "m-glass min-w-0 rounded-[16px] border border-[var(--border)]";

type Waiting = { id: string; customer: string; productLine: string; partnerName: string; state: string; waitSeconds: number };
type WaitingData = { count: number; items: Waiting[]; sla: { warnSeconds: number; escalateSeconds: number } | null; fetchedAt: string };

function clock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Take the next transfer: the same atomic claim as the inbox and the card. */
export function useTakeNext() {
  const router = useRouter();
  const [taking, setTaking] = useState(false);
  const takeNext = useCallback(async () => {
    setTaking(true);
    try {
      const response = await fetch("/api/app/inbound/claim-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not claim the next transfer"); return; }
      notify.arrive(claimedMessage(body));
      const id = body?.claim?.work_item_id as string | undefined;
      if (id) router.push(`/app/inbound/${id}/verification`);
    } catch { notify.block("Could not reach Insurvas. Try again."); }
    finally { setTaking(false); }
  }, [router]);
  return { taking, takeNext };
}

/**
 * Who else is waiting, longest first, while this call is open. Claiming another is for after this
 * call's outcome is recorded (`canTake`): until then the list is for seeing the line, not leaving it.
 */
export function LiveTransfersColumn({ canTake, onTake, taking }: { canTake: boolean; onTake: () => void; taking: boolean }) {
  const [data, setData] = useState<WaitingData | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(0);
  const load = useCallback(async () => {
    const response = await fetch("/api/app/inbound/waiting", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    setData(await response.json() as WaitingData);
    setLoadedAt(Date.now());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read of an external queue
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [load]);
  const elapsed = Math.max(0, Math.round(((now || loadedAt) - loadedAt) / 1000));
  const sla = data?.sla ?? null;
  return (
    <section aria-label="Live transfers" className={cn(card, "flex flex-col overflow-hidden lg:min-h-0")}>
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-foreground">Live transfers</h2>
          <span className="text-xs leading-[1.5] text-muted-foreground tabular-nums">{data ? `${data.count} waiting` : ""}</span>
        </div>
        <p className="m-0 mt-1 text-xs leading-[1.5] text-muted-foreground">{canTake ? "Longest wait first. Take the next when you are ready." : "Longest wait first. Record this call's outcome to take the next."}</p>
      </div>
      <ul className="m-0 list-none p-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {data?.items.map((item) => {
          const wait = item.waitSeconds + elapsed;
          const tone = !sla ? "text-[var(--accent-ink)]" : wait >= sla.escalateSeconds ? "text-[var(--error-ink)]" : wait >= sla.warnSeconds ? "text-[var(--warning-ink)]" : "text-[var(--accent-ink)]";
          return (
            <li key={item.id} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-foreground">{item.customer}</span>
                <span className="block truncate text-xs leading-[1.5] text-muted-foreground">{[productLineLabel(item.productLine), item.state !== "—" ? item.state : null, item.partnerName].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={cn("text-sm font-semibold tabular-nums", tone)}>{clock(wait)}</span>
            </li>
          );
        })}
        {data && data.items.length === 0 && <li className="px-4 py-4 text-xs leading-[1.5] text-muted-foreground">Nobody else is waiting.</li>}
      </ul>
      {data && data.count > 0 && (
        <div className="border-t border-[var(--border)] p-3">
          <Button type="button" className="w-full" onClick={onTake} disabled={!canTake || taking}>{taking ? "Claiming…" : "Take the next transfer"}</Button>
        </div>
      )}
    </section>
  );
}

const STEPS = ["Claim", "Verify", "Outcome"];

/** Where the call is: claimed, verified, recorded. */
export function InboundSteps({ verified, recorded }: { verified: boolean; recorded: boolean }) {
  const step = recorded ? 3 : verified ? 2 : 1;
  return (
    <ol aria-label="Call steps" className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
      {STEPS.map((name, index) => (
        <li key={name} aria-current={index === step ? "step" : undefined} className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-[1.5] font-semibold", index < step ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : index === step ? "bg-[var(--surface-alt)] text-[var(--ink)] ring-1 ring-[var(--border-strong)]" : "text-[var(--muted)]")}>
          <span className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border text-xs", index <= step ? "border-current" : "border-[var(--border-strong)]")} aria-hidden="true">{index < step ? "✓" : index + 1}</span>
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ol>
  );
}

type Ladder = { checked: boolean; summary: string; checkedAt: string | null; steps: Array<{ key: string; label: string; state: "passed" | "match" | "not_reached" | "unknown" }> };

/**
 * The screening that ran before the transfer reached the agent (lib/transferInbox/screeningLadder.ts).
 * `embedded` draws it inside another card (the call's caller card) without its own frame. The
 * all-clear summary is left off (owner 2026-10-27): the ticks say it; a match still explains itself.
 */
export function ScreeningCard({ workItemId, embedded = false }: { workItemId: string; embedded?: boolean }) {
  const [ladder, setLadder] = useState<Ladder | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/app/inbound/screening?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()) as Ladder : null))
      .catch(() => null)
      .then((value) => { if (!cancelled) setLadder(value); });
    return () => { cancelled = true; };
  }, [workItemId]);
  const clear = ladder?.steps.filter((step) => step.state === "passed").length ?? 0;
  const allClear = !!ladder && ladder.steps.length > 0 && clear === ladder.steps.length;
  return (
    <section aria-label="Screening" className={embedded ? "min-w-0" : cn(card, "p-4")}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-foreground">Screening</h2>
        {ladder && ladder.steps.length > 0 && <StatusChip dot={false} tone={allClear ? "good" : "danger"}>{clear} of {ladder.steps.length} clear</StatusChip>}
      </div>
      {ladder === undefined && <p className="m-0 text-xs leading-[1.5] text-muted-foreground">Reading the checks…</p>}
      {ladder === null && <p className="m-0 text-xs leading-[1.5] text-muted-foreground">The screening checks could not be read.</p>}
      {ladder && (
        <>
          <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0">
            {ladder.steps.map((step) => (
              <li key={step.key} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm leading-[1.5]">
                <span aria-hidden="true" className={cn("grid size-[18px] shrink-0 place-items-center rounded-full", step.state === "match" ? "bg-[var(--error)] text-white" : step.state === "passed" ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border border-[var(--border-strong)] text-muted-foreground")}>
                  {step.state === "match" ? <X className="size-3" /> : step.state === "passed" ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--body)]">{step.label}</span>
                {step.state === "match" ? <StatusChip dot={false} tone="danger">Match</StatusChip> : step.state !== "passed" && <span className="text-xs font-semibold text-muted-foreground">{step.state === "not_reached" ? "Not reached" : "Unknown"}</span>}
              </li>
            ))}
          </ul>
          {!allClear && ladder.summary && <p className="m-0 mt-2 text-xs leading-[1.5] text-muted-foreground">{ladder.summary}</p>}
        </>
      )}
    </section>
  );
}

/**
 * What the outcome did, in the server's words: one outcome moved the lead's stage, told the partner
 * and (for Do not call) listed the number. A partner card that failed says so, with where to follow up.
 */
export function OutcomeEffects({ outcome }: { outcome: RecordedOutcome }) {
  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    { label: "Pipeline", value: outcome.stage ? `Moved to “${outcome.stage.name}” · ${outcome.stage.pipelineName}` : "Stage unchanged", ok: true },
    { label: "Partner", value: outcome.partnerCardPosted === false ? "The update card could not be posted. Tell them in Partner chat." : outcome.partnerCardPosted ? "Update card posted to the partner" : "Partner told through their channel", ok: outcome.partnerCardPosted !== false },
    ...(outcome.dncAdded ? [{ label: "Do not call", value: "Number added to your do-not-call list", ok: true }] : []),
  ];
  return (
    <section aria-label="What the outcome did" className="rounded-[14px] border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-soft)] p-3.5">
      <p className="m-0 mb-2 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-foreground">Recorded{outcome.label ? `: ${outcome.label}` : ""}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row) => (
          <li key={row.label} className="flex gap-2 text-xs leading-[1.5]">
            <span aria-hidden="true" className={cn("font-bold", row.ok ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>{row.ok ? "✓" : "!"}</span>
            <span className="w-[72px] shrink-0 text-muted-foreground">{row.label}</span>
            <span className={row.ok ? "text-foreground" : "text-[var(--warning-ink)]"}>{row.value}</span>
          </li>
        ))}
      </ul>
      {outcome.leadId && <Link href={`/app/deal-flow?focus_lead_id=${encodeURIComponent(outcome.leadId)}`} className="mt-2 inline-block text-xs leading-[1.5] font-semibold text-[var(--accent-ink)] hover:underline">Open it in daily deal flow →</Link>}
    </section>
  );
}
