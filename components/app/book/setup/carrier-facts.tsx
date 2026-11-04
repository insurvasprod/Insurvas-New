"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inputControl } from "@/components/ui/field";
import { CADENCES, COMMISSION_TRIGGERS, SETTING_FIELDS, STATEMENT_FORMATS, type SettingField } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

const ENDPOINT = "/api/app/carrier-rules";
const TRIGGER_LABEL: Record<string, string> = { on_issue: "On issue", on_first_draft: "On first draft" };
const CADENCE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", ad_hoc: "Now and then" };
const FORMAT_LABEL: Record<string, string> = { spreadsheet: "Spreadsheet", pdf: "PDF" };
const LABEL: Record<SettingField, string> = { commissionTrigger: "Pays commission", expectedLagDays: "Payment lag", minimumPayoutCents: "Minimum payout", toleranceCents: "Tolerance", expectedCadence: "Files arrive", statementFormat: "Statement format" };
const API_FIELD: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };
const SETTINGS_CARRIERS = "/app/settings#carriers";

export type OwnedValue = { value: string | number | null; scope: "agency" | "platform" | null; since: string | null };
export type FactsSettings = Record<SettingField, OwnedValue & { yours: string | number | null }>;

export type FilesFacts = {
  layouts: Array<{ fileType: "policies" | "commissions"; key: string; name: string | null; version: number | null; scope: "agency" | "platform" }>;
  portal: OwnedValue;
  guidance: { whereInPortal: string | null; reportName: string | null; formatHint: string | null } | null;
  referencePattern: OwnedValue;
};

export type DeskFacts = { address: string; email: string | null; since: string } | null;

function settingText(field: SettingField, value: string | number | null): string | null {
  if (value === null || value === "") return null;
  if (field === "commissionTrigger") return TRIGGER_LABEL[String(value)] ?? String(value);
  if (field === "expectedCadence") return CADENCE_LABEL[String(value)] ?? String(value);
  if (field === "statementFormat") return FORMAT_LABEL[String(value)] ?? String(value);
  if (field === "expectedLagDays") return `${value} ${Number(value) === 1 ? "day" : "days"}`;
  return `$${(Number(value) / 100).toFixed(2)}`;
}

/** Whose a value is: Insurvas's default, or yours from a date. */
function whose(owned: OwnedValue): string | null {
  if (owned.scope === "agency") return owned.since ? `yours, from ${fileDay(owned.since)}` : "yours";
  if (owned.scope === "platform") return "Insurvas's";
  return null;
}

/** One fact: its label over its value, whose it is, and its one action at the end. */
function Fact({ label, value, owner, action, children }: { label: string; value: ReactNode; owner?: string | null; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--surface-alt)] py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-label text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground">
          {value}
          {owner && <span className="text-muted-foreground"> · {owner}</span>}
        </div>
        {children}
      </div>
      {action}
    </div>
  );
}

const notSet = <span className="text-muted-foreground">— not set</span>;
const notKept = <span className="text-muted-foreground">not kept yet</span>;

/**
 * A carrier's money and file facts (board 9b): pays commission, payment lag, minimum payout, tolerance and the
 * commissions desk; the statement format and layout, how often files arrive, the portal and where in it, and the
 * policy number pattern. Each value says whose it is. The carrier settings edit in place through the same save
 * as the old editor (save_settings, the agency's own over Insurvas's; clearing hands it back). The portal and the
 * policy number pattern are kept in Settings › Carriers, the commissions desk on a dispute letter: they link
 * there. The desk's phone number has no column, so it says "not kept yet" rather than inventing one.
 */
export function CarrierFacts({ carrierId, settings, files, desk, readOnly }: { carrierId: string; settings: FactsSettings; files: FilesFacts; desk: DeskFacts; readOnly: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SettingField | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(field: SettingField, value: string | number | null) {
    setBusy(true);
    const body: Record<string, unknown> = { action: "save_settings", carrier_id: carrierId };
    for (const f of SETTING_FIELDS) body[API_FIELD[f]] = f === field ? value : settings[f].yours;
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(value === null ? `${LABEL[field]}: back to Insurvas's.` : `${LABEL[field]} saved.`);
      setEditing(null);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function start(field: SettingField) {
    const own = settings[field].yours ?? settings[field].value;
    setDraft(own === null ? "" : field === "minimumPayoutCents" || field === "toleranceCents" ? (Number(own) / 100).toFixed(2) : String(own));
    setEditing(field);
  }

  function parsed(field: SettingField): string | number | null {
    const raw = draft.trim();
    if (!raw) return null;
    if (field === "expectedLagDays") return Number(raw);
    if (field === "minimumPayoutCents" || field === "toleranceCents") return Math.round(Number(raw) * 100);
    return raw;
  }

  function input(field: SettingField) {
    const choices = field === "commissionTrigger" ? COMMISSION_TRIGGERS.map((v) => [v, TRIGGER_LABEL[v]]) : field === "expectedCadence" ? CADENCES.map((v) => [v, CADENCE_LABEL[v]]) : field === "statementFormat" ? STATEMENT_FORMATS.map((v) => [v, FORMAT_LABEL[v]]) : null;
    if (choices) {
      return (
        <select aria-label={LABEL[field]} className={`${inputControl} w-[200px]`} value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="">Choose</option>
          {choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      );
    }
    const money = field !== "expectedLagDays";
    return <input aria-label={LABEL[field]} className={`${inputControl} w-[140px]`} inputMode={money ? "decimal" : "numeric"} placeholder={money ? "$" : "days"} value={draft} onChange={(e) => setDraft(e.target.value.replace(money ? /[^\d.]/g : /\D/g, ""))} />;
  }

  /** A carrier setting: its value and owner, or the control while it is edited. */
  function setting(field: SettingField, extra?: ReactNode) {
    const owned = settings[field];
    const text = settingText(field, owned.value);
    if (editing === field) {
      return (
        <Fact label={LABEL[field]} value={input(field)} action={
          <span className="inline-flex flex-wrap gap-2">
            {owned.yours !== null && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save(field, null)}>Back to Insurvas&apos;s</Button>}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void save(field, parsed(field))}>Save</Button>
          </span>
        } />
      );
    }
    return (
      <Fact label={LABEL[field]} value={<>{text ?? notSet}{extra}</>} owner={whose(owned)} action={readOnly ? undefined : (
        <Button type="button" variant="outline" size="sm" disabled={busy || editing !== null} onClick={() => start(field)}>{text === null ? "Set" : "Edit"}</Button>
      )} />
    );
  }

  const settingsLink = <Link href={SETTINGS_CARRIERS} className={buttonVariants({ variant: "outline", size: "sm" })}>Edit in Settings</Link>;
  const layoutText = files.layouts.length
    ? files.layouts.map((l) => `${l.fileType === "policies" ? "policy file" : "commission file"} ${l.version === null ? l.name ?? l.key : `layout v${l.version}`}${l.scope === "agency" ? " (yours)" : ""}`).join(" · ")
    : null;
  const where = files.guidance ? [files.guidance.whereInPortal, files.guidance.reportName].filter(Boolean).join(" › ") : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Money</CardTitle></CardHeader>
        <CardContent>
          {setting("commissionTrigger")}
          {setting("expectedLagDays")}
          {setting("minimumPayoutCents")}
          {setting("toleranceCents")}
          <Fact label="Commissions desk" value={desk ? [desk.address, desk.email].filter(Boolean).join(" · ") : notSet} owner={desk ? `yours, from ${fileDay(desk.since)}` : null}>
            <div className="text-xs text-muted-foreground">Phone: {notKept}. {desk ? "Changed" : "Set"} from a dispute letter.</div>
          </Fact>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Files</CardTitle></CardHeader>
        <CardContent>
          {setting("statementFormat", layoutText ? <span className="text-muted-foreground"> · {layoutText}</span> : <span className="text-muted-foreground"> · no layout yet</span>)}
          {setting("expectedCadence", <> · <Link href="/app/book-setup/how-files-arrive" className="text-[var(--accent-ink)] hover:underline">How files arrive</Link></>)}
          <Fact label="Portal" value={files.portal.value ?? notSet} owner={whose(files.portal)} action={readOnly ? undefined : settingsLink}>
            {(where || files.guidance?.formatHint) && <div className="text-xs text-muted-foreground">{[where, files.guidance?.formatHint].filter(Boolean).join(" · ")} · Insurvas&apos;s guidance</div>}
          </Fact>
          <Fact label="Policy numbers" value={files.referencePattern.value ? <span className="font-mono">{files.referencePattern.value}</span> : notSet} owner={whose(files.referencePattern)} action={readOnly ? undefined : settingsLink} />
        </CardContent>
      </Card>
    </div>
  );
}
