"use client";

import { useState, type ReactNode } from "react";

import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import type { ApiKeyView, WebhookView } from "@/lib/apiKeys/constants";
import { canDoWords, getsWords, hookState, type ChipTone, type KeyState } from "@/lib/apiKeys/hub";
import { STATUS_LABEL, STATUS_TONE, type LeadPostBoard } from "@/lib/leadPost/board";
import { cn } from "@/lib/utils";
import { lastDeliveryWords } from "./webhooks";
import { InlineLink, whenWords } from "./shared";

/**
 * Settings › Integrations, round 8 option A · Overview (board A1): who's connected. Apps (by their
 * API key), webhook endpoints, lead vendors and the browser extension on one table; each row says
 * where it's managed. Lead-vendor keys stay in Lead posting; they show here only so everything is in
 * one place.
 */

export const LEAD_POSTING_HREF = "/app/settings#lead-posting";
export const EXTENSION_HREF = "/app/settings#sales-extension";

/** What the Overview reads of Lead posting's board; null while loading, "off" when the plan or role has no Lead posting. */
export type VendorsRead = Pick<LeadPostBoard, "vendors" | "campaigns" | "allVendors"> | null | "off";
/** What it reads of the browser extension: its carrier sites and the newest access grant. */
export type ExtensionRead = { sites: number; lastAt: string | null } | null | "off";

type Filter = "all" | "apps" | "webhooks" | "vendors" | "needs_you";
type Row = { id: string; name: string; more?: string; kind: string; what: string; last: string; managed: ReactNode; chip: { label: string; tone: ChipTone }; group: Exclude<Filter, "all" | "needs_you"> | "extension"; needsYou: boolean; open?: () => void };

export function Overview({
  keys,
  keyStates,
  hooks,
  vendors,
  extension,
  onKeys,
  onWebhooks,
  onOpenKey,
  onOpenHook,
  emptyActions,
}: {
  keys: ApiKeyView[];
  keyStates: Map<string, KeyState>;
  hooks: WebhookView[];
  vendors: VendorsRead;
  extension: ExtensionRead;
  onKeys: () => void;
  onWebhooks: () => void;
  onOpenKey: (key: ApiKeyView) => void;
  onOpenHook: (hook: WebhookView) => void;
  emptyActions: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [now] = useState(() => Date.now());
  // One line an app: a key that is rotating out is the same app as its successor.
  const appKeys = keys.filter((key) => { const state = keyStates.get(key.id); return state?.live && state.kind !== "rotating_out"; });
  const vendorRows = vendors && vendors !== "off" ? vendors.vendors : [];

  const productOf = (vendorId: string, campaignId: string | null) => {
    if (!vendors || vendors === "off") return null;
    const campaign = campaignId ? vendors.campaigns.find((item) => item.id === campaignId) : vendors.campaigns.find((item) => item.vendorId === vendorId && item.servable);
    return campaign?.productLabel || vendors.allVendors.find((item) => item.id === vendorId)?.leadType || null;
  };

  const rows: Row[] = [
    ...hooks.map((hook): Row => {
      const state = hookState(hook);
      return { id: `hook:${hook.id}`, name: hook.label, kind: "Webhook", what: getsWords(hook.eventTypes), last: hook.status === "disabled" && hook.disabledAt ? `Turned off ${whenWords(hook.disabledAt, now)}` : lastDeliveryWords(hook), managed: <InlineLink onClick={onWebhooks}>Webhooks</InlineLink>, chip: { label: state.label, tone: state.tone }, group: "webhooks", needsYou: state.needsYou, open: () => onOpenHook(hook) };
    }),
    ...appKeys.map((key): Row => {
      const state = keyStates.get(key.id) as KeyState;
      return { id: `key:${key.id}`, name: key.label, kind: "App · API key", what: canDoWords(key.scopes), last: whenWords(key.lastUsedAt, now), managed: <InlineLink onClick={onKeys}>API keys</InlineLink>, chip: { label: state.kind === "idle" ? "Idle · revoke?" : state.label, tone: state.tone }, group: "apps", needsYou: state.kind === "idle" || state.kind === "ends_soon", open: () => onOpenKey(key) };
    }),
    ...vendorRows.map((row, index, all): Row | null => {
      // Three lines at most: two vendors, then the rest folded into the third (needs-you first, as Lead posting sorts them).
      if (all.length > 3 && index > 2) return null;
      const more = all.length > 3 && index === 2 ? `+ ${all.length - 3} more ${all.length - 3 === 1 ? "vendor" : "vendors"}` : undefined;
      const product = productOf(row.vendorId, row.key.campaignId);
      return { id: `vendor:${row.vendorId}`, name: row.vendorName, more, kind: "Lead vendor", what: more ? "Post leads" : product ? `Posts ${product} leads` : "Posts leads", last: row.lastPostAt ? whenWords(row.lastPostAt, now) : "Never", managed: <InlineLink href={LEAD_POSTING_HREF}>Lead posting ›</InlineLink>, chip: { label: STATUS_LABEL[row.status], tone: STATUS_TONE[row.status] }, group: "vendors", needsYou: row.status === "needs_you" };
    }).filter((row): row is Row => row !== null),
    ...(extension && extension !== "off"
      ? [{ id: "extension", name: "Browser extension", kind: "Extension", what: `Fills ${extension.sites} carrier ${extension.sites === 1 ? "site" : "sites"}`, last: extension.lastAt ? whenWords(extension.lastAt, now) : "Not used yet", managed: <InlineLink href={EXTENSION_HREF}>Browser extension ›</InlineLink>, chip: extension.sites ? { label: "Working", tone: "good" as ChipTone } : { label: "No carrier sites", tone: "neutral" as ChipTone }, group: "extension" as const, needsYou: false }]
      : []),
  ];

  const count = (which: Filter) => (which === "all" ? rows.length : which === "needs_you" ? rows.filter((row) => row.needsYou).length : rows.filter((row) => row.group === which).length);
  const shown = rows.filter((row) => filter === "all" || (filter === "needs_you" ? row.needsYou : row.group === filter));

  const usedToday = appKeys.filter((key) => whenWords(key.lastUsedAt, now).startsWith("Today")).length;
  const idle = appKeys.map((key) => keyStates.get(key.id)).filter((state) => state?.kind === "idle") as KeyState[];
  const hookStates = hooks.map(hookState);
  const working = hookStates.filter((state) => state.kind === "working" || state.kind === "new" || state.kind === "retrying").length;
  const failing = hookStates.filter((state) => state.kind === "failing").length;
  const off = hookStates.filter((state) => state.kind === "off" || state.kind === "paused").length;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      <StatRow label="Who's connected">
        <StatCard label="Apps using a key" value={appKeys.length.toLocaleString("en-US")} period={appKeys.length ? [`${usedToday} used today`, idle.length ? `${idle.length} idle ${Math.max(...idle.map((state) => state.idleDays ?? 0))} days` : ""].filter(Boolean).join(" · ") : "none yet"} />
        <StatCard label="Webhook endpoints" value={hooks.length.toLocaleString("en-US")} period={hooks.length ? [`${working} working`, failing ? `${failing} failing` : "", off ? `${off} off` : ""].filter(Boolean).join(" · ") : "none yet"} tone={failing ? "warn" : "default"} />
        <StatCard label="Lead vendors" value={vendors === null ? "…" : vendors === "off" ? "—" : vendorRows.length.toLocaleString("en-US")} fact={{ label: <>managed in <InlineLink href={LEAD_POSTING_HREF}>Lead posting ›</InlineLink></> }} />
        <StatCard label="Browser extension" value={extension === null ? "…" : extension === "off" ? "—" : <>{extension.sites} <span className="text-sm font-normal text-[var(--muted)]">carrier {extension.sites === 1 ? "site" : "sites"}</span></>} fact={{ label: <InlineLink href={EXTENSION_HREF}>Browser extension ›</InlineLink> }} />
      </StatRow>

      <TableCard
        title="Everything connected to Insurvas"
        className="lg:min-h-0 lg:flex-1"
        bodyClassName="min-h-[200px] overflow-y-auto lg:min-h-0"
        toolbar={
          <Segmented
            label="Show"
            options={[
              { key: "all", label: "All", count: count("all") },
              { key: "apps", label: "Apps", count: count("apps") },
              { key: "webhooks", label: "Webhooks", count: count("webhooks") },
              { key: "vendors", label: "Lead vendors", count: vendors && vendors !== "off" ? vendorRows.length : count("vendors") },
              { key: "needs_you", label: "Needs you", count: count("needs_you"), tone: "danger" },
            ]}
            value={filter}
            onChange={setFilter}
          />
        }
        footer={<span>Lead-vendor keys stay in Lead posting: one vendor, one sheet. This table only shows them so you see everything in one place.</span>}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            hint="Make an API key so another app can read your policies, or add a webhook so it hears about them the moment they happen."
            action={<div className="flex flex-col items-center gap-2"><div className="flex flex-wrap justify-center gap-2">{emptyActions}</div><span className="text-xs text-[var(--muted)]">Lead vendors connect in <InlineLink href={LEAD_POSTING_HREF}>Lead posting</InlineLink></span></div>}
          />
        ) : shown.length === 0 ? (
          <NoMatches noun="connections" onClear={() => setFilter("all")} />
        ) : (
          <table className={st.table} aria-label="Everything connected to Insurvas">
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Name</th>
                <th scope="col" className={st.th}>Kind</th>
                <th scope="col" className={st.th}>What it does</th>
                <th scope="col" className={st.th}>Last activity</th>
                <th scope="col" className={st.th}>Managed in</th>
                <th scope="col" className={st.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={cn(row.open && "cursor-pointer hover:bg-[var(--hover-wash)]")} onClick={row.open}>
                  <td className={cn(st.td, "max-w-[260px] truncate")}>
                    {row.open
                      ? <button type="button" className="max-w-full truncate border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]" aria-label={`Open ${row.name}`} onClick={(event) => { event.stopPropagation(); row.open?.(); }}>{row.name}</button>
                      : <span className="font-semibold text-[var(--ink)]">{row.name}</span>}
                    {row.more && <span className="text-xs text-[var(--muted)]"> {row.more}</span>}
                  </td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{row.kind}</td>
                  <td className={cn(st.td, "max-w-[260px] truncate")}>{row.what}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{row.last}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{row.managed}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={row.chip.tone}>{row.chip.label}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
