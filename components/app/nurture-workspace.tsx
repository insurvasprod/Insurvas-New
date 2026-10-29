"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import type { NurtureCampaignReport, NurtureReport } from "@/lib/nurture/report";
import type { RecycleBatch } from "@/lib/nurture/contract";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { StatusChip } from "@/components/ui/status-chip";
import { LeadsInSlot, useInLeadsFrame } from "@/components/app/lead-sources/leads-in-slot";
import { canContinue, count, draftOf, draftProblem, sameRule, startBlockedFor, type RuleDraft } from "@/components/app/nurture/format";
import { CampaignSwitch, RecycleFlow, RecyclePerformance, RulePanel, type Progress } from "@/components/app/nurture/recycle-cards";
import { BatchSheet, BatchTable, FreshVsRecycled, RecycleCadence } from "@/components/app/nurture/recycle-history";

/**
 * Lead sources › 7 Recycle (redesign 2026-10-29, LA-2.20). One campaign at a time, switched in the
 * frame's top row (each campaign with its ready count; Cadence and Refresh beside it). Then the job as
 * a short flow — who is ready, the new angle, bring them back — with the campaign's rule beside it,
 * recycled against fresh (only the figures that exist) and the past batches under it. A batch opens
 * in a sheet; the cadence and the fresh-vs-recycled table open in dialogs.
 *
 * Kept from the LA-2 §4 concept (20260925706500): a batch needs an angle and sets its own
 * attempts-this-pass, screening is driven a chunk at a time from this page (progress lives in the
 * database, so a closed tab loses nothing and an owner can resume a stalled run).
 *
 * Everything shown is read from lib/nurture/report.ts. The writes are: save a rule, start a batch,
 * screen the next chunk. Starting asks to be confirmed, because a cleared lead goes back to the dialer.
 */

type Payload = NurtureReport & { readOnly?: boolean };

const READ_ONLY = "Your plan gives read-only access to lead recycling.";

/** The campaigns with recycling work first, then the idle ones. */
function ordered(campaigns: NurtureCampaignReport[]) {
  const working = campaigns.filter((campaign) => campaign.eligible_count > 0 || campaign.reactivated_count > 0 || campaign.lastRun || campaign.openBatch || (campaign.pool?.saidNo ?? 0) > 0);
  return [...working, ...campaigns.filter((campaign) => !working.includes(campaign))];
}

export function NurtureWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  /** Screening that stopped on this page with an error (the service down): shown with Resume. */
  const [stopped, setStopped] = useState<{ campaignId: string; message: string } | null>(null);
  /** The Rule panel's edits, for one campaign. */
  const [edit, setEdit] = useState<{ campaignId: string; draft: RuleDraft } | null>(null);
  const [dialog, setDialog] = useState<"cadence" | "compare" | null>(null);
  const [openBatch, setOpenBatch] = useState<RecycleBatch | null>(null);
  const ruleScope = useRef<HTMLDivElement>(null);
  const inFrame = useInLeadsFrame();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/app/nurture", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
      // Keep the campaign picked, else open on a batch part-way screened that this viewer may continue,
      // then the campaign with the most leads ready.
      setSelected((current) => {
        const { campaigns, viewer, batchesReady } = body as Payload;
        if (current && campaigns.some((campaign) => campaign.campaign_id === current)) return current;
        if (!body.readOnly) {
          const resumable = campaigns.find((campaign) => campaign.openBatch && canContinue(campaign.openBatch, viewer).ok);
          if (resumable) return resumable.campaign_id;
        }
        const ready = campaigns.filter((campaign) => !startBlockedFor(campaign, batchesReady)).sort((a, b) => b.eligibleNow - a.eligibleNow)[0]
          ?? [...campaigns].sort((a, b) => b.eligibleNow - a.eligibleNow)[0];
        return ready && ready.eligibleNow > 0 ? ready.campaign_id : ordered(campaigns)[0]?.campaign_id ?? null;
      });
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not load nurture");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/app/nurture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "The request failed");
    return body;
  }

  const campaigns = data?.campaigns ?? [];
  const list = ordered(campaigns);
  const opened = campaigns.find((campaign) => campaign.campaign_id === selected) ?? list[0] ?? null;
  const draft = opened ? (edit?.campaignId === opened.campaign_id ? edit.draft : draftOf(opened.rule)) : null;
  const dirty = Boolean(opened && draft && !sameRule(draft, opened.rule));
  const problem = draft ? draftProblem(draft) : "";

  async function save(): Promise<boolean> {
    if (!opened || !draft || problem) return false;
    setSaving(opened.campaign_id);
    try {
      await post({ action: "save_rule", campaign_id: opened.campaign_id, wait_days: Number(draft.wait), allowed_dispositions: draft.outcomes, max_recycles: Number(draft.max) });
      notify.done("Recycle rule saved");
      setEdit(null);
      await load();
      return true;
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not save rule");
      return false;
    } finally {
      setSaving(null);
    }
  }

  /** Screens a batch a chunk at a time until nothing is pending. Stopping midway loses nothing. */
  async function screen(batchId: string, campaignId: string) {
    const totals: Progress = { batchId, campaignId, screened: 0, cleared: 0, blocked: 0, failed: 0, pending: 0 };
    setStopped(null);
    setProgress({ ...totals });
    try {
      for (;;) {
        const step = await post({ action: "screen_chunk", batch_id: batchId }) as { done: boolean; screened: number; cleared: number; blocked: number; failed: number; pending: number; busyElsewhere: boolean };
        totals.screened += step.screened; totals.cleared += step.cleared; totals.blocked += step.blocked; totals.failed += step.failed; totals.pending = step.pending;
        setProgress({ ...totals });
        if (step.done) { notify.done(`${count(totals.cleared)} cleared and back in the dialer, ${count(totals.blocked)} blocked, ${count(totals.failed)} held`); break; }
        if (step.busyElsewhere) { notify.fail("The rest of this batch is being screened in another session. It will finish there."); break; }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Screening stopped.";
      setStopped({ campaignId, message: /[.!?]$/.test(message) ? message : `${message}.` });
      notify.fail(`${message} — the batch keeps its progress; resume it here.`);
    } finally {
      setProgress(null);
      await load();
    }
  }

  async function start(campaign: NurtureCampaignReport, input: { angle: string; script: string; attemptCeiling: number }) {
    setSaving(campaign.campaign_id);
    let batchId: string | null = null;
    try {
      const body = await post({ action: "start_batch", campaign_id: campaign.campaign_id, angle: input.angle, script: input.script.trim() || null, attempt_ceiling: input.attemptCeiling });
      batchId = String(body.batchId);
      notify.done(`${count(Number(body.queued ?? 0))} leads queued for screening`);
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not start the batch");
    } finally {
      setSaving(null);
    }
    if (batchId) await screen(batchId, campaign.campaign_id);
  }

  /** Switches campaign; unsaved rule edits are confirmed away first. */
  async function choose(id: string) {
    if (id === opened?.campaign_id) return;
    if (dirty && !(await confirmAction({ title: "Discard the rule changes?", description: `The rule for ${opened?.campaign_name ?? "this campaign"} has changes that are not saved.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    setEdit(null);
    setSelected(id);
  }

  /** Puts the cursor on a rule control: the fixes under the ready count lead here. */
  function focusRule(id: "rule-wait" | "rule-max") {
    requestAnimationFrame(() => {
      const input = document.getElementById(id);
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      input?.focus();
    });
  }

  const refresh = <RefreshButton onClick={() => void load()} refreshing={loading} />;
  const place = (row: ReactNode) => (inFrame ? <LeadsInSlot slot="lead">{row}</LeadsInSlot> : <div className="flex flex-wrap items-center gap-3">{row}</div>);

  if (!data) {
    if (loading) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        {place(<div className="ml-auto">{refresh}</div>)}
        <Card>
          <ErrorState detail="Nurture campaigns could not be loaded." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        </Card>
      </div>
    );
  }

  const { viewer, batchesReady } = data;
  const readOnly = Boolean(data.readOnly);
  const busy = opened ? saving === opened.campaign_id || progress?.campaignId === opened.campaign_id : false;
  const screeningNow = Boolean(opened && progress?.campaignId === opened.campaign_id);
  const lockedReason = readOnly ? READ_ONLY : screeningNow ? "The rule is locked while its batch is screened." : null;
  const canCompare = data.sources.length > 0 || Boolean(data.conversion);

  const topRow = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {opened && <CampaignSwitch campaigns={list} value={opened.campaign_id} onPick={(id) => void choose(id)} />}
      {readOnly && <StatusChip tone="neutral" title={READ_ONLY}>Read only</StatusChip>}
      <span className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setDialog("cadence")}><Clock aria-hidden="true" />Cadence</Button>
        {refresh}
      </span>
    </div>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {place(topRow)}

      {opened && draft ? (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
            <RecycleFlow
              key={opened.campaign_id}
              campaign={opened}
              readOnly={readOnly}
              readOnlyReason={READ_ONLY}
              busy={busy}
              batchesReady={batchesReady}
              viewer={viewer}
              progress={progress}
              stopped={stopped?.campaignId === opened.campaign_id ? stopped.message : null}
              onStart={(input) => void start(opened, input)}
              onResume={(batch) => void screen(batch.id, opened.campaign_id)}
              onRaiseCap={() => { setEdit({ campaignId: opened.campaign_id, draft: { ...draft, max: draft.max === "0" ? "1" : draft.max } }); focusRule("rule-max"); }}
              onEditRule={() => focusRule("rule-wait")}
            />
            <div ref={ruleScope} className="min-w-0">
              <RulePanel
                campaign={opened}
                draft={draft}
                onDraft={(next) => setEdit({ campaignId: opened.campaign_id, draft: next })}
                dirty={dirty}
                problem={problem}
                saving={saving === opened.campaign_id && !screeningNow}
                lockedReason={lockedReason}
                screeningNow={screeningNow}
                onSave={() => void save()}
                onDiscard={() => setEdit(null)}
              />
            </div>
          </div>
          <RecyclePerformance data={data} onCompare={() => setDialog("compare")} />
          <BatchTable key={opened.campaign_id} batches={data.batches} baseline={data.batchBaseline} campaignId={opened.campaign_id} onOpen={setOpenBatch} onCompare={canCompare ? () => setDialog("compare") : undefined} />
        </>
      ) : (
        <Card>
          <EmptyState
            title="No campaigns yet"
            hint="Recycling works campaign by campaign. Add one in Source first."
            action={<Button asChild type="button" variant="outline"><Link href="/app/campaigns">Go to Source</Link></Button>}
          />
        </Card>
      )}

      <LeaveGuard dirty={dirty} scope={ruleScope} onSave={save} onDiscard={() => setEdit(null)} what="the recycle rule" />

      {openBatch && <BatchSheet batch={openBatch} baseline={data.batchBaseline} onClose={() => setOpenBatch(null)} />}

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto overflow-x-hidden" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{dialog === "cadence" ? "Cadence and time slots" : "Recycled against fresh"}</DialogTitle>
          </DialogHeader>
          {dialog === "cadence" && <RecycleCadence cadence={data.cadence} rotation={data.rotation} />}
          {dialog === "compare" && (canCompare ? <FreshVsRecycled data={data} /> : <EmptyState title="Nothing to compare yet" hint="Figures appear once recycled leads have been dialled." />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
