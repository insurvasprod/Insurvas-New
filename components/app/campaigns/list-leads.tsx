"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { LeadsInSlot } from "@/components/app/lead-sources/leads-in-slot";
import { NextUp } from "@/components/app/lead-sources/next-up";
import { shortDay } from "@/components/app/campaigns/campaign-lists";

type View = "all" | "not_called" | "problems";
type Lead = { id: string; name: string; phone: string | null; state: string | null; leadState: string | null; attempts: number; agentId: string | null; agentName: string | null };
type Payload = {
  list: { id: string; fileName: string; importedAt: string | null; rows: number | null; costCents: number | null };
  counts: Record<View, number>;
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
};

const VIEWS: Array<{ key: View; label: string }> = [{ key: "all", label: "All" }, { key: "not_called", label: "Not called" }, { key: "problems", label: "Problems" }];
const n = (value: number) => value.toLocaleString("en-US");

function phone(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value ?? "—";
}

/** Where a lead stands, in one chip. */
function leadStatus(lead: Lead): ReactNode {
  if (!lead.state) return <StatusChip tone="warning">No state</StatusChip>;
  switch (lead.leadState) {
    case "fresh": return lead.attempts > 0 ? <StatusChip tone="info">Called {lead.attempts}×</StatusChip> : <StatusChip tone="neutral">Not called</StatusChip>;
    case "working":
    case "retry": return <StatusChip tone="info">Called {lead.attempts}×</StatusChip>;
    case "exhausted": return <StatusChip tone="neutral">Used up</StatusChip>;
    case "nurture": return <StatusChip tone="neutral">In nurture</StatusChip>;
    case "closed": return <StatusChip tone="neutral">Closed</StatusChip>;
    default: return <StatusChip tone="neutral">{lead.attempts > 0 ? `Called ${lead.attempts}×` : "Not called"}</StatusChip>;
  }
}

/**
 * Source › a campaign › a list (board LirF2): the leads themselves. "Problems" filters to the ones that
 * need a fix, and each Fix opens the exact place (Clean › Missing data for a missing state). Back goes
 * one level up, to the campaign, never to a step.
 */
export function ListLeads({ campaignId, listId, campaignName, perUsable, assign }: {
  campaignId: string;
  listId: string;
  campaignName: string;
  /** The campaign's cost per usable lead, formatted; null when unknown or not shown to this person. */
  perUsable: string | null;
  /** The campaign's assign action (the pool drawer), or null when this person cannot assign. */
  assign: ReactNode;
}) {
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view, page: String(page), ...(query ? { q: query } : {}) });
    fetch(`/api/app/campaigns/${campaignId}/lists/${listId}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (Payload & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? "Could not load this list");
        setData(body);
        setError(null);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this list"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [campaignId, listId, view, page, query, attempt]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setLoading(true); setQuery(value.trim()); setPage(0); }, 300);
  };
  const pick = (next: View) => { setLoading(true); setView(next); setPage(0); };

  const list = data?.list;
  const sub = list ? [shortDay(list.importedAt), list.rows !== null ? `${n(list.rows)} rows` : null, perUsable ? `${perUsable} per usable` : null].filter(Boolean).join(" · ") : "";
  const fix = `/app/duplicates?tab=missing&missing=state&campaign=${campaignId}`;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
      <LeadsInSlot slot="lead">
        {/* Owner 2026-10-30: a real button back to the campaign, like "All campaigns" on the campaign page. */}
        <Button asChild variant="outline" className="max-w-[18rem]">
          <Link href={`/app/campaigns/${campaignId}`} data-leads-crumb={campaignName} data-leads-href={`/app/campaigns/${campaignId}`} title={`Back to ${campaignName}`}>
            <ArrowLeft aria-hidden="true" /><span className="truncate">{campaignName}</span>
          </Link>
        </Button>
        {list && <span data-leads-crumb={list.fileName} className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">{list.fileName}</span>}
        {/* Board LirF2: the list's one health word beside its name. */}
        {data && (data.counts.all === 0 ? <StatusChip tone="neutral">Empty</StatusChip>
          : data.counts.problems > 0 ? <StatusChip tone="warning">{n(data.counts.problems)} with no state</StatusChip>
          : data.counts.not_called === data.counts.all ? <StatusChip tone="info">Not called yet</StatusChip>
          : data.counts.not_called > 0 ? <StatusChip tone="good">Working</StatusChip>
          : <StatusChip tone="neutral">All called</StatusChip>)}
        {sub && <span className="text-sm text-[var(--ink)]">{sub}</span>}
      </LeadsInSlot>
      {/* One next-up line (critique 2026-10-30): a fix first, then what is still uncalled, else all clear. */}
      {data && (data.counts.problems > 0
        ? <NextUp tone="warning" action={<Button asChild><Link href={fix}>Fill in states</Link></Button>}><strong>{n(data.counts.problems)}</strong> {data.counts.problems === 1 ? "lead here has" : "leads here have"} no state, so {data.counts.problems === 1 ? "it can't" : "they can't"} be called yet.</NextUp>
        : data.counts.not_called > 0
          ? <NextUp tone="action" action={assign}><strong>{n(data.counts.not_called)}</strong> {data.counts.not_called === 1 ? "lead here hasn't" : "leads here haven't"} been called yet.{assign ? " Assigning hands out the campaign's waiting leads, this list's among them." : ""}</NextUp>
          : <NextUp tone="done">Every lead in this list has been called at least once.</NextUp>)}

      <TableCard
        toolbar={
          <DataToolbar actions={<Button asChild variant="outline" size="sm"><a href={`/api/app/campaigns/${campaignId}/lists/${listId}?format=csv&view=${view}${query ? `&q=${encodeURIComponent(query)}` : ""}`} download>Export</a></Button>}>
            <ToolbarSearch value={search} onChange={onSearch} placeholder="Search this list" className="sm:w-56" />
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-1.5">
              {VIEWS.map((item) => (
                <ToggleChip key={item.key} role="radio" selected={view === item.key} onClick={() => pick(item.key)} count={data ? n(data.counts[item.key]) : "…"}>
                  {item.label}
                </ToggleChip>
              ))}
            </div>
          </DataToolbar>
        }
        footer={data && data.total > data.pageSize ? <Pager page={data.page + 1} total={data.total} noun="leads" pageSize={data.pageSize} onPage={(next) => { setLoading(true); setPage(next - 1); }} /> : undefined}
      >
        {error ? <ErrorState title="This list did not load" detail={error} action={<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>} />
          : !data ? <div className="h-40 animate-pulse" aria-label="Loading leads" />
          : data.leads.length === 0 ? <EmptyState title={view === "problems" ? "No problems in this list" : "No leads here"} hint={query ? "Nothing matches that search." : view === "problems" ? "Every lead here can be called." : "This list has no leads."} />
          : <Table aria-busy={loading}>
            <TableHeader><TableRow>
              <TableHead className="w-[26%]">Lead</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead><span className="sr-only">Fix</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell><Link href={`/app/leads/${lead.id}`} className="font-semibold text-[var(--ink)] hover:underline">{lead.name}</Link></TableCell>
                  <TableCell className="tabular-nums">{phone(lead.phone)}</TableCell>
                  <TableCell>{lead.state ?? "—"}</TableCell>
                  <TableCell>{leadStatus(lead)}</TableCell>
                  <TableCell>{lead.agentName ?? "—"}</TableCell>
                  <TableCell className="text-right">{!lead.state && <Link href={fix} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">Fix →</Link>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>}
      </TableCard>
    </div>
  );
}
