"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Callout, SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { sectionHref } from "@/lib/settings/registry";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import {
  AUDITED_SECTIONS, CHANGE_TYPE_LABEL, SETTINGS_CHANGE_TYPES, actorLine, changeLine, sectionLabel,
  type SettingsAuditEntry, type SettingsChangeType,
} from "@/lib/settingsAudit/constants";

/**
 * LA-8.8 · Settings › Settings history. Who changed what, from what, to what, when — newest first,
 * filtered by section, person, change type and dates, exported as the same filtered set. Each row
 * opens the setting where it lives now. Read only: there is nothing here to edit or delete.
 *
 * `mine` draws a person's own entries (their profile), without the person filter.
 */

type Filters = { section: string; actor: string; type: "" | SettingsChangeType; from: string; to: string };

/** Where a section's settings live now; null for a hub with no screen (retention, LA-5.11). */
function hrefFor(sectionKey: string): string | null {
  const section = SETTINGS_SECTIONS.find((s) => s.id === sectionKey);
  return section ? sectionHref(section) : null;
}

/** The history's answer, as the app's cache keeps it under its URL (`query`). */
type HistoryBody = { entries: SettingsAuditEntry[]; actors?: Array<{ id: string; name: string }> };

function query(filters: Filters, mine: boolean, format?: "csv") {
  const params = new URLSearchParams();
  if (filters.section) params.set("section", filters.section);
  if (filters.actor && !mine) params.set("actor", filters.actor);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (mine) params.set("mine", "1");
  if (format) params.set("format", format);
  return `/api/app/settings-audit?${params.toString()}`;
}

/**
 * Entries by the same person, in the same section, in the same minute are one save (owner 2026-11-03):
 * a pipeline save that edits fourteen call outcomes is one row, opened to see each. Anything alone stays a row.
 */
type HistoryItem = { kind: "one"; entry: SettingsAuditEntry } | { kind: "save"; id: string; entries: SettingsAuditEntry[] };
function groupBySave(entries: SettingsAuditEntry[]): HistoryItem[] {
  const order: Array<{ id: string; entries: SettingsAuditEntry[] }> = [];
  const byKey = new Map<string, { id: string; entries: SettingsAuditEntry[] }>();
  for (const entry of entries) {
    const minute = Math.floor(new Date(entry.occurredAt).getTime() / 60_000);
    const key = `${actorLine(entry)}|${entry.sectionKey}|${minute}`;
    const hit = byKey.get(key);
    if (hit) { hit.entries.push(entry); continue; }
    const group = { id: key, entries: [entry] };
    byKey.set(key, group);
    order.push(group);
  }
  return order.map((group): HistoryItem => (group.entries.length > 1 ? { kind: "save", id: group.id, entries: group.entries } : { kind: "one", entry: group.entries[0] }));
}

export function SettingsHistory({ mine = false }: { mine?: boolean }) {
  // A "History" link from a section's "last changed" line opens this filtered to that section. The
  // panel mounts in the browser (its tab is chosen from the hash), so the URL is there to read.
  const [filters, setFilters] = useState<Filters>(() => {
    const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("history");
    return { section: asked && /^[a-z][a-z0-9_-]{1,63}$/.test(asked) ? asked : "", actor: "", type: "", from: "", to: "" };
  });
  const [entries, setEntries] = useState<SettingsAuditEntry[] | null>(() => seed<HistoryBody>(query(filters, mine))?.data?.entries ?? null);
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>(() => seed<HistoryBody>(query(filters, mine))?.data?.actors ?? []);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const zone = useMemo(() => viewerTimeZone(), []);
  const [openSaves, setOpenSaves] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(() => groupBySave(entries ?? []), [entries]);

  // Through the app's cache (lib/client/resource-cache.ts): a repeat visit draws the last answer at once.
  const load = useCallback(
    (fresh = false) =>
      (fresh ? loadResource<HistoryBody>(query(filters, mine)) : readResource<HistoryBody>(query(filters, mine)))
        .then((body) => {
          setEntries(body.entries);
          if (body.actors?.length) setActors(body.actors);
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "Could not read the settings history");
        }),
    [filters, mine],
  );
  useEffect(() => {
    const kept = peek<HistoryBody>(query(filters, mine))?.data;
    if (kept) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
      setEntries((current) => current ?? kept.entries);
      if (kept.actors?.length) setActors((current) => (current.length ? current : kept.actors ?? []));
    }
    void load();
  }, [filters, mine, load]);
  async function reload() {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }

  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const filtered = Boolean(filters.section || filters.actor || filters.type || filters.from || filters.to);
  const header = mine ? null : <SettingsSectionHeader />;

  if (error && !entries) {
    return <SettingsStack>{header}<Callout tone="error" title={error} /></SettingsStack>;
  }
  if (!entries) {
    return <SettingsStack>{header}<TableCard><SectionLoading label="Loading the settings history" /></TableCard></SettingsStack>;
  }

  return (
    <SettingsStack className="min-h-0 flex-1">
      {header}
      <PagedTableCard
        // An empty list centres its one message in the card instead of leaving a blank block under it.
        bodyClassName={entries.length === 0 && !filtered ? "flex flex-col" : undefined}
        total={items.length}
        noun={items.length === entries.length ? "changes" : "changes and saves"}
        // No title: in My profile the History tab and its switch already name this list, and on the
        // Settings history page the section header does.
        // Nothing to filter, export or refresh until there is a change to look at.
        toolbar={entries.length === 0 && !filtered ? undefined : (
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" size="icon" disabled={entries.length === 0} aria-label="Export CSV" title="Export CSV" onClick={() => { window.location.href = query(filters, mine, "csv"); }}>
                  <Download aria-hidden="true" />
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label="Refresh" title="Refresh" disabled={refreshing} onClick={() => void reload()}>
                  <RefreshCw aria-hidden="true" className={cn(refreshing && "animate-spin")} />
                </Button>
              </>
            }
          >
            <select aria-label="Section" className={toolbarControl} value={filters.section} onChange={(e) => set({ section: e.target.value })}>
              <option value="">All sections</option>
              {AUDITED_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {!mine && (
              <select aria-label="Changed by" className={toolbarControl} value={filters.actor} onChange={(e) => set({ actor: e.target.value })}>
                <option value="">Anyone</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <select aria-label="Change" className={toolbarControl} value={filters.type} onChange={(e) => set({ type: e.target.value as Filters["type"] })}>
              <option value="">Any change</option>
              {SETTINGS_CHANGE_TYPES.map((t) => <option key={t} value={t}>{CHANGE_TYPE_LABEL[t]}</option>)}
            </select>
            <input type="date" aria-label="From" className={toolbarControl} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            <input type="date" aria-label="To" className={toolbarControl} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </DataToolbar>
        )}
      >
        {entries.length === 0 ? (
          filtered
            ? <NoMatches noun="changes" onClear={() => setFilters({ section: "", actor: "", type: "", from: "", to: "" })} />
            : <div className="flex flex-1 items-center justify-center"><EmptyState title={mine ? "You have not changed any settings" : "No settings have been changed yet"} hint="Changes appear here as they happen." /></div>
        ) : (
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[170px]")}>When</th>
                <th scope="col" className={cn(st.th, "w-[220px]")}>Who</th>
                <th scope="col" className={st.th}>Setting</th>
                <th scope="col" className={st.th}>Change</th>
                <th scope="col" className={st.th}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <PagedBody>
              {items.map((item) => {
                const entryRow = (entry: SettingsAuditEntry, nested: boolean) => {
                  const href = hrefFor(entry.sectionKey);
                  return (
                    <tr key={entry.id} className={cn(nested && "bg-[var(--surface-alt)]/50")}>
                      <td className={cn(st.td, "whitespace-nowrap")}>{nested ? "" : dateTime(entry.occurredAt, zone)}</td>
                      <td className={st.td}>{nested ? "" : actorLine(entry)}{!nested && entry.source === "migration" && <span className={st.sub}>recorded before this log</span>}</td>
                      <td className={cn(st.td, nested && "pl-8")}>
                        {!nested && <span className="text-[var(--muted)]">{sectionLabel(entry.sectionKey)} → </span>}{entry.settingLabel}
                        {entry.reason && <span className={st.sub}>{entry.reason}</span>}
                      </td>
                      <td className={cn(st.td, "break-words")}>
                        <StatusChip tone="neutral" dot={false}>{CHANGE_TYPE_LABEL[entry.changeType]}</StatusChip> <span className="font-mono text-xs">{changeLine(entry)}</span>
                      </td>
                      <td className={cn(st.td, "whitespace-nowrap text-right")}>
                        {href && <Button asChild variant="outline" size="sm"><a href={href}>Open</a></Button>}
                      </td>
                    </tr>
                  );
                };
                if (item.kind === "one") return entryRow(item.entry, false);
                const first = item.entries[0];
                const open = openSaves.has(item.id);
                const types = new Set(item.entries.map((entry) => entry.changeType));
                const summary = types.size === 1 ? `${item.entries.length} ${CHANGE_TYPE_LABEL[first.changeType].toLowerCase()}` : `${item.entries.length} changes`;
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td className={cn(st.td, "whitespace-nowrap")}>{dateTime(first.occurredAt, zone)}</td>
                      <td className={st.td}>{actorLine(first)}</td>
                      <td className={st.td}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenSaves((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
                          className="flex items-center gap-1.5 text-left font-semibold text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform duration-150", open && "rotate-90")} />
                          <span><span className="font-normal text-[var(--muted)]">{sectionLabel(first.sectionKey)} → </span>{item.entries.length} changes in one save</span>
                        </button>
                      </td>
                      <td className={st.td}><StatusChip tone="neutral" dot={false}>{summary}</StatusChip></td>
                      <td className={st.td} />
                    </tr>
                    {open && item.entries.map((entry) => entryRow(entry, true))}
                  </Fragment>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </SettingsStack>
  );
}
