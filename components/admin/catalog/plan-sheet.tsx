"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { DetailPanel } from "@/components/ui/detail-panel";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { CatalogAuditItem } from "@/lib/adminCatalog/audit";
import { BILLING_CYCLE_LABELS } from "@/lib/money";
import { PLAN_TYPE_LABELS, type PlanListRow } from "@/lib/plans/constants";
import type { PlanSheetData } from "@/lib/plans/sheet";
import { PRICE_FIELDS, diffSummary, priceWords, type DiffLine } from "@/lib/plans/versionDiff";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

import { titleCaseNode } from "@/components/ui/title-case";
const ROW = "flex min-h-11 min-w-0 items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 17, 2026" in UTC, so the server and the browser print the same day. */
export function shortDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** The sheet's frame: title, status and the plan's actions; the body arrives with the server's reads. */
export function PlanSheetFrame({ row, loading, footer, onClose, children }: {
  row: PlanListRow | null;
  loading: boolean;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DetailPanel
      mode="overlay"
      className="lg:w-[min(760px,calc(100vw-80px))]"
      title={row?.name ?? "Plan"}
      subtitle={row ? `${row.code} · v${row.version} ${row.is_archived ? "archived" : "live"} · ${row.subscriber_count.toLocaleString("en-US")} ${row.subscriber_count === 1 ? "subscriber" : "subscribers"}` : undefined}
      status={row ? <StatusChip tone={row.is_archived ? "neutral" : "good"} dot>{row.is_archived ? "Archived" : "Live"}</StatusChip> : undefined}
      onClose={onClose}
      closeLabel="Close the plan"
      footer={footer}
      bodyClassName="flex flex-col"
    >
      {loading || !children ? <SheetLoading label="Loading the plan" /> : children}
    </DetailPanel>
  );
}

export function SheetLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }, (_, i) => <span key={i} aria-hidden="true" className="m-skel h-6 w-full rounded-md" />)}
    </div>
  );
}

/** A diff as label · was · now, the "was" struck through. */
export function DiffFacts({ lines }: { lines: DiffLine[] }) {
  return (
    <FactTable
      labelWidth={170}
      rows={lines.map((line) => [
        line.label,
        <span key={line.key} className="flex flex-wrap items-center gap-2">
          {line.from !== null && <span className="text-muted-foreground line-through">{line.from}</span>}
          {line.from !== null && line.to !== null && <span aria-hidden="true" className="text-muted-foreground">→</span>}
          {line.to !== null ? <span className="font-medium text-foreground">{line.to}</span> : <span className="text-muted-foreground">Taken away</span>}
        </span>,
      ])}
    />
  );
}

/** A history list from the audit log, newest first. Shared by the plan, add-on and feature sheets. */
export function AuditHistory({ items, empty }: { items: CatalogAuditItem[] | null; empty: string }) {
  if (items === null) return <EmptyState title="The history could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />;
  if (items.length === 0) return <EmptyState title="No history on record" hint={empty} />;
  return (
    <ul className="m-0 list-none p-0" aria-label="History">
      {items.map((item) => (
        <li key={item.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate" title={item.reason ?? undefined}>
            <span className="font-medium text-foreground">{item.label}</span>
            {item.by && <span className="text-muted-foreground"> · by {item.by}</span>}
            {item.reason && <span className="text-muted-foreground"> · {item.reason}</span>}
          </span>
          <time dateTime={item.at} className="shrink-0 text-xs tabular-nums text-muted-foreground" title={item.at}>{shortDay(item.at)}</time>
        </li>
      ))}
    </ul>
  );
}

const SUB_TONE: Record<string, StatusTone> = { active: "good", trialing: "info", trial: "info", past_due: "warning", cancelling: "warning", paused: "neutral", suspended: "danger" };
const statusWords = (status: string) => status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Part = "details" | "versions" | "subscribers" | "history";

/**
 * The plan sheet's body (catalog.html screen 2): Details · Versions (each version, when it was published, how many
 * are on it and what changed against the one before, from the stored versions) · Subscribers (who is on it and on
 * which version, each opening Billing › Subscriptions) · History (the audit log).
 */
export function PlanSheetBody({ data }: { data: PlanSheetData }) {
  const [part, setPart] = useState<Part>("versions");
  const latest = data.versions[0] ?? null;
  const [picked, setPicked] = useState<string | null>(latest?.id ?? null);
  const shown = data.versions.find((version) => version.id === picked) ?? latest;
  const { plan } = data;

  const sections = (
    <UnderlineTabs
      label={`${plan.name} sections`}
      value={part}
      onChange={setPart}
      tabs={[
        { key: "details", label: "Details" },
        { key: "versions", label: "Versions", count: data.versions.length },
        { key: "subscribers", label: "Subscribers", count: data.subscribers?.length ?? null },
        { key: "history", label: "History", count: data.history?.length ?? null },
      ]}
    />
  );

  return (
    <>
      <div className="sticky top-0 z-10 bg-card px-4">{sections}</div>
      {part === "details" && (
        <div className="flex flex-col gap-4 p-4">
          <FactTable
            rows={[
              ["Code", <code key="code" className="font-mono text-xs">{plan.code}</code>],
              ["Type", PLAN_TYPE_LABELS[plan.plan_type]],
              ["Visibility", `${plan.is_public ? "Public, on the pricing page" : "Private"}${plan.is_default ? " · the default plan" : ""}`],
              ["Description", plan.description || "None"],
              ["Sort order", String(plan.sort_order)],
              ...PRICE_FIELDS.map(([field, label]): [string, ReactNode] => [label, priceWords(latest?.prices ?? null, field)]),
              ["Features granted", latest ? `${latest.features.length.toLocaleString("en-US")}` : "—"],
              ["Created", shortDay(data.versions[data.versions.length - 1]?.createdAt ?? plan.created_at)],
            ]}
          />
          <p className="m-0 text-xs leading-[1.5] text-muted-foreground">
            Name, visibility and sort order change in place (Edit details). Features, prices and limits are edited on the plan&apos;s editor; saving a version people are on publishes the next one, and they stay where they are.
          </p>
        </div>
      )}

      {part === "versions" && (
        data.versions.length === 0 ? (
          <EmptyState title="No versions on record" hint="A plan always has at least its first version; reload the page." />
        ) : (
          <div className="flex flex-col">
            <ul className="m-0 list-none p-0" aria-label={`Versions of ${plan.name}`}>
              {data.versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(version.id)}
                    aria-pressed={version.id === shown?.id}
                    className={cn(ROW, "w-full cursor-pointer text-left hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]", version.id === shown?.id && "bg-[var(--hover-wash)]")}
                  >
                    <span className="w-10 shrink-0 font-semibold text-foreground">v{version.version}</span>
                    <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{shortDay(version.createdAt)}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-foreground" title="Live subscribers on this version">{version.subscribers.toLocaleString("en-US")}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={version.changes ? diffSummary(version.changes, 99) : "First version"}>{version.changes ? diffSummary(version.changes) : "First version"}</span>
                    {version.isArchived && <StatusChip tone="neutral">Archived</StatusChip>}
                  </button>
                </li>
              ))}
            </ul>
            {shown && (
              <section className="flex flex-col gap-2 border-t border-border p-4" aria-label={`What changed in v${shown.version}`}>
                <div className="flex items-center gap-3">
                  <h3 className="m-0 text-sm font-semibold text-foreground">
                    {shown.changes ? `v${data.versions.find((v) => v.version < shown.version)?.version ?? shown.version - 1} → v${shown.version}` : `v${shown.version}, the first version`}
                  </h3>
                  <Link href={`/admin/plans/${shown.id}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline ml-auto")}>{titleCaseNode(<>Open v{shown.version} in the editor</>)}</Link>
                </div>
                {shown.changes === null ? (
                  <p className="m-0 text-xs text-muted-foreground">Nothing before it to compare with.</p>
                ) : shown.changes.length === 0 ? (
                  <p className="m-0 text-xs text-muted-foreground">Published with the same price, limits and features as the version before it.</p>
                ) : (
                  <DiffFacts lines={shown.changes} />
                )}
              </section>
            )}
          </div>
        )
      )}

      {part === "subscribers" && (
        data.subscribers === null ? (
          <EmptyState title="The subscribers could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
        ) : data.subscribers.length === 0 ? (
          <EmptyState title="Nobody is on this plan" hint="Live subscriptions on any version of this plan are listed here." />
        ) : (
          <ul className="m-0 list-none p-0" aria-label={`Who is on ${plan.name}`}>
            {data.subscribers.map((sub) => (
              <li key={sub.subscriptionId}>
                <Link href={`/admin/subscriptions?open=${sub.subscriptionId}`} className={cn(ROW, "text-foreground no-underline hover:bg-[var(--hover-wash)]")}>
                  <span className="min-w-0 flex-1 truncate font-medium">{sub.tenantName}</span>
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground" title="Plan version">v{sub.version}</span>
                  <span className="hidden w-24 shrink-0 text-muted-foreground sm:block">{sub.cycle ? BILLING_CYCLE_LABELS[sub.cycle] : "—"}</span>
                  <span className="hidden w-28 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground sm:block" title="Subscribed since">{shortDay(sub.since)}</span>
                  <StatusChip tone={SUB_TONE[sub.status] ?? "neutral"}>{statusWords(sub.status)}</StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {part === "history" && <AuditHistory items={data.history} empty="Creating, editing, publishing and deleting a version of this plan is recorded here." />}
    </>
  );
}
