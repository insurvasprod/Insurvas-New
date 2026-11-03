"use client";

/**
 * The lead page's door into LA-3: "Open application" when the lead already has one, "Start
 * application" when the agent is holding its work item. Renders nothing for a tenant without the
 * Applications feature (the lookup answers 403) — the rest of the lead page is unchanged.
 *
 * Start is offered only when it can work: start_outbound_application wants the work item held by this
 * agent (claimed, buffer active or LA active). Otherwise one line says what to do instead — claim it
 * (the Claim button sits above), or wait for its callback, which puts a closed work item back in the
 * queue when it comes due (E2E 2026-11-02: a completed item showed Start, then "Claim this lead first",
 * with no Claim anywhere).
 */
const STARTABLE = new Set(["claimed", "buffer_active", "la_active"]);

export type EntryWorkItem = { id: string; status: string; ownerUserId: string | null; disposition: string | null };

function whyNotStart(item: EntryWorkItem | null, currentUserId: string): string | null {
  if (!item) return "This lead has no work item, so an application can't start here.";
  if (STARTABLE.has(item.status) && item.ownerUserId === currentUserId) return null;
  if (item.status === "unclaimed") return "Claim this lead to start an application.";
  if (STARTABLE.has(item.status)) return "Someone else is working this lead; they start its application.";
  if (item.disposition === "callback_scheduled") return "A callback is booked. When it comes due the lead is back in the queue; claim it then to start the application.";
  return "This lead's work is closed, so an application can't start here.";
}

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { withFrom } from "@/lib/applications/backLink";

export function LeadApplicationEntry({ leadId, workItem, currentUserId, canStart, className }: { leadId: string; workItem: EntryWorkItem | null; currentUserId: string; canStart: boolean; className?: string }) {
  const workItemId = workItem?.id ?? null;
  const [state, setState] = useState<{ loaded: boolean; allowed: boolean; caseId: string | null }>({ loaded: false, allowed: false, caseId: null });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/app/applications/for-lead/${encodeURIComponent(leadId)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => null)) as { caseId?: string | null } | null }))
      .then(({ ok, body }) => { if (live) setState({ loaded: true, allowed: ok, caseId: body?.caseId ?? null }); })
      .catch(() => { if (live) setState({ loaded: true, allowed: false, caseId: null }); });
    return () => { live = false; };
  }, [leadId]);

  if (!state.loaded || !state.allowed) return null;
  if (state.caseId) {
    return (
      <Button asChild variant="outline" className={className}>
        <Link href={withFrom(`/app/applications/${state.caseId}`, `/app/leads/${leadId}`)}><FileCheck className="size-4" aria-hidden="true" />Open application</Link>
      </Button>
    );
  }
  if (!canStart) return null;
  const blocked = whyNotStart(workItem, currentUserId);
  if (blocked || !workItemId) return <p className="text-xs text-muted-foreground">{blocked}</p>;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={starting}
        title={starting ? "Starting the application…" : undefined}
        onClick={async () => {
          setStarting(true);
          setError(null);
          try {
            const r = await fetch("/api/app/applications/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
            const body = (await r.json().catch(() => null)) as { href?: string; error?: string } | null;
            if (!r.ok || !body?.href) { setError(body?.error ?? "Could not start the application."); return; }
            window.location.assign(withFrom(body.href, `/app/leads/${leadId}`));
          } catch {
            setError("Could not start the application — check your connection.");
          } finally {
            setStarting(false);
          }
        }}
      >
        {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileCheck className="size-4" aria-hidden="true" />}Start application
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>
  );
}
