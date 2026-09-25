"use client";

/**
 * Settings › Carrier library.
 *
 * The table lists every product contract (a contracted carrier plus a product with a schedule or an
 * advance rule at the carrier's current level). The two cards under it show the selected row: the
 * schedule in force today, collapsed the way a carrier quotes it, and its advance rule — which is
 * the section's draft (the header's Save writes a new rule effective today, Discard puts it back).
 *
 * Every editor that was on this page before lives in the Edit / "Add a contract" dialog: carrier
 * choice (Configured / Not configured), contract level + writing number + effective date, contract
 * history, product choice, policy-year rate entry (the only way schedule rows are made) and the
 * advance rule with its own effective date.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  btn,
  Callout,
  control,
  DashedCard,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  st,
} from "@/components/app/settings/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { CarrierRow } from "@/lib/carriers/constants";
import type { AdvanceRuleRow, CommissionScheduleRow, TenantCarrierRow } from "@/lib/carriers/service";
import type { ProductRow } from "@/lib/products/constants";
import {
  activeContract,
  bandLabel,
  buildContractRows,
  currentAdvanceRule,
  formatBps,
  formatDay,
  formatPercentFromBps,
  parseBps,
  scheduleBands,
  todayIso,
  type ContractRow,
} from "@/lib/carriers/contracts";

type Snapshot = {
  carriers: CarrierRow[];
  products: ProductRow[];
  tenantCarriers: TenantCarrierRow[];
  commissionSchedules: CommissionScheduleRow[];
  advanceRules: AdvanceRuleRow[];
  /** Migration 20260924220100: which carriers require E&O in force. */
  carrierRequirements?: Array<{ carrier_id: string; requires_eo: boolean }>;
  requirementsAvailable?: boolean;
};
type RuleValues = { advanceMonths: string; advancePct: string; clawbackMonths: string; clawbackType: "full" | "prorated" };
type DialogState = { mode: "add" | "edit"; carrierId: string; productCode: string };

const EMPTY_RULE: RuleValues = { advanceMonths: "", advancePct: "", clawbackMonths: "", clawbackType: "prorated" };
const selectControl = control;

function ruleValues(rule: AdvanceRuleRow | null): RuleValues {
  if (!rule) return EMPTY_RULE;
  return { advanceMonths: String(rule.advance_months), advancePct: formatBps(rule.advance_pct_bp), clawbackMonths: String(rule.clawback_months), clawbackType: rule.clawback_type };
}

const sameRule = (a: RuleValues, b: RuleValues) =>
  a.advanceMonths.trim() === b.advanceMonths.trim() && (parseBps(a.advancePct) ?? a.advancePct.trim()) === (parseBps(b.advancePct) ?? b.advancePct.trim()) && a.clawbackMonths.trim() === b.clawbackMonths.trim() && a.clawbackType === b.clawbackType;

function percentOfYearOne(value: string) {
  const bp = parseBps(value);
  if (bp === null) return null;
  return `${Number((bp / 100).toFixed(2))}% of year one`;
}

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  return response.ok ? { ok: true } : { ok: false, error: result?.error ?? "Could not save changes" };
}

export function CarrierLibrarySettings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<{ key: string; values: RuleValues } | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/app/carrier-library", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      const message = body?.error ?? "Could not load your carriers";
      setLoadError(message);
      notify.block(message);
      return;
    }
    setLoadError(null);
    setSnapshot(body);
  }, []);
  // Initial data comes from the tenant-scoped API; this effect is the component's external-data
  // subscription and every save reuses the same loader.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (snapshot ? buildContractRows(snapshot) : []), [snapshot]);
  const selected = rows.find((row) => row.key === selectedKey) ?? rows[0] ?? null;
  const asOf = todayIso();

  const currentRule = selected?.productCode && snapshot ? currentAdvanceRule(snapshot.advanceRules, selected.carrierId, selected.productCode, asOf) : null;
  const ruleOriginal = ruleValues(currentRule);
  const ruleCurrent = selected && ruleDraft?.key === selected.key ? ruleDraft.values : ruleOriginal;
  const ruleDirty = Boolean(selected?.productCode) && !sameRule(ruleCurrent, ruleOriginal);
  const setRule = (patch: Partial<RuleValues>) => {
    if (!selected) return;
    setRuleError(null);
    setRuleDraft({ key: selected.key, values: { ...ruleCurrent, ...patch } });
  };

  async function saveRuleDraft() {
    if (!selected?.productCode) return;
    const advanceMonths = Number(ruleCurrent.advanceMonths);
    const advancePct = parseBps(ruleCurrent.advancePct);
    const clawbackMonths = Number(ruleCurrent.clawbackMonths);
    if (!ruleCurrent.advanceMonths.trim() || !Number.isInteger(advanceMonths) || advanceMonths < 0 || advanceMonths > 120) { setRuleError("Advance months is a whole number from 0 to 120."); return; }
    if (advancePct === null) { setRuleError("Advance percent is in basis points: 7,500 is 75%."); return; }
    if (!ruleCurrent.clawbackMonths.trim() || !Number.isInteger(clawbackMonths) || clawbackMonths < 0 || clawbackMonths > 240) { setRuleError("Clawback months is a whole number from 0 to 240."); return; }
    setRuleSaving(true);
    const result = await post("/api/app/carrier-library/advance-rules", { carrier_id: selected.carrierId, product_code: selected.productCode, advance_months: advanceMonths, advance_pct_bp: advancePct, clawback_months: clawbackMonths, clawback_type: ruleCurrent.clawbackType, effective_from: asOf });
    setRuleSaving(false);
    if (!result.ok) { setRuleError(result.error); notify.block(result.error); return; }
    notify.done("Advance rule saved");
    setRuleDraft(null);
    await load();
  }

  function discardRule() {
    setRuleDraft(null);
    setRuleError(null);
  }

  function openAdd() {
    if (!snapshot) return;
    setDialog({ mode: "add", carrierId: snapshot.carriers.find((carrier) => !activeContract(snapshot.tenantCarriers, carrier.id))?.id ?? snapshot.carriers[0]?.id ?? "", productCode: snapshot.products[0]?.code ?? "" });
  }

  function openEdit(row: ContractRow) {
    setSelectedKey(row.key);
    setDialog({ mode: "edit", carrierId: row.carrierId, productCode: row.productCode ?? snapshot?.products[0]?.code ?? "" });
  }

  if (loading && !snapshot) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <p role="status" className="text-[14px] text-[var(--muted)]">Loading carrier library…</p>
      </SettingsStack>
    );
  }
  if (!snapshot) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title={loadError ?? "Could not load your carriers"} />
      </SettingsStack>
    );
  }
  if (snapshot.carriers.length === 0) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <DashedCard title="No carriers in the library yet">
          The platform has not added any carriers yet. Ask support to add one before configuring appointments.
        </DashedCard>
      </SettingsStack>
    );
  }

  const bands = selected?.productCode ? scheduleBands(snapshot.commissionSchedules, { carrierId: selected.carrierId, productCode: selected.productCode, contractLevelBp: selected.levelBp, asOf }) : [];
  const laterRates = selected?.productCode
    ? snapshot.commissionSchedules.filter((row) => row.carrier_id === selected.carrierId && row.product_code === selected.productCode && row.contract_level_bp === selected.levelBp && row.effective_from > asOf).length
    : 0;
  const pctHint = percentOfYearOne(ruleCurrent.advancePct);

  return (
    <SettingsStack>
      <SettingsSectionHeader
        actions={selected?.productCode ? <DraftActions dirty={ruleDirty} saving={ruleSaving} onDiscard={discardRule} onSave={() => void saveRuleDraft()} /> : undefined}
      />

      <Callout tone="info" title="Basis points, not percentages, and effective-dated">
        A contract level is stored in basis points because 117.5% is a real contract level and a percentage field rounds it. Every row carries an <strong>effective from</strong> date: a raise applies to policies issued after it, never to the ones already paid.
      </Callout>

      <SettingsTableCard
        title="Carriers & contract levels"
        actions={
          <button type="button" className={btn("secondary")} onClick={openAdd}>
            <PlusIcon />
            Add a contract
          </button>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Carrier</th>
              <th scope="col" className={cn(st.th, "w-[200px]")}>Product</th>
              <th scope="col" className={cn(st.th, st.num, "w-[150px]")}>Contract level</th>
              <th scope="col" className={cn(st.th, st.num, "w-[140px]")}>Effective from</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn(st.td, "py-6 text-center text-[var(--muted)]")}>
                  No carrier contracts yet. Add a contract to record its level, writing number and commission schedule.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = row.key === selected?.key;
                return (
                  <tr key={row.key} className={cn(isSelected && "bg-[var(--surface-alt)]")}>
                    <td className={st.td}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedKey(row.key)}
                        className="cursor-pointer rounded-[4px] text-left text-inherit hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        title="Show this contract's schedule and advance rule"
                      >
                        {row.carrierName}
                      </button>
                    </td>
                    <td className={st.td}>{row.productName ?? <span className="text-[var(--muted)]">No products yet</span>}</td>
                    <td className={cn(st.td, st.num)}>{formatBps(row.levelBp)}</td>
                    <td className={cn(st.td, st.num)}>{formatDay(row.effectiveFrom)}</td>
                    <td className={cn(st.td, st.num)}>
                      <button type="button" className={btn("row")} onClick={() => openEdit(row)} aria-label={`Edit ${row.carrierName}${row.productName ? `, ${row.productName}` : ""}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </SettingsTableCard>

      {selected && (
        <SettingsGrid>
          <SettingsCard title="Commission schedule" sub={`${selected.carrierName} · ${selected.productName ?? "no product yet"}`} bodyClassName="mt-3.5">
            {!selected.productCode ? (
              <p className="text-[14px] leading-[1.5] text-[var(--muted)]">No product has a rate at this contract level yet. Use Edit to add the first policy-year rate.</p>
            ) : bands.length === 0 ? (
              <p className="text-[14px] leading-[1.5] text-[var(--muted)]">No rate is in force today at {formatBps(selected.levelBp)}. Use Edit to add policy-year rates.</p>
            ) : (
              <table className={st.table}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Policy year</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[120px]")}>Percent</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((band) => (
                    <tr key={band.from}>
                      <td className={st.td}>{bandLabel(band)}</td>
                      <td className={cn(st.td, st.num)}>{formatPercentFromBps(band.rateBp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {laterRates > 0 && <p className="mt-2 text-[12px] leading-[1.5] text-[var(--muted)]">{laterRates === 1 ? "1 rate takes" : `${laterRates} rates take`} effect later; Edit shows every dated row.</p>}
          </SettingsCard>

          <SettingsCard title="Advance rule" sub="What the carrier pays up front, and what it takes back. Saving here makes it effective today." bodyClassName="mt-3.5">
            {!selected.productCode ? (
              <p className="text-[14px] leading-[1.5] text-[var(--muted)]">Advance rules are per product. Add a product to this contract with Edit first.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Advance months" htmlFor="rule-advance-months">
                    <input id="rule-advance-months" type="text" inputMode="numeric" className={control} value={ruleCurrent.advanceMonths} onChange={(e) => setRule({ advanceMonths: e.target.value })} />
                  </Field>
                  <Field label="Advance percent" htmlFor="rule-advance-pct" hint={pctHint ?? "In basis points: 7,500 is 75%"}>
                    <input id="rule-advance-pct" type="text" inputMode="numeric" className={control} value={ruleCurrent.advancePct} onChange={(e) => setRule({ advancePct: e.target.value })} />
                  </Field>
                  <Field label="Clawback months" htmlFor="rule-clawback-months">
                    <input id="rule-clawback-months" type="text" inputMode="numeric" className={control} value={ruleCurrent.clawbackMonths} onChange={(e) => setRule({ clawbackMonths: e.target.value })} />
                  </Field>
                  <Field label="Clawback type" htmlFor="rule-clawback-type">
                    <select id="rule-clawback-type" className={selectControl} value={ruleCurrent.clawbackType} onChange={(e) => setRule({ clawbackType: e.target.value as RuleValues["clawbackType"] })}>
                      <option value="prorated">Prorated</option>
                      <option value="full">Full</option>
                    </select>
                  </Field>
                </div>
                {ruleError && <Callout tone="error" title={ruleError} className="mt-3.5" />}
                {!currentRule && !ruleDirty && <p className="mt-3 text-[12px] leading-[1.5] text-[var(--muted)]">No advance rule is recorded for this product yet.</p>}
              </>
            )}
            <Callout tone="error" title="Full clawback is not the same risk as prorated" className="mt-3.5">
              A full clawback takes the whole advance back if the policy lapses inside the period. The ledger models both, so the chargeback figure on Lapse risk is only right if this field is.
            </Callout>
          </SettingsCard>
        </SettingsGrid>
      )}

      {dialog && (
        <ContractDialog
          key={`${dialog.mode}:${dialog.carrierId}`}
          snapshot={snapshot}
          state={dialog}
          onChange={setDialog}
          onClose={() => setDialog(null)}
          onSaved={load}
        />
      )}
    </SettingsStack>
  );
}

/* ── the editor dialog: every control the page had before ─────────────────────────────────── */

function ContractDialog({
  snapshot,
  state,
  onChange,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  state: DialogState;
  onChange: (next: DialogState) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { carrierId, productCode } = state;
  const carrier = snapshot.carriers.find((row) => row.id === carrierId) ?? null;
  const contracts = snapshot.tenantCarriers.filter((row) => row.carrier_id === carrierId);
  const active = activeContract(snapshot.tenantCarriers, carrierId);

  const [saving, setSaving] = useState<"contract" | "schedule" | "rule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractLevel, setContractLevel] = useState(active ? String(active.contract_level_bp) : "");
  const [writingNumber, setWritingNumber] = useState(active?.writing_number ?? "");
  const [contractEffective, setContractEffective] = useState(todayIso());
  const [policyYear, setPolicyYear] = useState("1");
  const [rate, setRate] = useState("");
  const [appliesOnward, setAppliesOnward] = useState(false);
  const [scheduleEffective, setScheduleEffective] = useState(todayIso());
  const [advanceMonths, setAdvanceMonths] = useState("");
  const [advanceRate, setAdvanceRate] = useState("");
  const [clawbackMonths, setClawbackMonths] = useState("");
  // Prorated first, as the advance-rule card lists it (the board).
  const [clawbackType, setClawbackType] = useState<"full" | "prorated">("prorated");
  const requirement = snapshot.carrierRequirements?.find((row) => row.carrier_id === carrierId) ?? null;
  const [requiresEo, setRequiresEo] = useState(requirement?.requires_eo ?? false);
  const [requirementError, setRequirementError] = useState<string | null>(null);
  const [ruleEffective, setRuleEffective] = useState(todayIso());

  const schedules = snapshot.commissionSchedules
    .filter((row) => row.carrier_id === carrierId && row.product_code === productCode)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.policy_year - b.policy_year);
  const rules = snapshot.advanceRules.filter((row) => row.carrier_id === carrierId && row.product_code === productCode);
  const productName = (code: string) => snapshot.products.find((product) => product.code === code)?.name ?? code;

  async function run(key: "contract" | "schedule" | "rule", path: string, body: Record<string, unknown>, success: string) {
    setSaving(key);
    setError(null);
    const result = await post(path, body);
    setSaving(null);
    if (!result.ok) { setError(result.error); notify.block(result.error); return; }
    notify.done(success);
    await onSaved();
  }

  function saveContract(event: FormEvent) {
    event.preventDefault();
    return run("contract", "/api/app/carrier-library/tenant-carriers", { carrier_id: carrierId, contract_level_bp: parseBps(contractLevel) ?? contractLevel, writing_number: writingNumber, effective_from: contractEffective }, "Carrier contract saved");
  }
  function saveSchedule(event: FormEvent) {
    event.preventDefault();
    return run("schedule", "/api/app/carrier-library/commission-schedules", { carrier_id: carrierId, product_code: productCode, contract_level_bp: active?.contract_level_bp, policy_year: policyYear, rate_bp: parseBps(rate) ?? rate, effective_from: scheduleEffective, applies_onward: appliesOnward }, "Commission schedule saved");
  }
  function saveRule(event: FormEvent) {
    event.preventDefault();
    return run("rule", "/api/app/carrier-library/advance-rules", { carrier_id: carrierId, product_code: productCode, advance_months: advanceMonths, advance_pct_bp: parseBps(advanceRate) ?? advanceRate, clawback_months: clawbackMonths, clawback_type: clawbackType, effective_from: ruleEffective }, "Advance rule saved");
  }

  /** Saved on change: it is one fact about the carrier's contract, not part of a dated row. */
  async function saveRequiresEo(next: boolean) {
    setRequiresEo(next);
    setRequirementError(null);
    const response = await fetch("/api/app/carrier-library/tenant-carriers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrierId, requires_eo: next }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setRequiresEo(!next);
      setRequirementError(result?.error ?? "Could not save the E&O requirement");
      return;
    }
    notify.done(next ? `${carrier?.name ?? "Carrier"} requires E&O in force` : `${carrier?.name ?? "Carrier"} no longer marked as requiring E&O`);
    await onSaved();
  }

  const blocked = !active;
  const subhead = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";
  const listRow = "flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 text-[14px] leading-[1.5] text-[var(--body)] tabular-nums";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[var(--ink)]">{state.mode === "add" ? "Add a contract" : `Edit ${carrier?.name ?? "contract"}`}</DialogTitle>
          <DialogDescription className="text-[var(--muted)]">
            Each save is a new effective-dated row. The contract level comes first; rates and advance rules are recorded against it.
          </DialogDescription>
        </DialogHeader>

        {error && <Callout tone="error" title={error} />}

        {state.mode === "add" && (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className={subhead}>Carrier</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.carriers.map((row) => {
                const configured = snapshot.tenantCarriers.some((contract) => contract.carrier_id === row.id);
                const chosen = row.id === carrierId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onChange({ ...state, carrierId: row.id })}
                    className={cn(
                      "cursor-pointer rounded-[8px] border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                      chosen ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
                    )}
                  >
                    <span className="block text-[14px] font-semibold text-[var(--ink)]">{row.name}</span>
                    <span className="mt-1 block text-[12px] text-[var(--muted)]">{configured ? "Contract configured" : "Not configured"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {carrier && (
          <form onSubmit={saveContract} className="grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Contract level (basis points)" htmlFor="contract-level" required hint="11,000 = 110.00%">
              <input id="contract-level" inputMode="numeric" className={control} value={contractLevel} onChange={(e) => setContractLevel(e.target.value)} required />
            </Field>
            <Field label="Writing / agent number" htmlFor="writing-number" required hint=" ">
              <input id="writing-number" className={control} value={writingNumber} onChange={(e) => setWritingNumber(e.target.value)} required />
            </Field>
            <Field label="Effective from" htmlFor="contract-effective" required hint=" ">
              <input id="contract-effective" type="date" className={control} value={contractEffective} onChange={(e) => setContractEffective(e.target.value)} required />
            </Field>
            <div className="pb-[26px]">
              <button type="submit" className={btn("primary", "w-full")} disabled={saving === "contract"}>
                {saving === "contract" ? "Saving…" : `Save ${carrier.name}`}
              </button>
            </div>
          </form>
        )}

        {carrier && (
          <div className="border-t border-[var(--border)] pt-4">
            <label htmlFor="carrier-requires-eo" className="flex items-start gap-2 text-[14px] leading-[1.5] text-[var(--body)]">
              <input
                id="carrier-requires-eo"
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                checked={requiresEo}
                disabled={snapshot.requirementsAvailable === false}
                onChange={(e) => void saveRequiresEo(e.target.checked)}
              />
              <span>
                {carrier.name} requires E&amp;O cover in force
                <span className="block text-[12px] text-[var(--muted)]">
                  {snapshot.requirementsAvailable === false
                    ? "This setting needs a database update that has not been applied yet."
                    : "Counted on Agency profile and States & licences when the agency's E&O policy nears expiry. Saved as soon as it changes."}
                </span>
              </span>
            </label>
            {requirementError && <p role="alert" className="mt-2 text-[14px] text-[var(--error-ink)]">{requirementError}</p>}
          </div>
        )}

        {contracts.length > 0 && (
          <div>
            <p className={subhead}>Contract history for {carrier?.name ?? "carrier"}</p>
            <div className="mt-1">
              {contracts.map((row) => (
                <div key={row.id} className={listRow}>
                  <Pill tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Current" : "History"}</Pill>
                  <span>{formatBps(row.contract_level_bp)} ({formatPercentFromBps(row.contract_level_bp)}) · {row.writing_number}</span>
                  <span className="text-[var(--muted)]">effective {formatDay(row.effective_from)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[var(--border)] pt-4">
          <Field label="Product" htmlFor="contract-product" hint="The commission rate and advance rule below are recorded for this product.">
            <select id="contract-product" className={selectControl} value={productCode} onChange={(e) => onChange({ ...state, productCode: e.target.value })} required>
              {snapshot.products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={saveSchedule} className="min-w-0 space-y-4">
            <p className={subhead}>Commission rate{active ? ` at ${formatBps(active.contract_level_bp)}` : ""}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Policy year" htmlFor="schedule-year" required>
                <input id="schedule-year" type="number" min={1} max={100} className={control} value={policyYear} onChange={(e) => setPolicyYear(e.target.value)} required />
              </Field>
              <Field label="Rate (basis points)" htmlFor="schedule-rate" required hint="11,000 = 110.00%">
                <input id="schedule-rate" inputMode="numeric" className={control} value={rate} onChange={(e) => setRate(e.target.value)} required />
              </Field>
              <Field label="Effective from" htmlFor="schedule-effective" required className="sm:col-span-2">
                <input id="schedule-effective" type="date" className={control} value={scheduleEffective} onChange={(e) => setScheduleEffective(e.target.value)} required />
              </Field>
            </div>
            <label htmlFor="schedule-onward" className="flex items-start gap-2 text-[14px] leading-[1.5] text-[var(--body)]">
              <input id="schedule-onward" type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={appliesOnward} onChange={(e) => setAppliesOnward(e.target.checked)} />
              <span>Also every later year without its own rate (shown as “Year {policyYear || "N"}+”)</span>
            </label>
            <button type="submit" className={btn("primary")} disabled={saving === "schedule" || blocked}>
              {blocked ? "Save a contract first" : saving === "schedule" ? "Saving…" : "Save commission rate"}
            </button>
            {schedules.length > 0 && (
              <div>
                {schedules.map((row) => (
                  <div key={row.id} className={listRow}>
                    <span className="font-semibold text-[var(--ink)]">{productName(row.product_code)}</span>
                    <span>year {row.policy_year}{row.applies_onward ? "+" : ""}</span>
                    <span>{formatPercentFromBps(row.rate_bp)}</span>
                    <span className="text-[var(--muted)]">at {formatBps(row.contract_level_bp)} · from {formatDay(row.effective_from)}</span>
                  </div>
                ))}
              </div>
            )}
          </form>

          <form onSubmit={saveRule} className="min-w-0 space-y-4">
            <p className={subhead}>Advance rule</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Advance months" htmlFor="advance-months" required>
                <input id="advance-months" type="number" min={0} max={120} className={control} value={advanceMonths} onChange={(e) => setAdvanceMonths(e.target.value)} required />
              </Field>
              <Field label="Advance percent (basis points)" htmlFor="advance-rate" required hint={percentOfYearOne(advanceRate) ?? undefined}>
                <input id="advance-rate" inputMode="numeric" className={control} value={advanceRate} onChange={(e) => setAdvanceRate(e.target.value)} required />
              </Field>
              <Field label="Clawback months" htmlFor="clawback-months" required>
                <input id="clawback-months" type="number" min={0} max={240} className={control} value={clawbackMonths} onChange={(e) => setClawbackMonths(e.target.value)} required />
              </Field>
              <Field label="Clawback type" htmlFor="clawback-type">
                <select id="clawback-type" className={selectControl} value={clawbackType} onChange={(e) => setClawbackType(e.target.value as "full" | "prorated")}>
                  <option value="prorated">Prorated</option>
                  <option value="full">Full</option>
                </select>
              </Field>
              <Field label="Effective from" htmlFor="rule-effective" required className="sm:col-span-2">
                <input id="rule-effective" type="date" className={control} value={ruleEffective} onChange={(e) => setRuleEffective(e.target.value)} required />
              </Field>
            </div>
            <button type="submit" className={btn("primary")} disabled={saving === "rule" || blocked}>
              {blocked ? "Save a contract first" : saving === "rule" ? "Saving…" : "Save advance rule"}
            </button>
            {rules.length > 0 && (
              <div>
                {rules.map((row) => (
                  <div key={row.id} className={listRow}>
                    <span className="font-semibold text-[var(--ink)]">{productName(row.product_code)}</span>
                    <span>{row.advance_months} months at {formatPercentFromBps(row.advance_pct_bp)}</span>
                    <span>{row.clawback_type} clawback, {row.clawback_months} months</span>
                    <span className="text-[var(--muted)]">from {formatDay(row.effective_from)}</span>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
