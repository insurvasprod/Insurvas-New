"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { SelectMenu } from "@/components/ui/select-menu";
import { Sheet } from "@/components/ui/sheet";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { InlineAction, StatusLine, type LineTone } from "@/components/app/settings/business/indexed-form";
import { SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { ChangeDetail, byLine } from "@/components/app/settings/history/change-detail";
import { DateRangeFilter, presetRange, rangeLabel, rangePhrase, type DateRange, type RangeKey } from "@/components/app/settings/history/date-range";
import {
  Avatar, ChangeWords, KindChip, agoWords, clock, dayHeading, dayKey, registryLabel, shortDate, whenWords,
} from "@/components/app/settings/history/parts";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";
import { viewerTimeZone } from "@/lib/format/dates";
import { sectionHref } from "@/lib/settings/registry";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { AUDITED_SECTIONS, type SettingsAuditEntry } from "@/lib/settingsAudit/constants";
import {
  CHANGE_KINDS, KIND_LABEL, KIND_TYPE, areaLabel, changeSentence, describeChange, homeOf, plainHistoryCsv,
  saveKey, sectionFilterLabel, whoName, type ChangeKind, type IdNames,
} from "@/lib/settingsAudit/describe";

/**
 * LA-8.8 · Settings › Settings history, round 8 (owner pick 2026-11-12, one design). Every change
 * anyone makes in Settings, one line a change: When · Who · Section · What changed in plain words
 * ("Price band max $14.50 → $15.00") · Kind, grouped under a day line. Filters are chips (search,
 * dates with presets, section, person, kind); on filters turn green and carry an ×. A row opens a
 * right sheet with Before and After, what the setting does, what was saved with it and its earlier
 * changes; "Open this setting" goes to its section. Read only: nothing here edits or deletes.
 *
 * `mine` draws a person's own entries (My profile › History): no person filter, no Who column, and a
 * change opens in place, since that list already sits in a sheet.
 */

type Filters = { range: DateRange; section: string; actor: string; kind: "" | ChangeKind };

/** Where a section's settings live now; null for a section with no screen of its own. */
function hrefFor(sectionKey: string): string | null {
  const home = homeOf(sectionKey);
  const section = SETTINGS_SECTIONS.find((s) => s.id === home);
  return section ? sectionHref(section) : null;
}

/** The history's answer, as the app's cache keeps it under its URL (`query`). */
type HistoryBody = { entries: SettingsAuditEntry[]; actors?: Array<{ id: string; name: string }>; names?: IdNames };

function query(filters: Filters, mine: boolean) {
  const params = new URLSearchParams();
  if (filters.section) params.set("section", filters.section);
  if (filters.actor && !mine) params.set("actor", filters.actor);
  if (filters.kind) params.set("type", KIND_TYPE[filters.kind]);
  if (filters.range.from) params.set("from", filters.range.from);
  if (filters.range.to) params.set("to", filters.range.to);
  if (mine) params.set("mine", "1");
  return `/api/app/settings-audit?${params.toString()}`;
}

/** The server's row cap (lib/settingsAudit/service.ts): at it, the count says "1,000+". */
const ROW_CAP = 1000;
const PAGE = 50;

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function SettingsHistory({ mine = false }: { mine?: boolean }) {
  const defaultKey: RangeKey = mine ? "90d" : "30d";
  const today = useMemo(() => todayKey(), []);
  // A "See every change" / History link (?history=<section>) opens this filtered to that section.
  // The panel mounts in the browser (its tab is chosen from the hash), so the URL is there to read.
  const initial = useMemo<Filters>(() => {
    const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("history");
    return { range: presetRange(mine ? "90d" : "30d", todayKey()), section: asked && /^[a-z][a-z0-9_-]{1,63}$/.test(asked) ? asked : "", actor: "", kind: "" };
  }, [mine]);
  const [filters, setFilters] = useState<Filters>(initial);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState<HistoryBody | null>(() => seed<HistoryBody>(query(initial, mine))?.data ?? null);
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>(() => seed<HistoryBody>(query(initial, mine))?.data?.actors ?? []);
  const [error, setError] = useState<{ pending: boolean } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const zone = useMemo(() => viewerTimeZone(), []);

  // Through the app's cache (lib/client/resource-cache.ts): a repeat visit draws the last answer at once.
  const load = useCallback(
    (fresh = false) =>
      (fresh ? loadResource<HistoryBody>(query(filters, mine)) : readResource<HistoryBody>(query(filters, mine)))
        .then((next) => {
          setBody(next);
          if (next.actors?.length) setActors(next.actors);
          setError(null);
        })
        .catch((e: unknown) => {
          const code = (e as { body?: { code?: string } } | null)?.body?.code;
          setError({ pending: code === "schema_pending" });
        }),
    [filters, mine],
  );
  useEffect(() => {
    const kept = peek<HistoryBody>(query(filters, mine))?.data;
    if (kept) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
      setBody(kept);
      if (kept.actors?.length) setActors((current) => (current.length ? current : kept.actors ?? []));
    }
    void load();
  }, [filters, mine, load]);

  const set = (patch: Partial<Filters>) => { setFilters((current) => ({ ...current, ...patch })); setShown(PAGE); setOpenId(null); };
  const clearAll = () => { setFilters({ range: presetRange(defaultKey as Exclude<RangeKey, "custom">, today), section: "", actor: "", kind: "" }); setSearch(""); setShown(PAGE); };

  const names = useMemo(() => body?.names ?? {}, [body]);
  const entries = useMemo(() => body?.entries ?? [], [body]);
  // Search reads the words on screen, not the stored keys.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => `${changeSentence(describeChange(entry, names))} ${areaLabel(entry.sectionKey, registryLabel)} ${whoName(entry)}`.toLowerCase().includes(needle));
  }, [entries, names, search]);
  const page = visible.slice(0, shown);
  const open = openId ? entries.find((entry) => entry.id === openId) ?? null : null;
  const together = useMemo(() => (open ? entries.filter((entry) => entry.id !== open.id && saveKey(entry) === saveKey(open)) : []), [entries, open]);

  const narrowed = Boolean(filters.section || filters.actor || filters.kind || search.trim());
  const filtered = narrowed || filters.range.key !== defaultKey;
  const capped = entries.length >= ROW_CAP;
  const count = (n: number) => `${n.toLocaleString("en-US")}${capped && !search.trim() ? "+" : ""} ${n === 1 ? "change" : "changes"}`;
  const personName = actors.find((a) => a.id === filters.actor)?.name ?? null;
  const sectionName = filters.section ? sectionFilterLabel(filters.section, registryLabel) : null;

  // Every audited section, plus any other a row came from, as the Section filter's choices.
  const sectionKeys = useMemo(() => [...new Set([...AUDITED_SECTIONS.map((s) => s.key), ...entries.map((e) => e.sectionKey), ...(filters.section ? [filters.section] : [])])], [entries, filters.section]);
  const sectionOptions = useMemo(
    () => [{ value: "", label: "Every section" }, ...sectionKeys.map((key) => ({ value: key, label: sectionFilterLabel(key, registryLabel) })).sort((a, b) => a.label.localeCompare(b.label))],
    [sectionKeys],
  );

  function exportCsv() {
    const file = `settings-history-${today}.csv`;
    const blob = new Blob([plainHistoryCsv(visible, names, registryLabel)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify.done(`Exported ${count(visible.length).replace("+", "")} · ${file}`);
  }

  /* ── the status line ── */
  let tone: LineTone = "good";
  let line: ReactNode;
  const what = [sectionName, personName ? `by ${personName}` : null].filter(Boolean).join(" ");
  if (error && !body) {
    tone = error.pending ? "warning" : "danger";
    line = error.pending
      ? <>The settings history needs a database update · changes are still saved</>
      : <>Couldn&rsquo;t load the history. <InlineAction onClick={() => void load(true)}>Try again</InlineAction></>;
  } else if (!body) {
    tone = "neutral";
    line = <>Reading the settings history</>;
  } else if (mine) {
    tone = visible.length ? "good" : "neutral";
    line = <>Your own changes · {visible.length.toLocaleString("en-US")} {rangePhrase(filters.range) || "in all"} · the owner sees everyone&rsquo;s in Settings history</>;
  } else if (narrowed) {
    tone = visible.length ? "good" : "neutral";
    line = <>{count(visible.length)} {visible.length === 1 ? "matches" : "match"}{what ? ` · ${what}` : ""}, {rangeLabel(filters.range).replace(/^Last/, "last")}</>;
  } else {
    const newest = entries[0];
    tone = entries.length ? "good" : "neutral";
    line = <>{count(entries.length)} {rangePhrase(filters.range)}{newest ? ` · newest ${agoWords(newest.occurredAt)} by ${whoName(newest)}` : ""}</>;
  }
  if (error && body) { tone = "danger"; line = <>Couldn&rsquo;t refresh the history. <InlineAction onClick={() => void load(true)}>Try again</InlineAction></>; }

  const exportButton = (
    <Button type="button" variant="outline" disabled={!body || visible.length === 0} onClick={exportCsv}>
      <Download aria-hidden="true" />{filtered && body ? `Export ${count(visible.length).replace("+", "")}` : "Export CSV"}
    </Button>
  );
  const header = mine ? null : <SettingsSectionHeader actions={exportButton} />;

  /* ── the filter row ── */
  const chip = (label: string, onRemove: () => void) => <ToggleChip selected onRemove={onRemove}>{label}</ToggleChip>;
  const toolbar = (
    <>
      {!mine && <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setShown(PAGE); }} placeholder="Find a setting…" label="Find a setting" className="sm:w-56" />}
      <DateRangeFilter value={filters.range} today={today} defaultKey={defaultKey} onChange={(range) => set({ range })} />
      {filters.section
        ? chip(sectionName ?? "Section", () => set({ section: "" }))
        : <SelectMenu label="Section" value="" defaultValue="" options={sectionOptions.map((o) => (o.value === "" ? { ...o, triggerLabel: "Section" } : o))} onChange={(section) => set({ section })} searchPlaceholder="Find a section" panelAlign="start" />}
      {!mine && (filters.actor
        ? chip(personName ?? "Person", () => set({ actor: "" }))
        : <SelectMenu label="Person" value="" defaultValue="" options={[{ value: "", label: "Anyone", triggerLabel: "Person" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]} onChange={(actor) => set({ actor })} searchPlaceholder="Find a person" panelAlign="start" />)}
      {filters.kind
        ? chip(KIND_LABEL[filters.kind], () => set({ kind: "" }))
        : <SelectMenu<"" | ChangeKind> label="Kind" value="" defaultValue="" options={[{ value: "", label: "Any kind", triggerLabel: "Kind" }, ...CHANGE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]} onChange={(kind) => set({ kind })} panelAlign="start" />}
      {filtered && <InlineAction onClick={clearAll}>Clear all</InlineAction>}
      <span className="ml-auto flex items-center gap-3 text-xs text-[var(--muted)]">
        {body ? count(visible.length) : null}
        {mine && exportButton}
      </span>
    </>
  );

  /* ── the list ── */
  let content: ReactNode;
  if (error && !body) {
    content = error.pending
      ? <EmptyState title="Not available yet" hint="The settings history turns on with a database update. Every change is still saved." />
      : <ErrorState title="Couldn't load the history" detail="Filters stay as you set them." action={<Button type="button" variant="outline" onClick={() => void load(true)}>Try again</Button>} />;
  } else if (!body) {
    content = <SectionLoading label="Loading the settings history" rows={8} columns={mine ? 4 : 5} />;
  } else if (visible.length === 0) {
    content = filtered
      ? <EmptyState title="No changes match" hint={`Nothing${sectionName ? ` in ${sectionName}` : ""}${personName ? ` by ${personName}` : ""}${search.trim() ? ` for “${search.trim()}”` : ""}${filters.range.key === "all" ? "" : ` ${rangePhrase(filters.range)}`}.`} action={<Button type="button" variant="outline" onClick={clearAll}>Clear filters</Button>} />
      : <EmptyState title={mine ? "You haven't changed any settings yet" : "No changes yet"} hint="Changes appear here as they happen, with who made them." />;
  } else if (mine && open) {
    content = (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpenId(null)}><ChevronLeft aria-hidden="true" />All your changes</Button>
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{describeChange(open, names).label}</span>
        </div>
        <ChangeDetail entry={open} names={names} together={together} zone={zone} mine />
        <OpenSetting entry={open} />
      </div>
    );
  } else {
    const columns = mine ? 5 : 6;
    content = (
      // One line a change: "What changed" takes the room the fixed columns leave (data-even off: the
      // even spread would squeeze the sentence to an equal share).
      <table className={st.table} data-even="off">
        <thead>
          <tr className={st.headRow}>
            <th scope="col" className={cn(st.th, mine ? "w-[120px]" : "w-[96px]")}>When</th>
            {!mine && <th scope="col" className={cn(st.th, "w-[180px]")}>Who</th>}
            <th scope="col" className={cn(st.th, "w-[170px]")}>Section</th>
            <th scope="col" className={st.th}>What changed</th>
            <th scope="col" className={cn(st.th, "w-[110px]")}>Kind</th>
            <th scope="col" className={cn(st.th, "w-[48px]")}><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {page.map((entry, at) => {
            const change = describeChange(entry, names);
            const who = whoName(entry);
            const day = dayKey(entry.occurredAt, zone);
            const dayRow = !mine && (at === 0 || dayKey(page[at - 1].occurredAt, zone) !== day) ? (
              <tr>
                <td colSpan={columns} className="border-t border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">{dayHeading(day, zone)}</td>
              </tr>
            ) : null;
            const selected = openId === entry.id;
            return (
              <Fragment key={entry.id}>
                {dayRow}
                <tr
                  onClick={() => setOpenId(entry.id)}
                  aria-selected={selected || undefined}
                  className={cn("cursor-pointer transition-colors", selected ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--hover-wash)]")}
                >
                  <td className={cn(st.td, "whitespace-nowrap text-[var(--muted)] tabular-nums")}>
                    {mine ? (dayKey(entry.occurredAt, zone) === dayKey(new Date(), zone) ? `Today ${clock(entry.occurredAt, zone)}` : shortDate(entry.occurredAt, zone)) : clock(entry.occurredAt, zone)}
                  </td>
                  {!mine && (
                    <td className={cn(st.td, "whitespace-nowrap text-[var(--ink)]")}>
                      <span className="flex min-w-0 items-center gap-2"><Avatar name={who} /><span className="truncate">{who}</span></span>
                    </td>
                  )}
                  <td className={cn(st.td, "whitespace-nowrap text-[var(--muted)]")}><span className="block max-w-[170px] truncate">{areaLabel(entry.sectionKey, registryLabel)}</span></td>
                  <td className={cn(st.td, "max-w-0 w-full")}>
                    <span className="block truncate" title={changeSentence(change)}><ChangeWords change={change} /></span>
                  </td>
                  <td className={st.td}><KindChip kind={change.kind} /></td>
                  <td className={cn(st.td, "text-right")}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open: ${changeSentence(change)}, ${whenWords(entry.occurredAt, zone)}`}
                      onClick={(event) => { event.stopPropagation(); setOpenId(entry.id); }}
                    >
                      <ChevronRight aria-hidden="true" className="text-[var(--muted)]" />
                    </Button>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }

  const listing = Boolean(body && visible.length && !(mine && open));
  return (
    <SettingsStack className="gap-3 lg:min-h-0 lg:flex-1">
      {header}
      <StatusLine tone={tone}>{line}</StatusLine>
      <TableCard
        className="min-h-[320px] lg:min-h-0 lg:flex-1"
        bodyClassName="min-h-0 overflow-y-auto overscroll-contain"
        toolbar={mine && open ? undefined : toolbar}
        footer={listing ? (
          <>
            <span>Showing {Math.min(shown, visible.length).toLocaleString("en-US")} of {count(visible.length).replace(/ changes?$/, "")}</span>
            {visible.length > shown && <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>Load {Math.min(PAGE, visible.length - shown)} more</Button>}
          </>
        ) : undefined}
      >
        {content}
      </TableCard>

      {!mine && open && (
        <Sheet
          title={<span className="flex min-w-0 items-center gap-2.5"><Avatar name={whoName(open)} size="md" /><span className="truncate">{describeChange(open, names).label}</span></span>}
          subtitle={`${byLine(describeChange(open, names), whoName(open))} · ${whenWords(open.occurredAt, zone)}`}
          onClose={() => setOpenId(null)}
          footer={
            <>
              <Button type="button" variant="outline" className="ml-auto" onClick={() => setOpenId(null)}>Close</Button>
              <OpenSetting entry={open} button />
            </>
          }
        >
          <ChangeDetail entry={open} names={names} together={together} zone={zone} mine={false} />
        </Sheet>
      )}
    </SettingsStack>
  );
}

/** "Open this setting" — its section in Settings; plain words when it no longer has a page. */
function OpenSetting({ entry, button = false }: { entry: SettingsAuditEntry; button?: boolean }) {
  const href = hrefFor(entry.sectionKey);
  if (!href) return <p className="m-0 text-xs text-[var(--muted)]">This setting no longer has a page in Settings.</p>;
  if (button) return <Button asChild><a href={href}>Open this setting</a></Button>;
  return <Button asChild variant="outline" className="self-start"><a href={href}>Open this setting</a></Button>;
}

