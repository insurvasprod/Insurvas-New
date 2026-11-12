"use client";

import { useState } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { inputControl } from "@/components/ui/field";
import { st } from "@/components/app/settings/primitives";
import { ProductChips } from "@/components/app/form-templates/product-chips";
import { FormStatusLine } from "@/components/app/form-templates/status-line";

export type FormListRow = {
  kind: "product" | "variant";
  id: string;
  tenant_template_id: string;
  product_code: string;
  product_name: string;
  name: string;
  version: number;
  status: "live" | "draft" | "off";
  sent: number;
  started: number;
  changed_at: string | null;
  changed_by: string | null;
  draft_changes: boolean;
  has_webhook: boolean;
};
export type ListTab = "forms" | "results" | "webhooks";

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function changed(at: string | null) {
  if (!at) return "—";
  const date = new Date(at);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : day.format(date);
}
const STATUS = { live: { tone: "good", label: "Live" }, draft: { tone: "info", label: "Draft" }, off: { tone: "neutral", label: "Off" } } as const;

/**
 * Settings › Application forms, the list (board A1): every form with its product, version, what it did
 * in the last 30 days, who changed it, and its status. A row opens the form in the builder.
 */
export function FormsList({ tab, rows, products, loading, error, onRetry, onOpen, onNew, onWebhook }: {
  tab: ListTab;
  rows: FormListRow[] | null;
  products: Array<{ code: string; name: string }>;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpen: (row: FormListRow) => void;
  onNew: () => void;
  onWebhook: (row: FormListRow) => void;
}) {
  const [product, setProduct] = useState("");
  const [query, setQuery] = useState("");
  const all = rows ?? [];
  const counts = all.reduce<Record<string, number>>((out, row) => ({ ...out, [row.product_code]: (out[row.product_code] ?? 0) + 1 }), {});
  const q = query.trim().toLowerCase();
  const shown = all.filter((row) => (!product || row.product_code === product) && (!q || row.name.toLowerCase().includes(q) || row.product_name.toLowerCase().includes(q)));
  const live = all.filter((row) => row.status === "live").length;
  const drafts = all.filter((row) => row.status === "draft" || row.draft_changes).length;
  const started = all.reduce((sum, row) => sum + row.started, 0);

  if (error) return <FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={onRetry}>Try again</Button>}>{error}</FormStatusLine>;
  const toolbar = (
    <>
      <ProductChips products={products} value={product} counts={counts} onChange={setProduct} />
      <span className="flex-1" />
      <input aria-label="Find a form" className={cn(inputControl, "h-9 w-full max-w-[240px]")} placeholder="Find a form" value={query} onChange={(event) => setQuery(event.target.value)} />
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {rows && <FormStatusLine tone="good">{live} {live === 1 ? "form" : "forms"} live{drafts ? ` · ${drafts} with a draft` : ""} · {started.toLocaleString("en-US")} forms started in the last 30 days</FormStatusLine>}
      <TableCard toolbar={toolbar} className="min-h-0 flex-1">
        {loading && !rows ? <div className="p-4"><SectionLoading rows={5} columns={7} label="Reading your forms" /></div> : shown.length === 0 ? (
          <EmptyState title={all.length ? "No form matches" : "No forms yet"} hint={all.length ? "Try another product or word." : "Each product you sell starts with the Insurvas form for it."} action={all.length ? undefined : <Button type="button" onClick={onNew}>Start from Insurvas</Button>} />
        ) : (
          <div className="min-h-0 overflow-y-auto">
            <table className={st.table}>
              <thead className={st.headRow}>
                {tab === "forms" && <tr><th className={st.th}>Form</th><th className={st.th}>Product</th><th className={st.th}>Version</th><th className={`${st.th} text-right`}>Started · 30 days</th><th className={`${st.th} text-right`}>Completed</th><th className={st.th}>Changed</th><th className={st.th}>Status</th></tr>}
                {tab === "results" && <tr><th className={st.th}>Form</th><th className={st.th}>Product</th><th className={`${st.th} text-right`}>Started · 30 days</th><th className={`${st.th} text-right`}>Sent</th><th className={`${st.th} text-right`}>Finished</th></tr>}
                {tab === "webhooks" && <tr><th className={st.th}>Form</th><th className={st.th}>Product</th><th className={st.th}>When a form is sent</th><th className={st.th}><span className="sr-only">Open</span></th></tr>}
              </thead>
              <tbody>
                {shown.map((row) => {
                  const pct = row.started ? `${Math.round((row.sent / row.started) * 100)}%` : "—";
                  const open = () => (tab === "webhooks" ? onWebhook(row) : onOpen(row));
                  return (
                    <tr key={`${row.kind}:${row.id}`} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={open}>
                      <td className={st.td}><button type="button" className="flex max-w-[280px] items-center gap-2 truncate text-left font-semibold text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]" onClick={(event) => { event.stopPropagation(); open(); }}><FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" /><span className="truncate">{row.name}</span></button></td>
                      <td className={st.td}>{row.product_name}</td>
                      {tab === "forms" && (
                        <>
                          <td className={st.td}>{row.status === "draft" ? "Not published" : `v${row.version}${row.draft_changes ? " · changes in draft" : ""}`}</td>
                          <td className={`${st.td} ${st.num}`}>{row.kind === "variant" ? "—" : row.started.toLocaleString("en-US")}</td>
                          <td className={`${st.td} ${st.num}`}>{row.kind === "variant" ? "—" : pct}</td>
                          <td className={st.td}><span className="block max-w-[200px] truncate">{changed(row.changed_at)}{row.changed_by ? ` · ${row.changed_by}` : ""}</span></td>
                          <td className={st.td}><StatusChip tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusChip></td>
                        </>
                      )}
                      {tab === "results" && (
                        <>
                          <td className={`${st.td} ${st.num}`}>{row.started.toLocaleString("en-US")}</td>
                          <td className={`${st.td} ${st.num}`}>{row.sent.toLocaleString("en-US")}</td>
                          <td className={`${st.td} ${st.num}`}>{pct}</td>
                        </>
                      )}
                      {tab === "webhooks" && (
                        <>
                          <td className={st.td}>{row.kind === "variant" ? "Uses its product’s form" : row.has_webhook ? <StatusChip tone="good">Set up</StatusChip> : "None"}</td>
                          <td className={`${st.td} text-right`}><span className="text-sm font-semibold text-[var(--accent-ink)]">{row.has_webhook ? "Open" : "Set up"}</span></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </div>
  );
}
