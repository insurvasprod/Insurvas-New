"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { productLineLabel } from "@/lib/format/productLine";
import { isTypingTarget } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { claimedMessage } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";

type Waiting = { id: string; customer: string; productLine: string; partnerName: string; state: string; waitSeconds: number; screening: string };
type Handoff = { id: string; workItemId: string; bufferName: string; customer: string; productLine: string; progressPercentage: number; expiresAt: string };
type Data = { count: number; items: Waiting[]; handoffs: Handoff[]; sla: { warnSeconds: number; escalateSeconds: number } | null; realtimeTopic: string; readOnly: boolean; fetchedAt: string };

/** "4:02" — a wait as a clock, the way the floor reads it. */
function clock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Claim from anywhere (Inbound A, redesign 2026-10-25). When a live transfer is waiting, this card
 * sits over whatever page the agent is on: who, from which partner, and how long they have waited,
 * in the SLA's amber and red. Enter (or the button) claims the longest wait — the same atomic
 * claim-next as the inbox (LA-1.10: first claim wins; a lost race is said plainly, never retried) —
 * and opens the call screen. A handoff offered to this person comes first, with Accept.
 *
 * It is quiet on the inbound screens themselves, which list the same transfers, and it stays out of
 * the way: "Not now" hides it until a different transfer is at the front. The sound and the browser
 * alert for a new transfer stay the alert feed's (LA-1.25), so nothing here plays twice.
 */
export function LiveTransferCard() {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const inFlight = useRef(false);
  const hidden = pathname.startsWith("/app/inbound");

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/app/inbound/waiting", { cache: "no-store" });
      // Not entitled, or not a role that takes transfers: the card simply never shows.
      if (response.status === 401 || response.status === 403 || response.status === 404) { setOff(true); return; }
      if (!response.ok) return;
      setData(await response.json() as Data);
      setLoadedAt(Date.now());
    } catch {
      /* the next tick or broadcast retries */
    } finally {
      inFlight.current = false;
    }
  }, []);

  // A slow safety read; the realtime broadcast below is what makes it immediate.
  useEffect(() => {
    if (off) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read of an external queue
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, off]);

  // The inbox's channel: every claim, call and handoff broadcasts floor_changed (LA-1.15-2).
  const topic = data?.realtimeTopic;
  useEffect(() => {
    if (!topic || off) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let pending: number | null = null;
    const reloadSoon = () => { if (pending === null) pending = window.setTimeout(() => { pending = null; void load(); }, 800); };
    let channel: RealtimeChannel | null = supabase.channel(topic).on("broadcast", { event: "floor_changed" }, reloadSoon).subscribe();
    return () => { if (pending !== null) window.clearTimeout(pending); if (channel) void supabase.removeChannel(channel); channel = null; };
  }, [topic, load, off]);

  // The wait counts up between reads.
  const waitingNow = Boolean(data && (data.items.length || data.handoffs.length));
  useEffect(() => {
    if (!waitingNow) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitingNow]);

  const handoff = data?.handoffs[0] ?? null;
  const next = data?.items[0] ?? null;
  const front = handoff ? `handoff:${handoff.id}` : next ? `transfer:${next.id}` : null;
  const visible = Boolean(data && !hidden && !off && front && front !== dismissed);

  const claim = useCallback(async () => {
    if (!data || data.readOnly || busy) return;
    setBusy(true); setProblem(null);
    try {
      if (handoff) {
        const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoff.id }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) { setProblem(body?.error ?? "This handoff is no longer available."); void load(); return; }
        notify.arrive("Handoff accepted; verification is ready to resume");
        router.push(`/app/inbound/${handoff.workItemId}/verification`);
        return;
      }
      const response = await fetch("/api/app/inbound/claim-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json().catch(() => null);
      // First claim wins: someone else's claim is said plainly; the card moves on to whoever is next.
      if (!response.ok) { setProblem(body?.error ?? "Could not claim the transfer."); void load(); return; }
      const workItemId = body?.claim?.work_item_id as string | undefined;
      notify.arrive(claimedMessage(body));
      if (workItemId) router.push(`/app/inbound/${workItemId}/verification`);
    } catch {
      setProblem("Could not reach Insurvas. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, data, handoff, load, router]);

  // Enter claims — only when nothing else on the page has the keyboard.
  useEffect(() => {
    if (!visible) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target)) return;
      if (target && target !== document.body && !target.closest("[data-live-transfer]")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      event.preventDefault();
      void claim();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, claim]);

  if (!visible || !data) return null;

  const elapsed = Math.max(0, Math.round(((now || loadedAt) - loadedAt) / 1000));
  const wait = next ? next.waitSeconds + elapsed : 0;
  const sla = data.sla;
  const waitTone = !sla ? "text-[var(--accent-ink)]" : wait >= sla.escalateSeconds ? "text-[var(--error-ink)]" : wait >= sla.warnSeconds ? "text-[var(--warning-ink)]" : "text-[var(--accent-ink)]";
  const others = Math.max(0, data.count - (handoff ? 0 : 1));

  return (
    <section
      data-live-transfer=""
      data-print-hide
      aria-label={handoff ? "Handoff offered to you" : "Live transfer waiting"}
      aria-live="polite"
      className="m-glass fixed top-[calc(var(--top-bar-h,56px)+12px)] right-4 z-40 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--primary)_45%,transparent)] p-4 shadow-[var(--shadow-overlay)]"
    >
      <div className="flex items-center gap-2 text-xs leading-[1.5] font-semibold">
        <span className="relative inline-flex size-2.5" aria-hidden="true">
          <span className="absolute inline-flex size-full rounded-full bg-[var(--primary)] opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[var(--primary)]" />
        </span>
        <span className="tracking-[0.04em] text-[var(--accent-ink)] uppercase">{handoff ? "Handoff for you" : "Live transfer"}</span>
        {!handoff && <span className={cn("ml-auto tabular-nums", waitTone)}>waiting {clock(wait)}</span>}
      </div>

      {handoff ? (
        <div>
          <p className="m-0 text-lg leading-[1.3] font-semibold tracking-[-0.02em] text-foreground">{handoff.customer}</p>
          <p className="m-0 text-sm leading-[1.5] text-muted-foreground">{productLineLabel(handoff.productLine)} · from {handoff.bufferName} · verified {handoff.progressPercentage}%</p>
        </div>
      ) : next ? (
        <div>
          <p className="m-0 text-lg leading-[1.3] font-semibold tracking-[-0.02em] text-foreground">{next.customer}</p>
          <p className="m-0 text-sm leading-[1.5] text-muted-foreground">{[productLineLabel(next.productLine), next.state !== "—" ? next.state : null, next.partnerName].filter(Boolean).join(" · ")}</p>
          {next.screening !== "Clear" && <p className="m-0 mt-0.5 text-xs leading-[1.5] font-semibold text-[var(--warning-ink)]">Screening: {next.screening}</p>}
        </div>
      ) : null}

      {problem && <p role="alert" className="m-0 text-xs leading-[1.5] font-semibold text-[var(--error-ink)]">{problem}</p>}

      <Button type="button" onClick={() => void claim()} disabled={busy || data.readOnly} className="mt-1 w-full" aria-keyshortcuts="Enter">
        {data.readOnly ? "Read-only account" : busy ? "Claiming…" : handoff ? "Accept handoff" : "Claim"}
        {!data.readOnly && !busy && <kbd className="rounded-[4px] border border-current px-1.5 font-sans text-xs leading-[1.4] opacity-70">Enter</kbd>}
      </Button>
      <div className="flex items-center justify-between gap-3 text-xs leading-[1.5] text-muted-foreground">
        <span>{others > 0 ? <Link href="/app/inbound" className="font-semibold text-foreground hover:underline">{others} more waiting</Link> : "First to claim gets the call"}</span>
        <button type="button" onClick={() => setDismissed(front)} className="font-semibold hover:text-foreground">Not now</button>
      </div>
    </section>
  );
}
