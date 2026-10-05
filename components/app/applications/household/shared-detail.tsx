"use client";

/**
 * LA-3.24 · on the spouse's application, a detail shared with the primary insured says so and can be
 * detached. Until it is, it follows the primary's value and cannot be typed over here — the next
 * sync would undo the edit. Detaching makes it the spouse's own, from the value it has now.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";

import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { useWorkspace } from "@/components/app/applications/workspace/context";

/** The primary insured's first name, for "Follows Dorothy". */
export function usePrimaryFirstName() {
  const { caseView } = useWorkspace();
  const primary = caseView.attempts.filter((a) => a.insuredRole === "primary").sort((a, b) => b.attemptNo - a.attemptNo)[0];
  const first = primary?.values["insured.first_name"]?.value;
  return typeof first === "string" && first.trim() ? first.trim() : caseView.clientName.split(/\s+/)[0] || "the primary insured";
}

/**
 * The chip and the Detach button. `keys` are the detach route's keys: household value keys
 * (addr.* / contact.*), "payment" or "draft_day". `what` names them in the toast.
 */
export function SharedWithPrimary({ keys, what }: { keys: string[]; what: string }) {
  const { attempt, readOnly, sample, actions } = useWorkspace();
  const name = usePrimaryFirstName();
  const [busy, setBusy] = useState(false);
  if (!keys.length) return null;

  async function detach() {
    if (busy) return;
    if (sample) { notify.done("Sample data — nothing was detached."); return; }
    setBusy(true);
    try {
      for (const key of keys) {
        const r = await request<{ detached: boolean }>(attemptUrl(attempt.id, "/values/detach"), { method: "POST", body: { field_key: key } });
        if (!r.ok) { notify.block(r.error); return; }
      }
      await actions.refresh();
      notify.done(`The ${what} is the spouse's own now`, { detail: `Changes on ${name}'s application no longer reach it.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusChip tone="info" title={`Changes on ${name}'s application reach this one until it is detached.`}>Follows {name}</StatusChip>
      {!readOnly && (
        <Button type="button" variant="outline" onClick={() => { void detach(); }} disabled={busy} title={busy ? "Detaching…" : `Give the spouse their own ${what}`}>
          {busy ? "Detaching…" : "Detach"}
        </Button>
      )}
    </span>
  );
}
