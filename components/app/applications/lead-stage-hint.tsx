"use client";

/**
 * The leads board's reconcile hint (LA-3.23). When a person moved a lead's card after its
 * application last moved it, the sync leaves the card alone; this says so — "Application is at
 * Submitted, board says Quoted" — with one click to put the card where the application is. It moves
 * the card only; nothing here, or on the board, changes an application.
 *
 * Renders nothing when the lead has no application, the two agree, or the tenant has no
 * Applications feature (the route answers 403).
 */

import { useEffect, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";

type HintState = { needsReconcile: boolean; applicationLabel: string | null; boardStageName: string | null; targetStageId: string | null; boardStageId: string | null } | null;

export function LeadStageHint({ leadId, boardStageId, readOnly = false, onReconciled }: { leadId: string; boardStageId: string | null; readOnly?: boolean; onReconciled?: () => void }) {
  const [state, setState] = useState<HintState>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/app/leads/${encodeURIComponent(leadId)}/reconcile-stage`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json().catch(() => null)) as { state?: HintState } | null) : null))
      .then((body) => { if (live) setState(body?.state ?? null); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [leadId, boardStageId]);

  if (!state?.needsReconcile || state.boardStageId !== boardStageId) return null;

  async function reconcile() {
    setBusy(true);
    try {
      const r = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}/reconcile-stage`, { method: "POST" });
      const body = (await r.json().catch(() => null)) as { moved?: boolean; toStageName?: string | null; error?: string } | null;
      if (!r.ok) { notify.block(body?.error ?? "Could not move the card. Try again."); return; }
      notify.done(body?.moved ? `Moved to ${body.toStageName ?? "the application's stage"}.` : "The card is already where the application says.");
      setState(null);
      onReconciled?.();
    } catch {
      notify.fail("Could not move the card — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2 text-sm text-[var(--warning-ink)]">
      <span className="min-w-0 flex-1">Application is at {state.applicationLabel ?? "another stage"}, board says {state.boardStageName ?? "Unmapped"}</span>
      <Button type="button" variant="outline" size="sm" onClick={() => void reconcile()} disabled={readOnly || busy} title={readOnly ? "Read-only — your plan does not allow changes" : "Move the card to the application's stage"}>Reconcile</Button>
    </div>
  );
}
