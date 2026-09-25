"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { productLineLabel } from "@/lib/format/productLine";
import { oldestOpenLabel } from "@/lib/format/age";
import { dayMonth, viewerTimeZone } from "@/lib/format/dates";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { PartnerLeadRow } from "@/lib/partnerLeads/types";

type PipelineSummary = {
  rows: PartnerLeadRow[];
  counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number };
  oldestOpenAt?: string | null;
  total: number;
};
type PartnerUser = { id: string; name: string; role: PartnerRole; status: "active" | "revoked"; accepted_at: string | null };

/** "just now", "2m ago" — how fresh the figures on screen are. */
function freshness(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function formatDate(value: string) {
  return dayMonth(value, viewerTimeZone()); // leads load in an effect, after mount
}

export function PartnerPortalOverview({ role, partnerStatus, partnerName }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string | null }) {
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(null);
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Live · updated just now" is earned: the figures refresh on the same visible-tab poll the
  // pipeline page uses, and the pill says when they last did, or that they stopped.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const usersRequest = role === "partner_admin" ? fetch("/api/partner/users", { cache: "no-store" }) : Promise.resolve(null);
    try {
      const [pipelineResponse, usersResponse] = await Promise.all([
        fetch("/api/partner/leads/pipeline?limit=3&offset=0", { cache: "no-store" }),
        usersRequest,
      ]);
      const nextPipeline = await pipelineResponse.json().catch(() => null);
      const nextUsers = usersResponse ? await usersResponse.json().catch(() => null) : null;
      if (!pipelineResponse.ok || (role === "partner_admin" && !usersResponse?.ok)) throw new Error("load failed");
      setPipeline(nextPipeline as PipelineSummary);
      setUsers(role === "partner_admin" ? (nextUsers?.users ?? []) as PartnerUser[] : []);
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
  }, [role]);

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

  const activeUsers = users.filter((user) => user.status === "active").length;
  const pendingUsers = users.filter((user) => user.status === "active" && !user.accepted_at).length;
  const recentRows = pipeline?.rows ?? [];
  const statCards: Array<{ label: string; value: number; footnote: string }> = [
    { label: "Submitted today", value: pipeline?.counters.submittedToday ?? 0, footnote: "since 00:00 your time" },
    { label: "In progress", value: pipeline?.counters.claimed ?? 0, footnote: "claimed or verifying" },
    { label: "Converted", value: pipeline?.counters.converted ?? 0, footnote: "last 30 days" },
    { label: "Still open", value: pipeline?.counters.stillOpen ?? 0, footnote: oldestOpenLabel(pipeline?.counters.stillOpen ?? 0, pipeline?.oldestOpenAt, now) },
  ];

  return <div className="m-stagger mx-auto w-full max-w-7xl space-y-6">
    <header className="border-b border-[var(--portal-line)] pb-5">
      <PageHeader
        eyebrow="Partner workspace"
        title="Partner operations"
        description="What you submitted, where it got to, and the three things you can do next."
        actions={<Button asChild><a href="/partner/submit-lead"><Send className="mr-1.5 size-4" aria-hidden="true" />Submit a new lead</a></Button>}
      />
      <div className="portal-partner-overview-status">
        <span className={`portal-live-chip ${stale ? "is-stale" : ""}`} role="status">
          <span className={stale || updatedAt === null ? "" : "m-live"} aria-hidden="true" />
          {updatedAt === null ? (stale ? "Updates unavailable" : "Connecting") : stale ? `Updates paused · last ${freshness(updatedAt, now)}` : `Live · updated ${freshness(updatedAt, now)}`}
        </span>
        <span className="portal-partner-overview-scope">Showing data for {partnerName ? <strong>{partnerName}</strong> : "your organization"} only. You can only view and manage leads from your organization.</span>
      </div>
    </header>
    {partnerStatus === "paused" && <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm" role="status"><p className="font-medium">This partner account is paused</p><p className="mt-1">Your existing history remains available, but new lead submissions are disabled until the agent resumes the account.</p></div>}
    {error && <p className="rounded-lg border border-[var(--color-danger)]/40 p-3 text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {statCards.map(({ label, value, footnote }) => <StatTile key={label} label={label} value={value} footnote={footnote} />)}
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <div className="space-y-6">
        <TableCard
          title="Recent submissions"
          description="The latest leads submitted by this partner."
          action={<LinkArrow href="/partner/pipeline">View all</LinkArrow>}
        >
          {loading ? <p className="px-4 pb-4 text-sm text-muted-foreground">Loading submissions…</p> : recentRows.length === 0 ? <div className="px-4 pb-4"><div className="rounded-lg border border-dashed p-5"><p className="font-medium">No submissions yet</p><p className="mt-1 text-sm text-muted-foreground">Start with a lead and its progress will appear here.</p><Button asChild variant="outline" size="sm" className="mt-4"><a href="/partner/submit-lead">Submit a lead</a></Button></div></div> : <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Stage</TableHead><TableHead>Submitted by</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
            <TableBody>
              {recentRows.map((row) => <TableRow key={row.id}>
                <TableCell className="font-medium"><a className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/partner/pipeline">{row.customer}</a></TableCell>
                <TableCell className="text-muted-foreground">{productLineLabel(row.product)}</TableCell>
                <TableCell><StatusChip tone={row.outcome ? "good" : "info"}>{row.stageName}</StatusChip>{row.outcome && row.outcome !== row.stageName && <span className="ml-2 text-xs text-muted-foreground">{row.outcome}</span>}</TableCell>
                <TableCell className="text-muted-foreground">{row.submittedBy.name}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatDate(row.submittedAt)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>}
        </TableCard>
        <div className="portal-partner-quick-actions">
          <a href="/partner/submit-lead" className="portal-partner-quick-action"><strong>Submit leads</strong><p>Complete the agent-approved form and send it screened.</p><span className="portal-partner-quick-action-open">Open<ArrowRight aria-hidden="true" /></span></a>
          <a href="/partner/pipeline" className="portal-partner-quick-action"><strong>Track pipeline</strong><p>Follow every submission through the agent&rsquo;s stages.</p><span className="portal-partner-quick-action-open">Open<ArrowRight aria-hidden="true" /></span></a>
          {role === "partner_admin" ? <a href="/partner/team" className="portal-partner-quick-action"><strong>Manage team</strong><p>Invite teammates and manage their access.</p><span className="portal-partner-quick-action-open">Open<ArrowRight aria-hidden="true" /></span></a> : <div className="portal-partner-quick-action is-disabled" aria-disabled="true"><strong>Manage team</strong><p>Team access is managed by your partner admin.</p></div>}
        </div>
      </div>
      <div className="space-y-6">
        <Card>
          <CardContent className="p-5">
            <h2 className="m-0 text-lg font-semibold text-[var(--ink)]">Team access</h2>
            {role === "partner_admin" ? <>
              <dl className="portal-partner-team-figures">
                <div><dt>Active members</dt><dd>{loading ? "—" : activeUsers}</dd></div>
                <div><dt>Pending invitations</dt><dd>{loading ? "—" : pendingUsers}</dd></div>
              </dl>
              <Button asChild variant="outline" className="mt-4 w-full"><a href="/partner/team">Manage team</a></Button>
            </> : <p className="mt-3 text-sm text-muted-foreground">Team access is managed by your partner admin.</p>}
          </CardContent>
        </Card>
        <div className="portal-partner-info-callout">
          <strong>Need something from your agent?</strong>
          <p>Approved products, form versions and submission caps are set by the agency. Message your agent rather than looking for a setting you do not have.</p>
        </div>
      </div>
    </div>
  </div>;
}
