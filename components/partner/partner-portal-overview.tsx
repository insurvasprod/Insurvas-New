"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkArrow } from "@/components/ui/link-arrow";
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

  return <div className="m-stagger space-y-6">
    <PageHeader
      title="Overview"
      actions={<Button asChild><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit a new lead</a></Button>}
    />
    {partnerStatus === "paused" && <p role="status" className="rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">This partner account is paused — new lead submissions are disabled until the agent resumes it.</p>}
    {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}
    {!error && stale && updatedAt !== null && <p role="status" className="text-xs text-muted-foreground">Updates paused · last updated {freshness(updatedAt, now)}</p>}
    <StatStrip label={`${partnerName ?? "Your organization"} at a glance`}>
      <StatTile label="Submitted today" value={pipeline?.counters.submittedToday ?? 0} footnote="since 00:00 your time" />
      <StatTile label="In progress" value={pipeline?.counters.claimed ?? 0} footnote="claimed or verifying" />
      <StatTile label="Converted" value={pipeline?.counters.converted ?? 0} footnote="last 30 days" />
      <StatTile label="Still open" value={pipeline?.counters.stillOpen ?? 0} footnote={oldestOpenLabel(pipeline?.counters.stillOpen ?? 0, pipeline?.oldestOpenAt, now)} />
      {role === "partner_admin" && <StatTile label="Team" value={loading ? "—" : activeUsers} footnote={loading ? "" : `${pendingUsers} pending invitation${pendingUsers === 1 ? "" : "s"}`} />}
    </StatStrip>
    <TableCard
      title="Recent submissions"
      action={<LinkArrow href="/partner/pipeline">View all</LinkArrow>}
    >
      {loading ? <SectionLoading rows={3} columns={5} /> : recentRows.length === 0 ? <EmptyState title="No submissions yet" hint="Submit a lead and its progress appears here." action={<Button asChild variant="outline" size="sm"><a href="/partner/submit-lead">Submit a lead</a></Button>} /> : <Table>
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
  </div>;
}
