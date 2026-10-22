"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, X } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { CARRIER_FILE_ACCEPT, FILE_TYPE_LABELS } from "@/lib/ingestion/constants";
import { guessTargetField, isKeptEntry, mapProblems, TARGET_FIELDS, TRANSFORMS_FOR, type LayoutEntry, type Transform } from "@/lib/ingestion/layout";
import type { AssignmentView, CarrierOption, LayoutMapView, WaitingFile } from "@/lib/ingestion/layoutAdmin";
import { keptEntry, nextKeptField } from "@/lib/ingestion/layoutDraft";
import { notify } from "@/lib/notify";

import { KEPT, STATUS, TRANSFORM_LABEL, call, draftOf, enumValues, mergeColumns, payload, readPdfText, readSample, type Draft } from "./shared";

type Tab = "columns" | "settings" | "carriers" | "versions";
const select = `${toolbarControl} w-full`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

/**
 * One layout map on its own page (redesign 2026-10-14, owner request). Every column of the carrier's
 * file is listed: a column the software uses is mapped to one of its fields; every other column is
 * kept as information, read into no field and shown to the agent with the row. Tabs: the columns,
 * how the file is laid out, the carriers it reads for, and its versions. A draft is edited and
 * published; a live version is frozen, and changing it starts the next version (LA-4.3).
 */
export function LayoutDetail({ layoutKey, initialVersions, initialAssignments, carriers }: { layoutKey: string; initialVersions: LayoutMapView[]; initialAssignments: AssignmentView[]; carriers: CarrierOption[] }) {
  const router = useRouter();
  const [versions, setVersions] = useState(initialVersions);
  const [assignments, setAssignments] = useState(initialAssignments);
  const sorted = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);
  const preferred = sorted.find((map) => map.status === "draft" || map.status === "in_review") ?? sorted.find((map) => map.status === "published") ?? sorted[0];
  const [openId, setOpenId] = useState(preferred?.id ?? "");
  const open = versions.find((map) => map.id === openId) ?? preferred;
  const [draft, setDraft] = useState<Draft | null>(open ? draftOf(open) : null);
  const [tab, setTab] = useState<Tab>("columns");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "used" | "kept">("all");
  const [page, setPage] = useState(1);
  const [versionPage, setVersionPage] = useState(1);
  const [carrierPage, setCarrierPage] = useState(1);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [waitingFor, setWaitingFor] = useState<{ fileType: string; files: WaitingFile[] } | null>(null);
  const [assignCarrier, setAssignCarrier] = useState("");
  const sampleInput = useRef<HTMLInputElement>(null);

  const editable = open?.status === "draft" || open?.status === "in_review";
  const openDraft = sorted.find((map) => map.status === "draft" || map.status === "in_review") ?? null;
  const liveVersion = sorted.find((map) => map.status === "published") ?? null;
  // Removed: no live version and no draft (removeLayout); a new version brings it back.
  const removed = !openDraft && !liveVersion;

  // A different version opened, or the same one saved: the form starts from what is stored
  // (adjusted while rendering, not in an effect, so it never renders the old draft first).
  const openKey = open ? `${open.id}|${open.updatedAt}` : "";
  const [draftKey, setDraftKey] = useState(openKey);
  if (draftKey !== openKey) {
    setDraftKey(openKey);
    if (open) { setDraft(draftOf(open)); setProblems([]); }
  }

  // Files held back for want of a layout of this type: real headers to fill a draft from. Kept with
  // the file type they were fetched for, and shown only while that type is open for editing.
  const waiting = open && editable && waitingFor?.fileType === open.fileType ? waitingFor.files : [];
  useEffect(() => {
    if (!open || !editable) return;
    let live = true;
    const fileType = open.fileType;
    call<{ files: WaitingFile[] }>(`/api/admin/layout-maps/sample-headers?file_type=${fileType}`).then((data) => { if (live) setWaitingFor({ fileType, files: data.files }); }).catch(() => { if (live) setWaitingFor({ fileType, files: [] }); });
    return () => { live = false; };
  }, [open?.id, open?.fileType, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !draft) return null;
  const fields = TARGET_FIELDS[open.fileType];
  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  const pdf = readPdfText(draft.pdfText);
  const localProblems = editable ? [...mapProblems({ fileType: open.fileType }, draft.entries.map((entry) => ({ ...entry, enumValues: entry.dataType === "enum" ? enumValues(entry.enumText) : null }))), ...pdf.problems] : [];
  const used = draft.entries.filter((entry) => !isKeptEntry(entry)).length;
  const kept = draft.entries.length - used;
  const dirty = JSON.stringify(payload(draft)) !== JSON.stringify(payload(draftOf(open)));

  const rows = draft.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
    if (show === "used" && isKeptEntry(entry)) return false;
    if (show === "kept" && !isKeptEntry(entry)) return false;
    const words = query.trim().toLowerCase();
    return !words || entry.sourceColumn.toLowerCase().includes(words) || (!isKeptEntry(entry) && label(entry.targetField).toLowerCase().includes(words));
  });
  const shown = paginate(rows, page);
  const lastPage = (count: number) => Math.max(1, Math.ceil(count / 10));

  async function reload(select?: string) {
    const data = await call<{ maps: LayoutMapView[]; assignments: AssignmentView[] }>("/api/admin/layout-maps");
    setVersions(data.maps.filter((map) => map.layoutKey === layoutKey));
    setAssignments(data.assignments.filter((row) => row.layoutKey === layoutKey));
    if (select) setOpenId(select);
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblems([]);
    try {
      await action();
    } catch (error) {
      setProblems((error as { problems?: string[] }).problems ?? []);
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const update = (index: number, change: Partial<Draft["entries"][number]>) => setDraft({ ...draft, entries: draft.entries.map((item, at) => (at === index ? { ...item, ...change } : item)) });

  const save = (then?: () => Promise<void>) => run("save", async () => {
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}`, { method: "PUT", body: JSON.stringify(payload(draft)) });
    setVersions((current) => current.map((item) => (item.id === map.id ? map : item)));
    if (then) await then();
    else notify.done(`Draft v${map.version} saved.`);
  });
  const publish = () => save(async () => {
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/publish`, { method: "POST" });
    await reload(map.id);
    router.refresh();
    notify.done(`Version ${map.version} is live.`);
  });

  // Every header of a waiting file: a header that names one of our fields is used for it, every other is kept.
  const fillFrom = (fileId: string) => run("fill", async () => {
    const { headers } = await call<{ headers: string[] }>(`/api/admin/layout-maps/sample-headers?file_id=${fileId}`);
    const incoming = headers.map((header, index): LayoutEntry => {
      const field = fields.find((item) => item.key === guessTargetField(open.fileType, header));
      return field ? { sourceColumn: header, targetField: field.key, dataType: field.dataType, transform: "none", required: false, enumValues: field.dataType === "enum" ? {} : null } : keptEntry(header, String(index + 1));
    });
    const merged = mergeColumns(draft.entries, incoming);
    setDraft({ ...draft, entries: merged.entries });
    setShow("all"); setQuery(""); setPage(lastPage(merged.entries.length));
    notify.done(merged.added ? `${merged.added} column${merged.added === 1 ? "" : "s"} added. Check each one before saving.` : "Every column of that file is already listed.");
  });
  const fillFromSample = (file: File) => run("sample", async () => {
    const sample = await readSample(file, open.fileType, draft.sheetName.trim() || null);
    const chosen = sample.tables[0];
    const merged = mergeColumns(draft.entries, (chosen?.draft ?? sample.draft).entries);
    setDraft({ ...draft, entries: merged.entries, pdfText: !draft.pdfText.trim() && chosen ? JSON.stringify(chosen.layout, null, 2) : draft.pdfText });
    setShow("all"); setQuery(""); setPage(lastPage(merged.entries.length));
    notify.done(merged.added ? `${merged.added} column${merged.added === 1 ? "" : "s"} added from ${file.name}. Check each one before saving.` : `Every column of ${file.name} is already listed.`);
  });

  const removeButton = !removed ? <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={busy !== null} onClick={() => setRemoving(true)}>Delete layout</Button> : null;
  const actions = editable ? (
    <>
      {removeButton}
      <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setDeleting(true)}>Delete draft</Button>
      <Button type="button" variant="outline" disabled={busy !== null || !dirty} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
      <Button type="button" disabled={busy !== null || localProblems.length > 0} title={localProblems[0]} onClick={publish}>Publish v{open.version}</Button>
    </>
  ) : (
    <>
      {removeButton}
      {open.status === "published" && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => run("retire", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/retire`, { method: "POST" }); await reload(map.id); notify.done(`Version ${map.version} retired.`); })}>Retire</Button>}
      {openDraft
        ? <Button type="button" onClick={() => setOpenId(openDraft.id)}>Open draft v{openDraft.version}</Button>
        : <Button type="button" disabled={busy !== null} onClick={() => run("version", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/versions`, { method: "POST" }); await reload(map.id); notify.done(`Version ${map.version} started as a draft.`); })}>{removed ? "Bring it back" : "Change it"}: start v{(sorted[0]?.version ?? open.version) + 1}</Button>}
    </>
  );

  const errors = problems.length ? problems : editable ? localProblems : [];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={open.name} subtitle={`${FILE_TYPE_LABELS[open.fileType]} · ${layoutKey}${removed ? " · deleted" : ""}`} backHref="/admin/layout-maps" backLabel="Layout maps" />

      <StatStrip label="This layout">
        <StatTile label="Version" value={`v${open.version}`} footnote={STATUS[open.status].label.toLowerCase()} />
        <StatTile label="Columns" value={draft.entries.length.toLocaleString("en-US")} footnote="every column of the file" />
        <StatTile label="Used by the software" value={used.toLocaleString("en-US")} footnote="read into its fields" />
        <StatTile label="Kept as information" value={kept.toLocaleString("en-US")} footnote="shown to the agent with each row" />
        <StatTile label="Carriers" value={assignments.length.toLocaleString("en-US")} footnote={assignments.length ? assignments.map((row) => row.carrierName).join(", ") : "none yet"} />
      </StatStrip>

      <ViewTabs
        label="Layout views"
        value={tab}
        onChange={setTab}
        tabs={[{ key: "columns", label: "Columns", count: draft.entries.length }, { key: "settings", label: "File settings" }, { key: "carriers", label: "Carriers", count: assignments.length }, { key: "versions", label: "Versions", count: versions.length }]}
        actions={
          <>
            {sorted.length > 1 && (
              <select aria-label="Version" className={toolbarControl} value={open.id} disabled={busy !== null} onChange={(event) => { setOpenId(event.target.value); setPage(1); }}>
                {sorted.map((map) => <option key={map.id} value={map.id}>v{map.version} · {STATUS[map.status].label}</option>)}
              </select>
            )}
            {actions}
          </>
        }
      />

      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-disc space-y-1 rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] py-3 pl-8 pr-4 text-sm text-[var(--error-ink)]">
          {errors.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}

      {tab === "columns" && (
        <TableCard
          toolbar={
            <DataToolbar
              actions={editable ? (
                <>
                  <input ref={sampleInput} type="file" accept={CARRIER_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) fillFromSample(file); }} />
                  {waiting.length > 0 && (
                    <select aria-label="Add the columns of a file waiting for a layout" className={`${toolbarControl} max-w-[260px]`} value="" disabled={busy !== null} onChange={(event) => { if (event.target.value) fillFrom(event.target.value); }}>
                      <option value="">From a waiting file…</option>
                      {waiting.map((file) => <option key={file.id} value={file.id}>{file.label}</option>)}
                    </select>
                  )}
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => sampleInput.current?.click()}><FileUp className="size-4" aria-hidden="true" />{busy === "sample" ? "Reading…" : "Read a sample file"}</Button>
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { const entries = [...draft.entries, { ...keptEntry("", "x"), targetField: nextKeptField(draft.entries), enumText: "" }]; setDraft({ ...draft, entries }); setShow("all"); setQuery(""); setPage(lastPage(entries.length)); }}><Plus className="size-4" aria-hidden="true" />Add column</Button>
                </>
              ) : undefined}
            >
              <ToolbarSearch value={query} onChange={(next) => { setQuery(next); setPage(1); }} placeholder="Search columns" />
              <Segmented label="Which columns" value={show} onChange={(next) => { setShow(next); setPage(1); }} options={[{ key: "all", label: "All", count: draft.entries.length }, { key: "used", label: "Used", count: used }, { key: "kept", label: "Kept", count: kept }]} />
            </DataToolbar>
          }
          footer={rows.length > 0 ? <Pager page={shown.current} total={rows.length} noun="columns" onPage={setPage} suffix={editable ? (dirty ? "unsaved changes" : "saved") : "frozen: start the next version to change it"} /> : undefined}
        >
          {draft.entries.length === 0 ? (
            <EmptyState title="No columns yet" hint="Read a carrier's sample file to list every column at once." action={editable ? <Button type="button" onClick={() => sampleInput.current?.click()}>Read a sample file</Button> : undefined} />
          ) : rows.length === 0 ? (
            <NoMatches noun="columns" onClear={() => { setQuery(""); setShow("all"); }} />
          ) : (
            <fieldset disabled={!editable || busy !== null} className="m-0 min-w-0 border-0 p-0">
              <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[48px] text-right">#</th>
                    <th>Column in the file</th>
                    <th className="w-[250px]">
                      <span className="inline-flex items-center gap-1">Used for
                        <InfoTip label="About Used for">The software&apos;s own fields are what it works with: the policy number, its status, dates, premium, commission amounts. Every other column is kept as information: stored with each row exactly as the carrier sent it and shown to the agent, but not used in any figure.</InfoTip>
                      </span>
                    </th>
                    <th className="w-[200px]">Read as</th>
                    <th className="w-[90px]">Required</th>
                    <th>Carrier&apos;s words</th>
                    <th className="w-[50px]"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map(({ entry, index }) => {
                    const isKept = isKeptEntry(entry);
                    // A frozen version reads as text; only a draft shows its controls.
                    if (!editable) return (
                      <tr key={index}>
                        <td className="text-right tabular-nums text-muted-foreground">{index + 1}</td>
                        <td className="font-semibold text-foreground">{entry.sourceColumn}</td>
                        <td>{isKept ? <StatusChip tone="neutral" dot={false}>Kept as information</StatusChip> : label(entry.targetField)}</td>
                        <td className={isKept ? "text-muted-foreground" : undefined}>{isKept ? "As sent" : TRANSFORM_LABEL[entry.transform]}</td>
                        <td>{entry.required ? <StatusChip tone="info" dot={false}>Required</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="max-w-[320px] truncate" title={entry.enumText}>{entry.enumText || <span className="text-muted-foreground">—</span>}</td>
                        <td />
                      </tr>
                    );
                    return (
                      <tr key={index}>
                        <td className="text-right tabular-nums text-muted-foreground">{index + 1}</td>
                        <td><Input aria-label="Column header, exactly as the file has it" className="h-9" value={entry.sourceColumn} onChange={(event) => update(index, { sourceColumn: event.target.value })} /></td>
                        <td>
                          <select aria-label="Used for" className={select} value={isKept ? KEPT : entry.targetField} onChange={(event) => {
                            if (event.target.value === KEPT) { if (!isKept) update(index, { targetField: nextKeptField(draft.entries), dataType: "text", transform: "none", required: false, enumText: "" }); return; }
                            const field = fields.find((item) => item.key === event.target.value);
                            if (field) update(index, { targetField: field.key, dataType: field.dataType, transform: "none", enumText: "" });
                          }}>
                            <option value={KEPT}>Kept as information</option>
                            <optgroup label="The software's fields">
                              {fields.map((field) => <option key={field.key} value={field.key} disabled={field.key !== entry.targetField && draft.entries.some((other) => other.targetField === field.key)}>{field.label}</option>)}
                            </optgroup>
                          </select>
                        </td>
                        <td>
                          {isKept ? <span className="text-muted-foreground">As sent</span> : (
                            <select aria-label="Read as" className={select} value={entry.transform} onChange={(event) => update(index, { transform: event.target.value as Transform })}>
                              {TRANSFORMS_FOR[entry.dataType].map((transform) => <option key={transform} value={transform}>{TRANSFORM_LABEL[transform]}</option>)}
                            </select>
                          )}
                        </td>
                        <td><input aria-label="Required" type="checkbox" className="size-4 accent-[var(--primary)]" disabled={isKept} checked={entry.required} onChange={(event) => update(index, { required: event.target.checked })} /></td>
                        <td>{entry.dataType === "enum" ? <Input aria-label="Carrier's words" className="h-9" placeholder={`e.g. M=${fields.find((field) => field.key === entry.targetField)?.enumValues?.[0] ?? "value"}; Q=…`} value={entry.enumText} onChange={(event) => update(index, { enumText: event.target.value })} /> : <span className="text-muted-foreground">—</span>}</td>
                        <td>{editable && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${entry.sourceColumn || "this column"}`} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, at) => at !== index) })}><X className="size-4" /></Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </fieldset>
          )}
        </TableCard>
      )}

      {tab === "settings" && (
        <TableCard title="How the file is laid out" footer={editable ? <span>{dirty ? "Unsaved changes" : "Saved"}</span> : <span>Frozen: start the next version to change it</span>}>
          <fieldset disabled={!editable || busy !== null} className="m-0 grid gap-4 border-0 px-4 py-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label htmlFor="layout-name">Name</Label><Input id="layout-name" className="h-9" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-header">Header line (blank: found by itself)</Label><Input id="layout-header" className="h-9" inputMode="numeric" value={draft.headerRowIndex} onChange={(event) => setDraft({ ...draft, headerRowIndex: event.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-sheet">Sheet (blank: the widest)</Label><Input id="layout-sheet" className="h-9" value={draft.sheetName} onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-swing">Flag a row-count change over (%)</Label><Input id="layout-swing" className="h-9" inputMode="numeric" value={draft.rowCountSwingPct} onChange={(event) => setDraft({ ...draft, rowCountSwingPct: event.target.value.replace(/\D/g, "") })} /></div>
              {open.fileType === "commissions" && (
                <>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-col">Total line: column</Label><Input id="layout-total-col" className="h-9" value={draft.totalRowColumn} onChange={(event) => setDraft({ ...draft, totalRowColumn: event.target.value })} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-val">Total line: the word in it</Label><Input id="layout-total-val" className="h-9" value={draft.totalRowValue} onChange={(event) => setDraft({ ...draft, totalRowValue: event.target.value })} /></div>
                </>
              )}
            </div>
            {(open.fileType === "commissions" || draft.pdfText.trim() !== "") && (
              <div className="grid gap-1.5">
                <Label htmlFor="layout-pdf" className="inline-flex items-center gap-1">PDF layout
                  <InfoTip label="About the PDF layout">For a PDF statement only: each column&apos;s name and left edge, which column starts a row, and the statement&apos;s own total and balances. Empty for a spreadsheet.</InfoTip>
                </Label>
                <textarea
                  id="layout-pdf"
                  rows={draft.pdfText.trim() ? 14 : 3}
                  spellCheck={false}
                  value={draft.pdfText}
                  onChange={(event) => setDraft({ ...draft, pdfText: event.target.value })}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-70"
                />
              </div>
            )}
          </fieldset>
        </TableCard>
      )}

      {tab === "carriers" && (
        <TableCard
          footer={assignments.length > 10 ? <Pager page={paginate(assignments, carrierPage).current} total={assignments.length} noun="carriers" onPage={setCarrierPage} /> : undefined}
          toolbar={
            <DataToolbar>
              <select aria-label="Carrier" className={`${toolbarControl} max-w-[300px]`} value={assignCarrier} onChange={(event) => setAssignCarrier(event.target.value)}>
                <option value="">Add a carrier…</option>
                {carriers.filter((carrier) => !assignments.some((row) => row.carrierId === carrier.id)).map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
              </select>
              <Button type="button" variant="outline" disabled={busy !== null || !assignCarrier} onClick={() => run("assign", async () => {
                await call("/api/admin/layout-maps/assignments", { method: "PUT", body: JSON.stringify({ carrier_id: assignCarrier, file_type: open.fileType, layout_key: layoutKey }) });
                setAssignCarrier("");
                await reload();
                notify.done("Carrier added. Its " + FILE_TYPE_LABELS[open.fileType].toLowerCase() + " are read with this layout.");
              })}>{busy === "assign" ? "Adding…" : "Add"}</Button>
            </DataToolbar>
          }
        >
          {assignments.length === 0 ? (
            <EmptyState title="No carrier uses this layout" hint={`Add a carrier: its ${FILE_TYPE_LABELS[open.fileType].toLowerCase()} are then read with this layout's live version.`} />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Carrier</th><th className="w-[160px]">File type</th><th className="w-[120px] text-right"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {paginate(assignments, carrierPage).rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-semibold text-foreground">{row.carrierName}</td>
                    <td>{FILE_TYPE_LABELS[row.fileType]}</td>
                    <td className="text-right"><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => run(`remove-${row.id}`, async () => { await call(`/api/admin/layout-maps/assignments?id=${row.id}`, { method: "DELETE" }); await reload(); notify.done(`${row.carrierName} no longer uses this layout.`); })}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {tab === "versions" && (
        <TableCard footer={sorted.length > 10 ? <Pager page={paginate(sorted, versionPage).current} total={sorted.length} noun="versions" onPage={setVersionPage} /> : undefined}>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th className="w-[100px]">Version</th><th className="w-[130px]">State</th><th className="w-[160px]">Columns</th><th className="w-[150px]">Published</th><th>Last change</th><th className="w-[100px] text-right"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {paginate(sorted, versionPage).rows.map((map) => {
                const mapKept = map.entries.filter(isKeptEntry).length;
                return (
                  <tr key={map.id}>
                    <td className="font-semibold tabular-nums text-foreground">v{map.version}</td>
                    <td><StatusChip tone={STATUS[map.status].tone}>{STATUS[map.status].label}</StatusChip></td>
                    <td className="tabular-nums">{map.entries.length}<span className="block text-xs text-muted-foreground">{map.entries.length - mapKept} used · {mapKept} kept</span></td>
                    <td className="tabular-nums">{day(map.approvedAt)}</td>
                    <td className="tabular-nums">{day(map.updatedAt)}</td>
                    <td className="text-right">{map.id === open.id ? <span className="text-xs text-muted-foreground">Open</span> : <Button type="button" variant="outline" size="sm" onClick={() => { setOpenId(map.id); setTab("columns"); setPage(1); }}>Open</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      <Dialog open={removing} onOpenChange={(next) => { if (!busy) setRemoving(next); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Delete the layout &ldquo;{open.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              {[openDraft && `Draft v${openDraft.version} is deleted.`, liveVersion && `Live v${liveVersion.version} is retired.`, assignments.length ? `${assignments.map((row) => row.carrierName).join(", ")} stop${assignments.length === 1 ? "s" : ""} using it, so their ${FILE_TYPE_LABELS[open.fileType].toLowerCase()} wait until another layout is added.` : "No carrier uses it."].filter(Boolean).join(" ")} Files it already read keep their record of the version that read them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setRemoving(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => run("remove", async () => {
              await call(`/api/admin/layout-maps/${open.id}/remove`, { method: "POST" });
              setRemoving(false);
              notify.done(`"${open.name}" deleted.`);
              router.push("/admin/layout-maps");
              router.refresh();
            })}>{busy === "remove" ? "Deleting…" : "Delete layout"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={(next) => { if (!busy) setDeleting(next); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Delete draft v{open.version}?</DialogTitle>
            <DialogDescription>{versions.length === 1 ? `This is the only version of "${open.name}", so the layout and its carriers go too.` : "The draft and its columns are deleted. Live and retired versions stay as they are."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setDeleting(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => run("delete", async () => {
              await call(`/api/admin/layout-maps/${open.id}`, { method: "DELETE" });
              setDeleting(false);
              notify.done(`Draft v${open.version} deleted.`);
              if (versions.length === 1) { router.push("/admin/layout-maps"); return; }
              const rest = versions.filter((map) => map.id !== open.id);
              await reload((rest.find((map) => map.status === "published") ?? rest[0]).id);
            })}>{busy === "delete" ? "Deleting…" : "Delete draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
