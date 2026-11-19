"use client";

import { useCallback, useEffect, useState } from "react";

import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import type { CampaignGroup } from "@/lib/partnerLeads/campaignsCore";
import { localDay, shiftDay } from "@/lib/partnerLeads/trend";

type Payload = { groups: CampaignGroup[]; byCampaign: boolean; total: number; truncated: boolean };

const n = (value: number) => value.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Roles board P2 · Campaigns: a marketing partner's leads by campaign, with what happened to them —
 * form or call, contacted, converted, lost. Grouped by the campaign a lead stored; a lead sent
 * through the portal stores none, so those are grouped by how they arrived, and the page says so
 * (lib/partnerLeads/campaignsCore.ts). Counts only, partner-scoped on the server.
 */
export function PartnerCampaigns() {
  const [today] = useState(() => localDay(new Date())!);
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const from = period === "month" ? `${today.slice(0, 8)}01` : shiftDay(today, -(Number(period) - 1));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/partner/campaigns?date_from=${from}&date_to=${today}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as (Payload & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.groups)) throw new Error(body?.error ?? "Your campaigns could not be loaded");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your campaigns could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [from, today]);
  useEffect(() => { const kickoff = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(kickoff); }, [load]);

  const groups = data?.groups ?? [];
  const total = groups.reduce((sum, group) => sum + group.leads, 0);
  const form = groups.reduce((sum, group) => sum + group.form, 0);
  const call = groups.reduce((sum, group) => sum + group.call, 0);
  const contacted = groups.reduce((sum, group) => sum + group.contacted, 0);
  const converted = groups.reduce((sum, group) => sum + group.converted, 0);
  const tableLink = `/partner/pipeline?view=table&date_from=${from}&date_to=${today}`;

  return (
    <div className="m-stagger flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description={data && !data.byCampaign ? "Your leads by how they arrived: no campaign is stored on leads sent through the portal form, so they are grouped by source." : "Your leads by campaign, and what happened to each."}
        hideTitle
        breadcrumbs={[{ label: "Leads" }, { label: "Campaigns" }]}
        actions={<SelectMenu label="Period" value={period} onChange={setPeriod} className="w-40" panelAlign="end" options={[{ value: "month", label: "This month" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 12 months" }]} />}
      />
      <StatStrip label="Campaign figures">
        <StatTile label="Leads" value={data ? n(total) : "—"} href={tableLink} footnote={data?.truncated ? "first 5,000 only" : undefined} reserveFootnote />
        <StatTile label="Form / call" value={data ? `${n(form)} / ${n(call)}` : "—"} footnote="by entry stage" reserveFootnote />
        <StatTile label="Contacted" value={data ? pct(contacted, total) : "—"} href={tableLink} footnote={data ? `${n(contacted)} taken by the agency` : undefined} reserveFootnote />
        <StatTile label="Converted" value={data ? n(converted) : "—"} href="/partner/pipeline?lane=converted" footnote={data ? `${pct(converted, total)} of leads` : undefined} reserveFootnote />
      </StatStrip>
      <TableCard className="flex min-h-[18rem] flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col" toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} labelClassName="sr-only" className="px-2.5" />}><span className="text-sm text-muted-foreground">{data ? `${n(groups.length)} ${data.byCampaign ? "campaigns and sources" : "sources"}` : ""}</span></DataToolbar>}>
        {error ? <div className="flex min-h-48 flex-1 items-center justify-center"><EmptyState title="Not available" hint={error} /></div> : data === null ? <SectionLoading rows={4} columns={6} /> : !groups.length ? (
          <div className="flex min-h-48 flex-1 items-center justify-center"><EmptyState title="No leads in this period" hint="Leads you send appear here, by campaign where one is stored." /></div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Form / call</TableHead><TableHead className="text-right">Contacted</TableHead><TableHead className="text-right">Converted</TableHead><TableHead className="text-right">Conv. rate</TableHead></TableRow></TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.key}>
                  <TableCell className="max-w-[320px]"><span className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold text-foreground">{group.label}</span>{!group.stored && <StatusChip tone="neutral">Source</StatusChip>}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{n(group.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(group.form)} / {n(group.call)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(group.contacted, group.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(group.converted)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(group.converted, group.leads)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
