"use client";

/**
 * The appointment vault's shared parts: the carrier × state checkbox grid and the licence dialog.
 * (E&O cover and continuing education were removed from the platform 2026-10-26.)
 *
 * Two screens render them — Settings › States & licences (appointment-vault-settings.tsx) and
 * /app/appointments (carrier-appointments-page.tsx) — so they live here once rather than in either.
 * Moved verbatim from appointment-vault-settings.tsx; the only addition is AppointmentGrid's optional
 * `actions` slot, which Settings does not pass.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PagedBody, PagedPager, PagedProvider, PagedTableCard } from "@/components/ui/paged";
import { Field, control, st } from "@/components/app/settings/primitives";
import type { CarrierRow } from "@/lib/carriers/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { dayMonthYear } from "@/lib/format/dates";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import { cn } from "@/lib/utils";
import { licenceExpiryValue, licenceNumberValue } from "@/lib/appointments/tickModel";
import {
  LINES_OF_AUTHORITY,
  type LicenceType,
  type LicenseRow,
} from "@/lib/appointments/service-types";

export const today = new Date().toISOString().slice(0, 10);
export const keyFor = (carrierId: string, state: string) => `${carrierId}:${state}`;
const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
export const stateName = (code: string) => STATE_NAME.get(code) ?? code;
const asDate = (value: string) => new Date(`${value}T00:00:00`);
/** "4 Dec 2026", the boards' table date. A calendar day, so no zone can shift it. */
export const shortDate = (value: string) => dayMonthYear(value);
/** "2 November 2026", the boards' key/value date. */
export const longDate = (value: string) => asDate(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "Not recorded" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export type SaveResult = { ok: true; body: unknown } | { ok: false; error: string };

/* ── carrier × state grid ──────────────────────────────────────────────── */

export function AppointmentGrid({
  carriers,
  states,
  selected,
  setSelected,
  stateFilter,
  setStateFilter,
  effectiveFrom,
  setEffectiveFrom,
  canEdit,
  pending,
  actions,
}: {
  carriers: CarrierRow[];
  states: ReadonlyArray<(typeof US_STATES)[number]>;
  selected: Set<string>;
  setSelected: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void;
  stateFilter: string;
  setStateFilter: (value: string) => void;
  effectiveFrom: string;
  setEffectiveFrom: (value: string) => void;
  canEdit: boolean;
  pending: { additions: number; removals: number };
  /** Extra controls after the selection count; /app/appointments puts its draft actions here. */
  actions?: ReactNode;
}) {
  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  const pendingLabel = [pending.additions && `${pending.additions} to add`, pending.removals && `${pending.removals} to end`].filter(Boolean).join(", ");
  const selectedText = <>{plural(selected.size, "appointment")} selected{pendingLabel ? ` · ${pendingLabel}, unsaved` : ""}</>;
  return (
    <PagedTableCard
      total={carriers.length}
      noun="carriers"
      suffix={selectedText}
      title="Carrier appointments by state"
      toolbar={
        <DataToolbar
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!canEdit}
                onClick={() => setSelected((current) => new Set([...current, ...carriers.flatMap((carrier) => states.map(([state]) => keyFor(carrier.id, state)))]))}
              >
                Select visible states
              </Button>
              <Button type="button" variant="ghost" disabled={!canEdit} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              {actions}
            </>
          }
        >
          <ToolbarSearch value={stateFilter} onChange={setStateFilter} placeholder="Arizona or AZ" label="Find a state" />
          <label
            htmlFor="appointment-effective"
            className="flex items-center gap-2 text-sm text-muted-foreground"
            title="New appointments start, and unchecked ones end, on this date when you save."
          >
            Effective from
            <input
              id="appointment-effective"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.currentTarget.value)}
              onInput={(event) => setEffectiveFrom(event.currentTarget.value)}
              disabled={!canEdit}
              required
              className={toolbarControl}
            />
          </label>
        </DataToolbar>
      }
      footer={
        <span className="tabular-nums">
          {selectedText}
        </span>
      }
    >
      <div className="hidden max-w-full overflow-x-auto [contain:paint] sm:block">
        <table className={cn(st.table, "min-w-[980px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "sticky left-0 min-w-48 bg-[var(--surface-alt)]")}>Carrier</th>
              {states.map(([code, name]) => (
                <th key={code} scope="col" className={cn(st.th, "min-w-12 px-2 text-center")} title={name}>
                  {code}
                </th>
              ))}
            </tr>
          </thead>
          <PagedBody>
            {carriers.map((carrier) => (
              <tr key={carrier.id}>
                <th scope="row" className={cn(st.td, st.strong, "sticky left-0 bg-[var(--surface)] text-left")}>
                  {carrier.name}
                </th>
                {states.map(([code, name]) => {
                  const key = keyFor(carrier.id, code);
                  return (
                    <td key={code} className={cn(st.td, "px-2 text-center")}>
                      <label className="inline-flex cursor-pointer items-center justify-center">
                        <span className="sr-only">
                          {carrier.name} in {name}
                        </span>
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          disabled={!canEdit}
                          onChange={(event) => toggle(key, event.target.checked)}
                          className="size-4 accent-[var(--brand-500)]"
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </PagedBody>
        </table>
      </div>
      <div className="p-4 sm:hidden" aria-label="Appointments by carrier">
        <PagedBody as="div" className="space-y-4">
        {carriers.map((carrier) => (
          <fieldset key={carrier.id} className="rounded-[8px] border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-semibold text-[var(--ink)]">{carrier.name}</legend>
            <div className="grid grid-cols-2 gap-2">
              {states.map(([code, name]) => {
                const key = keyFor(carrier.id, code);
                return (
                  <label key={code} className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-2 text-sm text-[var(--body)]">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={!canEdit}
                      aria-label={`${carrier.name} in ${name}`}
                      onChange={(event) => toggle(key, event.target.checked)}
                      className="size-4 shrink-0 accent-[var(--brand-500)]"
                    />
                    <span className="truncate" title={name}>{code}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        </PagedBody>
      </div>
    </PagedTableCard>
  );
}

/* ── dialogs ───────────────────────────────────────────────────────────── */

export function RecordDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[var(--ink)]">{title}</DialogTitle>
          <DialogDescription className="text-sm text-[var(--muted)]">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function FormFooter({ saving, label, error, onCancel }: { saving: boolean; label: string; error: string; onCancel: () => void }) {
  return (
    <div className="sm:col-span-2">
      {error && (
        <p role="alert" className="mb-3 text-sm leading-[1.5] text-[var(--error-ink)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}

function RecordList({ items }: { items: { key: string; tag: string; text: string; sub: string }[] }) {
  if (items.length === 0) return null;
  return (
    <PagedProvider>
    <PagedBody as="ul" className="m-0 flex list-none flex-col gap-1.5 border-t border-[var(--border)] p-0 pt-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
          <StatusChip dot={false} tone="neutral">{item.tag}</StatusChip>
          <span>{item.text}</span>
          <span className="text-[var(--muted)]">{item.sub}</span>
        </li>
      ))}
    </PagedBody>
    {items.length > 10 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground"><PagedPager total={items.length} noun="records" /></div>}
    </PagedProvider>
  );
}

const pendingHint = (extended: boolean) => (extended ? undefined : SCHEMA_PENDING_MESSAGE);

export function LicenceDialog({
  open,
  onOpenChange,
  licences,
  extended,
  saving,
  onSave,
  initialState = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  licences: LicenseRow[];
  extended: boolean;
  saving: boolean;
  onSave: (payload: unknown) => Promise<SaveResult>;
  /** The state to open on, e.g. from Route's "Add a TX licence" (?tab=licences&state=TX). */
  initialState?: string | null;
}) {
  const blank = { state: initialState || "AZ", license_number: "", expires_at: "", licence_type: "" as "" | LicenceType, lines: [] as string[] };
  const [form, setForm] = useState(() => {
    const row = licences.find((item) => item.state === blank.state);
    return row ? { state: row.state, license_number: licenceNumberValue(row.license_number), expires_at: licenceExpiryValue(row.expires_at), licence_type: row.licence_type ?? ("" as const), lines: row.lines_of_authority ?? [] } : blank;
  });
  const [error, setError] = useState("");
  const existing = licences.find((row) => row.state === form.state) ?? null;

  function pickState(state: string) {
    const row = licences.find((item) => item.state === state);
    setForm(row ? { state, license_number: licenceNumberValue(row.license_number), expires_at: licenceExpiryValue(row.expires_at), licence_type: row.licence_type ?? "", lines: row.lines_of_authority ?? [] } : { ...blank, state });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const payload: Record<string, unknown> = { state: form.state, license_number: form.license_number, expires_at: form.expires_at };
    if (extended) {
      payload.licence_type = form.licence_type || null;
      payload.lines_of_authority = form.lines;
    }
    const result = await onSave(payload);
    if (!result.ok) setError(result.error);
    else {
      setForm(blank);
      onOpenChange(false);
    }
  }
  return (
    <RecordDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError("");
        onOpenChange(next);
      }}
      title={existing ? `Update the ${stateName(form.state)} licence` : "Add a licence"}
      description="One licence per state; choosing a state you already hold updates it."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
        <Field label="State" htmlFor="license-state">
          <select id="license-state" className={control} value={form.state} onChange={(event) => pickState(event.target.value)}>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="Type" htmlFor="license-type" hint={pendingHint(extended)}>
          <select
            id="license-type"
            className={control}
            value={form.licence_type}
            disabled={!extended}
            onChange={(event) => setForm((current) => ({ ...current, licence_type: event.target.value as "" | LicenceType }))}
          >
            <option value="">Not recorded</option>
            <option value="resident">Resident</option>
            <option value="non_resident">Non-resident</option>
          </select>
        </Field>
        {/* Optional (owner, 2026-10-28): a licence counts once it is ticked; the details can follow. */}
        <Field label="Licence number" htmlFor="license-number" hint="Optional">
          <input
            id="license-number"
            className={control}
            value={form.license_number}
            onChange={(event) => setForm((current) => ({ ...current, license_number: event.target.value }))}
            maxLength={120}
          />
        </Field>
        <Field label="Expires" htmlFor="license-expires" hint="Optional">
          <input
            id="license-expires"
            type="date"
            className={control}
            value={form.expires_at}
            onChange={(event) => { const expiresAt = event.currentTarget.value; setForm((current) => ({ ...current, expires_at: expiresAt })); }}
            // Read before the updater runs: React clears currentTarget once the handler returns, and the
            // updater runs later — reading it there crashed the page (QA 2026-10-22).
            onInput={(event) => { const expiresAt = event.currentTarget.value; setForm((current) => ({ ...current, expires_at: expiresAt })); }}
          />
        </Field>
        <fieldset className="sm:col-span-2" disabled={!extended}>
          <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Lines of authority</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {LINES_OF_AUTHORITY.map((line) => {
              const id = `license-line-${line.replace(/\W+/g, "-").toLowerCase()}`;
              return (
                <label key={line} htmlFor={id} className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2 text-sm text-[var(--body)]">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-[var(--brand-500)]"
                    checked={form.lines.includes(line)}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        lines: event.target.checked ? LINES_OF_AUTHORITY.filter((item) => item === line || current.lines.includes(item)) : current.lines.filter((item) => item !== line),
                      }))
                    }
                  />
                  {line}
                </label>
              );
            })}
          </div>
          {!extended && <span className="mt-1.5 block text-xs text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</span>}
        </fieldset>
        <FormFooter saving={saving} label={existing ? "Update licence" : "Save licence"} error={error} onCancel={() => onOpenChange(false)} />
      </form>
      <RecordList
        items={licences.map((row) => ({ key: row.id, tag: row.state, text: licenceNumberValue(row.license_number) || "No number yet", sub: licenceExpiryValue(row.expires_at) ? `expires ${shortDate(row.expires_at)}` : "No expiry" }))}
      />
    </RecordDialog>
  );
}
