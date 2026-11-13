"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { control, Field } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import { API_SCOPES, IDLE_DAYS, type ApiKeyView, type ApiScope } from "@/lib/apiKeys/constants";
import { canDoWords, samplePath, type KeyState } from "@/lib/apiKeys/hub";
import { dayMonth, dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Person, RequestSample, send, SheetSection, TechnicalDetails, TickCard, whenWords } from "./shared";

/**
 * Settings › Integrations, round 8 option A · the API keys tab (board A2) and a key's sheet (A3).
 * One line a key; what it can do in plain words; the key itself never shows.
 */

export type KeyFilter = "active" | "rotating" | "ended";

const filterOf = (state: KeyState): KeyFilter => (state.kind === "rotating_out" ? "rotating" : state.live ? "active" : "ended");
const endsWords = (key: ApiKeyView) => (key.revokedAt ? `Revoked ${dayMonth(key.revokedAt, viewerTimeZone())}` : key.expiresAt ? whenWords(key.expiresAt).replace(/^Never$/, "—") : "Never");

export function KeysTable({
  keys,
  states,
  filter,
  onFilter,
  query,
  onQuery,
  selectedId,
  onOpen,
  onReview,
  newKeyButton,
}: {
  keys: ApiKeyView[];
  states: Map<string, KeyState>;
  filter: KeyFilter;
  onFilter: (filter: KeyFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedId: string | null;
  onOpen: (key: ApiKeyView) => void;
  onReview: (key: ApiKeyView) => void;
  newKeyButton: React.ReactNode;
}) {
  const needle = query.trim().toLowerCase();
  const count = (which: KeyFilter) => keys.filter((key) => filterOf(states.get(key.id) as KeyState) === which).length;
  const shown = keys.filter((key) => filterOf(states.get(key.id) as KeyState) === filter && (!needle || key.label.toLowerCase().includes(needle) || canDoWords(key.scopes).toLowerCase().includes(needle)));
  const oldKeyOf = new Set(keys.filter((key) => key.rotatedFrom).map((key) => key.rotatedFrom as string));

  return (
    <TableCard
      title="API keys"
      className="lg:min-h-0 lg:flex-1"
      bodyClassName="min-h-[200px] overflow-y-auto lg:min-h-0"
      toolbar={
        <>
          <Segmented
            label="Show keys"
            options={[
              { key: "active", label: "Active", count: count("active") },
              { key: "rotating", label: "Rotating out", count: count("rotating") },
              { key: "ended", label: "Ended", count: count("ended") },
            ]}
            value={filter}
            onChange={onFilter}
          />
          <div className="ml-auto w-full sm:w-[220px]"><ToolbarSearch value={query} onChange={onQuery} placeholder="Find a key" /></div>
        </>
      }
      footer={<span>Click a key to open it · No key can read a Social Security number, bank details or a card number</span>}
    >
      {keys.length === 0 ? (
        <EmptyState title="No API keys yet" hint="A key lets another app, such as Zapier or a reporting warehouse, read your policies. It is shown once, when it is made." action={newKeyButton} />
      ) : shown.length === 0 ? (
        <NoMatches noun="keys" onClear={() => { onQuery(""); onFilter("active"); }} />
      ) : (
        <table className={st.table} aria-label="API keys">
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Name</th>
              <th scope="col" className={st.th}>Can do</th>
              <th scope="col" className={st.th}>Last used</th>
              <th scope="col" className={st.th}>Ends</th>
              <th scope="col" className={st.th}>Made by</th>
              <th scope="col" className={st.th}>Status</th>
              <th scope="col" className={cn(st.th, "w-[96px]")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((key) => {
              const state = states.get(key.id) as KeyState;
              const on = key.id === selectedId;
              return (
                <tr key={key.id} className={cn("cursor-pointer hover:bg-[var(--hover-wash)]", on && "bg-[var(--primary-soft)]", !state.live && "text-[var(--muted)]")} onClick={() => onOpen(key)}>
                  <td className={cn(st.td, "max-w-[260px] truncate")}>
                    <button type="button" className="max-w-full truncate border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]" aria-label={`Open ${key.label}`} onClick={(event) => { event.stopPropagation(); onOpen(key); }}>{key.label}</button>
                    {oldKeyOf.has(key.id) && <span className="text-xs text-[var(--muted)]"> · old key</span>}
                  </td>
                  <td className={cn(st.td, "max-w-[240px] truncate")}>{canDoWords(key.scopes)}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{whenWords(key.lastUsedAt)}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{endsWords(key)}</td>
                  <td className={cn(st.td, "max-w-[180px]")}><Person name={key.createdByName} /></td>
                  <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={state.tone}>{state.label}</StatusChip></td>
                  <td className={cn(st.td, "text-right text-[var(--muted)]")}>
                    {state.kind === "idle"
                      ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); onReview(key); }}>Review</Button>
                      : <ChevronRight aria-hidden="true" className="ml-auto size-4" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

type EndsChoice = "never" | "date";
type Draft = { label: string; scopes: ApiScope[]; ends: EndsChoice; date: string };

const pad = (n: number) => String(n).padStart(2, "0");
/** The viewer's own calendar day of an instant, as a date input wants it. */
const localDay = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const isoDay = (value: string | null) => (value ? localDay(new Date(value)) : "");
const draftOf = (key: ApiKeyView): Draft => ({ label: key.label, scopes: [...key.scopes], ends: key.expiresAt ? "date" : "never", date: isoDay(key.expiresAt) });
/** The end of the chosen day, the viewer's time, as the stored instant. */
const endOfDay = (day: string) => new Date(`${day}T23:59:00`).toISOString();

/** A key's sheet (board A3): name, what it can do (narrow only), when it ends, a sample; masked key behind details. */
export function KeySheet({
  apiKey,
  state,
  replaced,
  origin,
  onClose,
  onSaved,
  onRotate,
  onRevoke,
}: {
  apiKey: ApiKeyView;
  state: KeyState;
  /** A rotation made a successor: its end belongs to the rotation. */
  replaced: boolean;
  origin: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const base = draftOf(apiKey);
  const [draft, setDraft] = useState<Draft>(base);
  const [saving, setSaving] = useState(false);
  const editable = state.live;
  const endsEditable = editable && !replaced;
  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));
  const dirty = draft.label.trim() !== base.label || draft.scopes.slice().sort().join() !== base.scopes.slice().sort().join() || draft.ends !== base.ends || (draft.ends === "date" && draft.date !== base.date);
  const invalid = !draft.label.trim() || draft.scopes.length === 0 || (draft.ends === "date" && !draft.date);
  const zone = viewerTimeZone();

  async function save(): Promise<boolean> {
    if (invalid) return false;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (draft.label.trim() !== base.label) body.label = draft.label.trim();
      if (draft.scopes.slice().sort().join() !== base.scopes.slice().sort().join()) body.scopes = draft.scopes;
      if (draft.ends !== base.ends || (draft.ends === "date" && draft.date !== base.date)) body.expiresAt = draft.ends === "never" ? null : endOfDay(draft.date);
      await send(`/api/app/api-keys/${apiKey.id}`, "PATCH", body);
      notify.done(`${draft.label.trim()} saved.`);
      await onSaved();
      return true;
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (dirty && !(await confirmAction({ title: "Discard your changes?", description: `The unsaved changes to ${apiKey.label} are lost.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    onClose();
  }

  const extend90 = () => {
    const from = draft.ends === "date" && draft.date ? Date.parse(`${draft.date}T12:00:00`) : Date.now();
    set({ ends: "date", date: localDay(new Date(Math.max(from, Date.now()) + 90 * 86_400_000)) });
  };

  const subtitle = (
    <span className="inline-flex flex-wrap items-center gap-1">
      Made {dayMonthYear(apiKey.createdAt, zone)} by <Person name={apiKey.createdByName} /> · last used {whenWords(apiKey.lastUsedAt).replace(/^Today/, "today").replace(/^Never$/, "never")}
    </span>
  );

  return (
    <Sheet
      title={apiKey.label}
      subtitle={subtitle}
      status={<StatusChip tone={state.tone}>{state.label}</StatusChip>}
      onClose={() => void close()}
      closeLabel={`Close ${apiKey.label}`}
      className="lg:w-[640px]"
      bodyClassName="flex flex-col gap-5 p-4"
      footer={editable ? (
        <>
          <Button type="button" variant="destructive" onClick={onRevoke}>Revoke</Button>
          <span className="ml-auto flex gap-2">
            {!replaced && <Button type="button" variant="outline" onClick={onRotate}>Rotate key</Button>}
            <Button type="button" disabled={!dirty || saving || invalid} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          </span>
        </>
      ) : (
        <span className="ml-auto"><Button type="button" variant="ghost" onClick={onClose}>Close</Button></span>
      )}
    >
      <SheetSection title="Name" help="Say what uses it, so the next person knows what breaks if it's revoked.">
        <Field label="Name" htmlFor="key-sheet-name">
          <input id="key-sheet-name" className={control} value={draft.label} maxLength={80} disabled={!editable} onChange={(event) => set({ label: event.target.value })} autoComplete="off" />
        </Field>
      </SheetSection>

      <SheetSection title="What it can do" help="Only what this app needs. You can narrow it now; widening it makes a new key.">
        <div className="flex flex-col gap-2">
          {API_SCOPES.map((scope) => {
            const had = apiKey.scopes.includes(scope.key);
            return (
              <TickCard
                key={scope.key}
                checked={draft.scopes.includes(scope.key)}
                disabled={!editable || !had}
                onChange={(checked) => set({ scopes: checked ? [...draft.scopes, scope.key] : draft.scopes.filter((item) => item !== scope.key) })}
                title={scope.label}
                sub={scope.description}
                end={!had && editable ? "Widening makes a new key" : undefined}
              />
            );
          })}
        </div>
      </SheetSection>

      <SheetSection title="Ends" help={replaced ? "This key is rotating out: it stops when the rotation's overlap ends." : `We'll still ask about it if it goes ${IDLE_DAYS} days unused.`}>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Ends"
            options={[{ key: "never", label: "Never" }, { key: "date", label: "On a date" }]}
            value={draft.ends}
            onChange={(next) => set({ ends: next, date: next === "date" && !draft.date ? localDay(new Date(Date.now() + 90 * 86_400_000)) : draft.date })}
            disabled={!endsEditable}
          />
          {draft.ends === "date" && (
            <input type="date" aria-label="End date" className={cn(control, "mt-0 w-[170px]")} value={draft.date} min={localDay(new Date())} disabled={!endsEditable} onChange={(event) => set({ date: event.target.value })} />
          )}
          {endsEditable && <Button type="button" variant="outline" size="sm" onClick={extend90}>Extend 90 days</Button>}
        </div>
      </SheetSection>

      <SheetSection title="Try it" help="A copy-ready request. Paste the full key where it says YOUR_KEY.">
        <RequestSample origin={origin} path={samplePath(apiKey.scopes)} />
      </SheetSection>

      <TechnicalDetails
        rows={[
          { label: "Key", value: `${apiKey.keyPrefix}…${apiKey.lastFour}`, shown: `${apiKey.keyPrefix}••••••••${apiKey.lastFour}`, copy: false },
          { label: "Last used from", value: apiKey.lastUsedIp ?? "Not used yet", copy: Boolean(apiKey.lastUsedIp) },
          { label: "Scope names", value: apiKey.scopes.join(", ") },
        ]}
      />
      {editable && <LeaveGuard dirty={dirty} onSave={save} onDiscard={() => setDraft(base)} what={`${apiKey.label}`} />}
    </Sheet>
  );
}

export { filterOf as keyFilterOf };
