"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { NoMatches } from "@/components/admin/empty-state";
import { StateDisclosureEditor, type EditorTarget } from "@/components/admin/state-disclosures-editor";
import { StateDisclosuresImport } from "@/components/admin/state-disclosures-import";
import { StateDisclosuresReviewCard } from "@/components/admin/state-disclosures-review";
import { Callout, Pill, btn, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATE_CODES } from "@/lib/appointments/constants";
import {
  buildCoverageRows,
  coverageCsv,
  formatEffectiveDate,
  productScope,
  summarize,
  wordingPreview,
  type CoverageRow,
} from "@/lib/stateDisclosures/board";
import type { DisclosureProposal, StateDisclosure } from "@/lib/stateDisclosures/constants";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const TOTAL_STATES = STATE_CODES.length;

type CoverageFilter = "all" | "in_force" | "not_covered";

export type ProposalState = {
  /** False until migration 20260925507000 is applied: the editor then publishes directly, as before. */
  available: boolean;
  pending: DisclosureProposal[];
  recent: DisclosureProposal[];
  /** The server's answer for the signed-in admin: may they approve their own proposals? */
  selfApprovalAllowed: boolean;
  error: string | null;
};

/**
 * The Disclosures board (p-adm-state-disclosures): what the dialer will read for every state and
 * product line, which of it is the seeded placeholder, where it will refuse the call, and the
 * propose → review → publish path for new wording. The product never writes wording itself.
 */
export function StateDisclosuresTable({
  disclosures,
  catalog,
  proposals,
  activeTenants,
  currentAdminId,
  earliest,
  quarterStart,
}: {
  disclosures: StateDisclosure[];
  /** Active products from the platform catalog, in catalog order. */
  catalog: { code: string; name: string }[];
  proposals: ProposalState;
  activeTenants: number | null;
  currentAdminId: string;
  /** Tomorrow, UTC: the first date a new version may take effect. */
  earliest: string;
  quarterStart: string;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [placeholderOnly, setPlaceholderOnly] = useState(false);
  const [changingOnly, setChangingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const scope = useMemo(() => productScope(catalog, disclosures), [catalog, disclosures]);
  const allRows = useMemo(() => buildCoverageRows(disclosures, scope, proposals.pending), [disclosures, scope, proposals.pending]);
  const allSummary = useMemo(() => summarize(allRows, scope.length), [allRows, scope.length]);

  const scopeRows = useMemo(() => (product === "all" ? allRows : allRows.filter((row) => row.productCode === product)), [allRows, product]);
  const scopeProducts = product === "all" ? scope.length : 1;
  const summary = useMemo(() => summarize(scopeRows, scopeProducts), [scopeRows, scopeProducts]);
  const changedThisQuarter = useMemo(
    () => disclosures.filter((row) => row.effective_from >= quarterStart && (product === "all" || row.product_code === product)).length,
    [disclosures, quarterStart, product],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopeRows.filter((row) => {
      if (coverage === "in_force" && !row.live) return false;
      if (coverage === "not_covered" && row.live) return false;
      if (placeholderOnly && !row.placeholder) return false;
      if (changingOnly && row.scheduled.length === 0 && row.pending.length === 0) return false;
      if (!needle) return true;
      return [row.state, row.stateName, row.productName, row.productCode, row.live?.required_text ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [scopeRows, query, coverage, placeholderOnly, changingOnly]);

  const activeFilters = (placeholderOnly ? 1 : 0) + (changingOnly ? 1 : 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const productName = scope.find((entry) => entry.code === product)?.name ?? "Every product";

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function clearFilters() {
    setQuery("");
    setCoverage("all");
    setPlaceholderOnly(false);
    setChangingOnly(false);
    setPage(1);
  }

  function showPlaceholders() {
    setProduct("all");
    setCoverage("in_force");
    setPlaceholderOnly(true);
    setChangingOnly(false);
    setQuery("");
    setPage(1);
  }

  function exportCsv() {
    const blob = new Blob([coverageCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `state-disclosures-${product === "all" ? "all-products" : product}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const openRow = (row: CoverageRow) => setEditor({ kind: "pair", row });
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Disclosures"
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              Import a pack
            </Button>
            <Button type="button" onClick={() => setEditor({ kind: "new" })}>
              Add a disclosure
            </Button>
          </>
        }
      />

      <BoardStatGrid>
        <BoardStatTile
          label="States covered"
          value={summary.statesCovered.toLocaleString("en-US")}
          tone={summary.statesCovered < TOTAL_STATES ? "warning" : "default"}
          footnote={product === "all" ? `of 50 + DC, for all ${scope.length} products` : "of 50 + DC"}
          title="A state counts when every product in view has wording in force there — what the dialer needs to place the call."
        />
        <BoardStatTile
          label="Product combinations"
          value={summary.combinationsLive.toLocaleString("en-US")}
          tone={summary.placeholders > 0 ? "warning" : "default"}
          footnote={
            summary.placeholders > 0
              ? `${summary.placeholders.toLocaleString("en-US")} placeholder · ${summary.productsLive} of ${summary.products} ${summary.products === 1 ? "product" : "products"}`
              : `${summary.productsLive} of ${summary.products} ${summary.products === 1 ? "product" : "products"}`
          }
          title="State and product pairs with wording in force today."
        />
        <BoardStatTile
          label="Changed this quarter"
          value={changedThisQuarter.toLocaleString("en-US")}
          footnote="all effective-dated"
          title={`Versions taking effect on or after ${formatEffectiveDate(quarterStart)}, scheduled ones included.`}
        />
        <BoardStatTile
          label="Tenants affected"
          value={activeTenants === null ? "—" : activeTenants.toLocaleString("en-US")}
          footnote={activeTenants === null ? "could not be loaded" : "every active tenant reads this"}
          title="Disclosures are platform-wide: every active tenant's dialer reads the same rows."
        />
      </BoardStatGrid>

      {allSummary.placeholders > 0 && (
        <Callout
          tone="warning"
          title={`${allSummary.placeholders.toLocaleString("en-US")} of the disclosures in force ${allSummary.placeholders === 1 ? "is" : "are"} placeholder wording. Replace ${allSummary.placeholders === 1 ? "it" : "them"} with approved wording before any live call.`}
        >
          <Button type="button" variant="outline" className="mt-1" onClick={showPlaceholders}>
            Show placeholder rows
          </Button>
        </Callout>
      )}
      {summary.uncovered > 0 && (
        <Callout
          tone="error"
          title={
            product === "all"
              ? `${summary.uncovered.toLocaleString("en-US")} state and product ${summary.uncovered === 1 ? "pair has" : "pairs have"} no wording, and the dialer refuses those calls.`
              : `${(TOTAL_STATES - summary.statesCovered).toLocaleString("en-US")} ${TOTAL_STATES - summary.statesCovered === 1 ? "state has" : "states have"} no ${productName} wording, and the dialer refuses those calls.`
          }
        />
      )}

      <StateDisclosuresReviewCard
        proposals={proposals}
        rows={allRows}
        scope={scope}
        currentAdminId={currentAdminId}
        earliest={earliest}
        onChanged={refresh}
      />

      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
                  Export
                </Button>
                <RefreshButton onClick={refresh} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={query} onChange={resetPage(setQuery)} placeholder="Search by state or wording" />
            <select aria-label="Product" className={toolbarControl} value={product} onChange={(event) => resetPage(setProduct)(event.target.value)}>
              <option value="all">Every product</option>
              {scope.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                  {entry.inCatalog ? "" : " (not in catalog)"}
                </option>
              ))}
            </select>
            <select
              aria-label="Coverage"
              className={toolbarControl}
              value={coverage}
              onChange={(event) => resetPage(setCoverage)(event.target.value as CoverageFilter)}
            >
              <option value="all">Every pair</option>
              <option value="in_force">Wording in force</option>
              <option value="not_covered">Not covered</option>
            </select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline">
                  <SlidersHorizontal aria-hidden="true" />
                  Filters
                  {activeFilters > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground">
                      {activeFilters}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuCheckboxItem checked={placeholderOnly} onCheckedChange={(value) => resetPage(setPlaceholderOnly)(value === true)}>
                  Placeholder wording only
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={changingOnly} onCheckedChange={(value) => resetPage(setChangingOnly)(value === true)}>
                  Change scheduled or in review
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DataToolbar>
        }
      >
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[880px] table-fixed")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[130px]")}>State</th>
                <th scope="col" className={cn(st.th, "w-[200px]")}>Product</th>
                <th scope="col" className={st.th}>Wording</th>
                <th scope="col" className={cn(st.th, "w-[150px] text-right")}>Effective from</th>
                <th scope="col" className={cn(st.th, "w-[120px] text-right")}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-0">
                    <NoMatches noun="state and product pairs" onClear={clearFilters} />
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr
                  key={row.key}
                  onClick={() => openRow(row)}
                  className={cn(
                    "m-row cursor-pointer",
                    editor?.kind === "pair" && editor.row.key === row.key ? "bg-[var(--brand-50)]" : "hover:bg-[var(--canvas)]",
                  )}
                >
                  <td className={st.td}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRow(row);
                      }}
                      className="cursor-pointer rounded-[4px] text-left text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    >
                      {row.stateName}
                      <span className="sr-only"> {row.productName} — open</span>
                    </button>
                  </td>
                  <td className={cn(st.td, "truncate")} title={row.productCode}>
                    {row.productName}
                  </td>
                  <td className={st.td}>
                    {row.live ? (
                      <span className="flex min-w-0 items-center gap-2">
                        {row.placeholder && <Pill tone="warning">Placeholder</Pill>}
                        {row.pending.length > 0 && <Pill tone="brand">In review</Pill>}
                        {row.scheduled[0] && <Pill tone="info">Next {formatEffectiveDate(row.scheduled[0].effective_from)}</Pill>}
                        <span className="min-w-0 truncate" title={row.live.required_text}>
                          &ldquo;{wordingPreview(row.live.required_text)}&rdquo;
                        </span>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2">
                        {row.pending.length > 0 && <Pill tone="brand">In review</Pill>}
                        {row.scheduled[0] && <Pill tone="info">From {formatEffectiveDate(row.scheduled[0].effective_from)}</Pill>}
                        <span>&mdash;</span>
                      </span>
                    )}
                  </td>
                  <td className={cn(st.td, st.num)}>{row.live ? formatEffectiveDate(row.live.effective_from) : "—"}</td>
                  <td className={cn(st.td, "text-right")}>
                    {row.live ? (
                      <button
                        type="button"
                        className={btn("row")}
                        onClick={(event) => {
                          event.stopPropagation();
                          openRow(row);
                        }}
                        aria-label={`Edit the ${row.stateName} ${row.productName} disclosure`}
                      >
                        Edit
                      </button>
                    ) : (
                      <Pill tone="error">Not covered</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel={filtered.length === 1 ? "state and product pair" : "state and product pairs"}
          order="by state, then product"
          onPageChange={setPage}
        />
      </TableCard>

      {editor && (
        <StateDisclosureEditor
          key={editor.kind === "pair" ? editor.row.key : "new"}
          target={editor}
          scope={scope}
          reviewAvailable={proposals.available}
          earliest={earliest}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}

      {importOpen && (
        <StateDisclosuresImport
          reviewAvailable={proposals.available}
          earliest={earliest}
          onClose={() => setImportOpen(false)}
          onImported={refresh}
        />
      )}
    </div>
  );
}
