"use client";

/**
 * Small pieces the Verify, Quote and Application steps share (boards l3-ws-verify, -quote,
 * -application): the "Pre-filled from …" marking on a carried-in value, the read-only value box, and
 * the autosave chip in a step's header strip.
 */

import type { ReactNode } from "react";

import { StatusChip } from "@/components/ui/status-chip";
import type { ValueSource } from "@/lib/applications/constants";
import type { FieldValue } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { useWorkspace } from "@/components/app/applications/workspace/context";

/** How a carried-in value says where it came from. A typed value says nothing. */
export const PREFILL_FROM: Record<ValueSource, string> = {
  lead: "Pre-filled from the lead",
  interview: "Pre-filled from the interview",
  quote: "Pre-filled from the selected quote",
  carried_forward: "Carried over from the last attempt",
  household: "Shared with the spouse's application",
  manual: "",
};

export const hasContent = (f: FieldValue | undefined) => Boolean(f && (f.hasValue || (f.value !== null && f.value !== "")));

/** A value that was filled in for the agent and not typed over. */
export const isPrefilled = (f: FieldValue | undefined): f is FieldValue => Boolean(f && f.source !== "manual" && hasContent(f));

/** The warm background the boards give a carried-in value until it is typed over. */
export const PREFILL_SURFACE = "border-[var(--border)] bg-[var(--brand-50)]";

/**
 * The one-line hint under a carried-in value: where it came from, and — while nobody has confirmed it —
 * a "Looks right" that marks it checked without changing it.
 */
export function PrefillHint({ fv, fieldKey, readOnly, extra, confirmable = true }: {
  fv: FieldValue | undefined;
  fieldKey: string | string[];
  readOnly?: boolean;
  extra?: ReactNode;
  /** False for a value read straight from an interview answer: there is no stored field to mark checked. */
  confirmable?: boolean;
}) {
  const { markReviewed } = useWorkspace();
  if (!isPrefilled(fv)) return extra ? <span className="mt-1.5 block text-[12px] leading-[1.5] text-[var(--muted)]">{extra}</span> : null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[1.5] text-[var(--accent-ink)]">
      {PREFILL_FROM[fv.source]}
      {!confirmable ? null : fv.reviewed ? (
        <span className="text-[var(--muted)]">· checked</span>
      ) : !readOnly && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => { for (const k of Array.isArray(fieldKey) ? fieldKey : [fieldKey]) markReviewed(k); }}
            className="font-semibold underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
          >
            Looks right
          </button>
        </>
      )}
      {extra && <span className="text-[var(--muted)]">· {extra}</span>}
    </span>
  );
}

/** A value shown, not edited here (coverage from the quote, identity on Verify). `id` is the QA deep-link target. */
export function ValueBox({ id, children, prefilled, className }: { id?: string; children: ReactNode; prefilled?: boolean; className?: string }) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className={cn(
        "mt-1.5 flex h-9 min-w-0 items-center rounded-[8px] border px-3 text-[14px] leading-[1.5] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
        prefilled ? PREFILL_SURFACE : "border-[var(--border)] bg-[var(--surface-alt)]",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** "Autosaved" in a step's header strip; "Saving…" while in flight, and the error when the last save failed. */
export function AutosaveChip() {
  const { saving, saveError, sample, readOnly } = useWorkspace();
  if (readOnly) return <StatusChip tone="neutral">Read only</StatusChip>;
  if (sample) return <StatusChip tone="neutral">Sample — not saved</StatusChip>;
  if (saving) return <StatusChip tone="neutral">Saving…</StatusChip>;
  if (saveError) return <StatusChip tone="danger" title={saveError}>Not saved — still on screen</StatusChip>;
  return <StatusChip tone="action" dot={false}>Autosaved</StatusChip>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "1953-03-14" → "14 Mar 1953", read as a calendar date (no timezone shift). Month names are built
 * by hand: the server's ICU prints "Sept" where browsers print "Sep", which breaks hydration.
 */
export function calendarDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "••••4417" → "•••-••-4417", the way an SSN is read out. */
export function ssnMask(masked: string | undefined) {
  const last4 = (masked ?? "").replace(/\D/g, "").slice(-4);
  return last4 ? `•••-••-${last4}` : "•••-••-••••";
}
