"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ListFilter } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { NoMatches } from "@/components/admin/empty-state";
import { StateDisclosureEditor, type EditorTarget } from "@/components/admin/state-disclosures-editor";
import { StateDisclosuresImport } from "@/components/admin/state-disclosures-import";
import { StateDisclosuresReviewCard } from "@/components/admin/state-disclosures-review";
import { Callout, Pill, SearchBox, TableToolbar, btn, st } from "@/components/app/settings/primitives";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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

const TOOLBAR_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const HEADER_SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

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

  const activeFilters = (coverage !== "all" ? 1 : 0) + (placeholderOnly ? 1 : 0) + (changingOnly ? 1 : 0);
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
  const refresh = () => router.refresh();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Disclosures"
        subtitle="The wording an agent must read before an outbound call, by state and product."
        actions={
          <>
            <button type="button" className={HEADER_SECONDARY} onClick={() => setImportOpen(true)}>
              Import a pack
            </button>
            <button type="button" className={btn("primary", "h-11")} onClick={() => setEditor({ kind: "new" })}>
              Add a disclosure
            </button>
          </>
        }
      />

      {allSummary.placeholders > 0 && (
        <Callout
          tone="warning"
          title={`${allSummary.placeholders.toLocaleString("en-US")} of the disclosures in force ${allSummary.placeholders === 1 ? "is" : "are"} placeholder wording, not approved text`}
        >
          <p className="m-0">
            They were seeded so the dialer could be tested, and each begins with the marker “[PLACEHOLDER — NOT
            COMPLIANCE-APPROVED …]”. The dialer serves them to agents exactly as stored. Replace each one with approved
            wording before any live call; they carry a Placeholder pill below.
          </p>
          <button type="button" className={btn("secondary", "mt-3")} onClick={showPlaceholders}>
            Show placeholder rows
          </button>
        </Callout>
      )}

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

      <StateDisclosuresReviewCard
        proposals={proposals}
        rows={allRows}
        scope={scope}
        currentAdminId={currentAdminId}
        earliest={earliest}
        onChanged={refresh}
      />

      <TableToolbar>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TOOLBAR_BUTTON}>
              {productName}
              <ChevronDown aria-hidden className="size-[13px] stroke-[2.4]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Product</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={product} onValueChange={resetPage(setProduct)}>
              <DropdownMenuRadioItem value="all">Every product</DropdownMenuRadioItem>
              {scope.map((entry) => (
                <DropdownMenuRadioItem key={entry.code} value={entry.code}>
                  {entry.name}
                  {!entry.inCatalog && <span className="ml-1 text-[var(--muted)]">(not in catalog)</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <SearchBox value={query} onChange={resetPage(setQuery)} placeholder="Search by state or wording" label="Search by state or wording" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TOOLBAR_BUTTON}>
              <ListFilter aria-hidden className="size-4" />
              Filters
              {activeFilters > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tabular-nums text-[var(--ink)]">
                  {activeFilters}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Coverage</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={coverage} onValueChange={(value) => resetPage(setCoverage)(value as CoverageFilter)}>
              <DropdownMenuRadioItem value="all">Every pair</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="in_force">Wording in force</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="not_covered">Not covered</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={placeholderOnly} onCheckedChange={(value) => resetPage(setPlaceholderOnly)(value === true)}>
              Placeholder wording only
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={changingOnly} onCheckedChange={(value) => resetPage(setChangingOnly)(value === true)}>
              Change scheduled or in review
            </DropdownMenuCheckboxItem>
            {activeFilters > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setCoverage("all");
                    setPlaceholderOnly(false);
                    setChangingOnly(false);
                    setPage(1);
                  }}
                >
                  Clear filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="grow" />
        <button type="button" className={cn(TOOLBAR_BUTTON, "px-4")} onClick={exportCsv} disabled={filtered.length === 0}>
          Export
        </button>
        <span className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)] tabular-nums">
          {summary.statesCovered} of {TOTAL_STATES} states covered
        </span>
      </TableToolbar>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
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
        <div className="grow" />
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel={filtered.length === 1 ? "state and product pair" : "state and product pairs"}
          order="by state, then product"
          onPageChange={setPage}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {summary.uncovered > 0 ? (
          <Callout
            tone="error"
            title={
              product === "all"
                ? `${summary.uncovered.toLocaleString("en-US")} state and product ${summary.uncovered === 1 ? "pair has" : "pairs have"} no wording, and the dialer refuses those calls`
                : `${(TOTAL_STATES - summary.statesCovered).toLocaleString("en-US")} ${TOTAL_STATES - summary.statesCovered === 1 ? "state has" : "states have"} no ${productName} wording, and the dialer refuses those calls`
            }
          >
            A lead whose state and product line have no disclosure in force cannot be dialled: the agent is told dialing is
            blocked until one is published. Coverage is the number to drive to 51 for every product you sell.
          </Callout>
        ) : (
          <Callout tone="success" title={`Every state has wording in force for ${product === "all" ? "every product" : productName}`}>
            The dialer can serve a disclosure for every lead in view. Placeholder rows still need approved wording.
          </Callout>
        )}
        <Callout tone="info" title="A change here is effective-dated, never retroactive">
          A new version takes effect from a future date and the old wording stays on record, so a call placed under the old
          wording stays compliant under the old wording. Editing in place would rewrite the record of what was actually said.
        </Callout>
      </div>

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
