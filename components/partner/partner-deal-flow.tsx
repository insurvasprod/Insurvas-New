"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Handshake, Hourglass, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { PremiumBar } from "@/components/ui/premium-bar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { shiftDay, spanDays } from "@/lib/partnerLeads/trend";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { SelectMenu } from "@/components/ui/select-menu";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";
import { productLineLabel } from "@/lib/format/productLine";
import { dayLabel } from "@/lib/partnerDealFlow/localDay";
import { NO_CARRIER_FILTER } from "@/lib/partnerDealFlow/filters";
import { DEAL_FLOW_STAGE_TYPES, STAGE_TYPE_LABEL, type DealFlowStageType, type PartnerDealFlowPayload } from "@/lib/partnerDealFlow/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { cn } from "@/lib/utils";

/**
 * Daily deal flow — what the agency did with this partner's leads.
 *
 * **The same page as the agent app's `/app/deal-flow`** (owner, 1 Nov: "exactly the same design"):
 * the same header row, the same four figures with the same icons and Show actions, the same
 * header date range and toolbar search, the same inline filter panel, the same 40px/44px table and
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
 * Partner filters use the same searchable SelectMenu as the rest of the portal, inside the shared
 * inline filter panel.
 */

/** Sample data in place of the API, for `/design/deal-flow` (development only). */
export type DealFlowPreview = { data: PartnerDealFlowPayload | null; error?: string };

type Filters = {
  stage_type: string;
  product: string;
  submitted_by: string;
  customer: string;
  carrier: string;
  annualised_premium_min: string;
  annualised_premium_max: string;
  draft_date_from: string;
  draft_date_to: string;
};
const EMPTY_FILTERS: Filters = { stage_type: "", product: "", submitted_by: "", customer: "", carrier: "", annualised_premium_min: "", annualised_premium_max: "", draft_date_from: "", draft_date_to: "" };

function currencyFilterLabel(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatCentsAsCurrency(Math.round(numeric * 100)) : "invalid amount";
}

function currencyFilterCents(value: string) {
  const numeric = Number(value);
  const cents = Math.round(numeric * 100);
  return Number.isFinite(numeric) && Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

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
  const [customPeriod, setCustomPeriod] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PartnerDealFlowPayload | null>(preview ? preview.data : null);
  const [error, setError] = useState<string | null>(preview?.error ?? null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(!preview);

  const query = new URLSearchParams({ from: range.from, to: range.to });
  for (const key of ["stage_type", "product", "submitted_by", "customer", "carrier"] as const) if (filters[key]) query.set(key, filters[key]);
  if (filters.annualised_premium_min && currencyFilterCents(filters.annualised_premium_min) !== null) query.set("annualised_premium_min", String(currencyFilterCents(filters.annualised_premium_min)));
  if (filters.annualised_premium_max && currencyFilterCents(filters.annualised_premium_max) !== null) query.set("annualised_premium_max", String(currencyFilterCents(filters.annualised_premium_max)));
  if (filters.draft_date_from) query.set("draft_date_from", filters.draft_date_from);
  if (filters.draft_date_to) query.set("draft_date_to", filters.draft_date_to);
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
  // The pager takes as many rows as the window has room for, as on Commission statements.
  const pageSize = useFittingPageSize(420, 45);
  const tablePage = paginate(rows, page, pageSize);
  const figures = data?.figures;
  const counts = data?.stageCounts;
  const ceiling = data?.today ?? today;
  const isToday = range.from === ceiling && range.to === ceiling;
  const premiumMax = Math.max(0, ...rows.map((row) => (row.monthlyPremiumCents ?? 0) * 12));

  const setDate = (key: "from" | "to", value: string) => { setRange((current) => ({ ...current, [key]: value || ceiling })); setPage(1); };
  const applyFilter = (patch: Partial<Filters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch(""); setRange({ from: ceiling, to: ceiling }); setPage(1); };
  const premiumNarrowing = Boolean(filters.annualised_premium_min || filters.annualised_premium_max);
  const draftDateNarrowing = Boolean(filters.draft_date_from || filters.draft_date_to);
  const premiumRangeInvalid = Boolean(
    (filters.annualised_premium_min && currencyFilterCents(filters.annualised_premium_min) === null)
    || (filters.annualised_premium_max && currencyFilterCents(filters.annualised_premium_max) === null)
    || (filters.annualised_premium_min && filters.annualised_premium_max && Number(filters.annualised_premium_min) > Number(filters.annualised_premium_max)),
  );
  const draftDateRangeInvalid = Boolean(filters.draft_date_from && filters.draft_date_to && filters.draft_date_from > filters.draft_date_to);
  const extraFilters = [filters.stage_type, filters.product, filters.submitted_by, filters.customer, filters.carrier, premiumNarrowing, draftDateNarrowing].filter(Boolean).length;
  const hasNarrowing = extraFilters > 0 || Boolean(search.trim()) || !isToday;

  const periodText = isToday
    ? "today"
    : range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  const oldest = figures?.oldestInProgressDays ?? null;

  const chips: ActiveFilter[] = [
    filters.stage_type && { key: "status", label: "Status", value: STAGE_TYPE_LABEL[filters.stage_type as DealFlowStageType] ?? filters.stage_type, onRemove: () => applyFilter({ stage_type: "" }) },
    filters.product && { key: "product", label: "Product", value: productLineLabel(filters.product), onRemove: () => applyFilter({ product: "" }) },
    filters.customer && { key: "customer", label: "Customer", value: filters.customer, onRemove: () => applyFilter({ customer: "" }) },
    filters.carrier && { key: "carrier", label: "Carrier", value: filters.carrier === NO_CARRIER_FILTER ? "No carrier" : filters.carrier, onRemove: () => applyFilter({ carrier: "" }) },
    premiumNarrowing && { key: "premium", label: "Annualised premium", value: filters.annualised_premium_min && filters.annualised_premium_max ? `${currencyFilterLabel(filters.annualised_premium_min)} – ${currencyFilterLabel(filters.annualised_premium_max)}` : filters.annualised_premium_min ? `At least ${currencyFilterLabel(filters.annualised_premium_min)}` : `Up to ${currencyFilterLabel(filters.annualised_premium_max)}`, onRemove: () => applyFilter({ annualised_premium_min: "", annualised_premium_max: "" }) },
    draftDateNarrowing && { key: "draft-date", label: "Draft date", value: `${filters.draft_date_from ? dayLabel(filters.draft_date_from) : "any date"} – ${filters.draft_date_to ? dayLabel(filters.draft_date_to) : "any date"}`, onRemove: () => applyFilter({ draft_date_from: "", draft_date_to: "" }) },
    filters.submitted_by && { key: "submitted", label: "Submitted by", value: data?.facets.submitters.find((item) => item.id === filters.submitted_by)?.name ?? "Someone", onRemove: () => applyFilter({ submitted_by: "" }) },
  ].filter(Boolean) as ActiveFilter[];

  if (firstLoad) return <PageLoading />;

  const columns = isAdmin ? 7 : 6;

  // The period: a few quick ranges, or two dates. The default is today, where the partner is.
  const presets = [
    { key: "today", label: "Today", from: ceiling, to: ceiling },
    { key: "yesterday", label: "Yesterday", from: shiftDay(ceiling, -1), to: shiftDay(ceiling, -1) },
    { key: "7", label: "Last 7 days", from: shiftDay(ceiling, -6), to: ceiling },
    { key: "30", label: "Last 30 days", from: shiftDay(ceiling, -29), to: ceiling },
  ];
  const activePreset = presets.find((preset) => preset.from === range.from && preset.to === range.to)?.key;
  const customRange = customPeriod || !activePreset;
  function choosePeriod(key: string) {
    if (key === "custom") { setCustomPeriod(true); return; }
    const preset = presets.find((item) => item.key === key);
    if (!preset) return;
    setCustomPeriod(false);
    setRange({ from: preset.from, to: preset.to });
    setPage(1);
  }

  // The small line in each tile: deals per day through the period, when the period is more than a day.
  const rangeDays = spanDays(range.from, range.to);
  const dayList = rangeDays > 1 && rangeDays <= 92 ? Array.from({ length: rangeDays }, (_, index) => shiftDay(range.from, index)) : [];
  const perDay = (match: (row: (typeof rows)[number]) => boolean) => (dayList.length ? dayList.map((day) => rows.filter((row) => row.day === day && match(row)).length) : undefined);

  return (
    <div className="m-stagger flex min-h-[calc(100dvh_-_7rem)] w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Daily Deal Flow"
        description="What the agency did with the leads you sent. Published statements show what is paid."
        hideTitle
        breadcrumbs={[{ label: "Leads" }, { label: "Daily Deal Flow" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2" aria-label="Deals worked date range">
            <SelectMenu
              label="Period"
              value={customRange ? "custom" : activePreset!}
              onChange={choosePeriod}
              className="w-40"
              panelClassName="w-48"
              panelAlign="end"
              options={[...presets.map((preset) => ({ value: preset.key, label: preset.label })), { value: "custom", label: "Custom range" }]}
            />
            {customRange && <>
              <input type="date" aria-label="Worked from" className={toolbarControl} value={range.from} max={range.to || ceiling} onChange={(event) => setDate("from", event.target.value)} />
              <span className="text-xs text-muted-foreground" aria-hidden="true">to</span>
              <input type="date" aria-label="Worked to" className={toolbarControl} value={range.to} min={range.from || undefined} max={ceiling} onChange={(event) => setDate("to", event.target.value)} />
            </>}
          </div>
        }
      />

      {data?.capped && <Alert tone="warning">Narrow the range to see every deal — showing the first 5,000.</Alert>}
      {error && data && (
        <Alert tone="error">
          The latest refresh failed: {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load()}>Try again</button>
        </Alert>
      )}

      <KpiRow label="Deal flow summary">
        <KpiTile
          icon={Handshake}
          label="Deals worked"
          value={figures ? figures.worked : "—"}
          series={perDay(() => true)}
          note={figures ? `${isAdmin ? "Across your team" : "Submitted by you"} · ${periodText}` : undefined}
        />
        <KpiTile
          icon={BadgeCheck}
          label="Won"
          value={figures ? figures.won : "—"}
          series={perDay((row) => row.stageType === "won")}
          note={figures ? `${formatCentsAsCurrency(figures.wonAnnualisedCents)} annualised${figures.wonUnpriced > 0 ? ` · ${figures.wonUnpriced} unpriced` : ""}` : undefined}
        />
        <KpiTile
          icon={Hourglass}
          label="In progress"
          value={figures ? figures.inProgress : "—"}
          tone={oldest != null && oldest >= 2 ? "warn" : "default"}
          series={perDay((row) => row.stageType === "open")}
          note={figures ? (figures.inProgress === 0 ? "None open" : oldest == null ? "Age not recorded" : `Oldest ${oldest < 1 ? "under a day" : `${oldest} ${oldest === 1 ? "day" : "days"}`}`) : undefined}
        />
        <KpiTile
          icon={XCircle}
          label="Lost"
          value={figures ? figures.lost : "—"}
          series={perDay((row) => row.stageType === "lost")}
          note={figures ? (figures.worked ? `${Math.round((figures.lost / figures.worked) * 100)}% of deals worked` : "No deals worked") : undefined}
        />
      </KpiRow>

      <TableCard
        className="relative z-20 flex min-h-[24rem] min-w-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        toolbar={
          <DataToolbar actions={
            <>
              <FilterButton iconOnly open={showFilters} onClick={() => setShowFilters((value) => !value)} count={extraFilters} controls="partner-deal-flow-filters" />
              <RefreshButton onClick={() => void load()} refreshing={loading} labelClassName="sr-only" className="px-2.5" />
            </>
          }>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search deals" label="Search deals by customer, carrier or outcome" />
          </DataToolbar>
        }
        filters={<>
          <FilterPanel id="partner-deal-flow-filters" open={showFilters} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Customer" htmlFor="partner-deal-customer">
              <input id="partner-deal-customer" type="search" className={cn(toolbarControl, "w-full")} value={filters.customer} onChange={(event) => applyFilter({ customer: event.target.value })} placeholder="Any customer" />
            </FilterField>
            <FilterField label="Status" htmlFor="partner-deal-status">
              <SelectMenu
                id="partner-deal-status"
                label="Filter by status"
                value={filters.stage_type}
                defaultValue=""
                onChange={(value) => applyFilter({ stage_type: value })}
                searchPlaceholder="Search statuses"
                className="w-full"
                matchTriggerWidth
                options={[
                  { value: "", label: "All statuses" },
                  ...DEAL_FLOW_STAGE_TYPES.map((type) => ({
                    value: type,
                    label: STAGE_TYPE_LABEL[type],
                    count: counts?.[type],
                  })),
                ]}
              />
            </FilterField>
            <FilterField label="Product" htmlFor="partner-deal-product">
              <SelectMenu
                id="partner-deal-product"
                label="Filter by product"
                value={filters.product}
                defaultValue=""
                onChange={(value) => applyFilter({ product: value })}
                searchPlaceholder="Search products"
                className="w-full"
                matchTriggerWidth
                options={[
                  { value: "", label: "All products" },
                  ...(data?.facets.products ?? []).map((item) => ({ value: item, label: productLineLabel(item) })),
                ]}
              />
            </FilterField>
            <FilterField label="Carrier" htmlFor="partner-deal-carrier">
              <SelectMenu
                id="partner-deal-carrier"
                label="Filter by carrier"
                value={filters.carrier}
                defaultValue=""
                onChange={(value) => applyFilter({ carrier: value })}
                searchPlaceholder="Search carriers"
                className="w-full"
                matchTriggerWidth
                options={[
                  { value: "", label: "All carriers" },
                  ...(data?.facets.carriers ?? []).map((carrier) => ({ value: carrier ?? NO_CARRIER_FILTER, label: carrier ?? "No carrier" })),
                ]}
              />
            </FilterField>
            <FilterField label="Annualised premium" htmlFor="partner-deal-premium-min">
              <div className="grid grid-cols-2 gap-2">
                <input id="partner-deal-premium-min" type="number" min="0" step="0.01" inputMode="decimal" aria-label="Minimum annualised premium in dollars" className={cn(toolbarControl, "w-full px-2")} value={filters.annualised_premium_min} onChange={(event) => applyFilter({ annualised_premium_min: event.target.value })} placeholder="Min $" />
                <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Maximum annualised premium in dollars" className={cn(toolbarControl, "w-full px-2")} value={filters.annualised_premium_max} onChange={(event) => applyFilter({ annualised_premium_max: event.target.value })} placeholder="Max $" />
              </div>
              {premiumRangeInvalid && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">Enter valid amounts, with minimum no higher than maximum.</p>}
            </FilterField>
            <FilterField label="Draft date" htmlFor="partner-deal-draft-from">
              <div className="grid grid-cols-2 gap-2">
                <input id="partner-deal-draft-from" type="date" aria-label="Draft date from" className={cn(toolbarControl, "w-full px-2")} value={filters.draft_date_from} onChange={(event) => applyFilter({ draft_date_from: event.target.value })} />
                <input type="date" aria-label="Draft date to" className={cn(toolbarControl, "w-full px-2")} value={filters.draft_date_to} onChange={(event) => applyFilter({ draft_date_to: event.target.value })} />
              </div>
              {draftDateRangeInvalid && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">Start date must be on or before end date.</p>}
            </FilterField>
            {isAdmin && (
              <FilterField label="Submitted by" htmlFor="partner-deal-submitter">
                <SelectMenu
                  id="partner-deal-submitter"
                  label="Filter by who submitted the lead"
                  value={filters.submitted_by}
                  defaultValue=""
                  onChange={(value) => applyFilter({ submitted_by: value })}
                  searchPlaceholder="Search submitters"
                  className="w-full"
                  matchTriggerWidth
                  options={[
                    { value: "", label: "Anyone" },
                    ...(data?.facets.submitters ?? []).map((item) => ({ value: item.id, label: item.name })),
                  ]}
                />
              </FilterField>
            )}
          </FilterPanel>
          <ActiveFilters filters={chips} onClear={clearFilters} />
        </>}
        footer={data && rows.length > pageSize ? <Pager page={tablePage.current} total={rows.length} pageSize={pageSize} noun={rows.length === 1 ? "deal" : "deals"} onPage={setPage} disabled={loading} /> : undefined}
      >
        {!data
          ? (error
            ? <ErrorState detail={error} action={<Button type="button" variant="outline" size="sm" onClick={() => void load()}>Try again</Button>} />
            : <SectionLoading rows={6} columns={columns} label="Loading deals" />)
          : loading
            ? <SectionLoading rows={6} columns={columns} label="Loading deals" />
            : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead className="w-[170px]">Annualised premium</TableHead>
                    <TableHead>Draft date</TableHead>
                    {isAdmin && <TableHead>Submitted by</TableHead>}
                    <TableHead className="w-[60px] text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns + 1} className="h-64 text-center align-middle">
                        {hasNarrowing ? (
                          <NoMatches noun="deals" onClear={clearFilters} by={search.trim() ? "search" : "filters"} />
                        ) : (
                          <EmptyState
                            title="No leads available"
                            hint={isAdmin
                              ? "Leads your team sends appear here once the agency works them."
                              : "Leads you send appear here once the agency works them."}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ) : tablePage.rows.map((row) => (
                    <TableRow key={row.leadId} data-lead-id={row.leadId}>
                      <TableCell className="max-w-[220px]"><span className="block max-w-full truncate font-semibold text-foreground" title={row.customer}>{row.customer}</span></TableCell>
                      <TableCell>{productLineLabel(row.productLine)}</TableCell>
                      <TableCell><StatusChip tone={STAGE_TONE[row.stageType]} dot>{row.stageName}</StatusChip></TableCell>
                      <TableCell className="max-w-[150px] truncate" title={row.carrier ?? undefined}>{row.carrier ?? "—"}</TableCell>
                      <TableCell><PremiumBar monthlyCents={row.monthlyPremiumCents} max={premiumMax} /></TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{dateOnly(row.draftDate)}</TableCell>
                      {isAdmin && <TableCell className="whitespace-nowrap">{row.submittedBy.name}</TableCell>}
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                          <Link href={`/partner/pipeline/${row.leadId}`} title="Open the lead" aria-label={`Open the lead for ${row.customer}`}><ArrowUpRight aria-hidden="true" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
      </TableCard>
    </div>
  );
}
