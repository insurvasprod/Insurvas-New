"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { TableCard } from "@/components/ui/table-card";
import { CADENCES, COMMISSION_TRIGGERS, SETTING_FIELDS, STATEMENT_FORMATS, type SettingField } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/app/carrier-rules";
const TRIGGER_LABEL: Record<string, string> = { on_issue: "On issue", on_first_draft: "On first draft" };
const CADENCE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", ad_hoc: "Now and then" };
const FORMAT_LABEL: Record<string, string> = { spreadsheet: "Spreadsheet", pdf: "PDF" };
export const FACT_LABEL: Record<SettingField, string> = { commissionTrigger: "Pays commission", expectedLagDays: "Payment lag", minimumPayoutCents: "Minimum payout", toleranceCents: "Tolerance", expectedCadence: "Files arrive", statementFormat: "Statement format" };
const API_FIELD: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };

/** Where the facts this page does not edit are kept: their own pages (edit map, board 1). */
export const SETTINGS_CARRIERS = "/app/settings#carriers";
export const FIELD_MAPS = "/app/settings#carriers/carriers-maps";
export const FILES_IN_BUCKET = "/app/book-setup/how-files-arrive/bucket";
const RATE_CARD = "/app/book-setup";
const PAY_ISSUES = "/app/discrepancies";
const DISPUTE_LETTERS = "/app/discrepancies?view=letters";

export const MONEY_FIELDS = ["commissionTrigger", "expectedLagDays", "minimumPayoutCents", "toleranceCents"] as const satisfies readonly SettingField[];

export type OwnedValue = { value: string | number | null; scope: "agency" | "platform" | null; since: string | null };
export type FactsSettings = Record<SettingField, OwnedValue & { yours: string | number | null; insurvas: string | number | null }>;

export type FilesFacts = {
  layouts: Array<{ fileType: "policies" | "commissions"; key: string; name: string | null; version: number | null; scope: "agency" | "platform" }>;
  portal: OwnedValue;
  guidance: { whereInPortal: string | null; reportName: string | null; formatHint: string | null } | null;
  referencePattern: OwnedValue;
};

export type DeskFacts = { address: string; email: string | null; since: string } | null;

/** A fact's value in words, or null when nobody set it. */
export function settingText(field: SettingField, value: string | number | null): string | null {
  if (value === null || value === "") return null;
  if (field === "commissionTrigger") return TRIGGER_LABEL[String(value)] ?? String(value);
  if (field === "expectedCadence") return CADENCE_LABEL[String(value)] ?? String(value);
  if (field === "statementFormat") return FORMAT_LABEL[String(value)] ?? String(value);
  if (field === "expectedLagDays") return `${value} ${Number(value) === 1 ? "day" : "days"}`;
  return `$${(Number(value) / 100).toFixed(2)}`;
}

/** Whose a value is: Insurvas's default, or yours from a date. */
export function whoseValue(owned: OwnedValue): string | null {
  if (owned.scope === "agency") return owned.since ? `yours, from ${fileDay(owned.since)}` : "yours";
  if (owned.scope === "platform") return "Insurvas's";
  return null;
}

/** One layout as a link to the field maps, "commission file layout v3". */
export const layoutWords = (layout: FilesFacts["layouts"][number]) => `${layout.fileType === "policies" ? "policy file" : "commission file"} ${layout.version === null ? layout.name ?? layout.key : `layout v${layout.version}`}${layout.scope === "agency" ? " (yours)" : ""}`;

const choicesOf = (field: SettingField): Array<[string, string]> | null =>
  field === "commissionTrigger" ? COMMISSION_TRIGGERS.map((v) => [v, TRIGGER_LABEL[v]]) : field === "expectedCadence" ? CADENCES.map((v) => [v, CADENCE_LABEL[v]]) : field === "statementFormat" ? STATEMENT_FORMATS.map((v) => [v, FORMAT_LABEL[v]]) : null;
const isMoney = (field: SettingField) => field === "minimumPayoutCents" || field === "toleranceCents";

/** The draft as the API takes it, or an error line. */
function parse(field: SettingField, raw: string): { value: string | number } | { error: string } {
  const text = raw.trim();
  if (isMoney(field)) return /^\d+(\.\d{1,2})?$/.test(text) ? { value: Math.round(Number(text) * 100) } : { error: "Enter an amount, like 25.00." };
  if (field === "expectedLagDays") return /^\d+$/.test(text) ? { value: Number(text) } : { error: "Enter a number of days, like 45." };
  return text ? { value: text } : { error: "Choose one." };
}

/**
 * A fact's dialog (board 1·5, Dialog md): one value, "Back to Insurvas's" when it is yours, Cancel and Save. The same
 * save as before (save_settings with every one of the agency's own values; clearing one hands it back). A wrong amount
 * or a server error shows on the error line, beside the fix.
 */
export function FactDialog({ carrierId, carrierName, field, settings, onClose }: { carrierId: string; carrierName: string; field: SettingField; settings: FactsSettings; onClose: () => void }) {
  const router = useRouter();
  const owned = settings[field];
  const start = owned.yours ?? owned.value;
  const [draft, setDraft] = useState(start === null ? "" : isMoney(field) ? (Number(start) / 100).toFixed(2) : String(start));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parse(field, draft);
  const shownError = error ?? (touched && "error" in parsed && draft.trim() ? parsed.error : null);
  const choices = choicesOf(field);
  const insurvas = settingText(field, owned.insurvas);
  const id = `${carrierId}-${field}`;

  async function save(value: string | number | null) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action: "save_settings", carrier_id: carrierId };
    for (const f of SETTING_FIELDS) body[API_FIELD[f]] = f === field ? value : settings[f].yours;
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(value === null ? `${FACT_LABEL[field]}: back to Insurvas's.` : `${FACT_LABEL[field]} saved.`);
      router.refresh();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const said = owned.scope === null ? "Not set." : [whoseValue(owned), owned.scope === "agency" && insurvas ? `Insurvas's is ${insurvas}` : null].filter(Boolean).join(" · ");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="pr-8">{carrierName} · {FACT_LABEL[field]}</DialogTitle>
          <DialogDescription>{said}</DialogDescription>
        </DialogHeader>
        <Field label={FACT_LABEL[field]} htmlFor={id} hint={field === "expectedLagDays" ? "days" : undefined} error={shownError ?? undefined}>
          {choices ? (
            <select id={id} autoFocus className={control} value={draft} onChange={(e) => { setDraft(e.target.value); setTouched(true); setError(null); }}>
              <option value="">Choose</option>
              {choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          ) : (
            <input
              id={id}
              autoFocus
              className={cn(control, shownError && "border-[var(--error)]")}
              inputMode={isMoney(field) ? "decimal" : "numeric"}
              placeholder={isMoney(field) ? "$" : "days"}
              value={draft}
              onChange={(e) => { setDraft(e.target.value.replace(isMoney(field) ? /[^\d.]/g : /\D/g, "")); setTouched(true); setError(null); }}
            />
          )}
        </Field>
        <DialogFooter className="border-t border-border pt-4 sm:items-center">
          {owned.yours !== null && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>Back to Insurvas&apos;s</Button>}
          <span className="hidden flex-1 sm:block" />
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || "error" in parsed} onClick={() => { if ("value" in parsed) void save(parsed.value); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const notSet = <span className="text-muted-foreground" title="Not set">—</span>;
const link = "whitespace-nowrap hover:underline";
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

type FactRow = { key: string; label: string; value: ReactNode; whose: string | null; usedBy?: ReactNode; field?: SettingField; action?: ReactNode; valueTitle?: string };

/**
 * A carrier's Money and Files tabs (boards 1·2, 1·3, direction B): each fact one full-width row with its value, whose
 * it is, and (Money) what it is used by, linked. A carrier setting's row opens its fact dialog. The facts kept
 * elsewhere link there instead: the portal to Settings › Carriers, a layout to the field maps, the commissions desk to
 * a dispute letter; the policy number pattern is kept by Insurvas. The desk's phone number has no column, so it says
 * "not kept yet" rather than inventing one.
 */
export function CarrierFacts({ view, carrierId, carrierName, settings, files, desk, readOnly }: { view: "money" | "files"; carrierId: string; carrierName: string; settings: FactsSettings; files: FilesFacts; desk: DeskFacts; readOnly: boolean }) {
  const [editing, setEditing] = useState<SettingField | null>(null);
  const setting = (field: SettingField, usedBy?: ReactNode): FactRow => {
    const text = settingText(field, settings[field].value);
    return { key: field, label: FACT_LABEL[field], value: text ?? notSet, whose: whoseValue(settings[field]), usedBy, field };
  };
  const where = files.guidance ? [files.guidance.whereInPortal, files.guidance.reportName].filter(Boolean).join(" › ") : "";

  const rows: FactRow[] = view === "money" ? [
    setting("commissionTrigger", <Link href={RATE_CARD} className={link} title="Expected commission">Rate card</Link>),
    setting("expectedLagDays", <Link href={PAY_ISSUES} className={link} title="Past the usual lag">Pay issues</Link>),
    setting("minimumPayoutCents", <span title="Short payments under it are not flagged">Short payments</span>),
    setting("toleranceCents", <span title="A payment within it counts as paid in full">Paid in full</span>),
    {
      key: "desk",
      label: "Commissions desk",
      value: desk ? [desk.address, desk.email].filter(Boolean).join(" · ") : notSet,
      valueTitle: "Phone: not kept yet",
      whose: desk ? `yours, from ${fileDay(desk.since)}` : null,
      usedBy: "Dispute letters",
      action: <Link href={DISPUTE_LETTERS} className={link} title="Set from a dispute letter">Open ›</Link>,
    },
  ] : [
    setting("statementFormat", files.layouts.length ? <span className="whitespace-nowrap">{files.layouts.map((layout, i) => <span key={layout.fileType}>{i > 0 && " · "}<Link href={FIELD_MAPS} className={link}>{layoutWords(layout)}</Link></span>)}</span> : <span className="text-muted-foreground" title="No layout yet">—</span>),
    setting("expectedCadence", <Link href={FILES_IN_BUCKET} className={link}>Files in › Bucket</Link>),
    {
      key: "portal",
      label: "Portal",
      value: files.portal.value ?? notSet,
      valueTitle: where || files.guidance?.formatHint ? `${[where, files.guidance?.formatHint].filter(Boolean).join(" · ")} · Insurvas's guidance` : undefined,
      whose: whoseValue(files.portal),
      action: <Link href={SETTINGS_CARRIERS} className={link} title="Kept in Settings › Carriers">Open ›</Link>,
    },
    {
      key: "pattern",
      label: "Policy numbers",
      value: files.referencePattern.value ? <span className="font-mono">{files.referencePattern.value}</span> : notSet,
      whose: whoseValue(files.referencePattern),
      action: <span className="text-muted-foreground" title="Kept by Insurvas">—</span>,
    },
  ];

  const editable = (row: FactRow) => Boolean(row.field && !readOnly);
  const actionOf = (row: FactRow) => row.action ?? (editable(row) ? (
    <button type="button" className={link} onClick={() => setEditing(row.field!)}>
      {settingText(row.field!, settings[row.field!].value) === null ? "Set ›" : "Edit ›"}
    </button>
  ) : null);

  return (
    <>
      <TableCard footer={view === "money" ? <span className="text-xs text-muted-foreground">Clearing a value hands it back to Insurvas&apos;s.</span> : undefined}>
        <div className="hidden md:block">
          <table className="portal-lead-table w-full min-w-[880px] text-left text-sm" data-even="off">
            <thead>
              <tr>
                <th className="w-[200px]">Fact</th>
                <th>Value</th>
                <th>Whose</th>
                <th>{view === "money" ? "Used by" : "Goes with"}</th>
                <th className="w-[120px]">Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={cn(editable(row) && "group cursor-pointer hover:bg-[var(--primary-soft)]")} onClick={editable(row) ? (event) => { if (opensFrom(event)) setEditing(row.field!); } : undefined}>
                  <td className="whitespace-nowrap font-medium text-foreground">{row.label}</td>
                  <td className="whitespace-nowrap" title={row.valueTitle}>{row.value}</td>
                  <td className="whitespace-nowrap">{row.whose ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">{row.usedBy ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">{actionOf(row) ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-3 p-4 md:hidden">
          {rows.map((row) => (
            <li key={row.key} className="grid gap-1.5 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{row.label}</span>
                {actionOf(row)}
              </div>
              <div className="text-sm" title={row.valueTitle}>{row.value}</div>
              {(row.whose || row.usedBy) && <div className="text-xs text-muted-foreground">{row.whose}{row.whose && row.usedBy ? " · " : ""}{row.usedBy}</div>}
            </li>
          ))}
        </ul>
      </TableCard>
      {editing && <FactDialog carrierId={carrierId} carrierName={carrierName} field={editing} settings={settings} onClose={() => setEditing(null)} />}
    </>
  );
}
