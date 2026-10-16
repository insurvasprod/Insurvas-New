"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Callout, SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
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

export function SettingsHistory({ mine = false }: { mine?: boolean }) {
  // A "History" link from a section's "last changed" line opens this filtered to that section. The
  // panel mounts in the browser (its tab is chosen from the hash), so the URL is there to read.
  const [filters, setFilters] = useState<Filters>(() => {
    const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("history");
    return { section: asked && /^[a-z][a-z0-9_-]{1,63}$/.test(asked) ? asked : "", actor: "", type: "", from: "", to: "" };
  });
  const [entries, setEntries] = useState<SettingsAuditEntry[] | null>(null);
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const zone = useMemo(() => viewerTimeZone(), []);

  const load = useCallback(
    () =>
      fetch(query(filters, mine), { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not read the settings history");
          return body;
        })
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
  useEffect(() => { void load(); }, [load]);
  async function reload() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
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
    <SettingsStack>
      {header}
      <PagedTableCard
        total={entries.length}
        noun="changes"
        // One title per screen: the section header already says "Settings history".
        title={mine ? "Your settings changes" : undefined}
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" disabled={entries.length === 0} onClick={() => { window.location.href = query(filters, mine, "csv"); }}>
                  <Download aria-hidden="true" />
                  Export CSV
                </Button>
                <RefreshButton onClick={() => void reload()} refreshing={refreshing} />
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
        }
      >
        {entries.length === 0 ? (
          filtered
            ? <NoMatches noun="changes" onClear={() => setFilters({ section: "", actor: "", type: "", from: "", to: "" })} />
            : <EmptyState title={mine ? "You have not changed any settings" : "No settings have been changed yet"} hint="Changes to your agency, team, plan, integrations, calling hours, pipelines, outcomes, accounting, compliance, sales and carrier settings appear here." />
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
              {entries.map((entry) => {
                const href = hrefFor(entry.sectionKey);
                return (
                  <tr key={entry.id}>
                    <td className={cn(st.td, "whitespace-nowrap")}>{dateTime(entry.occurredAt, zone)}</td>
                    <td className={st.td}>{actorLine(entry)}{entry.source === "migration" && <span className={st.sub}>recorded before this log</span>}</td>
                    <td className={st.td}>
                      <span className="text-[var(--muted)]">{sectionLabel(entry.sectionKey)} →</span> {entry.settingLabel}
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
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </SettingsStack>
  );
}
