"use client";

/**
 * Settings › Carrier library: the carriers you're contracted with — level, writing number, the
 * contract's history and whether the carrier requires E&O in force.
 *
 * Commission rates and advance rules moved to Book of Business › Rate card (2026-10-08 overlap
 * merge), beside the policies they price; they were set in two places before. The product column
 * still shows which products have a rate at the current level.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Plus } from "lucide-react";

import {
  Callout,
  control,
  Field,
  Pill,
  SettingsSectionHeader,
  SettingsStack,
  st,
} from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { CarrierRow } from "@/lib/carriers/constants";
import type { AdvanceRuleRow, CommissionScheduleRow, TenantCarrierRow } from "@/lib/carriers/service";
import type { ProductRow } from "@/lib/products/constants";
import {
  activeContract,
  buildContractRows,
  formatBps,
  formatDay,
  formatPercentFromBps,
  parseBps,
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
type DialogState = { mode: "add" | "edit"; carrierId: string; productCode: string };

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  return response.ok ? { ok: true } : { ok: false, error: result?.error ?? "Could not save changes" };
}

export function CarrierLibrarySettings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [query, setQuery] = useState("");

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
  const needle = query.trim().toLowerCase();
  const shownRows = needle ? rows.filter((row) => row.carrierName.toLowerCase().includes(needle) || (row.productName ?? "").toLowerCase().includes(needle)) : rows;
  function openAdd() {
    if (!snapshot) return;
    setDialog({ mode: "add", carrierId: snapshot.carriers.find((carrier) => !activeContract(snapshot.tenantCarriers, carrier.id))?.id ?? snapshot.carriers[0]?.id ?? "", productCode: snapshot.products[0]?.code ?? "" });
  }

  function openEdit(row: ContractRow) {
    setDialog({ mode: "edit", carrierId: row.carrierId, productCode: row.productCode ?? snapshot?.products[0]?.code ?? "" });
  }

  if (!snapshot) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {loading ? (
          <TableCard><SectionLoading label="Loading the carrier library" /></TableCard>
        ) : (
          <Callout tone="error" title={loadError ?? "Could not load your carriers"} />
        )}
      </SettingsStack>
    );
  }
  if (snapshot.carriers.length === 0) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <TableCard>
          <EmptyState title="No carriers in the library yet" hint="Ask support to add a carrier before configuring appointments." />
        </TableCard>
      </SettingsStack>
    );
  }

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" asChild><Link href="/app/rate-card">Rates and advance rules</Link></Button>
                <Button type="button" onClick={openAdd}>
                  <Plus aria-hidden="true" />
                  Add a contract
                </Button>
                <RefreshButton onClick={() => void load()} refreshing={loading} />
              </>
            }
          >
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search carriers or products" />
          </DataToolbar>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No carrier contracts yet" hint="Add a contract to record its level and writing number. Rates and advance rules are set on the Rate card." />
        ) : shownRows.length === 0 ? (
          <NoMatches noun="contracts" onClear={() => setQuery("")} />
        ) : (
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Carrier</th>
                <th scope="col" className={cn(st.th, "w-[200px]")}>Product</th>
                <th scope="col" className={cn(st.th, st.num, "w-[150px]")}>Contract level</th>
                <th scope="col" className={cn(st.th, st.num, "w-[140px]")}>Effective from</th>
                <th scope="col" className={cn(st.th, st.num, "w-[90px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => {
                return (
                  <tr key={row.key}>
                    <td className={st.td}>{row.carrierName}</td>
                    <td className={st.td}>{row.productName ?? <span className="text-[var(--muted)]">No products yet</span>}</td>
                    <td className={cn(st.td, st.num)}>{formatBps(row.levelBp)}</td>
                    <td className={cn(st.td, st.num)}>{formatDay(row.effectiveFrom)}</td>
                    <td className={cn(st.td, st.num)}>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)} aria-label={`Edit ${row.carrierName}${row.productName ? `, ${row.productName}` : ""}`}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

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

/* ── the editor dialog: the contract, its history and the E&O requirement ─────────────────── */

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
  const { carrierId } = state;
  const carrier = snapshot.carriers.find((row) => row.id === carrierId) ?? null;
  const contracts = snapshot.tenantCarriers.filter((row) => row.carrier_id === carrierId);
  const active = activeContract(snapshot.tenantCarriers, carrierId);

  const [saving, setSaving] = useState<"contract" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractLevel, setContractLevel] = useState(active ? String(active.contract_level_bp) : "");
  const [writingNumber, setWritingNumber] = useState(active?.writing_number ?? "");
  const [contractEffective, setContractEffective] = useState(todayIso());
  const requirement = snapshot.carrierRequirements?.find((row) => row.carrier_id === carrierId) ?? null;
  const [requiresEo, setRequiresEo] = useState(requirement?.requires_eo ?? false);
  const [requirementError, setRequirementError] = useState<string | null>(null);

  async function run(key: "contract", path: string, body: Record<string, unknown>, success: string) {
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

  const subhead = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";
  const listRow = "flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 text-[14px] leading-[1.5] text-[var(--body)] tabular-nums";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[var(--ink)]">{state.mode === "add" ? "Add a contract" : `Edit ${carrier?.name ?? "contract"}`}</DialogTitle>
          <DialogDescription className="text-[var(--muted)]">
            Each save is a new effective-dated row. Rates and advance rules are on the <Link href="/app/rate-card" className="font-medium text-[var(--accent-ink)] hover:underline">Rate card</Link>.
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
              <Button type="submit" className="w-full" disabled={saving === "contract"}>
                {saving === "contract" ? "Saving…" : `Save ${carrier.name}`}
              </Button>
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
                    : "Saved as soon as it changes."}
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

      </DialogContent>
    </Dialog>
  );
}
