"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { inputControl } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { CADENCES, COMMISSION_TRIGGERS, RULE_SOURCE_LABELS, RULE_SOURCES, RULE_TYPE_LABELS, RULE_TYPES, STATEMENT_FORMATS, SETTING_FIELDS, type RuleSource, type RuleType, type SettingField } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";
import type { CarrierRuleSides, RuleSide } from "@/lib/pipelineRules/carrierRuleSides";
import { notify } from "@/lib/notify";

const ENDPOINT = "/api/app/carrier-rules";
const TRIGGER_LABEL: Record<string, string> = { on_issue: "On issue", on_first_draft: "On first draft" };
const CADENCE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", ad_hoc: "Now and then" };
const FORMAT_LABEL: Record<string, string> = { spreadsheet: "Spreadsheet", pdf: "PDF" };
const SETTING_LABEL: Record<SettingField, string> = { commissionTrigger: "Pays commission", expectedLagDays: "Payment lag", expectedCadence: "Files arrive", minimumPayoutCents: "Minimum payout", toleranceCents: "Tolerance", statementFormat: "Statement format" };
const SETTING_ORDER: SettingField[] = ["commissionTrigger", "expectedLagDays", "expectedCadence", "minimumPayoutCents", "toleranceCents", "statementFormat"];
const API_FIELD: Record<SettingField, string> = { commissionTrigger: "commission_trigger", expectedLagDays: "expected_lag_days", minimumPayoutCents: "minimum_payout_cents", toleranceCents: "tolerance_cents", expectedCadence: "expected_cadence", statementFormat: "statement_format" };

const days = (n: number | null | undefined) => (n === null || n === undefined ? null : `${n} ${n === 1 ? "day" : "days"}`);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function ruleText(rule: RuleSide): string {
  if (!rule) return "Not set";
  const parts = [rule.windowDays !== null ? `${days(rule.windowDays)} to save` : null, rule.graceDays !== null ? `grace ${days(rule.graceDays)}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not set";
}

function settingText(field: SettingField, value: string | number | null): string {
  if (value === null || value === "") return "Not set";
  if (field === "commissionTrigger") return TRIGGER_LABEL[String(value)] ?? String(value);
  if (field === "expectedCadence") return CADENCE_LABEL[String(value)] ?? String(value);
  if (field === "statementFormat") return FORMAT_LABEL[String(value)] ?? String(value);
  if (field === "expectedLagDays") return days(Number(value)) ?? "Not set";
  return `$${(Number(value) / 100).toFixed(2)}`;
}

type Draft = { window: string; grace: string; from: string; source: RuleSource };
const num = (value: string) => (value.trim() === "" ? null : Number(value));

/**
 * Setup › Carrier rules (owner decision 4, 2026-11-02): one carrier at a time, each rule with Insurvas's
 * value beside the agency's own. Edited in the row, no pop-up: Set your own (a dated rule that wins for
 * this agency from its date), Clear (back to Insurvas's). Past countdowns keep the rule they used.
 */
export function CarrierRulesEditor({ carriers, asOf, readOnly }: { carriers: CarrierRuleSides[]; asOf: string; readOnly: boolean }) {
  const router = useRouter();
  const [carrierId, setCarrierId] = useState(carriers[0]?.carrierId ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ window: "", grace: "", from: asOf, source: "carrier_agreement" });
  const [settingDraft, setSettingDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const carrier = useMemo(() => carriers.find((c) => c.carrierId === carrierId) ?? null, [carriers, carrierId]);

  if (!carriers.length) return <EmptyState title="No carriers in the library" hint="Carriers come from Insurvas's carrier library." />;
  if (!carrier) return null;
  const ownCount = RULE_TYPES.filter((type) => carrier.rules[type].yours).length + SETTING_FIELDS.filter((field) => carrier.settings[field].yours !== null).length;

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      setEditing(null);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function startRule(type: RuleType) {
    const own = carrier!.rules[type].yours;
    const base = own ?? carrier!.rules[type].insurvas;
    setDraft({ window: base?.windowDays?.toString() ?? "", grace: base?.graceDays?.toString() ?? "", from: asOf, source: (own?.source as RuleSource | null) ?? "carrier_agreement" });
    setEditing(type);
  }

  function saveRule(type: RuleType) {
    const base = carrier!.rules[type].yours ?? carrier!.rules[type].insurvas;
    void post({
      action: "add_rule", carrier_id: carrier!.carrierId, rule_type: type, window_days: num(draft.window), grace_days: num(draft.grace),
      // The redrafts carry over from the rule it replaces: the agency changes the days, not the rest.
      redraft_attempts: base?.redraftAttempts ?? null, redraft_interval_days: base?.redraftIntervalDays ?? null,
      source: draft.source, notes: null, effective_from: draft.from || asOf,
    }, `${carrier!.carrierName}: your ${RULE_TYPE_LABELS[type].window} applies from ${fileDay(draft.from || asOf)}.`);
  }

  async function clearRule(type: RuleType) {
    const ok = await confirmAction({ title: `Clear your ${RULE_TYPE_LABELS[type].window}?`, description: `From today ${carrier!.carrierName} uses Insurvas's rule again for your agency. Past countdowns keep the rule they used.`, confirmLabel: "Use Insurvas's rule", cancelLabel: "Keep mine", destructive: false });
    if (ok) void post({ action: "clear_override", carrier_id: carrier!.carrierId, rule_type: type }, "Back to Insurvas's rule.");
  }

  function saveSetting(field: SettingField, value: string | number | null) {
    const body: Record<string, unknown> = { action: "save_settings", carrier_id: carrier!.carrierId };
    for (const f of SETTING_FIELDS) body[API_FIELD[f]] = f === field ? value : carrier!.settings[f].yours;
    void post(body, value === null ? "Back to Insurvas's setting." : `${SETTING_LABEL[field]} saved.`);
  }

  function settingValue(field: SettingField): string | number | null {
    const raw = settingDraft.trim();
    if (!raw) return null;
    if (field === "expectedLagDays") return Number(raw);
    if (field === "minimumPayoutCents" || field === "toleranceCents") return Math.round(Number(raw) * 100);
    return raw;
  }

  function settingInput(field: SettingField) {
    const choices = field === "commissionTrigger" ? COMMISSION_TRIGGERS.map((v) => [v, TRIGGER_LABEL[v]]) : field === "expectedCadence" ? CADENCES.map((v) => [v, CADENCE_LABEL[v]]) : field === "statementFormat" ? STATEMENT_FORMATS.map((v) => [v, FORMAT_LABEL[v]]) : null;
    if (choices) {
      return (
        <select aria-label={SETTING_LABEL[field]} className={`${inputControl} w-[180px]`} value={settingDraft} onChange={(e) => setSettingDraft(e.target.value)}>
          <option value="">Choose</option>
          {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      );
    }
    const money = field !== "expectedLagDays";
    return <input aria-label={SETTING_LABEL[field]} className={`${inputControl} w-[120px]`} inputMode={money ? "decimal" : "numeric"} placeholder={money ? "$" : "days"} value={settingDraft} onChange={(e) => setSettingDraft(e.target.value.replace(money ? /[^\d.]/g : /\D/g, ""))} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Carrier" className={`${inputControl} w-[260px]`} value={carrierId} onChange={(e) => { setCarrierId(e.target.value); setEditing(null); }}>
          {carriers.map((c) => <option key={c.carrierId} value={c.carrierId}>{c.carrierName}{c.inForce ? ` · ${c.inForce.toLocaleString("en-US")} in force` : ""}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Your own rule wins for your agency only, from its date. Past countdowns keep the rule they used.</span>
      </div>
      <TableCard title={carrier.carrierName} action={<StatusChip tone={ownCount ? "good" : "neutral"}>{ownCount ? `${ownCount} of your own` : "All Insurvas's"}</StatusChip>}>
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr><th>Rule</th><th>Insurvas</th><th>Yours</th><th className="w-[200px] text-right"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {RULE_TYPES.map((type) => {
              const row = carrier.rules[type];
              const open = editing === type;
              return (
                <tr key={type}>
                  <td className="font-medium text-foreground">{cap(RULE_TYPE_LABELS[type].window)}</td>
                  <td className="text-muted-foreground">{ruleText(row.insurvas)}</td>
                  <td>
                    {open ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <input aria-label="Days to save" className={`${inputControl} w-[90px]`} inputMode="numeric" placeholder="days" value={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.value.replace(/\D/g, "") })} />
                        <input aria-label="Grace days" className={`${inputControl} w-[90px]`} inputMode="numeric" placeholder="grace" value={draft.grace} onChange={(e) => setDraft({ ...draft, grace: e.target.value.replace(/\D/g, "") })} />
                        <input aria-label="Applies from" type="date" className={`${inputControl} w-[150px]`} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                        <select aria-label="Where it comes from" className={`${inputControl} w-[160px]`} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as RuleSource })}>
                          {RULE_SOURCES.map((source) => <option key={source} value={source}>{RULE_SOURCE_LABELS[source]}</option>)}
                        </select>
                      </span>
                    ) : row.yours ? (
                      <span className="block leading-snug">
                        <span className="font-semibold text-foreground">{ruleText(row.yours)}</span>
                        <span className="block text-xs text-muted-foreground">from {fileDay(row.yours.effectiveFrom)}{row.yours.source ? ` · ${RULE_SOURCE_LABELS[row.yours.source as RuleSource]?.toLowerCase() ?? row.yours.source}` : ""}</span>
                      </span>
                    ) : row.upcoming ? (
                      <span className="text-xs text-muted-foreground">{ruleText(row.upcoming)} from {fileDay(row.upcoming.effectiveFrom)}</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="text-right">
                    {readOnly ? null : open ? (
                      <span className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                        <Button type="button" size="sm" disabled={busy || (!draft.window && !draft.grace)} onClick={() => saveRule(type)}>Save</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-2">
                        {row.yours && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clearRule(type)}>Clear</Button>}
                        <Button type="button" variant="outline" size="sm" disabled={busy || editing !== null} onClick={() => startRule(type)}>{row.yours ? "Change" : "Set your own"}</Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {SETTING_ORDER.map((field) => {
              const row = carrier.settings[field];
              const open = editing === `setting:${field}`;
              return (
                <tr key={field}>
                  <td className="font-medium text-foreground">{SETTING_LABEL[field]}</td>
                  <td className="text-muted-foreground">{settingText(field, row.insurvas)}</td>
                  <td>{open ? settingInput(field) : row.yours !== null ? <span className="font-semibold text-foreground">{settingText(field, row.yours)}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right">
                    {readOnly ? null : open ? (
                      <span className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                        <Button type="button" size="sm" disabled={busy || !settingDraft.trim()} onClick={() => saveSetting(field, settingValue(field))}>Save</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-2">
                        {row.yours !== null && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => saveSetting(field, null)}>Clear</Button>}
                        <Button type="button" variant="outline" size="sm" disabled={busy || editing !== null} onClick={() => { setSettingDraft(row.yours === null ? "" : field === "minimumPayoutCents" || field === "toleranceCents" ? (Number(row.yours) / 100).toFixed(2) : String(row.yours)); setEditing(`setting:${field}`); }}>{row.yours !== null ? "Change" : "Set your own"}</Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>
    </>
  );
}
