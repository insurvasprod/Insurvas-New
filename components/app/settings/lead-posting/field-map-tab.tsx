"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { canonicalFieldMap, isKnownLeadField, OUR_FIELD_PATTERN, readFieldMap } from "@/lib/leadPost/fieldMap";
import { guessFieldMap, parseSample } from "@/lib/leadPost/sampleCheck";
import type { VendorSample } from "@/lib/leadPost/boardStore";
import type { VendorRow } from "@/lib/leadPost/board";
import { cn } from "@/lib/utils";
import { OUR_FIELD_LABELS, PICKABLE_FIELDS, send } from "./shared";

/**
 * Vendor sheet › Field map (board A7): their field → our field or one of the product form's own
 * questions. The rows are their fields from their last post (with an example), plus any the map
 * already names; a pasted sample guesses the rest. A field that is not read is still kept on the
 * lead as sent — "Not read" means none of our fields takes it.
 *
 * Form questions need no database change: an intake form's answers live on the lead under the
 * question's key, so mapping a field to that key fills the question.
 */

type Row = { id: string; theirs: string; ours: string; note: string; example: string; fromSample: boolean };
let seq = 0;
const rowId = () => `fm-${++seq}`;

function rowsFrom(row: VendorRow, sample: VendorSample | null): Row[] {
  const notes = row.key.fieldNotes ?? {};
  const mapped = readFieldMap(row.key.fieldMap);
  const byTheirs = new Map(mapped.map((entry) => [entry.theirs, entry]));
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const field of sample?.fields ?? []) {
    const entry = byTheirs.get(field.name);
    // A field already named like ours is read as sent; shown as going to itself.
    const ours = entry?.ours ?? (isKnownLeadField(field.name) ? field.name : "");
    out.push({ id: rowId(), theirs: field.name, ours, note: entry ? notes[entry.ours] ?? "" : "", example: field.example, fromSample: true });
    seen.add(field.name);
  }
  for (const entry of mapped) if (!seen.has(entry.theirs)) out.push({ id: rowId(), theirs: entry.theirs, ours: entry.ours, note: notes[entry.ours] ?? "", example: "", fromSample: false });
  return out;
}

/** The map a row set stores: only rows whose name differs from ours (a same-named field is read as sent). */
function mapOf(rows: Row[]) {
  return canonicalFieldMap(rows.filter((row) => row.ours && row.theirs.trim() && row.ours !== row.theirs.trim()));
}
function notesOf(rows: Row[]) {
  return Object.fromEntries(rows.filter((row) => row.ours && row.note.trim()).map((row) => [row.ours, row.note.trim()]));
}
const same = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

export function FieldMapTab({ row, schemaReady, onSaved }: { row: VendorRow; schemaReady: boolean; onSaved: () => Promise<void> }) {
  const [sample, setSample] = useState<VendorSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  useEffect(() => {
    let live = true;
    send<VendorSample>(`/api/app/lead-post-keys/${row.key.id}/sample`, "GET")
      .then((body) => { if (live) { setSample(body); setRows(rowsFrom(row, body)); } })
      .catch((cause: unknown) => { if (live) { setError(cause instanceof Error ? cause.message : "Their fields didn't load"); setRows(rowsFrom(row, null)); } });
    return () => { live = false; };
    // The sheet remounts this tab per vendor; a reload of the same vendor keeps the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key.id]);

  const storedMap = useMemo(() => canonicalFieldMap(readFieldMap(row.key.fieldMap)), [row.key.fieldMap]);
  const storedNotes = useMemo(() => Object.fromEntries(Object.entries(row.key.fieldNotes ?? {}).filter(([field]) => field in storedMap)), [row.key.fieldNotes, storedMap]);
  const draftMap = rows ? mapOf(rows) : storedMap;
  const draftNotes = rows ? notesOf(rows) : storedNotes;
  const changes = rows ? Object.keys({ ...draftMap, ...storedMap }).filter((key) => draftMap[key] !== storedMap[key]).length + (schemaReady && !same(draftNotes, storedNotes) ? 1 : 0) : 0;
  const dirty = changes > 0;

  const problems = useMemo(() => {
    const out = new Map<string, string>();
    const taken = new Map<string, string>();
    for (const item of rows ?? []) {
      if (!item.ours) continue;
      if (!item.theirs.trim()) out.set(item.id, "Enter the name they send.");
      else if (!OUR_FIELD_PATTERN.test(item.ours)) out.set(item.id, "Choose one of the fields.");
      else if (taken.has(item.ours)) out.set(item.id, `${OUR_FIELD_LABELS[item.ours] ?? item.ours} is already read from ${taken.get(item.ours)}.`);
      taken.set(item.ours, item.theirs);
    }
    return out;
  }, [rows]);

  if (!rows) return <SectionLoading label="Loading their fields" rows={6} columns={3} />;

  const questions = sample?.formQuestions ?? [];
  const matched = rows.filter((item) => item.ours).length;
  const notRead = rows.filter((item) => !item.ours && item.fromSample);
  const update = (id: string, patch: Partial<Row>) => setRows((list) => (list ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)));

  function discard() {
    setRows(rowsFrom(row, sample));
  }

  async function save(): Promise<boolean> {
    if (problems.size > 0) return false;
    setSaving(true);
    try {
      await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: "field_map", fieldMap: draftMap, ...(schemaReady ? { fieldNotes: draftNotes } : {}) });
      notify.done(row.keys.length > 1 ? `Field map saved to all of ${row.vendorName}'s keys.` : "Field map saved.");
      await onSaved();
      return true;
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "The field map was not saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function resetToSuggested() {
    const payload = Object.fromEntries((sample?.fields ?? []).map((field) => [field.name, field.example]));
    const guesses = guessFieldMap(payload, []);
    setRows((list) => (list ?? []).map((item) => {
      const guess = guesses.find((entry) => entry.theirs === item.theirs);
      return guess ? { ...item, ours: guess.ours } : isKnownLeadField(item.theirs) ? { ...item, ours: item.theirs } : { ...item, ours: "" };
    }));
  }

  function applyPasted(payload: Record<string, unknown>) {
    setRows((list) => {
      const current = list ?? [];
      const existing = current.filter((item) => item.ours).map((item) => ({ ours: item.ours, theirs: item.theirs }));
      const guesses = guessFieldMap(payload, existing);
      const next = [...current];
      for (const [name, value] of Object.entries(payload)) {
        const guess = guesses.find((entry) => entry.theirs === name);
        const at = next.findIndex((item) => item.theirs === name);
        const example = typeof value === "string" ? value.slice(0, 48) : JSON.stringify(value)?.slice(0, 48) ?? "";
        if (at >= 0) {
          if (!next[at].ours && guess) next[at] = { ...next[at], ours: guess.ours };
          if (!next[at].example) next[at] = { ...next[at], example };
        } else {
          next.push({ id: rowId(), theirs: name, ours: guess?.ours ?? (isKnownLeadField(name) ? name : ""), note: "", example, fromSample: true });
        }
      }
      return next;
    });
    notify.done("Their fields were matched where the names said so. Save to keep it.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm text-[var(--body)]">
          <b className="text-[var(--ink)]">{matched} of {rows.length}</b> of their fields are matched{notRead.length ? ` · ${notRead.length} ${notRead.length === 1 ? "is" : "are"} not read yet` : ""}
        </span>
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>Paste a sample lead</Button>
          <Button type="button" variant="ghost" size="sm" disabled={!sample?.fields.length} onClick={resetToSuggested}>Reset to suggested</Button>
        </span>
      </div>
      {error && <p className="m-0 px-4 pb-2 text-xs text-[var(--error-ink)]">{error} · their last post&rsquo;s examples are not shown.</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-[var(--muted)]">{row.vendorName} has not posted yet. Paste a sample lead from them, or add their fields by hand.</p>
        ) : (
          <TableCard>
            <table className={st.table} aria-label={`${row.vendorName}'s field map`}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Their field</th>
                  <th scope="col" className={st.th}>Example from their last post</th>
                  <th scope="col" className={st.th}>Goes to</th>
                  <th scope="col" className={cn(st.th, "w-[96px]")}>Note</th>
                  <th scope="col" className={cn(st.th, "w-[40px]")}><span className="sr-only">Status</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => {
                  const isQuestion = questions.some((question) => question.key === item.ours);
                  const problem = problems.get(item.id);
                  return (
                    <tr key={item.id} className={cn(!item.ours && item.fromSample && "bg-[var(--warning-surface)]")}>
                      <td className={cn(st.td, "max-w-[120px]")}>
                        {item.fromSample ? (
                          <span className="block truncate font-mono text-xs text-[var(--ink)]" title={item.theirs}>{item.theirs}</span>
                        ) : (
                          <input aria-label={`Their field, row ${index + 1}`} className={cn(control, "mt-0 h-8 font-mono text-xs")} value={item.theirs} maxLength={120} placeholder="ph_home" onChange={(event) => update(item.id, { theirs: event.target.value })} />
                        )}
                      </td>
                      <td className={cn(st.td, "max-w-[130px]")}><span className="block truncate" title={item.example}>{item.example || "—"}</span></td>
                      <td className={cn(st.td, "min-w-[150px]")}>
                        <select
                          aria-label={`Where ${item.theirs || "this field"} goes`}
                          aria-invalid={problem ? true : undefined}
                          title={problem}
                          className={cn(control, "mt-0 h-8 text-sm", !item.ours && "text-[var(--muted)]")}
                          value={item.ours}
                          onChange={(event) => update(item.id, { ours: event.target.value })}
                        >
                          <option value="">Choose a field</option>
                          <optgroup label="Lead fields">
                            {PICKABLE_FIELDS.concat(item.ours && !PICKABLE_FIELDS.includes(item.ours) && !questions.some((question) => question.key === item.ours) ? [item.ours] : []).map((field) => (
                              <option key={field} value={field}>{OUR_FIELD_LABELS[field] ?? field}</option>
                            ))}
                          </optgroup>
                          {questions.length > 0 && (
                            <optgroup label={`Form › ${sample?.formName ?? sample?.productLabel ?? "intake form"}`}>
                              {questions.map((question) => <option key={question.key} value={question.key}>Form › {question.label}</option>)}
                            </optgroup>
                          )}
                        </select>
                        {problem && <span role="alert" className="mt-1 block text-xs text-[var(--error-ink)]">{problem}</span>}
                      </td>
                      <td className={st.td}>
                        <input aria-label={`Note for ${item.theirs || "this field"}`} className={cn(control, "mt-0 h-8 text-xs")} value={item.note} maxLength={200} placeholder="Optional" disabled={!schemaReady || !item.ours} title={schemaReady ? undefined : "Notes need a database update that has not been applied yet."} onChange={(event) => update(item.id, { note: event.target.value })} />
                      </td>
                      <td className={cn(st.td, "whitespace-nowrap")}>
                        {isQuestion ? <StatusChip tone="info">Form question</StatusChip>
                          : !item.ours && item.fromSample ? <StatusChip tone="warning">Not read</StatusChip>
                          : !item.fromSample ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove row ${index + 1}`} onClick={() => setRows((list) => (list ?? []).filter((entry) => entry.id !== item.id))}><X aria-hidden="true" /></Button>
                          : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((list) => [...(list ?? []), { id: rowId(), theirs: "", ours: "", note: "", example: "", fromSample: false }])}>
            <Plus aria-hidden="true" /> Add a field
          </Button>
        </div>
      </div>
      <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
        {questions.length > 0 ? `"Form ›" answers fill the ${sample?.formName ?? "intake form"}'s own questions. ` : ""}
        A field that is not read is still kept on the lead as sent.
      </p>
      {dirty && (
        <div role="region" aria-label="Unsaved field map" className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2.5 text-sm font-medium text-[var(--ink)]">
          <span>{changes} unsaved {changes === 1 ? "change" : "changes"}</span>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={discard}>Discard</Button>
            <Button type="button" size="sm" disabled={saving || problems.size > 0} onClick={() => void save()}>{saving ? "Saving…" : "Save field map"}</Button>
          </span>
        </div>
      )}
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={discard} what={`${row.vendorName}'s field map`} />
      {pasteOpen && <PasteSample onClose={() => setPasteOpen(false)} onApply={(payload) => { applyPasted(payload); setPasteOpen(false); }} />}
    </div>
  );
}

/** "Paste a sample lead": one of their payloads; nothing is posted or saved. */
function PasteSample({ onClose, onApply }: { onClose: () => void; onApply: (payload: Record<string, unknown>) => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Paste a sample lead</DialogTitle>
          <DialogDescription>One lead exactly as they send it. Their fields are matched by name; nothing is posted or saved.</DialogDescription>
        </DialogHeader>
        <Field label="Their lead" htmlFor="paste-sample" hint="JSON, or name=value pairs joined with &." error={problem}>
          <textarea id="paste-sample" className={cn(textareaControl, "min-h-[140px] font-mono text-xs")} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} placeholder='{"fname":"Ana","lname":"Ruiz","ph_home":"(512) 555-0142","st":"TX"}' />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!text.trim()} onClick={() => {
            const parsed = parseSample(text);
            if ("error" in parsed) setProblem(parsed.error);
            else onApply(parsed.payload);
          }}>Match their fields</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
