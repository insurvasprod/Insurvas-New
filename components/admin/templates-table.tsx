"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ListFilter } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { Callout, Pill, SearchBox, TableToolbar, btn, st, type PillTone } from "@/components/app/settings/primitives";
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
import type { ProductRow } from "@/lib/products/constants";
import type { TemplateRow } from "@/lib/templates/constants";
import {
  DEFAULT_VISIBLE_STATES,
  EMPTY_TEMPLATE_USAGE,
  TEMPLATE_CATALOG_ORDER,
  TEMPLATE_STATES,
  TEMPLATE_STATE_LABELS,
  activeFilterCount,
  filterTemplates,
  sortTemplatesForCatalog,
  templateSizeDetail,
  templateSizeLabel,
  templateTypeLabel,
  type TemplateState,
  type TemplateUsageSummary,
} from "@/lib/templates/catalog";
import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";
import { cn } from "@/lib/utils";
import { TemplateEditorDialog } from "./template-editor-dialog";

export type CatalogTemplate = TemplateRow & { state: TemplateState };

const PAGE_SIZE = 25;

const STATE_TONE: Record<TemplateState, PillTone> = {
  published: "success",
  draft: "warning",
  archived: "neutral",
};

const toolbarButton =
  "inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

/** "12 Sep 2026" in UTC; hover gives the full UTC time and, after mount, the reader's own time. */
function UpdatedDate({ iso }: { iso: string }) {
  const ref = useRef<HTMLTimeElement>(null);
  const utc = recordDateTime(iso);
  useEffect(() => {
    const date = new Date(iso);
    if (ref.current && !Number.isNaN(date.getTime())) {
      ref.current.title = `${utc} · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} your time`;
    }
  }, [iso, utc]);
  return (
    <time ref={ref} dateTime={iso} title={utc} className="whitespace-nowrap">
      {recordDate(iso)}
    </time>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The Templates catalog (board p-adm-templates): header, figures, product / search / state filters,
 * the table and the versioning callout. A row click — or the name, for the keyboard — opens the
 * editor, where editing, duplicating, publishing, archiving and restoring live; the open row carries
 * the brand tint, as on the board.
 */
export function TemplatesTable({
  templates,
  products,
  tiles,
  usage,
  draftsSupported,
}: {
  templates: CatalogTemplate[];
  products: ProductRow[];
  tiles: ReactNode;
  /** Null when tenant copies or in-progress applications could not be read. */
  usage: TemplateUsageSummary | null;
  /** False until migration 20260925504000 (templates.published_at) is applied. */
  draftsSupported: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [productCode, setProductCode] = useState<string>("all");
  const [states, setStates] = useState<TemplateState[]>([...DEFAULT_VISIBLE_STATES]);
  const [page, setPage] = useState(1);

  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const template of templates) seen.set(template.product_code, template.product_name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
  }, [templates]);

  const sorted = useMemo(() => sortTemplatesForCatalog(templates), [templates]);
  const filtered = useMemo(
    () => filterTemplates(sorted, (row) => row.state, { query, productCode, states }),
    [sorted, query, productCode, states],
  );

  const filterCount = activeFilterCount({ states });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const editing = editor?.mode === "edit" ? templates.find((template) => template.id === editor.id) ?? null : null;
  const productLabel = productCode === "all" ? "All products" : productOptions.find(([code]) => code === productCode)?.[1] ?? productCode;

  function toggleState(state: TemplateState, on: boolean) {
    setStates((currentStates) => (on ? [...currentStates, state] : currentStates.filter((item) => item !== state)));
    setPage(1);
  }

  function clearFilters() {
    setQuery("");
    setProductCode("all");
    setStates([...TEMPLATE_STATES]);
    setPage(1);
  }

  const openEdit = (template: CatalogTemplate) => setEditor({ mode: "edit", id: template.id });

  const agencyCopies = usage ? Object.values(usage.byTemplate).reduce((sum, item) => sum + item.agencies, 0) : 0;
  const copiesOnEarlier = usage ? Object.values(usage.byTemplate).reduce((sum, item) => sum + item.agenciesOnEarlierVersion, 0) : 0;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Templates"
        subtitle="Lead fields, pipelines and application forms, per product."
        actions={
          <button type="button" className={btn("primary", "h-11")} onClick={() => setEditor({ mode: "create" })}>
            New template
          </button>
        }
      />

      {tiles}

      <TableToolbar>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={toolbarButton} aria-label={`Product: ${productLabel}`}>
              {productLabel}
              <ChevronDown aria-hidden className="size-[13px]" strokeWidth={2.4} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuRadioGroup
              value={productCode}
              onValueChange={(value) => {
                setProductCode(value);
                setPage(1);
              }}
            >
              <DropdownMenuRadioItem value="all">All products</DropdownMenuRadioItem>
              {productOptions.map(([code, name]) => (
                <DropdownMenuRadioItem key={code} value={code}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Search templates"
          label="Search templates"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={toolbarButton}>
              <ListFilter aria-hidden className="size-[15px]" />
              Filters
              {filterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tabular-nums text-[var(--ink)]">
                  {filterCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>State</DropdownMenuLabel>
            {TEMPLATE_STATES.map((state) => (
              <DropdownMenuCheckboxItem
                key={state}
                checked={states.includes(state)}
                onCheckedChange={(checked) => toggleState(state, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                {TEMPLATE_STATE_LABELS[state]}
                {state === "draft" && !draftsSupported ? " (needs database update)" : ""}
              </DropdownMenuCheckboxItem>
            ))}
            {filterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setStates([...TEMPLATE_STATES]);
                    setPage(1);
                  }}
                >
                  Show every state
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="grow" />
      </TableToolbar>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[980px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Template</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Product</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Type</th>
                <th scope="col" className={cn(st.th, "w-[100px]")}>Version</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Size</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>State</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Updated</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {templates.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      title="No templates yet"
                      hint="A template is the starting workspace an agency picks for a product: its lead fields, pipeline stages and application form."
                    />
                  </td>
                </tr>
              )}
              {templates.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <NoMatches noun="templates" onClear={clearFilters} />
                  </td>
                </tr>
              )}
              {visible.map((template) => {
                const selected = editor?.mode === "edit" && editor.id === template.id;
                return (
                  <tr
                    key={template.id}
                    onClick={() => openEdit(template)}
                    data-selected={selected || undefined}
                    className={cn(
                      "m-row cursor-pointer",
                      selected ? "bg-[var(--brand-50)]" : "hover:bg-[var(--canvas)]",
                      template.state === "archived" && !selected && "[&>td]:text-[var(--muted)]",
                    )}
                  >
                    <td className={st.td}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(template);
                        }}
                        title={template.description ?? undefined}
                        className="cursor-pointer rounded-[4px] text-left text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        {template.name}
                        <span className="sr-only"> — open</span>
                      </button>
                    </td>
                    <td className={st.td}>
                      <span title={template.product_code}>{template.product_name}</span>
                    </td>
                    <td className={st.td}>{templateTypeLabel(template)}</td>
                    <td className={st.td}>
                      <Pill tone="neutral">v{template.version}</Pill>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
                      <span title={templateSizeDetail(template)}>{templateSizeLabel(template)}</span>
                    </td>
                    <td className={st.td}>
                      <Pill tone={STATE_TONE[template.state]} dot>
                        {TEMPLATE_STATE_LABELS[template.state]}
                      </Pill>
                    </td>
                    <td className={st.td}>
                      <UpdatedDate iso={template.updated_at} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grow" />
        {templates.length > 0 && (
          <BoardTableFooter
            page={current}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            itemLabel={filtered.length === 1 ? "template" : "templates"}
            order={TEMPLATE_CATALOG_ORDER}
            onPageChange={setPage}
          />
        )}
      </section>

      <Callout tone="info" title="In-progress work keeps the version it started with">
        {usage ? (
          <>
            {usage.inProgressOnEarlierVersion === 0
              ? "No in-progress application is on an earlier version right now; any that are stay there."
              : `${plural(usage.inProgressOnEarlierVersion, "application is", "applications are")} mid-flight on earlier versions and stay there.`}{" "}
            {copiesOnEarlier > 0 && `${plural(copiesOnEarlier, "agency copy was", "agency copies were")} taken from an earlier template version and keep it (${agencyCopies.toLocaleString("en-US")} in all). `}
          </>
        ) : (
          "In-progress applications could not be counted just now. "
        )}
        A published template is never edited in place — saving creates a new version — and removing a lead field the form or a
        condition still uses names those dependents before it is allowed.
      </Callout>

      {editor && (editor.mode === "create" || editing) && (
        <TemplateEditorDialog
          key={editor.mode === "create" ? "create" : `edit-${editing?.id}-${editing?.version}-${editing?.state}`}
          mode={editor.mode}
          open
          template={editing}
          state={editing?.state}
          usage={editing ? (usage ? usage.byTemplate[editing.id] ?? EMPTY_TEMPLATE_USAGE : null) : null}
          products={products}
          draftsSupported={draftsSupported}
          onClose={() => setEditor(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
