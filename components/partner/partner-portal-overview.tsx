"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, BarChart3, CheckCircle2, CircleAlert, Clock3, Hand, Inbox, MessageSquare, Send, ShieldX, Users, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { HomePanel } from "@/components/app/home/home-panel";
import { oldestOpenLabel } from "@/lib/format/age";
import { formatCentsAsCurrency } from "@/lib/money";
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
  latestStatement?: { periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null } | null;
};

const PIPELINE = "/partner/pipeline";

/** Today as YYYY-MM-DD in the viewer's calendar, for the pipeline's "From" filter. */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Partner Overview: real partner-scoped figures and configured board stages, refreshed every 15s.
 * The design is analytical, but every figure and shortcut still comes from the existing reads.
 */
export function PartnerPortalOverview({ role, partnerStatus }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string | null }) {
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
      // The stage counts and counters come with the first page; one row is enough.
      const [pipelineResponse, extrasResponse, statementsResponse] = await Promise.all([
        fetch("/api/partner/leads/pipeline?limit=1&offset=0", { cache: "no-store" }),
        fetch("/api/partner/overview", { cache: "no-store" }),
        isAdmin ? fetch("/api/partner/payouts?limit=1", { cache: "no-store" }).catch(() => null) : Promise.resolve(null),
      ]);
      const nextPipeline = await pipelineResponse.json().catch(() => null);
      const nextExtras = await extrasResponse.json().catch(() => null);
      if (!pipelineResponse.ok || !extrasResponse.ok) throw new Error("load failed");
      const statementData = statementsResponse?.ok ? await statementsResponse.json().catch(() => null) : null;
      setPipeline(nextPipeline as PipelineSummary);
      setExtras({
        ...nextExtras as OverviewExtras,
        ...(isAdmin ? { latestStatement: statementsResponse?.ok ? statementData?.runs?.[0] ?? null : undefined } : {}),
      });
      setError(null);
      setStale(false);
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch {
      setStale(true);
      setPipeline((current) => {
        if (!current) setError("Some overview details could not be loaded. Try refreshing the page.");
        return current;
      });
    }
  }, [isAdmin]);

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
  const figure = (value: number | null | undefined) => (!ready || value == null ? "—" : value);
  const pulse = extras?.pulse;
  const team = extras?.team;
  const latestStatement = extras?.latestStatement;
  const statementDetail = !extras ? "Statements" : latestStatement === undefined ? "Latest statement unavailable" : latestStatement === null ? "No published statements yet" : `${latestStatement.status === "paid" ? "Paid" : "Published"} · ${formatCentsAsCurrency(latestStatement.netCents)} · ${shortPeriod(latestStatement.periodStart, latestStatement.periodEnd)}`;
  const stages = pipeline?.stages ?? [];
  const visibleStages = stages.slice(0, 6);
  const otherStages = stages.slice(6);
  const chartStages = otherStages.length
    ? [...visibleStages, { id: "other-stages", name: "Other stages", leadCount: otherStages.reduce((sum, stage) => sum + stage.leadCount, 0) }]
    : visibleStages;
  const totalSubmissions = pipeline?.total ?? 0;

  const stats = [
    { key: "today", icon: Send, label: "Submitted today", value: figure(counters?.submittedToday), fact: { label: "Since midnight, your time" }, href: `${PIPELINE}?date_from=${todayIso()}&view=table` },
    { key: "claimed", icon: Hand, label: "With a closer", value: figure(counters?.claimed), fact: { label: "Claimed or on a call" }, href: PIPELINE },
    { key: "converted", icon: CheckCircle2, label: "Converted · 30 days", value: figure(counters?.converted), fact: { label: "Won on the board" }, href: PIPELINE },
    { key: "open", icon: Inbox, label: "Still open", value: figure(counters?.stillOpen), fact: { label: oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now) }, href: PIPELINE },
  ];

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="Your submissions and pipeline at a glance."
        visible
        infoDescription
        actions={<>
          {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={stale ? 0 : 45} />}
          {canSubmit && <Button asChild><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit a new lead</a></Button>}
        </>}
      />

      {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      {(extras?.alerts.length ?? 0) > 0 && <section aria-label="Needs attention" className="flex flex-col gap-2">
        {extras!.alerts.map((alert) => (
          <Link key={alert.id} href={alert.link} className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-surface)] px-3.5 py-2.5 text-sm text-[var(--warning-ink)] no-underline hover:border-[var(--warning)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate"><strong className="font-semibold">{alert.title}</strong><span className="ml-2 text-[var(--muted-foreground)]">{alert.body}</span></span>
            <span className="shrink-0 font-semibold">{alert.actionLabel}<ArrowUpRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
          </Link>
        ))}
      </section>}

      <div className="@container">
        <StatRow label="Partner activity" className="grid-cols-1 @lg:grid-cols-2 @4xl:grid-cols-4">
          {stats.map((stat) => (
            <Link key={stat.key} href={stat.href} className="block min-w-0 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
              <StatCard icon={stat.icon} label={stat.label} value={stat.value} fact={stat.fact} className="h-full min-h-[132px]" />
            </Link>
          ))}
        </StatRow>
      </div>

      <div className="@container">
        <div className="grid min-w-0 grid-cols-1 gap-3 @4xl:grid-cols-12">
          <HomePanel title="Lead pipeline" period="share of submissions" link={{ label: "View pipeline", href: PIPELINE }} className="min-h-[296px] @4xl:col-span-8" bodyClassName="pt-1">
            {!ready ? <div className="flex flex-1 flex-col justify-center gap-3" aria-label="Loading pipeline stages" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="flex items-center gap-3"><span className="m-skel h-4 w-24 rounded" /><span className="m-skel h-4 flex-1 rounded" /></div>)}
            </div> : chartStages.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-[var(--surface-alt)] text-muted-foreground"><BarChart3 className="size-5" aria-hidden="true" /></span>
              <p className="m-0 text-sm font-semibold text-foreground">No pipeline stages yet</p>
              <p className="m-0 text-xs text-muted-foreground">Your configured stages will appear here.</p>
            </div> : <div className="flex flex-1 flex-col justify-center gap-4 py-2">
              {chartStages.map((stage) => {
                const share = totalSubmissions ? (stage.leadCount / totalSubmissions) * 100 : 0;
                return <div key={stage.id} className="grid grid-cols-[minmax(100px,0.85fr)_2rem_minmax(0,3fr)_2.5rem] items-center gap-3" aria-label={`${stage.name}: ${stage.leadCount} leads, ${Math.round(share)}% of submissions`}>
                  <span className="truncate text-sm font-medium text-foreground" title={stage.name}>{stage.name}</span>
                  <span className="text-right text-sm font-semibold tabular-nums text-foreground">{stage.leadCount}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" aria-hidden="true"><span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-500" style={{ width: `${share}%` }} /></span>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">{Math.round(share)}%</span>
                </div>;
              })}
              {totalSubmissions === 0 && <p className="mt-1 border-t border-dashed pt-4 text-center text-sm text-muted-foreground">No leads in the pipeline yet.</p>}
            </div>}
          </HomePanel>

          {isAdmin ? <HomePanel title="Team response" period="30 days" link={{ label: "View team review", href: "/partner/team-review" }} className="min-h-[296px] @4xl:col-span-4" bodyClassName="pt-1">
            <div className="flex flex-1 flex-col justify-center divide-y divide-[var(--border)]">
              <div className="flex items-center gap-4 py-5 first:pt-2">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--accent-ink)]"><Clock3 className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0"><p className="m-0 text-xs text-muted-foreground">Average reply to your agent</p><p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-foreground">{pulse?.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : "—"}</p><p className="mt-1.5 text-xs text-muted-foreground">{pulse?.responses ? `Based on ${pulse.responses} replies` : "No replies recorded yet"}</p></div>
              </div>
              <Link href="/partner/messages" className="flex items-center gap-4 py-5 text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--accent-ink)]"><MessageSquare className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0"><p className="m-0 text-xs text-muted-foreground">Follow-ups waiting</p><p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-foreground">{pulse ? pulse.pendingFollowUps : "—"}</p><p className="mt-1.5 text-xs text-muted-foreground">Conversations needing your team</p></div>
              </Link>
              <div className="flex items-center gap-4 py-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--accent-ink)]"><ShieldX className="size-4" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><p className="m-0 text-xs text-muted-foreground">Stopped by screening</p><p className="mt-1 text-lg font-semibold leading-none tabular-nums text-foreground">{figure(extras?.rejectedCompliance)}</p></div>
              <span className="shrink-0 text-xs text-muted-foreground">Count only</span>
              </div>
            </div>
          </HomePanel> : <HomePanel title="Compliance screening" link={{ label: "View pipeline", href: PIPELINE }} className="min-h-[296px] @4xl:col-span-4" bodyClassName="pt-1">
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--accent-ink)]"><ShieldX className="size-5" aria-hidden="true" /></span>
              <p className="m-0 text-3xl font-semibold leading-none tabular-nums text-foreground">{figure(extras?.rejectedCompliance)}</p>
              <p className="m-0 text-sm font-medium text-foreground">Stopped by screening</p>
              <p className="m-0 max-w-[16rem] text-xs text-muted-foreground">Count only · no personal details shown</p>
            </div>
          </HomePanel>}
        </div>
      </div>

      <section aria-label="Quick actions" className="flex min-w-0 flex-col gap-2">
        <h2 className="m-0 font-[family-name:var(--font-display)] text-sm font-semibold text-foreground">Quick actions</h2>
        <div className="@container">
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @4xl:grid-cols-3">
            <QuickAction href="/partner/messages" icon={<MessageSquare aria-hidden="true" />} title="Messages" detail="Open conversations" />
            {isAdmin && <QuickAction href="/partner/team" icon={<Users aria-hidden="true" />} title="Team" detail={team ? `${team.active} active · ${team.pending} pending` : "Manage members and invites"} />}
            {isAdmin && <QuickAction href="/partner/payouts" icon={<WalletCards aria-hidden="true" />} title="Statements" detail={statementDetail} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function shortPeriod(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const sameMonth = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth();
  const startLabel = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = sameMonth
    ? String(endDate.getDate())
    : endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(startDate.getFullYear() !== endDate.getFullYear() ? { year: "numeric" } : {}) });
  return `${startLabel}–${endLabel}`;
}

function QuickAction({ href, icon, title, detail }: { href: string; icon: ReactNode; title: string; detail: string }) {
  return <Link href={href} className="m-stat-card flex min-w-0 items-center gap-3 rounded-lg border px-3.5 py-3 text-inherit no-underline transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--surface-alt)] text-[var(--accent-ink)]">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span>
    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </Link>;
}
