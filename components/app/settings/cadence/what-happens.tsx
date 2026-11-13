"use client";

/**
 * Settings › Dialing cadence · "What happens" (round 8, board A): the example lead's calls as a list,
 * one line each — when, and why then. A call calling windows moved says what it wanted and carries the
 * one chip on its row. The last call says the lead then goes to Nurture (the scheduler's ceiling).
 */

import type { ReactNode } from "react";

import { StatusChip } from "@/components/ui/status-chip";
import { callLabel, dayLabel, waitWords, type SimulatedCall } from "@/lib/cadence/timeline";
import { cn } from "@/lib/utils";

import { dotClass } from "./shared";

export function WhatHappens({
  calls,
  startDate,
  ownCalls,
  openCall,
  onOpenCall,
  footer,
  unplaced,
}: {
  calls: SimulatedCall[];
  startDate: string;
  ownCalls: ReadonlySet<number>;
  openCall: number | null;
  onOpenCall: (n: number) => void;
  footer: ReactNode;
  unplaced: number;
}) {
  return (
    <ol className="m-0 list-none p-0">
      {calls.map((call, index) => {
        const last = index === calls.length - 1 && unplaced === 0;
        const why = call.moved
          ? `Wanted ${dayLabel(startDate, call.wanted?.day ?? call.day)}, ${call.movedBecause === "after your calling hours" ? "after your calling hours" : call.movedBecause === "Sunday" ? "a no-call day" : call.movedBecause}`
          : last && calls.length > 1
            ? "Last call, then the lead goes to Nurture"
            : waitWords(call, calls[index - 1]);
        return (
          <li key={call.n}>
            <button
              type="button"
              onClick={() => onOpenCall(call.n)}
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-border px-3.5 py-2 text-left outline-none transition-colors hover:bg-[var(--hover-wash)] focus-visible:bg-[var(--hover-wash)]",
                openCall === call.n && "bg-[var(--primary-soft)]",
              )}
            >
              <span aria-hidden="true" className={cn(dotClass(call.moved ? "moved" : ownCalls.has(call.n) ? "own" : "call", "sm"), "size-6")}>{call.n}</span>
              <span className="min-w-0">
                <b className="block text-sm font-semibold text-[var(--ink)]">{callLabel(startDate, call.at)}</b>
                <small className="block truncate text-xs text-[var(--muted)]">{why}</small>
              </span>
              {call.moved && <StatusChip tone="warning" className="ml-auto">Moved</StatusChip>}
            </button>
          </li>
        );
      })}
      {unplaced > 0 && (
        <li className="border-b border-border px-3.5 py-2 text-xs text-[var(--warning-ink)]">
          {unplaced} more {unplaced === 1 ? "call finds" : "calls find"} no allowed time within three weeks of being due.
        </li>
      )}
      <li className="bg-[var(--surface-alt)] px-3.5 py-2.5 text-xs leading-[1.5] text-[var(--muted)]">{footer}</li>
    </ol>
  );
}
