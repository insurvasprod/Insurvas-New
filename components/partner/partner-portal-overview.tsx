"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, BellRing, CheckCircle2, Hand, Inbox, MessageSquare, Send, ShieldX, Users, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { DashTile } from "@/components/ui/dash-tile";
import { Launchpad, type LaunchCell } from "@/components/ui/launchpad";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { oldestOpenLabel } from "@/lib/format/age";
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

const PIPELINE = "/partner/pipeline";

/** Today as YYYY-MM-DD in the viewer's calendar, for the pipeline's "From" filter. */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * The partner home uses movable workspaces. Its next-step tile uses the partner-scoped funnel,
 * followed by submission, pipeline, and team figures.
 *   launchpad   every figure as a tile: submitted today, claimed, converted,
 *               still open, rejected at screening, submit, messages; team, statements and team review
 *               for a partner admin (LA-7.4: statements are the organisation's)
 *
 * The figures poll every 15 seconds while the tab is visible, as before; a failed poll keeps the last
 * good figures and turns the LiveStamp amber.
 */
export function PartnerPortalOverview({ role, partnerStatus, partnerName }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string | null }) {
  const isAdmin = role === "partner_admin";
  const canSubmit = partnerStatus === "active";
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [extras, setExtras] = useState<OverviewExtras | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      // The stage counts and the counters come with the first page of the pipeline; one row is enough.
      const [pipelineResponse, extrasResponse] = await Promise.all([
        fetch("/api/partner/leads/pipeline?limit=1&offset=0", { cache: "no-store" }),
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
      setStale(true);
      setPipeline((current) => {
        if (!current) setError("Some workspace details could not be loaded. Try refreshing the page.");
        return current;
      });
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
  const ready = pipeline !== null;
  const figure = (value: number | null | undefined) => (!ready || value == null ? "—" : String(value));
  const pulse = extras?.pulse;
  const team = extras?.team;

  const cells: LaunchCell[] = [];
  // Must-act notices (an expiring document, a paused organisation) lead the tiles.
  for (const alert of extras?.alerts ?? []) {
    cells.push({ id: `alert-${alert.id}`, title: alert.title, w: 1, h: 1, href: alert.link, node: <DashTile title={alert.title} icon={<BellRing />} href={alert.link} tone="warning" rows={[{ label: alert.body, tone: "warning", href: alert.link }]} cta={{ label: alert.actionLabel, href: alert.link }} ctaAtFoot /> });
  }
  cells.push(
    { id: "today", title: "Submitted today", w: 1, h: 1, href: `${PIPELINE}?date_from=${todayIso()}&view=table`, node: <DashTile title="Submitted today" icon={<Send />} href={`${PIPELINE}?date_from=${todayIso()}&view=table`} big={figure(counters?.submittedToday)} unit="since 00:00 your time" rows={[{ label: "See today's leads", href: `${PIPELINE}?date_from=${todayIso()}&view=table` }]} /> },
    { id: "claimed", title: "Claimed", w: 1, h: 1, href: PIPELINE, node: <DashTile title="Claimed" icon={<Hand />} href={PIPELINE} big={figure(counters?.claimed)} unit="with a closer or on a call" tone="good" rows={[{ label: "On the board", href: PIPELINE }]} /> },
    { id: "converted", title: "Converted", w: 1, h: 1, href: PIPELINE, node: <DashTile title="Converted" icon={<CheckCircle2 />} href={PIPELINE} big={figure(counters?.converted)} unit="last 30 days" tone="good" rows={[{ label: "Won on the board", href: PIPELINE }]} /> },
    { id: "open", title: "Still open", w: 1, h: 1, href: PIPELINE, node: <DashTile title="Still open" icon={<Inbox />} href={PIPELINE} big={figure(counters?.stillOpen)} unit="being worked" rows={[{ label: oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now), href: PIPELINE }]} /> },
    // Sixteen Open Questions #9: a coded reason and a running total, never which numbers.
    { id: "rejected", title: "Rejected · compliance", w: 1, h: 1, href: PIPELINE, node: <DashTile title="Rejected · compliance" icon={<ShieldX />} href={PIPELINE} big={figure(extras?.rejectedCompliance)} unit="stopped by screening" tone={extras?.rejectedCompliance ? "warning" : "default"} rows={[{ label: isAdmin ? "All time, your organization · only the count is shown" : "All time, your submissions · only the count is shown" }]} /> },
  );
  if (canSubmit) cells.push({ id: "submit", title: "Submit a lead", w: 1, h: 1, href: "/partner/submit-lead", node: <DashTile title="Submit a lead" icon={<Send />} href="/partner/submit-lead" rows={[{ label: "The agency sees it at once" }]} cta={{ label: "Submit a lead", href: "/partner/submit-lead" }} ctaAtFoot /> });
  cells.push({ id: "messages", title: "Messages", w: 1, h: 1, href: "/partner/messages", node: <DashTile title="Messages" icon={<MessageSquare />} href="/partner/messages" big={isAdmin && pulse ? String(pulse.pendingFollowUps) : undefined} unit={isAdmin ? "waiting on your team" : undefined} tone={isAdmin && pulse?.pendingFollowUps ? "warning" : "default"} rows={[{ label: "Your agent and your team", href: "/partner/messages" }]} /> });
  if (isAdmin) {
    cells.push(
      { id: "team", title: "Team", w: 1, h: 1, href: "/partner/team", node: <DashTile title="Team" icon={<Users />} href="/partner/team" big={figure(team?.active)} unit="active members" rows={[{ label: team ? `${team.pending} pending invitation${team.pending === 1 ? "" : "s"}` : "Invite your closers", tone: team?.pending ? "warning" : "default", href: "/partner/team" }]} /> },
      { id: "statements", title: "Statements", w: 1, h: 1, href: "/partner/payouts", node: <DashTile title="Statements" icon={<WalletCards />} href="/partner/payouts" rows={[{ label: "What the agency paid your organization", href: "/partner/payouts" }]} cta={{ label: "Open statements", href: "/partner/payouts" }} ctaAtFoot /> },
      { id: "review", title: "Team review", w: 1, h: 1, href: "/partner/team-review", node: <DashTile title="Team review" icon={<BarChart3 />} href="/partner/team-review" big={pulse ? (pulse.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : "—") : "—"} unit="average reply to your agent" rows={[{ label: "Conversations waiting on your team", value: pulse ? String(pulse.pendingFollowUps) : "—", href: "/partner/messages" }]} /> },
    );
  }

  return (
    <DashboardStage>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <PageHeader
          title="Overview"
          actions={<>
            {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={stale ? 0 : 45} />}
            {canSubmit && <Button asChild><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit a new lead</a></Button>}
          </>}
        />
        {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}
        <Launchpad storageKey={`insurvas:partner-home:${role}`} spaces={[{ key: "today", label: `${partnerName ?? "Your organization"} at a glance`, cells }]} />
      </div>
    </DashboardStage>
  );
}
