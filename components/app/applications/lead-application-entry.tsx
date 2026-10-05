"use client";

/**
 * The lead page's door into LA-3: "Open application" when the lead already has one, "Start
 * application" when the agent is holding its work item. Renders nothing for a tenant without the
 * Applications feature (the lookup answers 403) — the rest of the lead page is unchanged.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LeadApplicationEntry({ leadId, workItemId, canStart, className }: { leadId: string; workItemId: string | null; canStart: boolean; className?: string }) {
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
        <Link href={`/app/applications/${state.caseId}`}><FileCheck className="size-4" aria-hidden="true" />Open application</Link>
      </Button>
    );
  }
  if (!canStart || !workItemId) return null;
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
            window.location.assign(body.href);
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
