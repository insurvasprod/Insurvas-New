"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Download, Handshake, Hourglass, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { PremiumBar } from "@/components/ui/premium-bar";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import { when } from "@/components/partner/lead-format";
import { formatCentsAsCurrency } from "@/lib/money";
import { productLineLabel } from "@/lib/format/productLine";
import { dayLabel } from "@/lib/partnerDealFlow/localDay";
import { DEAL_FLOW_STAGE_TYPES, STAGE_TYPE_LABEL, type DealFlowStageType, type PartnerDealFlowPayload } from "@/lib/partnerDealFlow/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { cn } from "@/lib/utils";

/**
 * Daily deal flow — what the agency did with this partner's leads.
 *
 * **The same page as the agent app's `/app/deal-flow`** (owner, 1 Nov: "exactly the same design"):
 * the same header row, the same four figures with the same icons and Show actions, the same
 * toolbar of search, from/to and Today, the same inline filter panel, the same 40px/44px table and
 * premium bar, the same pager. `components/app/deal-flow-workspace.tsx` is the reference; change
 * one and look at the other.
 *
 * Two things are deliberately *not* the same, and both are the owner's own earlier decisions:
 *
 * - **It is read-only.** No edit dialog, no "Add deal update", no detail panel — the agency
 *   records what happened to a lead and the partner reads it. The API has no write route to reach.
 * - **It shows none of the agency's own columns.** No campaign, vendor, owner or notes: who at the
 *   agency worked a lead, and where the agency bought it, is not the partner's business
 *   (`PARTNER_DEAL_FLOW_COLUMNS`). Those columns are replaced by the ones a partner has instead —
 *   carrier, product and, for an admin, which of their people submitted it.
 *
 * The dropdowns are the agent's native `<select>` (owner, 1 Nov). That makes this the one page in
 * the portal with one — the 29 Oct rule that every partner dropdown is a `SelectMenu` was set
 * before this page existed, and "exactly the same design" wins here. Keep the two files the same.
 */

/** Sample data in place of the API, for `/design/deal-flow` (development only). */
export type DealFlowPreview = { data: PartnerDealFlowPayload | null; error?: string };

type Filters = { stage_type: string; product: string; submitted_by: string };
const EMPTY_FILTERS: Filters = { stage_type: "", product: "", submitted_by: "" };

const STAGE_TONE: Record<DealFlowStageType, StatusTone> = { open: "action", won: "good", lost: "neutral" };

function dateOnly(value: string | null) {
  return value ? dayLabel(value) : "—";
}

/** The agent page's banner, for the one case a partner can reach: a refresh that failed. */
function Alert({ tone, children }: { tone: "info" | "warning" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]",
    warning: "border-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
    error: "border-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]",
  } as const;
  return <div role="status" className={cn("rounded-md border px-4 py-2.5 text-sm", tones[tone])}>{children}</div>;
}

export function PartnerDealFlow({
  role,
  initialFrom,
  initialTo,
  today,
  preview,
  initialFiltersOpen = false,
}: {
  role: PartnerRole;
  initialFrom: string;
  initialTo: string;
  /** Today where the partner is: the default range, and the ceiling on the date inputs. */
  today: string;
  preview?: DealFlowPreview;
  /** `/design/deal-flow?filters=open` — so the panel can be reviewed without clicking into it. */
  initialFiltersOpen?: boolean;
}) {
  const isAdmin = role === "partner_admin";
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(initialFiltersOpen);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PartnerDealFlowPayload | null>(preview ? preview.data : null);
  const [error, setError] = useState<string | null>(preview?.error ?? null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(!preview);

  const query = new URLSearchParams({ from: range.from, to: range.to });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  if (search.trim()) query.set("search", search.trim());
  const queryString = query.toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/partner/deal-flow?${queryString}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the daily deal flow");
      setData(body as PartnerDealFlowPayload);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the daily deal flow");
    } finally {
      setLoading(false);
      setFirstLoad(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (preview) return;
    // Deferred by a tick, as the agent page does: a fetch started straight from an effect body
    // sets state inside it (react-hooks/set-state-in-effect).
    const kickoff = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(kickoff);
  }, [load, preview]);

  const rows = data?.rows ?? [];
  const pageSize = 10;
  const tablePage = paginate(rows, page, pageSize);
  const figures = data?.figures;
  const counts = data?.stageCounts;
  const ceiling = data?.today ?? today;
  const isToday = range.from === ceiling && range.to === ceiling;
  const premiumMax = Math.max(0, ...rows.map((row) => (row.monthlyPremiumCents ?? 0) * 12));

  const setDate = (key: "from" | "to", value: string) => { setRange((current) => ({ ...current, [key]: value || ceiling })); setPage(1); };
  const resetToToday = () => { setRange({ from: ceiling, to: ceiling }); setPage(1); };
  const applyFilter = (patch: Partial<Filters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch(""); setPage(1); };
  const extraFilters = Object.values(filters).filter(Boolean).length;
  const hasNarrowing = extraFilters > 0 || Boolean(search.trim());

  const periodText = isToday
    ? "today"
    : range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  const oldest = figures?.oldestInProgressDays ?? null;

  const chips: ActiveFilter[] = [
    filters.stage_type && { key: "status", label: "Status", value: STAGE_TYPE_LABEL[filters.stage_type as DealFlowStageType] ?? filters.stage_type, onRemove: () => applyFilter({ stage_type: "" }) },
    filters.product && { key: "product", label: "Product", value: productLineLabel(filters.product), onRemove: () => applyFilter({ product: "" }) },
    filters.submitted_by && { key: "submitted", label: "Submitted by", value: data?.facets.submitters.find((item) => item.id === filters.submitted_by)?.name ?? "Someone", onRemove: () => applyFilter({ submitted_by: "" }) },
  ].filter(Boolean) as ActiveFilter[];

  if (firstLoad) return <PageLoading />;

  const columns = isAdmin ? 8 : 7;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* The agent page's header row: the title on the left, the page's actions on the right. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Daily deal flow" description="What the agency did with the leads you sent. The agency's published statement is what is actually paid." />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={`/api/partner/deal-flow?${queryString}&format=csv`} aria-label="Export the deals in this range as CSV">
              <Download aria-hidden="true" />
              Export
            </a>
          </Button>
        </div>
      </div>

      {data?.capped && <Alert tone="warning">Narrow the range to see every deal — showing the first 5,000.</Alert>}
      {error && data && (
        <Alert tone="error">
          The latest refresh failed: {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load()}>Try again</button>
        </Alert>
      )}

      {/* §4a: the four figures once, as the agent draws them. Each card's footer narrows the list
          to its deals; In progress turns amber when a deal is days old. */}
      <StatRow label="Deal flow summary">
        <StatCard icon={Handshake} label="Deals worked" period={periodText} value={figures ? figures.worked : "—"}
          fact={{ label: isAdmin ? "Across your team" : "Submitted by you" }} />
        <StatCard icon={BadgeCheck} label="Won" period={periodText} value={figures ? figures.won : "—"}
          fact={{ label: "Annualised", value: figures ? `${formatCentsAsCurrency(figures.wonAnnualisedCents)}${figures.wonUnpriced > 0 ? ` · ${figures.wonUnpriced} unpriced` : ""}` : "—" }}
          action={figures && figures.won > 0 && filters.stage_type !== "won" ? <button type="button" className="hover:underline" onClick={() => applyFilter({ stage_type: "won" })}>Show</button> : undefined} />
        <StatCard icon={Hourglass} label="In progress" period={periodText} value={figures ? figures.inProgress : "—"} tone={oldest != null && oldest >= 2 ? "warn" : "default"}
          fact={{ label: "Oldest", value: !figures || figures.inProgress === 0 ? "none open" : oldest == null ? "not recorded" : oldest < 1 ? "under a day" : `${oldest} ${oldest === 1 ? "day" : "days"}` }}
          action={figures && figures.inProgress > 0 && filters.stage_type !== "open" ? <button type="button" className="hover:underline" onClick={() => applyFilter({ stage_type: "open" })}>Show</button> : undefined} />
        <StatCard icon={XCircle} label="Lost" period={periodText} value={figures ? figures.lost : "—"}
          fact={{ label: "Of deals worked", value: figures && figures.worked ? `${Math.round((figures.lost / figures.worked) * 100)}%` : "—" }}
          action={figures && figures.lost > 0 && filters.stage_type !== "lost" ? <button type="button" className="hover:underline" onClick={() => applyFilter({ stage_type: "lost" })}>Show</button> : undefined} />
      </StatRow>

      <TableCard
        className="relative z-20 flex min-h-[calc(100dvh-var(--top-bar-h)-392px)] min-w-0 flex-1 flex-col [&>.overflow-x-auto]:flex-1"
        toolbar={
          // §6a: search, the day range (the page's scope), one Filters button; the facets open
          // inline under the toolbar and show as chips while closed.
          <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Customer, carrier, outcome…" label="Search deals" />
            <input type="date" aria-label="From" className={toolbarControl} value={range.from} max={range.to || ceiling} onChange={(event) => setDate("from", event.target.value)} />
            <input type="date" aria-label="To" className={toolbarControl} value={range.to} min={range.from || undefined} max={ceiling} onChange={(event) => setDate("to", event.target.value)} />
            {!isToday && <Button type="button" variant="outline" onClick={resetToToday} aria-label="Show today’s deals">Today</Button>}
            <FilterButton open={showFilters} onClick={() => setShowFilters((value) => !value)} count={extraFilters} controls="partner-deal-flow-filters" />
          </DataToolbar>
        }
        filters={<>
          <FilterPanel id="partner-deal-flow-filters" open={showFilters}>
            <FilterField label="Status" htmlFor="partner-deal-status">
              <select id="partner-deal-status" aria-label="Filter by status" className={cn(toolbarControl, "w-full min-w-0")} value={filters.stage_type} onChange={(event) => applyFilter({ stage_type: event.target.value })}>
                <option value="">All statuses</option>
                {DEAL_FLOW_STAGE_TYPES.map((type) => (
                  <option key={type} value={type}>{counts ? `${STAGE_TYPE_LABEL[type]} · ${counts[type]}` : STAGE_TYPE_LABEL[type]}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Product" htmlFor="partner-deal-product">
              <select id="partner-deal-product" aria-label="Filter by product" className={cn(toolbarControl, "w-full min-w-0")} value={filters.product} onChange={(event) => applyFilter({ product: event.target.value })}>
                <option value="">All products</option>
                {(data?.facets.products ?? []).map((item) => <option key={item} value={item}>{productLineLabel(item)}</option>)}
              </select>
            </FilterField>
            {isAdmin && (
              <FilterField label="Submitted by" htmlFor="partner-deal-submitter">
                <select id="partner-deal-submitter" aria-label="Filter by who submitted the lead" className={cn(toolbarControl, "w-full min-w-0")} value={filters.submitted_by} onChange={(event) => applyFilter({ submitted_by: event.target.value })}>
                  <option value="">Anyone</option>
                  {(data?.facets.submitters ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </FilterField>
            )}
          </FilterPanel>
          <ActiveFilters filters={chips} onClear={clearFilters} />
        </>}
        footer={data && rows.length ? <Pager page={tablePage.current} total={rows.length} pageSize={pageSize} noun={rows.length === 1 ? "deal" : "deals"} onPage={setPage} disabled={loading} /> : undefined}
      >
        {!data
          ? (error
            ? <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
            : <SectionLoading rows={6} columns={columns} label="Loading deals" />)
          : loading
            ? <SectionLoading rows={6} columns={columns} label="Loading deals" />
            : (
              <table className={cn(st.table, isAdmin ? "min-w-[1000px]" : "min-w-[880px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[210px]")}>Customer</th>
                    <th scope="col" className={cn(st.th, "w-[140px]")}>Product</th>
                    <th scope="col" className={cn(st.th, "w-[170px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Carrier</th>
                    <th scope="col" className={cn(st.th, "w-[180px]")}>Annualised premium</th>
                    <th scope="col" className={cn(st.th, "w-[110px]")}>Draft date</th>
                    {isAdmin && <th scope="col" className={cn(st.th, "w-[130px]")}>Submitted by</th>}
                    <th scope="col" className={cn(st.th, "w-[120px] text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {tablePage.rows.map((row) => (
                    <tr key={row.leadId} data-lead-id={row.leadId} className="m-row hover:bg-[var(--surface-alt)]">
                      <td className={cn(st.td, "max-w-[220px]")}>
                        <span className="block max-w-full truncate" title={row.customer}>{row.customer}</span>
                        <span className={st.sub}>{when(row.updatedAt)}</span>
                      </td>
                      <td className={st.td}>{productLineLabel(row.productLine)}</td>
                      <td className={st.td}><StatusChip tone={STAGE_TONE[row.stageType]} dot>{row.stageName}</StatusChip></td>
                      <td className={cn(st.td, "max-w-[150px] truncate")} title={row.carrier ?? undefined}>{row.carrier ?? "—"}</td>
                      <td className={st.td}><PremiumBar monthlyCents={row.monthlyPremiumCents} max={premiumMax} /></td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{dateOnly(row.draftDate)}</td>
                      {isAdmin && <td className={cn(st.td, "whitespace-nowrap")}>{row.submittedBy.name}</td>}
                      <td className={cn(st.td, "text-right")}>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/partner/pipeline/${row.leadId}`}>Open lead</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns} className={st.td}>
                        {hasNarrowing ? (
                          <NoMatches noun="deals" onClear={clearFilters} by={search.trim() ? "search" : "filters"} />
                        ) : (
                          <EmptyState
                            title={isToday ? "No deals worked yet today" : "No deals worked in this range"}
                            hint={isAdmin
                              ? "Leads your team sends appear here once the agency works them."
                              : "Leads you send appear here once the agency works them."}
                            action={<Button asChild variant="outline"><Link href="/partner/submit-lead">Submit a lead</Link></Button>}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
      </TableCard>
    </div>
  );
}
