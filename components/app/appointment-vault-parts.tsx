"use client";

/**
 * The appointment vault's shared parts: the carrier × state checkbox grid, the continuing-education
 * summary, and the licence, E&O and CE dialogs.
 *
 * Two screens render them — Settings › States & licences (appointment-vault-settings.tsx) and
 * /app/appointments (carrier-appointments-page.tsx) — so they live here once rather than in either.
 * Moved verbatim from appointment-vault-settings.tsx; the only addition is AppointmentGrid's optional
 * `actions` slot, which Settings does not pass.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableCard } from "@/components/ui/table-card";
import { Field, KeyValues, Pill, SettingsMeter, control, st } from "@/components/app/settings/primitives";
import type { CarrierRow } from "@/lib/carriers/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { dayMonthYear } from "@/lib/format/dates";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import { cn } from "@/lib/utils";
import {
  LINES_OF_AUTHORITY,
  type CeRecordRow,
  type EoPolicyRow,
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
const dollarsToCents = (value: string) => (value.trim() === "" ? null : Math.round(Number(value.replace(/[$,\s]/g, "")) * 100));
const centsToDollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : String(cents / 100));
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export type SaveResult = { ok: true; body: unknown } | { ok: false; error: string };

/* ── continuing education summary ──────────────────────────────────────── */

export function CeSummary({ record }: { record: CeRecordRow }) {
  const remaining = Math.max(0, record.credits_required - record.credits_completed);
  const ethicsKnown = record.ethics_required !== null && record.ethics_required !== undefined;
  const ethicsRemaining = ethicsKnown ? Math.max(0, (record.ethics_required ?? 0) - (record.ethics_completed ?? 0)) : 0;
  const generalRemaining = Math.max(0, remaining - ethicsRemaining);
  const remainingLabel =
    remaining === 0
      ? "None"
      : ethicsKnown
        ? [generalRemaining && `${generalRemaining} general`, ethicsRemaining && `${ethicsRemaining} ethics`].filter(Boolean).join(", ")
        : plural(remaining, "credit");
  return (
    <div className="flex flex-col gap-4">
      <SettingsMeter
        value={record.credits_completed}
        max={record.credits_required}
        tone={record.credits_required > 0 && record.credits_completed >= record.credits_required ? "success" : "primary"}
        ariaLabel={`${record.credits_completed} of ${record.credits_required} credits`}
        caption={`${record.credits_completed} of ${record.credits_required} credits`}
      />
      <KeyValues
        cols={1}
        items={[
          { label: "Cycle ends", value: shortDate(record.deadline), tone: record.deadline < today ? "error" : undefined },
          { label: "Ethics credits", value: ethicsKnown ? `${record.ethics_completed ?? 0} of ${record.ethics_required}` : "Not recorded" },
          { label: "Remaining", value: remainingLabel },
        ]}
      />
    </div>
  );
}

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
  return (
    <TableCard
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
          {plural(selected.size, "appointment")} selected{pendingLabel ? ` · ${pendingLabel}, unsaved` : ""}
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
          <tbody>
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
          </tbody>
        </table>
      </div>
      <div className="space-y-4 p-4 sm:hidden" aria-label="Appointments by carrier">
        {carriers.map((carrier) => (
          <fieldset key={carrier.id} className="rounded-[8px] border border-[var(--border)] p-3">
            <legend className="px-1 text-[14px] font-semibold text-[var(--ink)]">{carrier.name}</legend>
            <div className="grid grid-cols-2 gap-2">
              {states.map(([code, name]) => {
                const key = keyFor(carrier.id, code);
                return (
                  <label key={code} className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-2 text-[14px] text-[var(--body)]">
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
      </div>
    </TableCard>
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
          <DialogDescription className="text-[14px] text-[var(--muted)]">{description}</DialogDescription>
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
        <p role="alert" className="mb-3 text-[14px] leading-[1.5] text-[var(--error-ink)]">
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
    <ul className="m-0 flex list-none flex-col gap-1.5 border-t border-[var(--border)] p-0 pt-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-wrap items-center gap-2 text-[14px] text-[var(--body)]">
          <Pill tone="neutral">{item.tag}</Pill>
          <span>{item.text}</span>
          <span className="text-[var(--muted)]">{item.sub}</span>
        </li>
      ))}
    </ul>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  licences: LicenseRow[];
  extended: boolean;
  saving: boolean;
  onSave: (payload: unknown) => Promise<SaveResult>;
}) {
  const blank = { state: "AZ", license_number: "", expires_at: "", licence_type: "" as "" | LicenceType, lines: [] as string[] };
  const [form, setForm] = useState(() => {
    const row = licences.find((item) => item.state === blank.state);
    return row ? { state: row.state, license_number: row.license_number, expires_at: row.expires_at, licence_type: row.licence_type ?? ("" as const), lines: row.lines_of_authority ?? [] } : blank;
  });
  const [error, setError] = useState("");
  const existing = licences.find((row) => row.state === form.state) ?? null;

  function pickState(state: string) {
    const row = licences.find((item) => item.state === state);
    setForm(row ? { state, license_number: row.license_number, expires_at: row.expires_at, licence_type: row.licence_type ?? "", lines: row.lines_of_authority ?? [] } : { ...blank, state });
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
        <Field label="Licence number" htmlFor="license-number" required>
          <input
            id="license-number"
            className={control}
            value={form.license_number}
            onChange={(event) => setForm((current) => ({ ...current, license_number: event.target.value }))}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Expires" htmlFor="license-expires" required>
          <input
            id="license-expires"
            type="date"
            className={control}
            value={form.expires_at}
            onChange={(event) => setForm((current) => ({ ...current, expires_at: event.currentTarget.value }))}
            onInput={(event) => setForm((current) => ({ ...current, expires_at: event.currentTarget.value }))}
            required
          />
        </Field>
        <fieldset className="sm:col-span-2" disabled={!extended}>
          <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Lines of authority</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {LINES_OF_AUTHORITY.map((line) => {
              const id = `license-line-${line.replace(/\W+/g, "-").toLowerCase()}`;
              return (
                <label key={line} htmlFor={id} className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2 text-[14px] text-[var(--body)]">
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
          {!extended && <span className="mt-1.5 block text-[12px] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</span>}
        </fieldset>
        <FormFooter saving={saving} label={existing ? "Update licence" : "Save licence"} error={error} onCancel={() => onOpenChange(false)} />
      </form>
      <RecordList
        items={licences.map((row) => ({ key: row.id, tag: row.state, text: row.license_number, sub: `expires ${shortDate(row.expires_at)}` }))}
      />
    </RecordDialog>
  );
}

export function EoDialog({
  open,
  onOpenChange,
  policies,
  current,
  extended,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies: EoPolicyRow[];
  current: EoPolicyRow | null;
  extended: boolean;
  saving: boolean;
  onSave: (payload: unknown) => Promise<SaveResult>;
}) {
  const fromPolicy = (row: EoPolicyRow | null) => ({
    carrier: row?.carrier ?? "",
    policy_number: row?.policy_number ?? "",
    expires_at: row?.expires_at ?? "",
    coverage: centsToDollars(row?.coverage_amount_cents),
    per_claim: centsToDollars(row?.per_claim_cents),
    aggregate: centsToDollars(row?.aggregate_cents),
  });
  const [form, setForm] = useState(() => fromPolicy(current));
  const [error, setError] = useState("");
  const set = (key: keyof ReturnType<typeof fromPolicy>) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setForm((state) => ({ ...state, [key]: value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const coverage = dollarsToCents(form.coverage);
    if (coverage === null || !Number.isFinite(coverage)) {
      setError("Enter the coverage amount in dollars");
      return;
    }
    const payload: Record<string, unknown> = { carrier: form.carrier, policy_number: form.policy_number, expires_at: form.expires_at, coverage_amount_cents: coverage };
    if (extended) {
      payload.per_claim_cents = dollarsToCents(form.per_claim);
      payload.aggregate_cents = dollarsToCents(form.aggregate);
    }
    const result = await onSave(payload);
    if (!result.ok) setError(result.error);
    else onOpenChange(false);
  }
  return (
    <RecordDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError("");
        onOpenChange(next);
      }}
      title="Errors & omissions cover"
      description="Saving a policy number you already hold updates it; a new number adds a policy."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
        <Field label="E&O carrier" htmlFor="eo-carrier" required>
          <input id="eo-carrier" className={control} value={form.carrier} onChange={set("carrier")} maxLength={160} required />
        </Field>
        <Field label="Policy number" htmlFor="eo-policy-number" required>
          <input id="eo-policy-number" className={control} value={form.policy_number} onChange={set("policy_number")} maxLength={120} required />
        </Field>
        <Field label="Expires" htmlFor="eo-expires" required>
          <input id="eo-expires" type="date" className={control} value={form.expires_at} onChange={set("expires_at")} onInput={(event) => { const value = event.currentTarget.value; setForm((state) => ({ ...state, expires_at: value })); }} required />
        </Field>
        <Field label="Coverage amount ($)" htmlFor="eo-coverage" required hint="The policy's headline limit, as it appears on the declarations page.">
          <input id="eo-coverage" inputMode="decimal" className={control} value={form.coverage} onChange={set("coverage")} required />
        </Field>
        <Field label="Per claim ($)" htmlFor="eo-per-claim" hint={pendingHint(extended)}>
          <input id="eo-per-claim" inputMode="decimal" className={control} value={form.per_claim} onChange={set("per_claim")} disabled={!extended} />
        </Field>
        <Field label="Aggregate ($)" htmlFor="eo-aggregate" hint={pendingHint(extended)}>
          <input id="eo-aggregate" inputMode="decimal" className={control} value={form.aggregate} onChange={set("aggregate")} disabled={!extended} />
        </Field>
        <FormFooter saving={saving} label="Save E&O policy" error={error} onCancel={() => onOpenChange(false)} />
      </form>
      <RecordList items={policies.map((row) => ({ key: row.id, tag: row.carrier, text: row.policy_number, sub: `expires ${shortDate(row.expires_at)}` }))} />
    </RecordDialog>
  );
}

export function CeDialog({
  open,
  onOpenChange,
  records,
  current,
  extended,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: CeRecordRow[];
  current: CeRecordRow | null;
  extended: boolean;
  saving: boolean;
  onSave: (payload: unknown) => Promise<SaveResult>;
}) {
  const fromRecord = (row: CeRecordRow | null, state = row?.state ?? "AZ") => ({
    state,
    credits_required: row ? String(row.credits_required) : "",
    credits_completed: row ? String(row.credits_completed) : "",
    deadline: row?.deadline ?? "",
    ethics_required: row?.ethics_required === null || row?.ethics_required === undefined ? "" : String(row.ethics_required),
    ethics_completed: row?.ethics_completed === null || row?.ethics_completed === undefined ? "" : String(row.ethics_completed),
  });
  const [form, setForm] = useState(() => fromRecord(current));
  const [error, setError] = useState("");
  const set = (key: keyof ReturnType<typeof fromRecord>) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setForm((state) => ({ ...state, [key]: value }));
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const payload: Record<string, unknown> = { state: form.state, credits_required: form.credits_required, credits_completed: form.credits_completed, deadline: form.deadline };
    if (extended) {
      payload.ethics_required = form.ethics_required;
      payload.ethics_completed = form.ethics_completed;
    }
    const result = await onSave(payload);
    if (!result.ok) setError(result.error);
    else onOpenChange(false);
  }
  return (
    <RecordDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError("");
        onOpenChange(next);
      }}
      title="Continuing education"
      description="One cycle per state, with its credits and deadline."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
        <Field label="State" htmlFor="ce-state">
          <select
            id="ce-state"
            className={control}
            value={form.state}
            onChange={(event) => {
              const state = event.target.value;
              setForm(fromRecord(records.find((row) => row.state === state) ?? null, state));
            }}
          >
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cycle ends" htmlFor="ce-deadline" required>
          <input id="ce-deadline" type="date" className={control} value={form.deadline} onChange={set("deadline")} onInput={(event) => { const value = event.currentTarget.value; setForm((state) => ({ ...state, deadline: value })); }} required />
        </Field>
        <Field label="Credits required" htmlFor="ce-required" required>
          <input id="ce-required" type="number" min={0} max={10000} className={control} value={form.credits_required} onChange={set("credits_required")} required />
        </Field>
        <Field label="Credits completed" htmlFor="ce-completed" required>
          <input id="ce-completed" type="number" min={0} max={10000} className={control} value={form.credits_completed} onChange={set("credits_completed")} required />
        </Field>
        <Field label="Ethics credits required" htmlFor="ce-ethics-required" hint={pendingHint(extended) ?? "Part of the total above."}>
          <input id="ce-ethics-required" type="number" min={0} max={10000} className={control} value={form.ethics_required} onChange={set("ethics_required")} disabled={!extended} />
        </Field>
        <Field label="Ethics credits completed" htmlFor="ce-ethics-completed" hint={pendingHint(extended)}>
          <input id="ce-ethics-completed" type="number" min={0} max={10000} className={control} value={form.ethics_completed} onChange={set("ethics_completed")} disabled={!extended} />
        </Field>
        <FormFooter saving={saving} label="Save CE record" error={error} onCancel={() => onOpenChange(false)} />
      </form>
      <RecordList
        items={records.map((row) => ({ key: row.id, tag: row.state, text: `${row.credits_completed}/${row.credits_required} credits`, sub: `deadline ${shortDate(row.deadline)}` }))}
      />
    </RecordDialog>
  );
}
