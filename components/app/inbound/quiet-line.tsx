"use client";

/**
 * Incoming calls with nobody in line (owner 2026-11-09, board A on "Inbound Quiet Line", round 2).
 *
 * Two parts, deliberately different:
 * - The line: waiting for the next caller (or not taking calls / on a break, with the one button that starts
 *   again), how long you have been in that status, the line and the teammates taking calls (a link to Team).
 * - Callbacks due today: calls YOU place, not callers in line, so they sit in their own card with an outbound
 *   look (the info tint and a calendar mark) and never read as a caller waiting. Each opens its lead.
 *
 * The ready check (chime, pop-ups, live line) was removed in round 2 (owner: "remove these things"). When a
 * caller joins, the page swaps the line card for the caller card (the chime comes from the app's alerts).
 */

import Link from "next/link";
import { ArrowRight, CalendarClock, Coffee, PhoneIncoming, PhoneOff, PhoneOutgoing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

import { secondsSince, shortDuration, type Availability, type Callback } from "./use-floor";

/** Hand-built month names: Intl's "short" month differs between this Node's ICU and browsers. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function QuietLine({ availability, statusSince, now, inLine, teammatesTaking, teamHref, onStart, statusLocked, readOnly, callbacks }: {
  availability: Availability | null;
  /** When your status last changed (the floor's member row); null when unknown. */
  statusSince: string | null;
  now: number;
  inLine: number;
  teammatesTaking: number;
  /** Team › People, or null where there is no Team (solo, or a role without it). */
  teamHref: string | null;
  onStart: () => void;
  statusLocked: boolean;
  readOnly: boolean;
  callbacks: Callback[];
}) {
  const ready = availability === "ready";
  const onBreak = availability === "on_break";

  // "for 12m" within a day; past that the date it started ("since Oct 27"), which says more than "13 days".
  const sinceSeconds = statusSince ? secondsSince(statusSince, now) : null;
  const since = sinceSeconds === null ? null : sinceSeconds < 86_400 ? `for ${shortDuration(sinceSeconds)}` : `since ${MONTHS[new Date(statusSince!).getMonth()]} ${new Date(statusSince!).getDate()}`;
  const title = ready ? "Waiting for the next caller" : onBreak ? "You're on a break" : "You're not taking calls";
  const statusFacts = [
    ready ? (since ? `Taking calls ${since}` : "Taking calls") : onBreak ? (since ? `On break ${since}` : null) : "Callers are offered to you only while you take calls",
    `${inLine} in line`,
  ].filter(Boolean).join(" · ");
  const Icon = ready ? PhoneIncoming : onBreak ? Coffee : PhoneOff;
  const team = `${teammatesTaking} ${teammatesTaking === 1 ? "teammate" : "teammates"} taking calls`;

  const due = callbacks.filter((item) => item.isOverdue || item.isDueToday).sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || (a.scheduledAtUtc ?? "").localeCompare(b.scheduledAtUtc ?? ""));
  const overdue = due.filter((item) => item.isOverdue).length;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      <section aria-label="Nobody in line" className="m-glass flex shrink-0 flex-wrap items-center gap-4 rounded-xl border border-border px-5 py-5">
        <span aria-hidden="true" className={cn("relative grid size-12 shrink-0 place-items-center rounded-full", ready ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : onBreak ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
          <Icon className="size-5" />
          {/* A slow ring while you are reachable: small and calm, still under reduced motion. */}
          {ready && <span className="absolute -inset-1.5 rounded-full border-[1.5px] border-[var(--primary)] opacity-0 motion-safe:animate-[m-ring_2.4s_ease-out_infinite]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
          <p className="m-0 mt-0.5 text-sm text-[var(--body)]">
            {statusFacts}
            {teamHref ? <> · <Link href={teamHref} className="font-semibold text-[var(--accent-ink)] hover:underline">{team}</Link></> : null}
          </p>
        </div>
        {!ready && !readOnly && <Button type="button" onClick={onStart} disabled={statusLocked}>{onBreak ? "Back to taking calls" : "Start taking calls"}</Button>}
      </section>

      {/* Outbound work: its own card, info-tinted head, so it never reads as a caller in line. */}
      <section aria-labelledby="callbacks-due-heading" className="m-glass flex min-w-0 flex-col overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--info)_35%,var(--border))] lg:min-h-0 lg:flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--info)_30%,var(--border))] bg-[var(--info-surface)] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-[var(--info-ink)]"><CalendarClock className="size-[18px]" /></span>
            <div className="min-w-0">
              <h3 id="callbacks-due-heading" className="m-0 flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                Callbacks due today
                {due.length > 0 && <StatusChip tone="info" dot={false}>{due.length}</StatusChip>}
                {overdue > 0 && <StatusChip tone="danger" dot={false}>{overdue} overdue</StatusChip>}
              </h3>
              <p className="m-0 flex items-center gap-1.5 text-xs text-[var(--body)]"><PhoneOutgoing className="size-3.5 text-[var(--info-ink)]" aria-hidden="true" />You call them back. They are not in the line.</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/app/callbacks">Open callbacks<ArrowRight aria-hidden="true" /></Link></Button>
        </div>
        {due.length === 0 ? (
          <p className="m-0 px-5 py-4 text-sm text-[var(--body)]">Nothing due today.</p>
        ) : (
          <ul className="m-0 list-none p-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {due.map((item) => (
              <li key={item.id} className="border-t border-[var(--border)] first:border-t-0">
                <Link href={`/app/leads/${item.leadId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)] focus-visible:outline-none">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-[var(--ink)]">{item.customerName}</strong>
                    <span className="block truncate text-xs text-[var(--body)]">{[item.customerTime && `${item.customerTime} their time`, item.productName && item.productName !== "Lead" ? item.productName : null, item.note].filter(Boolean).join(" · ")}</span>
                  </span>
                  <StatusChip tone={item.isOverdue ? "danger" : "warning"} dot={false}>{item.isOverdue ? "Overdue" : "Due today"}</StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
