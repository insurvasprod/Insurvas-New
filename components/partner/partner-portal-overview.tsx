"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { LinkArrow } from "@/components/ui/link-arrow";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { productLineLabel } from "@/lib/format/productLine";
import { oldestOpenLabel } from "@/lib/format/age";
import { dayMonth, viewerTimeZone } from "@/lib/format/dates";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { PartnerLaneCounts } from "@/lib/partnerLeads/lanes";
import type { PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import { durationLabel } from "@/lib/partnerTeamReview/pulse";

type PipelineSummary = {
  rows: PartnerLeadRow[];
  stages: PartnerPipelineStage[];
  laneCounts?: PartnerLaneCounts | null;
  counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number };
  oldestOpenAt?: string | null;
  total: number;
};
/** /api/partner/overview: counts only, partner-scoped on the server; team and pulse for admins. */
type OverviewExtras = {
  rejectedCompliance: number | null;
  alerts: Array<{ id: string; title: string; body: string; link: string; actionLabel: string }>;
  team?: { active: number; pending: number } | null;
  pulse?: { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number } | null;
};

const RECENT_ROWS = 8;
const PIPELINE = "/partner/pipeline";

function formatDate(value: string) {
  return dayMonth(value, viewerTimeZone()); // leads load in an effect, after mount
}

/** Today as YYYY-MM-DD in the viewer's calendar, for the pipeline's "From" filter. */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

export function PartnerPortalOverview({ role, partnerStatus, partnerName }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string | null }) {
  const isAdmin = role === "partner_admin";
  const canSubmit = partnerStatus === "active";
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [extras, setExtras] = useState<OverviewExtras | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The LiveStamp is fed by the last good poll; a failed one turns it amber at once.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      // One round of parallel reads per poll: the pipeline read model, and the counts beside it.
      const [pipelineResponse, extrasResponse] = await Promise.all([
        fetch(`/api/partner/leads/pipeline?limit=${RECENT_ROWS}&offset=0`, { cache: "no-store" }),
        fetch("/api/partner/overview", { cache: "no-store" }),
      ]);
      const nextPipeline = await pipelineResponse.json().catch(() => null);
      const nextExtras = await extrasResponse.json().catch(() => null);
      if (!pipelineResponse.ok || !extrasResponse.ok) throw new Error("load failed");
      setPipeline(nextPipeline as PipelineSummary);
      setExtras(nextExtras as OverviewExtras);
      setError(null);
      setStale(false);
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch {
      // The first failure is an error. A later one keeps the last good figures and marks them stale.
      setStale(true);
      setPipeline((current) => {
        if (!current) setError("Some workspace details could not be loaded. Try refreshing the page.");
        return current;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let polling = false;
    const poll = () => {
      if (document.visibilityState !== "visible" || polling) return;
      polling = true;
      void load().finally(() => { polling = false; });
    };
    const kickoff = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(poll, 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(refresh);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load]);

  const counters = pipeline?.counters;
  const figure = (value: number | null | undefined) => (loading || value == null ? "—" : value);
  const recentRows = pipeline?.rows ?? [];
  // LA-1.17: the partner's own pipeline stages, the board's columns (lib/partnerLeads/board.ts), each
  // opening the rows on it. Another pipeline's stages appear only while they hold this partner's leads.
  const pipelineStages = pipeline?.stages ?? [];
  const manyPipelines = new Set(pipelineStages.map((stage) => stage.pipelineId)).size > 1;
  const stages = pipelineStages.map((stage) => ({ key: stage.id, label: stage.name, footnote: manyPipelines ? stage.pipelineName : "", count: stage.leadCount, href: `${PIPELINE}?stage_id=${encodeURIComponent(stage.id)}&view=table` }));
  const pulse = extras?.pulse;
  const team = extras?.team;
  const nextAction = canSubmit
    ? <Button asChild variant="outline"><a href="/partner/submit-lead">Submit your first lead</a></Button>
    : <Button asChild variant="outline"><a href="/partner/messages">Message your agent</a></Button>;

  return <DashboardStage>
    <div className="m-stagger space-y-6">
      <PageHeader
        title="Overview"
        actions={<>
          {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={stale ? 0 : 45} />}
          {canSubmit && <Button asChild><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit a new lead</a></Button>}
        </>}
      />
      {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}
      {(extras?.alerts ?? []).map((alert) => <p key={alert.id} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
        <span><strong className="font-semibold">{alert.title}.</strong> {alert.body}</span>
        <LinkArrow href={alert.link} className="shrink-0">{alert.actionLabel}</LinkArrow>
      </p>)}
      <StatStrip label={`${partnerName ?? "Your organization"} at a glance`}>
        <StatTile label="Submitted today" value={figure(counters?.submittedToday)} footnote="since 00:00 your time" action={pipeline ? <LinkArrow href={`${PIPELINE}?date_from=${todayIso()}&view=table`} className="text-xs">View</LinkArrow> : undefined} />
        <StatTile label="Claimed" value={figure(counters?.claimed)} footnote="with a closer or on a call" action={<LinkArrow href={PIPELINE} className="text-xs">Board</LinkArrow>} />
        <StatTile label="Converted" value={figure(counters?.converted)} footnote="last 30 days" action={<LinkArrow href={PIPELINE} className="text-xs">Board</LinkArrow>} />
        <StatTile label="Still open" value={figure(counters?.stillOpen)} footnote={oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now)} action={<LinkArrow href={PIPELINE} className="text-xs">Board</LinkArrow>} />
        {/* Sixteen Open Questions #9: a coded reason and a running total, never which numbers. */}
        <StatTile label="Rejected · compliance" labelTitle="Rejected: compliance screening. Submissions stopped before they reached the agency. Only the count is shown." value={figure(extras?.rejectedCompliance)} footnote={isAdmin ? "all time, your organization" : "all time, your submissions"} />
        {isAdmin && <StatTile label="Team" value={figure(team?.active)} footnote={team ? `${team.pending} pending invitation${team.pending === 1 ? "" : "s"}` : undefined} reserveFootnote action={<LinkArrow href="/partner/team" className="text-xs">Team</LinkArrow>} />}
      </StatStrip>
      <div className={isAdmin ? "grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : undefined}>
        <TableCard title="Your pipeline by stage" action={<LinkArrow href={PIPELINE}>Open pipeline</LinkArrow>}>
          {loading ? <SectionLoading rows={5} columns={3} /> : !pipeline?.total ? <EmptyState title="No submissions yet" hint={canSubmit ? "Your leads are counted here by stage as the agency works them." : "Leads your organization sent are counted here by stage."} action={nextAction} /> : <Table>
            <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right"><span className="sr-only">Action</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {stages.map((stage) => <TableRow key={stage.key}>
                <TableCell><span className="font-medium">{stage.label}</span> <span className="text-xs text-muted-foreground">{stage.footnote}</span></TableCell>
                <TableCell className="text-right tabular-nums">{stage.count == null ? "—" : stage.count.toLocaleString()}</TableCell>
                <TableCell className="text-right">{Boolean(stage.count) && <Button asChild variant="outline" size="sm"><a href={stage.href} aria-label={`View ${stage.label} leads`}>View</a></Button>}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>}
        </TableCard>
        {isAdmin && <TableCard title="Team pulse" action={<LinkArrow href="/partner/team-review">Team review</LinkArrow>}>
          {loading ? <SectionLoading rows={2} columns={2} /> : <Table>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground">Average reply to your agent</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{pulse ? (pulse.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : "No replies yet") : "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-muted-foreground">Conversations waiting on your team</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{pulse ? <a className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/partner/messages">{pulse.pendingFollowUps}</a> : "—"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>}
        </TableCard>}
      </div>
      <TableCard
        title="Recent submissions"
        action={<LinkArrow href={PIPELINE}>View all</LinkArrow>}
      >
        {loading ? <SectionLoading rows={RECENT_ROWS} columns={5} /> : recentRows.length === 0 ? <EmptyState title="No submissions yet" hint={canSubmit ? "Submit a lead and its progress appears here." : "Leads your organization sent appear here."} action={nextAction} /> : <Table>
          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Stage</TableHead>{isAdmin && <TableHead>Submitted by</TableHead>}<TableHead>When</TableHead><TableHead className="text-right"><span className="sr-only">Action</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {recentRows.map((row) => <TableRow key={row.id}>
              <TableCell className="font-medium">{row.customer}</TableCell>
              <TableCell className="text-muted-foreground">{productLineLabel(row.product)}</TableCell>
              <TableCell><StatusChip tone={row.stageType === "won" ? "good" : row.stageType === "lost" ? "danger" : "neutral"}>{row.stageName}</StatusChip>{row.outcome && row.outcome !== row.stageName && <span className="ml-2 text-xs text-muted-foreground">{row.outcome}</span>}</TableCell>
              {isAdmin && <TableCell className="text-muted-foreground">{row.submittedBy.name}</TableCell>}
              <TableCell className="text-muted-foreground tabular-nums">{formatDate(row.submittedAt)}</TableCell>
              <TableCell className="text-right"><Button asChild variant="outline" size="sm"><a href={`${PIPELINE}?lead=${encodeURIComponent(row.id)}&view=table`} aria-label={`View ${row.customer}`}>View</a></Button></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>}
      </TableCard>
    </div>
  </DashboardStage>;
}
