"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Callout, SettingsCard, SettingsGrid, ToggleRow, control } from "@/components/app/settings/primitives";
import { LeaveGuard } from "@/components/ui/leave-guard";
import type { LadderValues } from "@/lib/queueSla/ladder";
import { cn } from "@/lib/utils";

/**
 * Settings › Inbound transfers (Inbound A, chosen 2026-10-25): what sits beside the waiting-time
 * ladder. The coloured bar is the ladder itself, redrawn as each rung is typed; the three cards are
 * the workspace's alerts, buffer handoff and who gets the next transfer
 * (/api/app/inbound-settings, migration 20261025100000).
 */

export type InboundSettings = {
  alertNewTransfer: boolean;
  emailOwnersOnEscalation: boolean;
  handoffTimeoutSeconds: number;
  licensedOnly: boolean;
  skipOnBreak: boolean;
};

/** 45 → `45s`, 120 → `2m`, 14400 → `4h`. */
function short(seconds: number) {
  const parts: string[] = [];
  let rest = Math.round(seconds);
  for (const [size, suffix] of [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]] as const) {
    if (rest >= size) { parts.push(`${Math.floor(rest / size)}${suffix}`); rest %= size; }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0s";
}

const BANDS = [
  { key: "warn", label: "Claimable", color: "var(--success)" },
  { key: "escalate", label: "Warned", color: "var(--warning)" },
  { key: "partner", label: "Escalated", color: "color-mix(in srgb, var(--error) 70%, var(--warning))" },
  { key: "expire", label: "Partner told", color: "var(--error)" },
] as const;

/**
 * The ladder as one coloured bar: green while a transfer is simply claimable, amber once it warns,
 * then escalation, partner notice, and the end where it expires. A log scale, so 45 seconds and
 * four hours can share one bar and each band stays wide enough to read.
 */
export function WaitingBar({ values }: { values: LadderValues }) {
  const end = Math.log1p(values.expire);
  const at = (seconds: number) => (Math.log1p(seconds) / end) * 100;
  const edges = [0, at(values.warn), at(values.escalate), at(values.partner), 100];
  return (
    <figure className="m-0" aria-label={`A transfer is claimable for ${short(values.warn)}, warns at ${short(values.warn)}, escalates at ${short(values.escalate)}, tells the partner at ${short(values.partner)} and expires at ${short(values.expire)}.`}>
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>
        {BANDS.map((band, index) => (
          <span key={band.key} className="h-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, edges[index + 1] - edges[index])}%`, background: band.color }} />
        ))}
      </div>
      <div className="relative mt-2 h-9" aria-hidden>
        {[
          { at: 0, label: "0s", tone: "text-[var(--muted)]", align: "start" },
          { at: edges[1], label: `Warn ${short(values.warn)}`, tone: "text-[var(--warning-ink)]", align: "mid" },
          { at: edges[2], label: `Escalate ${short(values.escalate)}`, tone: "text-[var(--error-ink)]", align: "mid" },
          { at: edges[3], label: `Partner ${short(values.partner)}`, tone: "text-[var(--error-ink)]", align: "mid" },
          { at: 100, label: `Expire ${short(values.expire)}`, tone: "text-[var(--muted)]", align: "end" },
        ].map((mark, index) => (
          <span
            key={mark.label}
            className={cn("absolute whitespace-nowrap text-xs leading-[1.5] font-semibold tracking-[-0.01em]", mark.tone, index % 2 === 1 ? "top-4" : "top-0")}
            style={mark.align === "start" ? { left: 0 } : mark.align === "end" ? { right: 0 } : { left: `${mark.at}%`, transform: "translateX(-50%)" }}
          >
            {mark.label}
          </span>
        ))}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-[1.5] text-[var(--muted)]">
        {BANDS.map((band) => (
          <span key={band.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: band.color }} />{band.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}

type Loaded = { settings: InboundSettings; ready: boolean };

/** The inbound settings as a draft beside the ladder's; `available` is false without inbound transfers on the plan. */
export function useInboundSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<InboundSettings | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const [timeoutText, setTimeoutText] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/app/inbound-settings", { cache: "no-store" }).catch(() => null);
    if (!response) { setError("Could not load the inbound settings."); return; }
    // 403: no inbound transfers on the plan (or not the owner) — the cards are simply not shown.
    if (response.status === 403 || response.status === 404) { setAvailable(false); return; }
    const body = await response.json().catch(() => null) as (Loaded & { error?: string }) | null;
    if (!response.ok || !body?.settings) { setError(body?.error ?? "Could not load the inbound settings."); return; }
    setLoaded({ settings: body.settings, ready: body.ready });
    setDraft(body.settings);
    setTimeoutText(String(body.settings.handoffTimeoutSeconds));
    setError("");
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const timeout = /^\d{1,3}$/.test(timeoutText.trim()) ? Number(timeoutText.trim()) : null;
  const timeoutProblem = timeout === null || timeout < 5 || timeout > 300 ? "Between 5 and 300 seconds." : null;
  const next = useMemo(() => (draft && timeout !== null ? { ...draft, handoffTimeoutSeconds: timeout } : draft), [draft, timeout]);
  const dirty = Boolean(loaded && next && JSON.stringify(next) !== JSON.stringify(loaded.settings));

  const save = useCallback(async (): Promise<boolean> => {
    if (!next || timeoutProblem) { setError(timeoutProblem ?? ""); return false; }
    const response = await fetch("/api/app/inbound-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) as { settings?: InboundSettings; error?: string } | null : null;
    if (!response?.ok || !body?.settings) { setError(body?.error ?? "Could not save the inbound settings. Check your connection and try again."); return false; }
    setLoaded({ settings: body.settings, ready: true });
    setDraft(body.settings);
    setTimeoutText(String(body.settings.handoffTimeoutSeconds));
    setError("");
    return true;
  }, [next, timeoutProblem]);

  const reset = useCallback(() => {
    if (!loaded) return;
    setDraft(loaded.settings);
    setTimeoutText(String(loaded.settings.handoffTimeoutSeconds));
    setError("");
  }, [loaded]);

  return { available, loaded, draft, setDraft, timeoutText, setTimeoutText, timeoutProblem, dirty, save, reset, error };
}

export function InboundSettingsCards({ inbound, disabled }: { inbound: ReturnType<typeof useInboundSettings>; disabled: boolean }) {
  const { draft, loaded } = inbound;
  if (!inbound.available) return null;
  if (!draft || !loaded) return inbound.error ? <Callout tone="error" title={inbound.error} /> : null;
  const locked = disabled || !loaded.ready;
  const set = (patch: Partial<InboundSettings>) => inbound.setDraft((current) => (current ? { ...current, ...patch } : current));
  return (
    <>
      <LeaveGuard dirty={inbound.dirty} onSave={inbound.save} onDiscard={inbound.reset} what="the inbound settings" />
      {!loaded.ready && <Callout tone="warning" title="Alerts, buffer handoff and routing need a database update before they can be changed. Until then transfers work as they always have." />}
      {inbound.error && <Callout tone="error" title={inbound.error} />}
      <SettingsGrid cols={3}>
        <SettingsCard title="Who hears about it" sub="When a transfer arrives or waits too long.">
          <div className="flex flex-col gap-4">
            <ToggleRow id="inbound-alert-new" title="Agents, when a transfer arrives" help="The “new lead waiting” alert to owners, producers and buffer agents. The claim card shows the wait either way." checked={draft.alertNewTransfer} onChange={(value) => set({ alertNewTransfer: value })} disabled={locked} />
            <ToggleRow id="inbound-email-owners" title="Owners by email, when it escalates" help="Each owner can still turn it off for themselves in Notifications. The in-app alert always fires." checked={draft.emailOwnersOnEscalation} onChange={(value) => set({ emailOwnersOnEscalation: value })} disabled={locked} />
            <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">The partner is told automatically in their channel: connected, the outcome, and at the partner rung above.</p>
          </div>
        </SettingsCard>
        <SettingsCard title="Buffer agents" sub="People with the Assistant role take the call first, then hand it to a licensed agent.">
          <div className="flex flex-col gap-2">
            <label htmlFor="inbound-handoff-timeout" className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">The licensed agent has this long to accept</label>
            <div className="flex items-center gap-2">
              <input id="inbound-handoff-timeout" inputMode="numeric" autoComplete="off" value={inbound.timeoutText} onChange={(event) => inbound.setTimeoutText(event.target.value)} disabled={locked} aria-invalid={Boolean(inbound.timeoutProblem) || undefined} className={cn(control, "mt-0 w-24", inbound.timeoutProblem && "border-[var(--error)]")} />
              <span className="text-sm leading-[1.5] text-[var(--body)]">seconds</span>
            </div>
            <span className={cn("text-xs leading-[1.5]", inbound.timeoutProblem ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>{inbound.timeoutProblem ?? "After that the offer lapses and the buffer can offer someone else. 5 to 300 seconds."}</span>
          </div>
        </SettingsCard>
        <SettingsCard title="Who gets the next transfer" sub="Take next and the claim card hand out the longest wait first.">
          <div className="flex flex-col gap-4">
            <ToggleRow id="inbound-licensed-only" title="Only agents licensed in the caller’s state" help="Licensed agents are offered only callers in states they hold a live licence for. Buffer agents are not licensed and still take any caller." checked={draft.licensedOnly} onChange={(value) => set({ licensedOnly: value })} disabled={locked} />
            <ToggleRow id="inbound-skip-break" title="Skip agents on a break" help="Someone set to On break or Off on the floor is not handed a transfer until they are Ready again." checked={draft.skipOnBreak} onChange={(value) => set({ skipOnBreak: value })} disabled={locked} />
          </div>
        </SettingsCard>
      </SettingsGrid>
    </>
  );
}
