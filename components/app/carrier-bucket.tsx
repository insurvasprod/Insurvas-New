"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, X } from "lucide-react";

import { ViewTabs } from "@/components/app/book-of-business-views";
import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { BUCKET_STATE_LABELS, WEEKDAY_SHORT, type BucketRow, type BucketState } from "@/lib/ingestion/bucket";
import type { BucketView } from "@/lib/ingestion/bucketStore";
import { fileDay, fileSize, FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { fileHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";

type Ready = Extract<BucketView, { available: true }>;

const STATE_TONE: Record<BucketState, StatusTone> = { received: "good", reading: "info", failed: "danger", removed: "warning", missing: "danger", unexpected: "warning" };
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC", "Europe/London", "Europe/Belgrade"];
const typeLabel = (type: string | null) => (type && type in FILE_TYPE_LABELS ? FILE_TYPE_LABELS[type as CarrierFileType] : "Not known");
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const zoneName = (zone: string) => zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
const stamp = (iso: string, zone: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone });

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/carrier-files/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work.");
  return data;
}

/**
 * Carrier files › Bucket (2026-10-09): one day of the files an agency's scripts drop into the
 * bucket — expected, received, missing, unexpected — refreshed every 20 seconds while the page is
 * open, checked on the schedule in Settings and by "Check now". Settings say which agency expects
 * which carrier's file on which days, and when the bucket is checked.
 */
export function CarrierBucket({ initial, tenantId, readOnly }: { initial: Ready; tenantId: string; readOnly: boolean }) {
  const [view, setView] = useState<Ready>(initial);
  const [tab, setTab] = useState<"files" | "settings">("files");
  const [date, setDate] = useState(initial.day.date);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (day: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/app/carrier-files/bucket?date=${day}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "The bucket could not be read.");
      setView(data as Ready);
    } catch (error) {
      if (!quiet) notify.block(error instanceof Error ? error.message : "The bucket could not be read.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Live: new, changed and removed files appear on their own while the page is open and visible.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(date, true); }, 20_000);
    return () => window.clearInterval(timer);
  }, [date, load]);

  function goTo(day: string) {
    setDate(day);
    setPage(1);
    void load(day);
  }

  // An unexpected file, expected from now on (weekdays), so the day reads Received.
  async function expect(row: BucketRow) {
    if (!row.carrierId || !row.fileType) return;
    setBusy(true);
    try {
      await post({ action: "add_expectation", agency: row.agency, carrier_id: row.carrierId, file_type: row.fileType, weekdays: [1, 2, 3, 4, 5] });
      notify.done(`${row.carrierName} ${typeLabel(row.fileType).toLowerCase()} expected every weekday. Change it in Settings.`);
      await load(date, true);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    setBusy(true);
    try {
      const outcome = await post({ action: "check_now", date });
      const moved = [outcome.putBack ? `${outcome.putBack} put back` : "", outcome.registered ? `${outcome.registered} read` : "", outcome.removed ? `${outcome.removed} removed` : "", outcome.restored ? `${outcome.restored} back` : ""].filter(Boolean).join(", ");
      notify.done(moved ? `Checked: ${moved}.` : "Checked: nothing new in the bucket.");
      await load(date, true);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The bucket could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  const { day, settings, checks } = view;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return day.rows.filter((row) =>
      (!needle || `${row.agency} ${row.carrierName} ${row.file?.filename ?? ""}`.toLowerCase().includes(needle)) &&
      (!agency || row.agency.toLowerCase() === agency.toLowerCase()) &&
      (!carrier || row.carrierId === carrier) &&
      (!type || row.fileType === type) &&
      (!state || (state === "missing" ? row.state === "missing" || row.state === "removed" : state === "received" ? row.expected && ["received", "reading", "failed"].includes(row.state) : row.state === state)));
  }, [day.rows, query, agency, carrier, type, state]);
  const { current, rows: shown } = paginate(rows, page, 25);
  const filtered = Boolean(query.trim() || agency || carrier || type || state);
  const clear = () => { setQuery(""); setAgency(""); setCarrier(""); setType(""); setState(""); setPage(1); };
  const last = checks[0] ?? null;
  const dayAgencies = [...new Set(day.rows.map((row) => row.agency))].sort((a, b) => a.localeCompare(b));
  const dayCarriers = [...new Map(day.rows.filter((row) => row.carrierId).map((row) => [row.carrierId as string, row.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const folder = `carrier-files/${tenantId}/MM-DD-YYYY/<agency>/<carrier>/<Policies | Commissions | New Business>/`;

  return (
    <div className="flex flex-col gap-4">
      <ViewTabs label="Bucket views" active={tab} onChange={(key) => setTab(key as "files" | "settings")} tabs={[{ key: "files", label: "Files" }, { key: "settings", label: "Settings" }]} />

      {tab === "files" ? (
        <>
          <StatStrip label="The bucket on this day">
            <StatTile label="Expected" value={day.counts.expected.toLocaleString("en-US")} footnote="files the settings expect this day" />
            <StatTile label="Received" value={day.counts.received.toLocaleString("en-US")} footnote="expected files found in the bucket" valueTone={day.counts.expected && day.counts.received === day.counts.expected ? "good" : undefined} />
            <StatTile label="Missing" value={day.counts.missing.toLocaleString("en-US")} footnote="expected files not found" valueTone={day.counts.missing ? "danger" : undefined} />
            <StatTile label="Unexpected" value={day.counts.unexpected.toLocaleString("en-US")} footnote="files in the bucket the settings don't expect" valueTone={day.counts.unexpected ? "warning" : undefined} />
          </StatStrip>
          <p className="m-0 text-sm text-muted-foreground">
            {last ? <>Last checked {stamp(last.checkedAt, settings.timezone)}{last.checkedByName ? ` by ${last.checkedByName}` : ""} ({last.trigger === "manual" ? "Check now" : last.trigger === "schedule" ? "scheduled" : "poll"}) · {checks.length} {checks.length === 1 ? "check" : "checks"} recorded for {fileDay(date)}{last.putBack ? ` · ${last.putBack} deleted ${last.putBack === 1 ? "file" : "files"} put back` : ""}</> : <>No check recorded for {fileDay(date)} yet</>}
            {" · "}{settings.checkTimes.length ? `scheduled daily at ${settings.checkTimes.join(" and ")} ${zoneName(settings.timezone)} time` : "no scheduled checks"}
            {" · "}new files are picked up every 5 minutes
          </p>

          <TableCard
            toolbar={
              <DataToolbar actions={<>
                {filtered && <ClearFiltersButton onClick={clear} />}
                {!readOnly && <Button type="button" disabled={busy} onClick={() => void checkNow()}>{busy ? "Checking…" : "Check now"}</Button>}
                <RefreshButton onClick={() => void load(date)} refreshing={loading} />
              </>}>
                <span className="inline-flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" aria-label="The day before" onClick={() => goTo(shiftDay(date, -1))}><ChevronLeft aria-hidden="true" /></Button>
                  <input type="date" aria-label="Day" className={toolbarControl} value={date} onChange={(event) => { if (event.target.value) goTo(event.target.value); }} />
                  <Button type="button" variant="outline" size="icon" aria-label="The day after" onClick={() => goTo(shiftDay(date, 1))}><ChevronRight aria-hidden="true" /></Button>
                </span>
                <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search agency, carrier or file" />
                <select aria-label="Filter by agency" className={toolbarControl} value={agency} onChange={(event) => { setAgency(event.target.value); setPage(1); }}>
                  <option value="">All agencies</option>
                  {dayAgencies.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
                  <option value="">All carriers</option>
                  {dayCarriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Filter by type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
                  <option value="">Every type</option>
                  {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
                </select>
                <select aria-label="Filter by status" className={toolbarControl} value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}>
                  <option value="">All statuses</option>
                  <option value="received">Received</option>
                  <option value="missing">Missing</option>
                  <option value="unexpected">Unexpected</option>
                  <option value="failed">Can&apos;t be read</option>
                </select>
              </DataToolbar>
            }
            footer={day.rows.length ? <Pager page={current} pageSize={25} total={rows.length} onPage={setPage} noun={rows.length === 1 ? "file" : "files"} /> : undefined}
          >
            {day.rows.length === 0 ? (
              <EmptyState
                title={`Nothing expected or received on ${fileDay(date)}`}
                hint={`Say which files you expect in Settings. Scripts drop them into ${folder}`}
                action={<Button type="button" variant="outline" onClick={() => setTab("settings")}>Open Settings</Button>}
              />
            ) : rows.length === 0 ? (
              <NoMatches noun="files" onClear={clear} />
            ) : (
              <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[180px]">Agency</th>
                    <th className="w-[200px]">Carrier</th>
                    <th className="w-[130px]">Type</th>
                    <th className="w-[170px]">Status</th>
                    <th>File</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => <BucketTableRow key={row.key} row={row} zone={settings.timezone} onExpect={readOnly || busy ? null : () => void expect(row)} />)}
                </tbody>
              </table>
            )}
          </TableCard>
        </>
      ) : (
        <BucketSettings view={view} readOnly={readOnly} folder={folder} onSaved={() => load(date, true)} />
      )}
    </div>
  );
}

function BucketTableRow({ row, zone, onExpect }: { row: BucketRow; zone: string; onExpect: (() => void) | null }) {
  const file = row.file;
  return (
    <tr>
      <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{row.agency}</span></td>
      <td><span className="block whitespace-normal break-words leading-snug">{row.carrierName}</span></td>
      <td>{typeLabel(row.fileType)}</td>
      <td title={file?.problem ?? undefined}>
        <StatusChip tone={STATE_TONE[row.state]}>{BUCKET_STATE_LABELS[row.state]}</StatusChip>
        {row.state === "unexpected" && file && <span className="block text-xs text-muted-foreground">{file.status === "failed" ? "can't be read" : file.removedAt ? "removed from bucket" : "received"}</span>}
        {row.replaced > 0 && <span className="block text-xs text-muted-foreground">replaced {row.replaced} earlier {row.replaced === 1 ? "file" : "files"}</span>}
        {row.state === "unexpected" && onExpect && row.carrierId && row.fileType && <Button type="button" variant="outline" size="sm" className="mt-1" onClick={onExpect} title="Expect this carrier's file every weekday">Expect it</Button>}
      </td>
      <td>
        {file ? (
          <>
            <Link href={fileHref(file.id)} className="block max-w-[360px] truncate text-[var(--accent-ink)] hover:underline" title={file.path}>{file.filename}</Link>
            <span className="block text-xs text-muted-foreground">
              {fileSize(file.bytes)} · {stamp(file.receivedAt, zone)}{file.rows !== null ? ` · ${file.rows.toLocaleString("en-US")} ${file.rows === 1 ? "row" : "rows"}` : ""}
              {file.removedAt ? ` · removed ${stamp(file.removedAt, zone)}` : file.restoredAt ? ` · back ${stamp(file.restoredAt, zone)}` : ""}
            </span>
            {file.problem && <span className="block max-w-[420px] truncate text-xs text-[var(--error-ink)]" title={file.problem}>{file.problem}</span>}
          </>
        ) : <span className="text-muted-foreground">Not in the bucket</span>}
      </td>
    </tr>
  );
}

function BucketSettings({ view, readOnly, folder, onSaved }: { view: Ready; readOnly: boolean; folder: string; onSaved: () => Promise<void> }) {
  const [times, setTimes] = useState<string[]>(view.settings.checkTimes);
  const [zone, setZone] = useState(view.settings.timezone);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ agency: "", carrierId: "", fileType: "policies", weekdays: [1, 2, 3, 4, 5] as number[] });

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await post(body);
      notify.done(done);
      await onSaved();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (days: number[], day: number) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort());
  const zones = TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES];

  return (
    <div className="flex flex-col gap-4">
      <TableCard title="When the bucket is checked" description="Each check puts back any file deleted from the bucket, from its private copy, and reads what arrived. New files are also picked up every 5 minutes.">
        <div className="flex flex-col gap-3 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {times.map((time, index) => (
              <span key={`${time}-${index}`} className="inline-flex items-center gap-1">
                <Input type="time" aria-label={`Check time ${index + 1}`} className="h-9 w-[120px]" value={time} disabled={readOnly} onChange={(event) => setTimes((now) => now.map((t, i) => (i === index ? event.target.value : t)))} />
                {!readOnly && <Button type="button" variant="ghost" size="icon" aria-label={`Remove check time ${time}`} onClick={() => setTimes((now) => now.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button>}
              </span>
            ))}
            {!readOnly && times.length < 24 && <Button type="button" variant="outline" onClick={() => setTimes((now) => [...now, "12:00"])}><Plus aria-hidden="true" />Add a time</Button>}
            <select aria-label="Time zone" className={toolbarControl} value={zone} disabled={readOnly} onChange={(event) => setZone(event.target.value)}>
              {zones.map((name) => <option key={name} value={name}>{name.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          {!readOnly && <div><Button type="button" disabled={busy} onClick={() => void run({ action: "save_settings", check_times: times.filter(Boolean), timezone: zone }, "Settings saved. Run Check now to apply them to this day.")}>Save check times</Button></div>}
          <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Scripts drop files into <code className="rounded bg-[var(--surface-alt)] px-1.5 py-0.5 text-foreground">{folder}</code>
            <Button type="button" variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(folder).then(() => notify.done("Folder copied."), () => notify.block("Copy it by hand: the browser refused.")); }}><Copy aria-hidden="true" />Copy</Button>
          </p>
        </div>
      </TableCard>

      <ExpectationTable view={view} readOnly={readOnly} busy={busy} run={run} toggle={toggle} draft={draft} setDraft={setDraft} />
    </div>
  );
}

function ExpectationTable({ view, readOnly, busy, run, toggle, draft, setDraft }: {
  view: Ready; readOnly: boolean; busy: boolean;
  run: (body: Record<string, unknown>, done: string) => Promise<void>;
  toggle: (days: number[], day: number) => number[];
  draft: { agency: string; carrierId: string; fileType: string; weekdays: number[] };
  setDraft: (value: { agency: string; carrierId: string; fileType: string; weekdays: number[] }) => void;
}) {
  const all = view.expectations;
  const act = run;

  return (
    <TableCard title="Expected files" description="Which file each agency's scripts should drop, for which carrier, on which days.">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Input aria-label="Agency folder" list="bucket-agencies" placeholder="Agency folder, e.g. Heritage" className="h-9 w-[220px]" value={draft.agency} onChange={(event) => setDraft({ ...draft, agency: event.target.value })} />
          <datalist id="bucket-agencies">{view.agencies.map((name) => <option key={name} value={name} />)}</datalist>
          <select aria-label="Carrier" className={toolbarControl} value={draft.carrierId} onChange={(event) => setDraft({ ...draft, carrierId: event.target.value })}>
            <option value="">Choose a carrier</option>
            {view.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="File type" className={toolbarControl} value={draft.fileType} onChange={(event) => setDraft({ ...draft, fileType: event.target.value })}>
            {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
          </select>
          <span className="inline-flex gap-1" role="group" aria-label="Days of the week">
            {WEEKDAY_SHORT.map((label, index) => (
              <Button key={label} type="button" size="sm" variant={draft.weekdays.includes(index) ? "default" : "outline"} aria-pressed={draft.weekdays.includes(index)} onClick={() => setDraft({ ...draft, weekdays: toggle(draft.weekdays, index) })}>{label}</Button>
            ))}
          </span>
          <Button type="button" disabled={busy || !draft.agency.trim() || !draft.carrierId || !draft.weekdays.length} onClick={() => void act({ action: "add_expectation", agency: draft.agency.trim(), carrier_id: draft.carrierId, file_type: draft.fileType, weekdays: draft.weekdays, active: true }, "Expected file added.").then(() => setDraft({ ...draft, carrierId: "" }))}>
            <Plus aria-hidden="true" />Add
          </Button>
        </div>
      )}
      {all.length === 0 ? (
        <EmptyState title="No expected files yet" hint="Add each agency's carrier files above. Until then, every file in the bucket shows as unexpected, and nothing can be missing." />
      ) : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th className="w-[200px]">Agency</th><th className="w-[200px]">Carrier</th><th className="w-[130px]">Type</th><th>Days</th><th className="w-[100px]">Active</th><th className="w-[90px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {all.map((row) => (
              <tr key={row.id}>
                <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{row.agency}</span></td>
                <td><span className="block whitespace-normal break-words leading-snug">{row.carrierName}</span></td>
                <td>{typeLabel(row.fileType)}</td>
                <td>
                  <span className="inline-flex flex-wrap gap-1">
                    {WEEKDAY_SHORT.map((label, index) => (
                      <Button key={label} type="button" size="sm" variant={row.weekdays.includes(index) ? "default" : "outline"} aria-pressed={row.weekdays.includes(index)} disabled={readOnly || busy || (row.weekdays.length === 1 && row.weekdays.includes(index))}
                        onClick={() => void act({ action: "update_expectation", id: row.id, weekdays: toggle(row.weekdays, index), active: row.active }, "Days saved.")}>{label}</Button>
                    ))}
                  </span>
                </td>
                <td><input type="checkbox" aria-label={`${row.agency} ${row.carrierName} active`} className="size-4 accent-[var(--primary)]" checked={row.active} disabled={readOnly || busy} onChange={(event) => void act({ action: "update_expectation", id: row.id, weekdays: row.weekdays, active: event.target.checked }, event.target.checked ? "Expected again." : "Paused.")} /></td>
                <td className="text-right">{!readOnly && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act({ action: "remove_expectation", id: row.id }, "Expected file removed.")}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
