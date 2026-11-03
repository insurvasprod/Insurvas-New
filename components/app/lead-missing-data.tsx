"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Download, MapPin, Upload } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button, buttonVariants } from "@/components/ui/button";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection } from "@/components/ui/bulk-bar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import { LeadsInSlot } from "@/components/app/lead-sources/leads-in-slot";
import { cn } from "@/lib/utils";
import {
  MISSING_COLUMNS, MISSING_FIX_ORDER, MISSING_SAVE_LIMIT, countMissingEdits, displayMissingValue, firstMissing, normalizeMissingValue, parseMissingDataCsv,
  type MissingColumn, type MissingCounts, type MissingDataPage, type MissingDataRow, type MissingEdits, type MissingFilter, type MissingSaveResult,
} from "@/lib/leadDuplicates/missingData";

/**
 * Clean › Missing data (board LirK2, owner 2026-10-29). The leads that miss a phone, a state, a date
 * of birth or an address. Each empty cell is a dashed amber box you type into; "Set state…" fills
 * the selected rows at once; "Download to fix" / "Upload fixed file" round-trips the list through a
 * spreadsheet, matched by lead id. Nothing is written until "Save N changes", which goes through the
 * lead edit, so a new phone number is screened as on the lead itself.
 */

const PAGE_SIZE = 25;
const FILTER_LABEL: Record<MissingFilter, string> = { any: "Any", phone: "Phone", state: "State", dob: "Date of birth", address: "Address" };
/** The dashed amber box an empty cell is (board LirK2). */
const EMPTY_CELL = "h-8 w-full min-w-0 rounded-md border border-dashed border-[var(--warning)] bg-transparent px-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus-visible:border-solid focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";
const PLACEHOLDER: Record<MissingColumn, string> = { phone: "(555) 555-0100", state: "OH", dob: "MM/DD/YYYY", address: "Street address" };
/** Column widths that fit the step's column at 1440px with Campaign in view. */
const COLUMN_WIDTH: Record<MissingColumn, string> = { phone: "w-[140px]", state: "w-[72px]", dob: "w-[124px]", address: "w-[200px]" };
/** Why a lead's empty cells are greyed out: it was saved on another lead form, which the lead edit will not fill from here. */
const NOT_HERE = "This lead was saved on a different lead form from yours, so its fields can't be filled in from this table. Open the lead to fill them in there.";

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/** What the page's "next up" line needs from this tab: the held edits, whether they are saving, and the filter on screen. */
export type MissingDataStatus = { held: number; saving: boolean; filter: MissingFilter };

export function LeadMissingData({ tabs, inFrame, readOnly, initialFilter = null, initialCampaign = null, counts, ask = null, saveRequest = 0, onTotal, onStatus, onSaved }: {
  /** The page's tabs: drawn first in the top row, with this tab's filters after them. */
  tabs: ReactNode;
  inFrame: boolean;
  readOnly: boolean;
  /** From ?missing=. Null: open on the most fixable field (see firstMissing), not on everything. */
  initialFilter?: MissingFilter | null;
  initialCampaign?: string | null;
  /** Leads missing each field; undefined while they are read, null when they could not be. */
  counts?: MissingCounts | null;
  /** The "next up" line asking for a field (a new nonce each time it is pressed). */
  ask?: { filter: MissingFilter; nonce: number } | null;
  /** Bumped by the "next up" line's "Save N changes". */
  saveRequest?: number;
  onTotal?: (total: number | null) => void;
  onStatus?: (status: MissingDataStatus) => void;
  /** After a save that wrote something, so the page can recount. */
  onSaved?: () => void;
}) {
  // Opens on the field the "next up" line names (state first: it blocks calling), never on "Any";
  // while the counts are still being read, on state, and once they land, on the first one with leads.
  const autoFilter = (known: MissingCounts | null | undefined): MissingFilter => {
    const first = firstMissing(known);
    return first ? first.column : known && MISSING_FIX_ORDER.every((column) => known[column] === 0) ? "any" : "state";
  };
  const [filter, setFilter] = useState<MissingFilter>(() => ask?.filter ?? initialFilter ?? autoFilter(counts));
  /** Still choosing the filter for the reader: no ?missing=, no ask, nothing picked yet. */
  const [auto, setAuto] = useState(!ask && !initialFilter);
  const [askSeen, setAskSeen] = useState(ask?.nonce ?? 0);
  const [campaign, setCampaign] = useState<string>(initialCampaign ?? "all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MissingDataPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<MissingEdits>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [onlyStaged, setOnlyStaged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const [bulkState, setBulkState] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  /** Every row read so far, so a held change from another page or the file still shows its lead. */
  const [seen, setSeen] = useState<Record<string, MissingDataRow>>({});
  const ticket = useRef(0);
  const scope = useRef<HTMLDivElement>(null);

  // Adjusting state while rendering (React's alternative to an effect that paints the old filter first):
  // the counts landing settle the opening filter; a press on the "next up" line switches to its field.
  if (auto && counts !== undefined) {
    setAuto(false);
    const picked = autoFilter(counts);
    if (picked !== filter) { setFilter(picked); setPage(0); }
  }
  if (ask && ask.nonce !== askSeen) {
    setAskSeen(ask.nonce);
    setAuto(false);
    if (ask.filter !== filter) { setFilter(ask.filter); setPage(0); setOnlyStaged(false); }
  }

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ missing: filter, page: String(page), pageSize: String(PAGE_SIZE) });
      if (campaign !== "all") params.set("campaign", campaign);
      const response = await fetch(`/api/app/contacts/missing-data?${params}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body) throw new Error(typeof body?.error === "string" ? body.error : "Could not load leads with missing data");
      if (mine !== ticket.current) return;
      const next = body as unknown as MissingDataPage;
      setSeen((current) => ({ ...current, ...Object.fromEntries(next.rows.map((row) => [row.id, row])) }));
      setData(next);
      setError(null);
      if (filter === "any" && campaign === "all") onTotal?.(next.total);
    } catch (failure) {
      if (mine === ticket.current) setError(failure instanceof Error ? failure.message : "Could not load leads with missing data");
    } finally { if (mine === ticket.current) setLoading(false); }
  }, [filter, campaign, page, onTotal]);

  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  const changeCount = countMissingEdits(edits);
  const stagedIds = Object.keys(edits);
  const rows: MissingDataRow[] = useMemo(() => {
    if (!onlyStaged) return data?.rows ?? [];
    return Object.keys(edits).map((id) => seen[id] ?? { id, name: fileNames[id] || "Lead from your file", campaignId: null, campaign: null, phone: null, state: null, dob: null, address: null, editable: true });
  }, [onlyStaged, data, edits, fileNames, seen]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const editable = data?.editable ?? { phone: true, state: true, dob: true, address: true };

  function stage(leadId: string, column: MissingColumn, value: string) {
    setEdits((current) => {
      const values = { ...current[leadId] };
      if (value.trim()) values[column] = value; else delete values[column];
      const next = { ...current };
      if (Object.keys(values).length) next[leadId] = values; else delete next[leadId];
      return next;
    });
    setFailures((current) => { if (!current[leadId]) return current; const next = { ...current }; delete next[leadId]; return next; });
  }

  function discard() { setEdits({}); setFailures({}); setFileNames({}); setOnlyStaged(false); }

  async function save(): Promise<boolean> {
    // Checked here first, so a typo is pointed at before anything is sent.
    const clean: MissingEdits = {};
    const invalid: Record<string, string> = {};
    for (const [leadId, values] of Object.entries(edits)) {
      for (const [column, raw] of Object.entries(values) as Array<[MissingColumn, string]>) {
        const checked = normalizeMissingValue(column, raw);
        if ("error" in checked) { invalid[leadId] = `${MISSING_COLUMNS.find((item) => item.key === column)?.label}: ${checked.error}`; continue; }
        clean[leadId] = { ...clean[leadId], [column]: checked.value };
      }
    }
    if (Object.keys(invalid).length) {
      setFailures(invalid);
      notify.block(`${Object.keys(invalid).length} lead${Object.keys(invalid).length === 1 ? " has" : "s have"} a value to fix first`, { detail: Object.values(invalid)[0] });
      return false;
    }
    if (Object.keys(clean).length > MISSING_SAVE_LIMIT) { notify.block(`Save at most ${MISSING_SAVE_LIMIT} leads at a time`); return false; }
    setSaving(true);
    try {
      const response = await fetch("/api/app/contacts/missing-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits: clean }) });
      const body = await readJson(response);
      if (!response.ok || !body) { notify.block("Could not save", { detail: typeof body?.error === "string" ? body.error : "Try again." }); return false; }
      const result = body as unknown as MissingSaveResult;
      const failed = Object.fromEntries(result.failed.map((item) => [item.leadId, item.error]));
      // The saved leads leave the held edits; the ones refused stay, with the reason on their row.
      setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => failed[id])));
      setFailures(failed);
      if (result.failed.length) notify.warn(`${result.saved.length} saved, ${result.failed.length} not saved`, { detail: result.failed[0].error });
      else notify.done(`${result.saved.length} lead${result.saved.length === 1 ? "" : "s"} saved`);
      if (!result.failed.length) setOnlyStaged(false);
      if (result.saved.length) onSaved?.();
      await load();
      return result.failed.length === 0;
    } catch (failure) {
      notify.fail("Could not save", { detail: failure instanceof Error ? failure.message : undefined });
      return false;
    } finally { setSaving(false); }
  }

  // The page's "next up" line reads the held edits and the filter, and its "Save N changes" lands here.
  useEffect(() => { onStatus?.({ held: changeCount, saving, filter }); }, [changeCount, saving, filter, onStatus]);
  useEffect(() => () => onStatus?.({ held: 0, saving: false, filter: "any" }), [onStatus]);
  const saveSeen = useRef(saveRequest);
  useEffect(() => {
    if (saveRequest === saveSeen.current) return;
    saveSeen.current = saveRequest;
    void save();
  }, [saveRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const parsed = parseMissingDataCsv(await file.text());
      // The file carries the values a lead already had; only the cells that were empty are changes.
      for (const [id, values] of Object.entries(parsed.edits)) {
        const known = seen[id];
        if (!known) continue;
        for (const column of Object.keys(values) as MissingColumn[]) if (known[column]) delete values[column];
        if (!Object.keys(values).length) delete parsed.edits[id];
      }
      const count = Object.keys(parsed.edits).length;
      if (!count) { notify.warn("Nothing to fill in", { detail: parsed.errors[0] ?? "The file has no new values in phone, state, date_of_birth or address." }); return; }
      setEdits((current) => {
        const next = { ...current };
        for (const [id, values] of Object.entries(parsed.edits)) next[id] = { ...next[id], ...values };
        return next;
      });
      setFileNames((current) => ({ ...current, ...parsed.names }));
      setOnlyStaged(true);
      const title = `${count.toLocaleString()} lead${count === 1 ? "" : "s"} from your file, ready to review`;
      if (parsed.errors.length) notify.warn(title, { detail: `${parsed.errors.length} cell${parsed.errors.length === 1 ? "" : "s"} skipped · ${parsed.errors[0]}` });
      else notify.done(title, { detail: "Nothing is saved until you press Save." });
    } catch (failure) {
      notify.block("Could not read the file", { detail: failure instanceof Error ? failure.message : undefined });
    } finally { event.target.value = ""; setUploading(false); }
  }

  function applyBulkState(event: React.FormEvent) {
    event.preventDefault();
    const checked = normalizeMissingValue("state", bulkState);
    if ("error" in checked) { setBulkError(checked.error); return; }
    // Only the selected rows still missing a state: a value a lead has is changed on the lead.
    const targets = rows.filter((row) => selection.isSelected(row.id) && !row.state && row.editable);
    for (const row of targets) stage(row.id, "state", checked.value);
    notify.done(`State ${checked.value} set on ${targets.length} lead${targets.length === 1 ? "" : "s"}`, { detail: "Nothing is saved until you press Save." });
    setStateOpen(false); setBulkState(""); setBulkError(null); selection.clear();
  }

  const downloadHref = (() => {
    const params = new URLSearchParams({ missing: filter, format: "csv" });
    if (campaign !== "all") params.set("campaign", campaign);
    return `/api/app/contacts/missing-data?${params}`;
  })();

  // Each field with how many leads miss it (owner 2026-10-30), in fix order; "Any" stays, to see them all.
  const countOf = (key: MissingFilter) => (key === "any" ? null : counts?.[key] ?? null);
  const filterOptions = (["any", ...MISSING_FIX_ORDER] as MissingFilter[]).map((key) => {
    const count = countOf(key);
    const label = count === null ? FILTER_LABEL[key] : `${FILTER_LABEL[key]} · ${count.toLocaleString()}`;
    return { value: key, label, triggerLabel: `Missing: ${label}` };
  });
  const campaignOptions = [{ value: "all", label: "All", triggerLabel: "Campaign: All" }, ...(data?.campaigns ?? []).map((item) => ({ value: item.id, label: item.name, triggerLabel: `Campaign: ${item.name}` }))];

  const topRow = (
    <>
      {tabs}
      <SelectMenu label="Missing" value={filter} defaultValue="any" options={filterOptions} onChange={(value) => { setAuto(false); setFilter(value); setPage(0); setOnlyStaged(false); }} className="w-auto" />
      <SelectMenu label="Campaign" value={campaign} defaultValue="all" options={campaignOptions} onChange={(value) => { setCampaign(value); setPage(0); setOnlyStaged(false); }} searchPlaceholder="Search campaigns" className="w-auto max-w-56" />
    </>
  );
  // The frame's corner (owner 2026-10-30), all outline: the page's one primary is the "next up" line,
  // which becomes "Save N changes" while edits are held.
  const corner = (
    <>
      <Button asChild variant="outline"><a href={downloadHref} download><Download aria-hidden="true" />Download to fix</a></Button>
      <label htmlFor="missing-data-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", (readOnly || uploading) && "pointer-events-none opacity-40")}>
        <Upload aria-hidden="true" />{uploading ? "Reading…" : "Upload fixed file"}
        <input id="missing-data-file" type="file" accept=".csv,text/csv" className="sr-only" disabled={readOnly || uploading} onChange={(event) => void upload(event)} />
      </label>
      {/* Held edits are written only here (or by the "next up" line); greyed out, it says why. */}
      <Button type="button" variant="outline" disabled={readOnly || saving || !changeCount} onClick={() => void save()}>
        {saving ? "Saving…" : changeCount ? `Save ${changeCount.toLocaleString()} change${changeCount === 1 ? "" : "s"}` : "No changes to save"}
      </Button>
    </>
  );

  const total = data?.total ?? null;
  const approxTotal = total ?? (data ? data.page * PAGE_SIZE + data.rows.length + (data.rows.length === PAGE_SIZE ? 1 : 0) : 0);

  return (
    <div ref={scope} className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      {inFrame ? (
        <><LeadsInSlot slot="lead">{topRow}</LeadsInSlot><LeadsInSlot slot="continue">{corner}</LeadsInSlot></>
      ) : (
        <div className="flex flex-wrap items-center gap-3">{topRow}<span className="ml-auto flex flex-wrap items-center gap-2">{corner}</span></div>
      )}
      <LeaveGuard dirty={changeCount > 0} scope={scope} onSave={save} onDiscard={discard} what="the missing data" />

      {error && !data ? (
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">{error}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></span>} />
      ) : !data ? (
        <PageLoading />
      ) : (
        <TableCard
          className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>.overflow-x-auto]:flex-1 lg:[&>.overflow-x-auto]:min-h-0 lg:[&>.overflow-x-auto]:overflow-y-auto"
          toolbar={stagedIds.length ? (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <ToggleChip selected={!onlyStaged} onClick={() => setOnlyStaged(false)}>All missing</ToggleChip>
              <ToggleChip selected={onlyStaged} onClick={() => setOnlyStaged(true)}>Held changes · {stagedIds.length.toLocaleString()}</ToggleChip>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={discard}>Discard changes</Button>
            </div>
          ) : undefined}
          footer={onlyStaged ? undefined : <Pager page={data.page + 1} total={approxTotal} approximate={total === null} noun={approxTotal === 1 ? "lead" : "leads"} pageSize={PAGE_SIZE} disabled={loading} onPage={(next) => setPage(next - 1)} />}
        >
          {/* Board LirK2: the bulk bar acts on the ticked rows. Park and Remove from calling have no safe path yet. */}
          <BulkBar
            count={selection.count}
            noun={["lead", "leads"]}
            onClear={selection.clear}
            actions={<Button type="button" variant="outline" disabled={readOnly || !editable.state} onClick={() => { setBulkError(null); setStateOpen(true); }}><MapPin aria-hidden="true" />Set state…</Button>}
          />
          <div aria-busy={loading}>
            {rows.length ? (
              // Fits the step's column at 1440px (owner 2026-10-30: Campaign was cut off): narrow fixed
              // columns, a two-letter state, and the address and campaign wrap instead of widening the table.
              <Table aria-label="Leads with missing data" className="min-w-[760px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><SelectAllCheckbox selection={selection} /></TableHead>
                    <TableHead>Name</TableHead>
                    {MISSING_COLUMNS.map((column) => <TableHead key={column.key} className={COLUMN_WIDTH[column.key]}>{column.label}</TableHead>)}
                    <TableHead className="w-[136px]">Campaign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const held = edits[row.id] ?? {};
                    const failure = failures[row.id];
                    return (
                      <TableRow key={row.id} data-state={selection.isSelected(row.id) ? "selected" : undefined}>
                        <TableCell><RowCheckbox selection={selection} id={row.id} label={`Select ${row.name}`} /></TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="block truncate font-semibold text-[var(--ink)]" title={row.name}>{row.name}</span>
                          {failure && <span role="alert" className="block text-xs leading-[1.5] text-[var(--error-ink)]">{failure}</span>}
                          {/* Owner 2026-10-30: the old lead-form chip was cryptic. The lead was saved on a lead
                              form other than yours, so the lead edit refuses a fill from here; its own page can fix it. */}
                          {!row.editable && (
                            <Link href={`/app/leads/${row.id}`} title={NOT_HERE} className="inline-flex items-center gap-1 text-xs leading-[1.5] font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">
                              Edit on the lead<ArrowRight aria-hidden="true" className="size-3" />
                            </Link>
                          )}
                        </TableCell>
                        {MISSING_COLUMNS.map((column) => {
                          const value = row[column.key];
                          return (
                            <TableCell key={column.key} className={column.key === "address" ? "whitespace-normal" : undefined}>
                              {value ? (
                                <span className={cn("text-[var(--ink)] tabular-nums", column.key === "address" && "line-clamp-2 break-words")} title={column.key === "address" ? value : undefined}>{displayMissingValue(column.key, value)}</span>
                              ) : (
                                <input
                                  aria-label={`${column.label} for ${row.name}`}
                                  aria-invalid={Boolean(failure && failure.startsWith(column.label)) || undefined}
                                  className={cn(EMPTY_CELL, held[column.key] && "border-solid border-[var(--primary)]")}
                                  placeholder={PLACEHOLDER[column.key]}
                                  maxLength={column.key === "state" ? 2 : column.key === "address" ? 200 : 20}
                                  value={held[column.key] ?? ""}
                                  disabled={readOnly || saving || !row.editable || !editable[column.key]}
                                  title={!editable[column.key] ? `Your lead form has no ${column.label.toLowerCase()} field` : !row.editable ? NOT_HERE : undefined}
                                  onChange={(event) => stage(row.id, column.key, column.key === "state" ? event.target.value.toUpperCase() : event.target.value)}
                                />
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="whitespace-normal text-[var(--ink)]"><span className="line-clamp-2 break-words" title={row.campaign ?? undefined}>{row.campaign ?? "—"}</span></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="Nothing missing" hint={filter === "any" && campaign === "all" ? "Every lead has a phone, state, date of birth and address." : "No lead in this filter misses that."} />
            )}
          </div>
        </TableCard>
      )}

      <Dialog open={stateOpen} onOpenChange={setStateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Set state</DialogTitle>
            <DialogDescription>On the {selection.count.toLocaleString()} selected lead{selection.count === 1 ? "" : "s"} that miss one. Held until you save.</DialogDescription>
          </DialogHeader>
          <form onSubmit={applyBulkState} className="grid gap-3">
            <Field label="State code" htmlFor="missing-bulk-state"><input id="missing-bulk-state" className={control} maxLength={2} autoFocus value={bulkState} onChange={(event) => setBulkState(event.target.value.toUpperCase())} /></Field>
            {bulkError && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{bulkError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStateOpen(false)}>Cancel</Button>
              <Button type="submit">Set state</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
