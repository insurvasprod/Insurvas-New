"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, GitMerge, Phone, TriangleAlert, UserPlus, Users } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card, cardInset } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { LEAD_DUPLICATE_FIELDS, leadDisplayName, leadFieldValue, type LeadDuplicateDecision, type LeadDuplicateQueue } from "@/lib/leadDuplicates/types";

/**
 * Clean · same-phone leads (owner 2026-10-29: "any lead whose phone matches another must land in
 * the Review / Clean queue as a duplicate"). The same "Is X the same person?" card as the contact
 * pairs, one at a time, oldest first:
 *   re-imported row  Yes keeps one lead (the row stays attached) · No adds the row as a new lead
 *   two leads        Yes records them as one person · No keeps both
 * Drawn above the contact pairs while any are waiting; `onTotal` adds them to the tab's count.
 */

const GRID = "grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2";

function formatPhone(digits: string) {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

const EMPTY: LeadDuplicateQueue = { ready: false, total: 0, index: 0, item: null };

export function LeadDuplicateReview({ readOnly, onTotal }: { readOnly: boolean; onTotal: (total: number) => void }) {
  const [queue, setQueue] = useState<LeadDuplicateQueue>(EMPTY);
  const [busy, setBusy] = useState<LeadDuplicateDecision | "queue" | null>(null);

  const load = useCallback(async (index = 0) => {
    const response = await fetch(`/api/app/contacts/lead-reviews?index=${index}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as LeadDuplicateQueue | null;
    // A read that fails, or a database without the queue, leaves the contact pairs as they were.
    const next = response.ok && body ? body : EMPTY;
    setQueue(next);
    onTotal(next.total);
  }, [onTotal]);

  useEffect(() => { void load(0); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  const item = queue.item;
  if (!queue.ready || !item) return null;

  async function goTo(index: number) {
    setBusy("queue");
    try { await load(index); } finally { setBusy(null); }
  }

  async function answer(decision: LeadDuplicateDecision) {
    if (!item) return;
    setBusy(decision);
    try {
      const response = await fetch("/api/app/contacts/lead-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_id: item.id, decision }),
      });
      const body = await response.json().catch(() => null) as { error?: string; createdLeadId?: string | null } | null;
      if (!response.ok) {
        notify.block("Could not save this answer", { detail: body?.error ?? "Try again." });
        if (response.status === 409) await load(queue.index);
        return;
      }
      notify.done(decision === "same_person"
        ? item.kind === "reimport" ? "Kept as one lead" : "Marked as the same person"
        : item.kind === "reimport" ? "Added as a new lead" : "Kept as two leads");
      await load(queue.index);
    } finally {
      setBusy(null);
    }
  }

  const name = leadDisplayName(item.existing.values);
  const rows = LEAD_DUPLICATE_FIELDS
    .map((field) => ({ ...field, incoming: leadFieldValue(item.incoming.values, field.keys), existing: leadFieldValue(item.existing.values, field.keys) }))
    .filter((row) => row.incoming || row.existing);
  const differs = rows.filter((row) => row.incoming && row.existing && row.incoming.toLowerCase() !== row.existing.toLowerCase());
  const reimport = item.kind === "reimport";
  const disabled = readOnly || busy !== null;
  const leadLink = (leadId: string | null) => leadId ? <Link href={`/app/leads/${leadId}`} className="text-xs leading-[1.5] font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Open lead</Link> : null;

  return (
    <Card aria-labelledby="same-phone" className="min-w-0 gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="same-phone" className="m-0 min-w-0 text-card-title text-[var(--ink)]">Is {name} the same person?</h2>
        {queue.total > 1 && (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="icon-sm" aria-label="Previous same-phone lead" disabled={queue.index === 0 || busy === "queue"} onClick={() => void goTo(queue.index - 1)}><ChevronIcon direction="left" /></Button>
            <span className="text-xs leading-[1.5] text-[var(--body)] tabular-nums">{queue.index + 1} of {queue.total} same phone</span>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Next same-phone lead" disabled={queue.index >= queue.total - 1 || busy === "queue"} onClick={() => void goTo(queue.index + 1)}><ChevronIcon direction="right" /></Button>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="How these two compare">
        <StatusChip tone="good" dot={false}><Phone aria-hidden className="size-3.5" />Same phone · {formatPhone(item.phone)}</StatusChip>
        {differs.map((row) => <StatusChip key={row.key} tone="warning" dot={false}><TriangleAlert aria-hidden className="size-3.5" />{row.label} differs</StatusChip>)}
        {!differs.length && <StatusChip tone="good" dot={false}><Check aria-hidden className="size-3.5" />Nothing else differs</StatusChip>}
        {reimport && item.incoming.campaign && <StatusChip tone="info" dot={false}>Came in again from {item.incoming.campaign}</StatusChip>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className={cn(GRID, "px-3 text-xs leading-[1.5] font-semibold text-[var(--body)]")}>
          <span aria-hidden />
          <span className="flex items-center gap-2">{reimport ? "Came in again" : "Newer lead"}{leadLink(item.incoming.leadId)}</span>
          <span className="flex items-center gap-2">Already yours{item.existing.campaign ? ` · ${item.existing.campaign}` : ""}{leadLink(item.existing.leadId)}</span>
        </div>
        {rows.map((row) => {
          const different = differs.includes(row);
          return (
            <div key={row.key} className={cn(cardInset, GRID, "px-3 py-2")}>
              <span className="min-w-0 pt-1 text-xs leading-[1.5] text-[var(--body)]">{row.label}</span>
              {[row.incoming, row.existing].map((value, at) => (
                <span key={at} className={cn("min-w-0 px-2 py-1 text-sm leading-[1.5] tracking-[-0.02em] break-words text-[var(--ink)]", different && "font-semibold")}>{value ?? "—"}</span>
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => void answer("separate")}>
          {reimport ? <UserPlus aria-hidden="true" /> : <Users aria-hidden="true" />}
          {busy === "separate" ? "Saving…" : reimport ? "No — add as a new lead" : "No — keep both"}
        </Button>
        <Button type="button" disabled={disabled} onClick={() => void answer("same_person")}>
          <GitMerge aria-hidden="true" />{busy === "same_person" ? "Saving…" : reimport ? "Yes — keep one lead" : "Yes — same person"}
        </Button>
      </div>
    </Card>
  );
}
