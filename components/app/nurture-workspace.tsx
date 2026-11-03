"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Clock, History } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import type { NurtureCampaignReport, NurtureReport } from "@/lib/nurture/report";
import { DEFAULT_PASS_CEILING, type RecycleBatch } from "@/lib/nurture/contract";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { LeadsInSlot, useInLeadsFrame } from "@/components/app/lead-sources/leads-in-slot";
import { NextUp } from "@/components/app/lead-sources/next-up";
import { ViewTabs } from "@/components/ui/view-tabs";
import { canContinue, count, draftOf, draftProblem, MONTHS, plural, ruleSummary, sameRule, sourceLine, startBlockedFor, type RuleDraft } from "@/components/app/nurture/format";
import { campaignStatus, PanelSection, RecycleFlow, RecyclePerformance, RulePanel, type Progress } from "@/components/app/nurture/recycle-cards";
import { BatchList, BatchSheet, BatchTable, FreshVsRecycled, RecycleCadence } from "@/components/app/nurture/recycle-history";
import { BringBackAllDialog, CampaignTable, ComesBackWhen, wholePercent, type PanelFocus } from "@/components/app/nurture/recycle-table";

/**
 * Lead sources › 6 Recycle (board C, LirY3, with board A's four figures; owner pick 2026-10-29).
 * Top to bottom: the "With leads / All campaigns" tabs and the search in the frame's top row (Past
 * batches, Cadence and Refresh beside it); the next-up line (owner critique 2026-10-30) whose button is
 * the page's one primary ("Bring back N", or the fix for the top blocker: a cap of 0, a stalled or
 * stopped batch), with the rule in one line under it; four figures; one row per campaign (opening on
 * those with leads); and the full rule leads come back by. The corner holds "Bring back N" as an
 * outline only while a blocker leads the next-up line. A row opens the campaign's panel: who is ready and the new angle
 * (required) to bring them back, its rule to edit, its past batches. Recycled against fresh in full
 * and every campaign's batches open in dialogs, the cadence in another.
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
const FOCUS_ID: Record<Exclude<PanelFocus, null>, string> = { angle: "recycle-angle", max: "rule-max", wait: "rule-wait" };

/** The campaigns with recycling work first, then the idle ones. */
function ordered(campaigns: NurtureCampaignReport[]) {
  const working = campaigns.filter((campaign) => campaign.eligible_count > 0 || campaign.reactivated_count > 0 || campaign.lastRun || campaign.openBatch || (campaign.pool?.saidNo ?? 0) > 0);
  return [...working, ...campaigns.filter((campaign) => !working.includes(campaign))];
}

/** "With leads": something in nurture or ready, or a batch still being screened. */
const hasLeads = (campaign: NurtureCampaignReport) => campaign.eligible_count > 0 || campaign.eligibleNow > 0 || Boolean(campaign.openBatch);

/** "12 Nov". */
function dayMonth(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function NurtureWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  /** The campaign whose panel is open, or null. */
  const [selected, setSelected] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  /** Screening that stopped on this page with an error (the service down): shown with Resume. */
  const [stopped, setStopped] = useState<{ campaignId: string; message: string } | null>(null);
  /** The Rule panel's edits, for one campaign. */
  const [edit, setEdit] = useState<{ campaignId: string; draft: RuleDraft } | null>(null);
  const [dialog, setDialog] = useState<"cadence" | "compare" | "batches" | null>(null);
  const [openBatch, setOpenBatch] = useState<RecycleBatch | null>(null);
  const [query, setQuery] = useState("");
  /** The table's view, once picked; until then "With leads" when any campaign has some. */
  const [viewPick, setViewPick] = useState<"with" | "all" | null>(null);
  const [askAll, setAskAll] = useState(false);
  /** "Bring back all ready" is walking its campaigns. */
  const [runningAll, setRunningAll] = useState(false);
  const ruleScope = useRef<HTMLDivElement>(null);
  const inFrame = useInLeadsFrame();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/app/nurture", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
      // A campaign gone since (deleted elsewhere) closes its panel.
      setSelected((current) => (current && (body as Payload).campaigns.some((campaign) => campaign.campaign_id === current) ? current : null));
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
  const opened = campaigns.find((campaign) => campaign.campaign_id === selected) ?? null;
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
      notify.done(`${count(Number(body.queued ?? 0))} leads queued for screening · ${campaign.campaign_name}`);
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not start the batch");
    } finally {
      setSaving(null);
    }
    if (batchId) await screen(batchId, campaign.campaign_id);
  }

  /** The corner's action: one angle, a batch per campaign that can start, each screened in turn. */
  async function startAll(targets: NurtureCampaignReport[], angle: string) {
    setAskAll(false);
    setRunningAll(true);
    try {
      for (const campaign of targets) await start(campaign, { angle, script: "", attemptCeiling: DEFAULT_PASS_CEILING });
    } finally {
      setRunningAll(false);
    }
  }

  /** Puts the cursor on a panel control once the panel has rendered. */
  function focusControl(focus: PanelFocus) {
    if (!focus) return;
    window.setTimeout(() => {
      const input = document.getElementById(FOCUS_ID[focus]);
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      input?.focus();
    }, 60);
  }

  /** Opens a campaign's panel; unsaved rule edits on another are confirmed away first. */
  async function openCampaign(id: string, focus: PanelFocus) {
    if (id !== opened?.campaign_id) {
      if (dirty && !(await confirmAction({ title: "Discard the rule changes?", description: `The rule for ${opened?.campaign_name ?? "this campaign"} has changes that are not saved.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
      setEdit(null);
      setSelected(id);
    }
    focusControl(focus);
  }

  async function closePanel() {
    if (dirty && !(await confirmAction({ title: "Discard the rule changes?", description: `The rule for ${opened?.campaign_name ?? "this campaign"} has changes that are not saved.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    setEdit(null);
    setSelected(null);
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

  const { viewer, batchesReady, totals } = data;
  const readOnly = Boolean(data.readOnly);
  const busy = opened ? saving === opened.campaign_id || progress?.campaignId === opened.campaign_id : false;
  const screeningNow = Boolean(opened && progress?.campaignId === opened.campaign_id);
  const lockedReason = readOnly ? READ_ONLY : screeningNow ? "The rule is locked while its batch is screened." : null;
  const canCompare = data.sources.length > 0 || Boolean(data.conversion);
  const needle = query.trim().toLowerCase();

  // The table opens on the campaigns with something to recycle; "All campaigns" shows the rest.
  const withLeads = list.filter(hasLeads);
  const view = viewPick ?? (withLeads.length ? "with" : "all");
  const inView = view === "with" ? withLeads : list;
  const shownInView = needle ? inView.filter((campaign) => `${campaign.campaign_name} ${campaign.vendorName ?? ""}`.toLowerCase().includes(needle)) : inView;

  // Every campaign that can start a batch now: "Bring back N" (next up, or the corner when a blocker leads).
  const startable = list.filter((campaign) => !startBlockedFor(campaign, batchesReady) && campaign.eligibleNow > 0);
  const readyTotal = startable.reduce((sum, campaign) => sum + campaign.eligibleNow, 0);
  const working = runningAll || progress !== null || saving !== null;
  const allWhy = readOnly ? READ_ONLY : working ? "A batch is being screened." : !startable.length ? "No campaign has leads ready to come back." : undefined;
  const bringAll = (variant: "default" | "outline") => (
    <Button type="button" variant={variant} disabled={Boolean(allWhy)} title={allWhy ?? `${count(readyTotal)} ready across ${plural(startable.length, "campaign")}`} onClick={() => setAskAll(true)}>
      {runningAll ? "Bringing back…" : `Bring back ${count(readyTotal)}`}
    </Button>
  );

  // Next up (owner critique 2026-10-30): what blocks work, then what waits on a person, then the
  // normal next step. Its button is the page's one primary.
  const capped = list.filter((campaign) => batchesReady && !campaign.openBatch && campaign.rule.max_recycles === 0 && campaign.eligible_count > 0);
  const cappedLeads = capped.reduce((sum, campaign) => sum + campaign.eligible_count, 0);
  const stalled = list.find((campaign) => campaign.openBatch?.stalled && canContinue(campaign.openBatch, viewer).ok) ?? null;
  const screeningName = progress ? campaigns.find((campaign) => campaign.campaign_id === progress.campaignId)?.campaign_name ?? "a campaign" : "";
  const stoppedName = stopped ? campaigns.find((campaign) => campaign.campaign_id === stopped.campaignId)?.campaign_name ?? "a campaign" : "";
  const nextBack = totals.nextBackAt ? dayMonth(totals.nextBackAt) : "";
  const fixButton = (label: string, onClick: () => void) => (
    <Button type="button" disabled={readOnly} title={readOnly ? READ_ONLY : undefined} onClick={onClick}>{label}</Button>
  );
  let offersBringAll = false;
  let nextUp: ReactNode;
  if (progress) {
    nextUp = <NextUp tone="action">Screening <strong>{screeningName}</strong>{progress.pending ? <>: <strong>{count(progress.pending)}</strong> to go</> : "…"} Cleared leads go straight back to the dialer.</NextUp>;
  } else if (stopped) {
    nextUp = <NextUp tone="danger" action={fixButton("Resume", () => void openCampaign(stopped.campaignId, null))}>Screening <strong>{stoppedName}</strong> stopped: {stopped.message} The batch kept its progress.</NextUp>;
  } else if (!batchesReady && totals.inNurture > 0) {
    nextUp = <NextUp tone="danger"><strong>{count(totals.inNurture)}</strong> leads in nurture cannot come back until a database update is applied. Ask your Insurvas contact.</NextUp>;
  } else if (capped.length) {
    nextUp = (
      <NextUp tone="danger" action={fixButton("Raise the cap", () => void openCampaign(capped[0].campaign_id, "max"))} more={capped.length > 1 ? <span className="text-xs text-[var(--body)]">Starting with {capped[0].campaign_name}</span> : null}>
        <strong>{count(cappedLeads)}</strong> leads in nurture can never come back: {capped.length === 1 ? <>{capped[0].campaign_name}&apos;s recycle cap is 0.</> : <>{capped.length} campaigns have a recycle cap of 0.</>}
      </NextUp>
    );
  } else if (stalled?.openBatch) {
    nextUp = (
      <NextUp tone="warning" action={fixButton("Resume", () => void openCampaign(stalled.campaign_id, null))}>
        Screening for <strong>{stalled.campaign_name}</strong> stalled with <strong>{count(stalled.openBatch.pending)}</strong> leads to go. Resume it to finish the batch.
      </NextUp>
    );
  } else if (readyTotal > 0) {
    // No banner just for a button (owner 2026-10-30): "Bring back N" is the toolbar's last button.
    offersBringAll = true;
    nextUp = null;
  } else {
    nextUp = <NextUp tone="done">{nextBack ? <>Nothing is ready yet. The next leads come back on <strong>{nextBack}</strong>.</> : "Nothing is ready yet."}</NextUp>;
  }
  // "Bring back N" at the far right of the toolbar, after Refresh: the primary when nothing blocks,
  // an outline while a blocker's own fix holds the next-up line.
  const corner = startable.length > 0 && !progress ? bringAll(offersBringAll ? "default" : "outline") : null;

  const fresh = data.sources.find((source) => source.source === "fresh") ?? null;
  const recycledRate = data.contactRate?.recycled ?? null;

  const topRow = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {campaigns.length > 0 && (
        <ViewTabs
          label="Which campaigns"
          value={view}
          onChange={setViewPick}
          tabs={[{ key: "with", label: "With leads", count: withLeads.length }, { key: "all", label: "All campaigns", count: list.length }]}
        />
      )}
      <ToolbarSearch value={query} onChange={setQuery} placeholder="Search campaigns" />
      {readOnly && <StatusChip tone="neutral" title={READ_ONLY}>Read only</StatusChip>}
      <span className="ml-auto flex items-center gap-2">
        {data.batches.length > 0 && <Button type="button" variant="outline" onClick={() => setDialog("batches")}><History aria-hidden="true" />Past batches</Button>}
        <Button type="button" variant="outline" onClick={() => setDialog("cadence")}><Clock aria-hidden="true" />Cadence</Button>
        {refresh}
        {corner}
      </span>
    </div>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {place(topRow)}

      {campaigns.length ? (
        <>
          {/* The rules line under it is gone too (owner 2026-10-30); the rules are "Comes back when" below and each campaign's panel. */}
          {nextUp}

          <StatStrip label="Recycling">
            <StatTile label="In nurture" value={count(totals.inNurture)} reserveFootnote />
            <StatTile label="Ready now" value={count(totals.eligibleNow)} valueTone="good" footnote="rest period over" />
            {fresh && (
              <StatTile
                label="Fresh leads"
                labelTitle="Fresh leads served to the dialer this month, and the share of their dials that reached someone."
                value={count(fresh.served)}
                footnote={fresh.contactRate != null ? `${wholePercent(fresh.contactRate)} contact` : undefined}
                reserveFootnote
              />
            )}
            <StatTile
              label="Recycled this month"
              labelTitle="Leads cleared on re-screening and back in the dialer since the first of the month, and the share of recycled dials that reached someone."
              value={count(totals.recycledThisMonth)}
              footnote={recycledRate != null ? `${wholePercent(recycledRate)} contact` : undefined}
              action={canCompare ? <button type="button" onClick={() => setDialog("compare")} className="font-semibold text-[var(--accent-ink)] hover:underline">Compare</button> : undefined}
              reserveFootnote
            />
          </StatStrip>

          <CampaignTable
            campaigns={shownInView}
            total={campaigns.length}
            empty={view === "with" && !needle && !withLeads.length
              ? { title: "No campaign has leads in nurture", hint: "Leads land here when their calls run out without a result.", action: <Button type="button" variant="outline" onClick={() => setViewPick("all")}>Show all campaigns</Button> }
              : view === "with" && needle && !shownInView.length && list.some((campaign) => `${campaign.campaign_name} ${campaign.vendorName ?? ""}`.toLowerCase().includes(needle))
                ? { title: "No campaign with leads matches", hint: "It may have no leads in nurture.", action: <Button type="button" variant="outline" onClick={() => setViewPick("all")}>Search all campaigns</Button> }
                : null}
            readOnly={readOnly}
            readOnlyReason={READ_ONLY}
            batchesReady={batchesReady}
            progress={progress}
            onOpen={(id, focus) => void openCampaign(id, focus)}
          />

          <ComesBackWhen campaigns={campaigns} />
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

      {opened && draft && (
        <DetailPanel
          mode="overlay"
          title={opened.campaign_name}
          subtitle={[sourceLine(opened), ruleSummary(opened.rule)].filter(Boolean).join(" · ")}
          status={campaignStatus(opened, screeningNow)}
          onClose={() => void closePanel()}
          closeLabel="Close the campaign"
        >
          <PanelSection title="Bring back" aside={readOnly ? <StatusChip tone="neutral" title={READ_ONLY}>Read only</StatusChip> : undefined}>
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
              onRaiseCap={() => { setEdit({ campaignId: opened.campaign_id, draft: { ...draft, max: draft.max === "0" ? "1" : draft.max } }); focusControl("max"); }}
              onEditRule={() => focusControl("wait")}
            />
          </PanelSection>
          <div ref={ruleScope} className="min-w-0 border-t border-border pt-4">
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
          <PanelSection title="Past batches">
            <BatchList key={opened.campaign_id} batches={data.batches} baseline={data.batchBaseline} campaignId={opened.campaign_id} />
          </PanelSection>
        </DetailPanel>
      )}

      <LeaveGuard dirty={dirty} scope={ruleScope} onSave={save} onDiscard={() => setEdit(null)} what="the recycle rule" />

      {openBatch && <BatchSheet batch={openBatch} baseline={data.batchBaseline} onClose={() => setOpenBatch(null)} />}

      <BringBackAllDialog open={askAll} onOpenChange={setAskAll} campaigns={startable} onConfirm={(angle) => void startAll(startable, angle)} />

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto overflow-x-hidden" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{dialog === "cadence" ? "Cadence and time slots" : dialog === "batches" ? "Every campaign's batches" : "Recycled against fresh"}</DialogTitle>
          </DialogHeader>
          {dialog === "cadence" && <RecycleCadence cadence={data.cadence} rotation={data.rotation} />}
          {dialog === "batches" && <BatchTable batches={data.batches} baseline={data.batchBaseline} campaignId={null} onOpen={(batch) => { setDialog(null); setOpenBatch(batch); }} onCompare={canCompare ? () => setDialog("compare") : undefined} />}
          {dialog === "compare" && (canCompare
            ? <div className="flex flex-col gap-4"><RecyclePerformance data={data} /><FreshVsRecycled data={data} /></div>
            : <EmptyState title="Nothing to compare yet" hint="Figures appear once recycled leads have been dialled." />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
