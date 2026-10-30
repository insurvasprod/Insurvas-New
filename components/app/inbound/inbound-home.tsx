"use client";

/**
 * Inbound (/app/inbound), Inbound A (owner, 2026-10-27). The agent's page:
 *
 * - It opens on step 1 (owner, 2026-10-27: no setup page). Not taking calls is one line with Start;
 *   a browser that blocks pop-ups gets one warning with how to fix it.
 * - Step 1, Take a caller: a caller passed to you on top, the next caller as one card with one
 *   button, the rest of the line below. Taking a caller opens step 2, Verification, on the call page.
 * - Beside it: your calls still open (one taken hours ago is one to finish) and your team right now.
 *
 * The waiting line, your status and its heartbeat come from the same live floor read as Team
 * (use-floor.ts): realtime, never polled.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Phone } from "lucide-react";

import { Callout, st } from "@/components/app/settings/primitives";
import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";
import { callHref, secondsSince, shortDuration, useFloor, type Availability, type FloorData, type Lead, type Member } from "@/components/app/inbound/use-floor";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { productLineLabel } from "@/lib/format/productLine";
import { languageKey, languageName } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";

/** "1:14", a caller's wait. */
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** A settings threshold: 120 → "2:00". */
const limitLabel = (seconds: number) => clock(seconds);

type Pop = "on" | "blocked" | "ask" | "none";
function popupState(): Pop {
  if (typeof window === "undefined" || !("Notification" in window)) return "none";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "ask";
}

/** What a caller's checks say, in plain words: one chip each. */
function checks(item: Lead): Array<{ label: string; tone: StatusTone }> {
  const out: Array<{ label: string; tone: StatusTone }> = [];
  if (item.preflightStatus === "already_customer" || item.duplicateWarning) out.push({ label: "Same person found: check first", tone: "danger" });
  else if (item.screeningWarning) out.push({ label: `Check first: ${item.screeningWarning}`, tone: "warning" });
  else out.push({ label: "Screening clear", tone: "good" });
  if (item.preflightStatus === "spoken_before") out.push({ label: "Spoken to before", tone: "warning" });
  if (item.preflightStatus === "new_household") out.push({ label: "New person", tone: "neutral" });
  if (item.escalatedAt) out.push({ label: "Waiting too long", tone: "danger" });
  return out;
}

function waitTone(seconds: number, floor: FloorData) {
  return seconds >= floor.waitThresholds.redSeconds ? "danger" : seconds >= floor.waitThresholds.amberSeconds ? "warning" : "good";
}

function WaitBar({ seconds, floor }: { seconds: number; floor: FloorData }) {
  const pct = Math.min(100, (seconds / Math.max(1, floor.waitThresholds.redSeconds)) * 100);
  const tone = waitTone(seconds, floor);
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]">
      <span className={cn("block h-full rounded-full", tone === "danger" ? "bg-[var(--error)]" : tone === "warning" ? "bg-[var(--warning)]" : "bg-[var(--primary)]")} style={{ width: `${pct}%` }} />
    </span>
  );
}

function AvailabilityStatus({ availability, onCall }: { availability: Availability | null; onCall: boolean }) {
  const [label, tone] = onCall ? ["On a call", "info"] as const
    : availability === "ready" ? ["Taking calls", "good"] as const
      : availability === "on_break" ? ["On break", "warning"] as const
        : ["Not taking calls", "neutral"] as const;
  return <StatusChip tone={tone} dot>{label}</StatusChip>;
}

function isPresent(member: Member, now: number) {
  return Boolean(member.lastSeenAt) && now - new Date(member.lastSeenAt!).getTime() <= 60_000;
}

export function InboundHome({ currentUserId, readOnly, canSeeTeam, solo = false }: { currentUserId: string; readOnly: boolean; canSeeTeam: boolean; /** Solo mode: no Team page; All callers instead. */ solo?: boolean }) {
  const { floor, error, now, saving, availability, setAvailability, liveLabel, updated, refresh, claim, accept, sendNudge } = useFloor({ readOnly });
  const [pop, setPop] = useState<Pop>("none");
  useEffect(() => {
    // The browser's pop-up permission, read once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPop(popupState());
  }, []);

  // A caller who arrives is announced to screen readers; the chime comes from the app's alerts.
  const [arrival, setArrival] = useState("");
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set((floor?.waiting ?? []).map((item) => item.id));
    const before = seen.current;
    seen.current = ids;
    if (!before) return;
    const fresh = (floor?.waiting ?? []).filter((item) => !before.has(item.id));
    if (fresh.length) setArrival(fresh.length === 1 ? `New caller in line: ${fresh[0].customer}` : `${fresh.length} new callers in line`);
  }, [floor?.waiting]);

  const line = useMemo(() => [...(floor?.waiting ?? [])].sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()), [floor?.waiting]);
  const myCalls = useMemo(() => (floor?.onCalls ?? []).filter((call) => call.agentId === currentUserId).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()), [floor?.onCalls, currentUserId]);
  const team = useMemo(() => {
    const members = (floor?.members ?? []).filter((member) => member.id !== currentUserId);
    return {
      taking: members.filter((member) => member.availability === "ready" && isPresent(member, now)).length,
      onCall: members.filter((member) => member.availability === "on_call").length,
      onBreak: members.filter((member) => member.availability === "on_break" && isPresent(member, now)).length,
    };
  }, [floor?.members, currentUserId, now]);

  const [linePage, setLinePage] = useState(1);
  const linePageSize = useFittingPageSize(560, 65);

  if (!floor) {
    if (!error) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        <PageHeader title="Inbound" />
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">We couldn’t open Inbound: {error}<Button type="button" variant="outline" onClick={() => void refresh()}>Try again</Button></span>} />
      </div>
    );
  }

  const ready = availability === "ready";
  const onCall = myCalls.some((call) => secondsSince(call.startedAt, now) < 4 * 3600);
  const statusLocked = readOnly || availability === null;
  const start = () => setAvailability("ready");
  const next = line[0] ?? null;
  const rest = line.slice(1);
  const restShown = paginate(rest, linePage, linePageSize);
  const takeReason = readOnly ? "Your agency’s account is paused." : !ready ? "Start taking calls first." : undefined;

  const headerActions = (
    <>
      <AvailabilityStatus availability={availability} onCall={onCall} />
      {ready && <Button type="button" variant="outline" disabled={statusLocked} onClick={() => setAvailability("on_break")}>Take a break</Button>}
      {ready && <Button type="button" variant="outline" disabled={statusLocked} onClick={() => setAvailability("off")}>Stop taking calls</Button>}
      {canSeeTeam && (solo
        ? <Button asChild variant="outline"><Link href="/app/inbound/team?tab=all">All callers</Link></Button>
        : <Button asChild variant="outline"><Link href="/app/inbound/team">Team</Link></Button>)}
    </>
  );

  /* ── step 1: the next caller ── */
  const nextCard = next && (() => {
    const wait = secondsSince(next.queuedAt, now);
    const tone = waitTone(wait, floor);
    const speaks = next.language && languageKey(next.language) !== "english" ? languageName(next.language) : null;
    const facts = [next.age, next.state, speaks, productLineLabel(next.productLine), next.partnerName ? `from ${next.partnerName}` : null].filter(Boolean).join(" · ");
    return (
      <section aria-label="Next caller" className="m-glass flex min-w-0 flex-col gap-4 rounded-xl border border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] p-5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent),0_0_30px_color-mix(in_srgb,var(--primary)_12%,transparent)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-xs font-semibold tracking-[0.04em] text-[var(--accent-ink)] uppercase">Next caller</span>
            <h2 className="m-0 mt-1 text-title-md font-semibold tracking-[-0.02em] text-[var(--ink)]">{next.customer}</h2>
            {/* Owner 2026-10-28: the phone number, before anything else about them. */}
            <p className="m-0 mt-1 inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
              <Phone className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{next.phone ?? <span className="text-sm font-medium text-[var(--body)]">No phone on the lead</span>}
            </p>
            <p className="m-0 mt-0.5 text-sm text-[var(--body)]">{facts}</p>
          </div>
          <div className="text-right">
            <span className={cn("block text-title-md font-semibold tabular-nums", tone === "danger" ? "text-[var(--error-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--ink)]")}>{clock(wait)}</span>
            <span className="text-xs text-[var(--muted)]">waiting · too long at {limitLabel(floor.waitThresholds.redSeconds)}</span>
          </div>
        </div>
        <WaitBar seconds={wait} floor={floor} />
        <div className="flex flex-wrap gap-1.5">{checks(next).map((check) => <StatusChip key={check.label} tone={check.tone} dot={false}>{check.label}</StatusChip>)}</div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" data-guide="inbound-claim" className="min-w-56" disabled={Boolean(takeReason) || saving === next.id} title={takeReason} onClick={() => void claim(next.id)}>
            {saving === next.id ? "Taking…" : "Take this call"}
          </Button>
          <span className="text-sm text-[var(--body)]">{takeReason ?? "Opens the call: what we know about them, then verification."}</span>
        </div>
      </section>
    );
  })();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
      {/* The actions share the step bar's row (owner 2026-10-28), so nothing may sit between the two. */}
      <PageHeader title="Inbound" actions={headerActions} />
      <InboundStepBar current={0} />
      <span role="status" className="sr-only">{arrival}</span>

      {readOnly && <Callout tone="warning" title="Your agency’s account is paused: you can see the line, but not take callers." />}
      {error && <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Refresh to see the latest. {error}<Button type="button" variant="outline" onClick={() => void refresh()}>Refresh</Button></span>} />}
      {pop === "blocked" && (
        <Callout tone="warning" title="Your browser blocks pop-ups from Insurvas, so a waiting caller only shows while this tab is open. Allow notifications for this site in the browser’s site settings." />
      )}
      {!ready && !readOnly && (
        <section aria-label="Your status" className="m-glass flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-5 py-3.5">
          <span className="text-sm text-[var(--body)]"><strong className="font-semibold text-[var(--ink)]">{availability === "on_break" ? "You are on a break." : "You are not taking calls."}</strong> Callers are offered to you only while you are taking calls.</span>
          <Button type="button" onClick={start} disabled={statusLocked}>{availability === "on_break" ? "Back to taking calls" : "Start taking calls"}</Button>
        </section>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {floor.pendingHandoffs.map((handoff) => (
            <section key={handoff.id} aria-label="A call passed to you" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[var(--primary-soft)] px-4 py-3">
              <span className="min-w-0 text-sm text-[var(--body)]">
                <strong className="font-semibold text-[var(--ink)]">{handoff.bufferName} passed you a caller</strong> · {handoff.customer}, {productLineLabel(handoff.productLine)}, {handoff.progressPercentage}% checked
                {handoff.expiresAt && new Date(handoff.expiresAt).getTime() > now ? `. Goes back to ${handoff.bufferName} at ${new Date(handoff.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "."}
              </span>
              <Button type="button" variant="outline" disabled={readOnly || saving === `handoff:${handoff.id}`} onClick={() => void accept(handoff.id, handoff.workItemId)}>
                {saving === `handoff:${handoff.id}` ? "Taking over…" : "Take over the call"}
              </Button>
            </section>
          ))}

          {next ? nextCard : (
            <section aria-label="Nobody in line" className="m-glass flex flex-col gap-1 rounded-xl border border-border p-5">
              <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Nobody is waiting</h2>
              <p className="m-0 text-sm text-[var(--muted)]">{ready ? "We chime and show the caller here the moment one arrives." : "When you are taking calls, we chime and show the caller here the moment one arrives."}</p>
              {floor.callbacks.some((item) => item.isDueToday || item.isOverdue) && <Link href="/app/callbacks" className="mt-1 text-sm font-semibold text-[var(--accent-ink)] hover:underline">Meanwhile: callbacks due today ›</Link>}
            </section>
          )}

          {rest.length > 0 && (
            <TableCard title="Also in line" description="Longest wait first." action={<StatusChip tone="neutral" dot={false}>{rest.length}</StatusChip>} footer={<Pager page={restShown.current} total={rest.length} noun={rest.length === 1 ? "caller" : "callers"} pageSize={linePageSize} onPage={setLinePage} />}>
              <ul className="m-0 list-none p-0">
                {restShown.rows.map((item) => {
                  const wait = secondsSince(item.queuedAt, now);
                  const tone = waitTone(wait, floor);
                  const first = checks(item)[0];
                  return (
                    <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-[var(--border)] px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_140px_auto]">
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.customer}</span><span className={st.sub}>{[item.age, item.state, item.language ? languageName(item.language) : null].filter(Boolean).join(" · ")}</span></span>
                      <span className="min-w-0 max-md:hidden"><span className="block truncate text-sm text-[var(--body)]">{productLineLabel(item.productLine)}</span><span className={st.sub}>from {item.partnerName}</span></span>
                      <span className="max-md:hidden"><StatusChip tone={first.tone} dot={false}>{first.label}</StatusChip></span>
                      <span className="flex flex-col gap-1 max-md:hidden"><span className={cn("text-sm font-semibold tabular-nums", tone === "danger" ? "text-[var(--error-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--ink)]")}>{clock(wait)} waiting</span><WaitBar seconds={wait} floor={floor} /></span>
                      <Button type="button" variant="outline" size="sm" disabled={Boolean(takeReason) || saving === item.id} title={takeReason} onClick={() => void claim(item.id)}>{saving === item.id ? "Taking…" : "Take call"}</Button>
                    </li>
                  );
                })}
              </ul>
            </TableCard>
          )}
          {floor.truncated && <Callout tone="warning" title="Showing the 500 callers who have waited longest." />}
          <p className="m-0 text-xs text-[var(--muted)]" role="status">{liveLabel} · updated {updated}</p>
        </div>

        <aside aria-label="You and your team" className="flex min-w-0 flex-col gap-4">
          <section className="m-glass flex flex-col gap-3 rounded-xl border border-border p-4">
            <h2 className="m-0 text-xs font-semibold tracking-[0.04em] text-[var(--muted)] uppercase">Your open calls</h2>
            {myCalls.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">None. Every call you took is finished.</p>}
            {myCalls.map((call) => {
              const age = secondsSince(call.startedAt, now);
              const forgotten = age >= 4 * 3600;
              return (
                <div key={call.id} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2.5", forgotten ? "bg-[var(--warning-surface)]" : "bg-[var(--surface-alt)]")}>
                  <span className="min-w-0 text-sm">
                    <strong className="block truncate font-semibold text-[var(--ink)]">{call.customer}</strong>
                    <span className={forgotten ? "text-[var(--warning-ink)]" : "text-[var(--muted)]"}>{forgotten ? `Taken ${shortDuration(age)} ago, no outcome` : `On the call ${shortDuration(age)}`}</span>
                  </span>
                  <Button asChild variant="outline" size="sm"><Link href={forgotten ? callHref(call.id, "finish") : callHref(call.id, "verify")}>{forgotten ? "Finish it" : "Back to it"}</Link></Button>
                </div>
              );
            })}
          </section>
          <section className="m-glass flex flex-col gap-2.5 rounded-xl border border-border p-4">
            <h2 className="m-0 text-xs font-semibold tracking-[0.04em] text-[var(--muted)] uppercase">Your team now</h2>
            {([["Taking calls", team.taking, "bg-[var(--primary)]"], ["On a call", team.onCall, "bg-[var(--info)]"], ["On break", team.onBreak, "bg-[var(--warning)]"]] as const).map(([label, value, dot]) => (
              <span key={label} className="flex items-center justify-between text-sm text-[var(--body)]"><span className="flex items-center gap-2"><span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />{label}</span><strong className="font-semibold text-[var(--ink)] tabular-nums">{value}</strong></span>
            ))}
            {next && !readOnly && (
              <Button type="button" variant="outline" size="sm" className="mt-1 self-start" disabled={saving === `nudge:${next.id}`} onClick={() => void sendNudge(next.id, null)}>{saving === `nudge:${next.id}` ? "Asking…" : "Ask the team to help"}</Button>
            )}
            <p className="m-0 text-xs text-[var(--muted)]">When a caller waits too long, everyone taking calls is asked.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
