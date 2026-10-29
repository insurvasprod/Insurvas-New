"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Pause, Play, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Meter } from "@/components/ui/stat";
import { minutesSince, scrubRunIsStale, scrubStoppedByOutage, type ScrubRun } from "@/lib/campaigns/constants";
import { notify } from "@/lib/notify";

/**
 * "Run the scrub" inside the Lists panel (owner 2026-10-29: the list's actions happen where the list
 * is). The same run the Source step drives (campaign-workspace.tsx · runScrub): the same API
 * (POST /api/app/campaigns/[id]/scrub, owner only, billed), the same confirm, the same per-tab token
 * (`campaign-scrub-token:<id>` in sessionStorage) so either screen can carry on a run the other
 * started, and the same reading of GET /api/app/campaigns for the run and who may start one.
 * Producers see the progress; only an owner runs a scrub.
 */

const OWNER_ONLY = "Ask an owner to run the scrub — it bills screening lookups.";

function tokenKey(campaignId: string) {
  return `campaign-scrub-token:${campaignId}`;
}
function scrubToken(campaignId: string, fresh = false) {
  try {
    const stored = fresh ? null : window.sessionStorage.getItem(tokenKey(campaignId));
    if (stored) return stored;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(tokenKey(campaignId), created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
function heldScrubToken(campaignId: string) {
  try { return window.sessionStorage.getItem(tokenKey(campaignId)); } catch { return null; }
}
function dropScrubToken(campaignId: string) {
  try { window.sessionStorage.removeItem(tokenKey(campaignId)); } catch { /* per-tab convenience only */ }
}

type Loaded = { run: ScrubRun | null; canScrub: boolean; leads: number | null; scrubStatus: string | null };

export function LeadListScrub({ campaignId, campaignName, autoStart = false, onDone }: {
  campaignId: string;
  campaignName: string;
  /** Start (after the confirm) as soon as the run is read: the Lists row's "Run the scrub" / "Resume". */
  autoStart?: boolean;
  /** After the run stops (finished, paused or failed): the panel and the index reload. */
  onDone: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/app/campaigns", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not read this list's scrub");
      const campaign = ((body?.campaigns ?? []) as Array<{ campaign_id: string; scrub_status: string | null }>).find((row) => row.campaign_id === campaignId);
      setLoaded({
        run: (body?.scrubRuns?.[campaignId] as ScrubRun | undefined) ?? null,
        // scrubRuns is null until its migration is applied; the Source step offers no scrub then either.
        canScrub: Boolean(body?.canScrub) && body?.scrubRuns != null,
        leads: typeof body?.progress?.[campaignId]?.leads_received === "number" ? body.progress[campaignId].leads_received : null,
        scrubStatus: campaign?.scrub_status ?? null,
      });
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not read this list's scrub");
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  const run = loaded?.run ?? null;
  const open = Boolean(run && run.status !== "scrubbed");
  const elsewhere = run?.status === "running" && !driving && !scrubRunIsStale(run) && !heldScrubToken(campaignId);
  const cannot = !loaded ? "Reading the scrub." : !loaded.canScrub ? OWNER_ONLY : loaded.leads === 0 ? "Import a list into this campaign first." : elsewhere ? "Another window is running this scrub." : null;

  const runScrub = useCallback(async () => {
    if (driving || !loaded) return;
    const current0 = loaded.run;
    const resuming = current0 && current0.status !== "scrubbed";
    if (!resuming) {
      const ok = await confirmAction({
        // A list never scrubbed is screened for the first time, not "re-screened".
        title: loaded.scrubStatus === "scrubbed" ? `Re-screen ${campaignName}?` : `Scrub ${campaignName}?`,
        confirmLabel: "Re-screen leads",
        destructive: false,
        description: `Re-screen ${loaded.leads == null ? "every lead" : `all ${loaded.leads.toLocaleString()} leads`} in ${campaignName}? Each number is checked against the litigator and do-not-call lists, and the lookups count against your plan's screening allowance. The campaign serves no leads until the scrub finishes. Numbers that fail are suppressed and recorded against the campaign.`,
      });
      if (!ok) return;
    }
    stopRequested.current = false;
    setError(null);
    setDriving(true);
    const post = async (payload: Record<string, unknown>) => {
      const response = await fetch(`/api/app/campaigns/${campaignId}/scrub`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (body?.run) setLoaded((was) => (was ? { ...was, run: body.run as ScrubRun } : was));
      if (!response.ok) throw new Error(body?.error ?? "The scrub could not continue");
      return body.run as ScrubRun;
    };
    try {
      // A stale run held by another window is taken over with this window's own token.
      const token = scrubToken(campaignId, Boolean(current0 && scrubRunIsStale(current0) && !heldScrubToken(campaignId)));
      let current = await post({ action: "start", token });
      while (current.status === "running" && !stopRequested.current) current = await post({ action: "step", token, runId: current.id });
      if (current.status === "scrubbed") {
        dropScrubToken(campaignId);
        notify.done(`${campaignName} is scrubbed — ${current.processed_leads.toLocaleString()} leads screened, ${current.rejected_leads.toLocaleString()} failed.`);
      } else if (current.status === "failed") {
        setError(current.error ?? "The scrub could not be completed.");
      } else {
        notify.done(`Scrub paused at ${current.processed_leads.toLocaleString()} of ${current.total_leads.toLocaleString()} leads. ${campaignName} serves no leads until it finishes.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scrub could not continue");
    } finally {
      setDriving(false);
      await load();
      onDone();
    }
  }, [campaignId, campaignName, driving, load, loaded, onDone]);

  // The row's "Run the scrub" / "Resume" opened this panel: start once the run has been read.
  useEffect(() => {
    if (!autoStart || started.current || !loaded || cannot) return;
    started.current = true;
    void runScrub();
  }, [autoStart, loaded, cannot, runScrub]);

  // Leaving the panel mid-run stops after the batch in flight; the run resumes from where it stopped.
  useEffect(() => () => { stopRequested.current = true; }, []);

  if (loadError) {
    // A read that failed (the service down, a timeout) says so with the way to try again.
    return (
      <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-[var(--error-ink)]" role="alert">
        {loadError}
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
      </p>
    );
  }

  const counts = run ? `${run.processed_leads.toLocaleString()} of ${run.total_leads.toLocaleString()} screened · ${run.rejected_leads.toLocaleString()} failed` : null;
  const quiet = run ? minutesSince(run.last_progress_at) : null;
  const outage = scrubStoppedByOutage(run);
  let status: string | null = null;
  if (driving && run) status = `${counts}. Keep this panel open; the list serves no leads until the scrub finishes.`;
  else if (run?.status === "running" && scrubRunIsStale(run)) status = `Stopped ${quiet} min ago at ${counts}. Resume from where it stopped.`;
  else if (run?.status === "running") status = `${counts} · last progress ${quiet === 0 ? "under a minute" : `${quiet} min`} ago.`;
  else if (outage) status = `${counts}. The Do Not Call check did not answer; nothing unchecked is let through. Resume once the service is back.`;
  else if (run?.status === "failed") status = `Failed at ${counts}: ${run.error ?? "it could not be completed"}`;
  const pct = run && run.total_leads > 0 ? Math.round((100 * run.processed_leads) / run.total_leads) : null;
  const label = open ? "Resume the scrub" : loaded?.scrubStatus === "scrubbed" ? "Scrub again" : "Run the scrub";

  return (
    <div className="flex w-full flex-col gap-2 text-sm leading-normal text-[var(--body)]">
      <div className="flex flex-wrap items-center gap-2">
        {driving
          ? <Button type="button" variant="outline" size="sm" onClick={() => { stopRequested.current = true; }}><Pause aria-hidden="true" />Pause the scrub</Button>
          : loaded?.canScrub && <Button type="button" variant="outline" size="sm" disabled={Boolean(cannot)} title={cannot ?? undefined} onClick={() => void runScrub()}>{open ? <Play aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{label}</Button>}
        {status && <span className="min-w-0 flex-1" role={driving ? "status" : undefined}>{status}</span>}
      </div>
      {open && pct !== null && <Meter value={pct} tone={outage || run?.status === "failed" ? "danger" : "info"} label={`Scrub ${pct}% done`} />}
      {error && <p className="m-0 flex items-center gap-1.5 text-[var(--error-ink)]" role="alert"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {loaded && !loaded.canScrub && <span className="text-xs text-[var(--muted)]">{OWNER_ONLY}</span>}
    </div>
  );
}
