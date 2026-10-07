"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { mapProblems, TARGET_FIELDS, TRANSFORMS_FOR, type LayoutEntry, type Transform } from "@/lib/ingestion/layout";
import type { AssignmentView, CarrierOption, LayoutMapView, LayoutStatus } from "@/lib/ingestion/layoutAdmin";
import { notify } from "@/lib/notify";

const STATUS: Record<LayoutStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "action" },
  in_review: { label: "In review", tone: "info" },
  published: { label: "Published", tone: "good" },
  retired: { label: "Retired", tone: "neutral" },
};

const TRANSFORM_LABEL: Record<Transform, string> = {
  none: "As written",
  strip_currency: "Remove $ and commas",
  mmddyyyy: "MM/DD/YYYY",
  yyyymmdd: "YYYYMMDD",
  digits_only: "Digits only",
  negate: "Flip the sign",
  pct_to_bp: "Percent to basis points",
};

const select = `${toolbarControl} w-full`;

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; problems?: string[] };
  if (!response.ok) {
    const error = new Error(data.error ?? "That did not work; try again.") as Error & { problems?: string[] };
    error.problems = data.problems;
    throw error;
  }
  return data;
}

/** "ADV=advance; CB=chargeback" ↔ { ADV: "advance", CB: "chargeback" } — the carrier's word, then ours. */
function enumText(values: Record<string, string> | null): string {
  return Object.entries(values ?? {}).map(([raw, value]) => `${raw}=${value}`).join("; ");
}
function enumValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

type Draft = {
  name: string;
  headerRowIndex: string;
  sheetName: string;
  rowCountSwingPct: string;
  totalRowColumn: string;
  totalRowValue: string;
  entries: Array<LayoutEntry & { enumText: string }>;
};

function draftOf(map: LayoutMapView): Draft {
  return {
    name: map.name,
    headerRowIndex: map.headerRowIndex ? String(map.headerRowIndex) : "",
    sheetName: map.sheetName ?? "",
    rowCountSwingPct: String(map.rowCountSwingPct),
    totalRowColumn: map.totalRowColumn ?? "",
    totalRowValue: map.totalRowValue ?? "",
    entries: map.entries.map((entry) => ({ ...entry, enumText: enumText(entry.enumValues) })),
  };
}

/**
 * LA-4.3 (Notion sprint) · the platform's layout maps: how each carrier's spreadsheets are read.
 * A draft is edited and published; a published version is frozen, and changing it starts the next
 * version. Each carrier is assigned a layout per file type, so one layout can serve several carriers.
 */
export function LayoutMapsReview({ initialMaps, initialAssignments, carriers, notice }: { initialMaps: LayoutMapView[]; initialAssignments: AssignmentView[]; carriers: CarrierOption[]; notice?: string }) {
  const [maps, setMaps] = useState(initialMaps);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLayout, setNewLayout] = useState({ layoutKey: "", name: "", fileType: "policies" as "policies" | "commissions" });
  const [assign, setAssign] = useState({ carrierId: "", fileType: "policies" as "policies" | "commissions", layoutKey: "" });

  const layouts = useMemo(() => {
    const byKey = new Map<string, LayoutMapView[]>();
    for (const map of maps) byKey.set(map.layoutKey, [...(byKey.get(map.layoutKey) ?? []), map]);
    return [...byKey.entries()].map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { key, name: sorted[0].name, fileType: sorted[0].fileType, versions: sorted, live: sorted.find((map) => map.status === "published") ?? null, draft: sorted.find((map) => map.status === "draft" || map.status === "in_review") ?? null };
    });
  }, [maps]);
  const open = maps.find((map) => map.id === openId) ?? null;
  const editable = open?.status === "draft" || open?.status === "in_review";

  async function reload() {
    const data = await call<{ maps: LayoutMapView[]; assignments: AssignmentView[] }>("/api/admin/layout-maps", { method: "GET" });
    setMaps(data.maps);
    setAssignments(data.assignments);
  }

  function openMap(map: LayoutMapView) {
    setOpenId(map.id);
    setDraft(draftOf(map));
    setProblems([]);
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblems([]);
    try {
      await action();
    } catch (error) {
      const problemList = (error as { problems?: string[] }).problems ?? [];
      setProblems(problemList);
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  function payload(current: Draft) {
    return {
      name: current.name.trim(),
      header_row_index: current.headerRowIndex.trim() ? Number(current.headerRowIndex) : null,
      sheet_name: current.sheetName.trim() || null,
      row_count_swing_pct: Number(current.rowCountSwingPct) || 50,
      total_row_column: current.totalRowColumn.trim() || null,
      total_row_value: current.totalRowValue.trim() || null,
      entries: current.entries.map((entry) => ({
        source_column: entry.sourceColumn,
        target_field: entry.targetField,
        data_type: entry.dataType,
        transform: entry.transform,
        required: entry.required,
        enum_values: entry.dataType === "enum" ? enumValues(entry.enumText) : null,
      })),
    };
  }

  const save = (then?: () => Promise<void>) => run("save", async () => {
    if (!open || !draft) return;
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}`, { method: "PUT", body: JSON.stringify(payload(draft)) });
    setMaps((current) => current.map((item) => (item.id === map.id ? map : item)));
    setDraft(draftOf(map));
    if (then) await then();
    else notify.done(`Draft v${map.version} saved.`);
  });

  const publish = () => save(async () => {
    if (!open) return;
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/publish`, { method: "POST" });
    await reload();
    openMap(map);
    notify.done(`Version ${map.version} is live.`);
  });

  const fields = open ? TARGET_FIELDS[open.fileType] : [];
  const localProblems = open && draft && editable ? mapProblems({ fileType: open.fileType }, draft.entries.map((entry) => ({ ...entry, enumValues: entry.dataType === "enum" ? enumValues(entry.enumText) : null }))) : [];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Layout maps" subtitle="How each carrier's spreadsheets are read: one map per layout, shared by every carrier that uses it." actions={<Button type="button" onClick={() => setCreating(true)} disabled={Boolean(notice)}>New layout</Button>} />

      {notice && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{notice}</div>}

      <TableCard title="Layouts">
        {layouts.length === 0 ? (
          <EmptyState title="No layout maps yet" hint="Layouts are written from real carrier sample files; until one is published for a carrier, its files wait." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Layout</th>
                <th className="w-[130px]">File type</th>
                <th className="w-[110px]">Live</th>
                <th className="w-[110px]">Draft</th>
                <th>Carriers</th>
                <th className="w-[110px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {layouts.map((layout) => {
                const using = assignments.filter((row) => row.layoutKey === layout.key).map((row) => row.carrierName);
                return (
                  <tr key={layout.key}>
                    <td><span className="block font-semibold text-foreground">{layout.name}</span><span className="block font-mono text-xs text-muted-foreground">{layout.key}</span></td>
                    <td>{layout.fileType === "policies" ? "Policies" : "Commissions"}</td>
                    <td className="tabular-nums">{layout.live ? `v${layout.live.version}` : "—"}</td>
                    <td className="tabular-nums">{layout.draft ? `v${layout.draft.version}` : "—"}</td>
                    <td className="max-w-[260px] truncate" title={using.join(", ")}>{using.length ? using.join(", ") : <span className="text-muted-foreground">None assigned</span>}</td>
                    <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => openMap(layout.draft ?? layout.live ?? layout.versions[0])}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {open && draft && (
        <TableCard
          title={`${open.name} · v${open.version}`}
          description={editable ? "Each column's header must be written exactly as the file has it." : "This version is frozen. Start the next version to change it."}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={STATUS[open.status].tone}>{STATUS[open.status].label}</StatusChip>
              {editable ? (
                <>
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
                  <Button type="button" disabled={busy !== null || localProblems.length > 0} title={localProblems[0]} onClick={publish}>Publish</Button>
                </>
              ) : (
                <>
                  {open.status === "published" && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => run("retire", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/retire`, { method: "POST" }); await reload(); openMap(map); notify.done(`Version ${map.version} retired.`); })}>Retire</Button>}
                  <Button type="button" disabled={busy !== null} onClick={() => run("version", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/versions`, { method: "POST" }); await reload(); openMap(map); notify.done(`Version ${map.version} started as a draft.`); })}>Start v{open.version + 1}</Button>
                </>
              )}
              <Button type="button" variant="ghost" size="icon" aria-label="Close the layout" onClick={() => { setOpenId(null); setDraft(null); }}><X className="size-4" /></Button>
            </div>
          }
        >
          <fieldset disabled={!editable || busy !== null} className="grid gap-4 px-4 py-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label htmlFor="layout-name">Name</Label><Input id="layout-name" className="h-9" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-header">Header row (blank: the first full-width line)</Label><Input id="layout-header" className="h-9" inputMode="numeric" value={draft.headerRowIndex} onChange={(event) => setDraft({ ...draft, headerRowIndex: event.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-sheet">Sheet (blank: the first visible)</Label><Input id="layout-sheet" className="h-9" value={draft.sheetName} onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-swing">Row-count swing to flag (%)</Label><Input id="layout-swing" className="h-9" inputMode="numeric" value={draft.rowCountSwingPct} onChange={(event) => setDraft({ ...draft, rowCountSwingPct: event.target.value.replace(/\D/g, "") })} /></div>
              {open.fileType === "commissions" && (
                <>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-col">Total row: column</Label><Input id="layout-total-col" className="h-9" value={draft.totalRowColumn} onChange={(event) => setDraft({ ...draft, totalRowColumn: event.target.value })} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-val">Total row: value in it</Label><Input id="layout-total-val" className="h-9" value={draft.totalRowValue} onChange={(event) => setDraft({ ...draft, totalRowValue: event.target.value })} /></div>
                </>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Column header in the file</th>
                    <th className="w-[230px]">Becomes</th>
                    <th className="w-[200px]">Read as</th>
                    <th className="w-[90px]">Required</th>
                    <th>Carrier&apos;s words (enum)</th>
                    <th className="w-[50px]"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.entries.map((entry, index) => {
                    const update = (change: Partial<Draft["entries"][number]>) => setDraft({ ...draft, entries: draft.entries.map((item, at) => (at === index ? { ...item, ...change } : item)) });
                    return (
                      <tr key={index}>
                        <td><Input aria-label="Column header" className="h-9" value={entry.sourceColumn} onChange={(event) => update({ sourceColumn: event.target.value })} /></td>
                        <td>
                          <select aria-label="Field" className={select} value={entry.targetField} onChange={(event) => { const field = fields.find((item) => item.key === event.target.value); if (field) update({ targetField: field.key, dataType: field.dataType, transform: "none", enumText: "" }); }}>
                            {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <select aria-label="Transform" className={select} value={entry.transform} onChange={(event) => update({ transform: event.target.value as Transform })}>
                            {TRANSFORMS_FOR[entry.dataType].map((transform) => <option key={transform} value={transform}>{TRANSFORM_LABEL[transform]}</option>)}
                          </select>
                        </td>
                        <td><input aria-label="Required" type="checkbox" className="size-4 accent-[var(--primary)]" checked={entry.required} onChange={(event) => update({ required: event.target.checked })} /></td>
                        <td>{entry.dataType === "enum" ? <Input aria-label="Carrier's words" className="h-9" placeholder={`e.g. M=${fields.find((field) => field.key === entry.targetField)?.enumValues?.[0] ?? "value"}; Q=…`} value={entry.enumText} onChange={(event) => update({ enumText: event.target.value })} /> : <span className="text-muted-foreground">—</span>}</td>
                        <td><Button type="button" variant="ghost" size="icon" aria-label="Remove this column" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, at) => at !== index) })}><X className="size-4" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable && (
              <div>
                <Button type="button" variant="outline" onClick={() => { const field = fields.find((item) => !draft.entries.some((entry) => entry.targetField === item.key)) ?? fields[0]; setDraft({ ...draft, entries: [...draft.entries, { sourceColumn: "", targetField: field.key, dataType: field.dataType, transform: "none", required: false, enumValues: null, enumText: "" }] }); }}><Plus className="size-4" /> Add column</Button>
              </div>
            )}
            {(problems.length > 0 || (editable && localProblems.length > 0)) && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-[var(--error-ink)]">
                {(problems.length ? problems : localProblems).map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
          </fieldset>
        </TableCard>
      )}

      <TableCard
        title="Carrier assignments"
        description="Which layout reads each carrier's files. A file waits until its carrier and type have a published layout."
        toolbar={
          <form className="flex flex-wrap items-center gap-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); void run("assign", async () => { await call("/api/admin/layout-maps/assignments", { method: "PUT", body: JSON.stringify({ carrier_id: assign.carrierId, file_type: assign.fileType, layout_key: assign.layoutKey }) }); await reload(); notify.done("Assignment saved."); }); }}>
            <select aria-label="Carrier" className={toolbarControl} value={assign.carrierId} onChange={(event) => setAssign({ ...assign, carrierId: event.target.value })}>
              <option value="">Carrier</option>
              {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select>
            <select aria-label="File type" className={toolbarControl} value={assign.fileType} onChange={(event) => setAssign({ ...assign, fileType: event.target.value as "policies" | "commissions", layoutKey: "" })}>
              <option value="policies">Policies</option>
              <option value="commissions">Commissions</option>
            </select>
            <select aria-label="Layout" className={toolbarControl} value={assign.layoutKey} onChange={(event) => setAssign({ ...assign, layoutKey: event.target.value })}>
              <option value="">Layout</option>
              {layouts.filter((layout) => layout.fileType === assign.fileType).map((layout) => <option key={layout.key} value={layout.key}>{layout.name}</option>)}
            </select>
            <Button type="submit" variant="outline" disabled={busy !== null || !assign.carrierId || !assign.layoutKey}>{busy === "assign" ? "Saving…" : "Assign"}</Button>
          </form>
        }
      >
        {assignments.length === 0 ? (
          <EmptyState title="No carrier assigned a layout" hint="Assign a layout to a carrier and file type once the layout is written." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr><th>Carrier</th><th className="w-[140px]">File type</th><th>Layout</th><th className="w-[110px] text-right"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {assignments.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold text-foreground">{row.carrierName}</td>
                  <td>{row.fileType === "policies" ? "Policies" : "Commissions"}</td>
                  <td>{layouts.find((layout) => layout.key === row.layoutKey)?.name ?? row.layoutKey}{!layouts.find((layout) => layout.key === row.layoutKey)?.live && <span className="ml-2 text-xs text-[var(--warning-ink)]">no live version</span>}</td>
                  <td className="text-right"><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(`remove-${row.id}`, async () => { await call(`/api/admin/layout-maps/assignments?id=${row.id}`, { method: "DELETE" }); await reload(); notify.done("Assignment removed."); })}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={creating} onOpenChange={(next) => { if (!busy) setCreating(next); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">New layout</DialogTitle>
            <DialogDescription>Starts version 1 as a draft. Write its columns from a real sample file.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 text-sm">
            <div className="grid gap-1.5"><Label htmlFor="new-layout-name">Name</Label><Input id="new-layout-name" className="h-9" placeholder="Aetna / Aflac / AHL 46-column" value={newLayout.name} onChange={(event) => setNewLayout({ ...newLayout, name: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="new-layout-key">Key</Label><Input id="new-layout-key" className="h-9 font-mono" placeholder="aetna_aflac_ahl_policies" value={newLayout.layoutKey} onChange={(event) => setNewLayout({ ...newLayout, layoutKey: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-layout-type">File type</Label>
              <select id="new-layout-type" className={select} value={newLayout.fileType} onChange={(event) => setNewLayout({ ...newLayout, fileType: event.target.value as "policies" | "commissions" })}>
                <option value="policies">Policies</option>
                <option value="commissions">Commissions</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="button" disabled={busy !== null || !newLayout.name.trim() || newLayout.layoutKey.length < 3} onClick={() => void run("create", async () => {
              const { map } = await call<{ map: LayoutMapView }>("/api/admin/layout-maps", { method: "POST", body: JSON.stringify({ layout_key: newLayout.layoutKey, name: newLayout.name.trim(), file_type: newLayout.fileType }) });
              await reload();
              openMap(map);
              setCreating(false);
              setNewLayout({ layoutKey: "", name: "", fileType: "policies" });
            })}>{busy === "create" ? "Creating…" : "Create draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
