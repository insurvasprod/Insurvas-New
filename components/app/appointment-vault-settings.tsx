"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";
import { Plus } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import {
  Callout,
  KeyValues,
  Pill,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  st,
  type PillTone,
} from "@/components/app/settings/primitives";
import {
  AppointmentGrid,
  CeDialog,
  CeSummary,
  EoDialog,
  LicenceDialog,
  keyFor,
  longDate,
  money,
  plural,
  shortDate,
  stateName,
  today,
  type SaveResult,
} from "@/components/app/appointment-vault-parts";
import type { CarrierRow } from "@/lib/carriers/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { daysUntilExpiry, dueExpiryWarnings } from "@/lib/appointments/warnings";
import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import { cn } from "@/lib/utils";
import {
  type AppointmentRow,
  type CeRecordRow,
  type EoPolicyRow,
  type LicenceType,
  type LicenseRow,
} from "@/lib/appointments/service-types";

type TenantCarrier = {
  id: string;
  carrier_id: string;
  contract_level_bp: number;
  writing_number: string;
  effective_from: string;
  is_active: boolean;
};
type Vault = {
  carriers: CarrierRow[];
  tenantCarriers: TenantCarrier[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
  ceRecords: CeRecordRow[];
  /** False until migration 20260924110000: licence type/lines, E&O limits and ethics credits cannot be stored. */
  extendedFields?: boolean;
  /** Which carriers require E&O in force (migration 20260924220100); null before it. */
  carrierRequirements?: Array<{ carrier_id: string; requires_eo: boolean }> | null;
};
const LICENCE_TYPE_LABEL: Record<LicenceType, string> = { resident: "Resident", non_resident: "Non-resident" };
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const inWords = (count: number) => NUMBER_WORDS[count] ?? String(count);
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function AppointmentVaultSettings({
  canEdit = true,
  inSettings = false,
}: { canEdit?: boolean; /** Rendered as Settings › States & licences: the section header replaces the page header. */ inSettings?: boolean } = {}) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [stateFilter, setStateFilter] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "license" | "eo" | "ce">(null);
  const [licenceQuery, setLicenceQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const applyVault = useCallback((next: Vault) => {
    setVault(next);
    const latest = new Map<string, AppointmentRow>();
    for (const row of next.appointments) {
      const key = keyFor(row.carrier_id, row.state);
      if (!latest.has(key)) latest.set(key, row);
    }
    const active = new Set([...latest.values()].filter((row) => row.status === "active").map((row) => keyFor(row.carrier_id, row.state)));
    setSaved(active);
    setSelected(new Set(active));
  }, []);

  const fetchVault = useCallback(async () => {
    const response = await fetch("/api/app/appointment-vault", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      notify.block(body?.error ?? "Could not load the appointment vault");
      return null;
    }
    return body as Vault;
  }, []);

  const load = useCallback(async () => {
    const next = await fetchVault();
    if (next) applyVault(next);
  }, [applyVault, fetchVault]);

  // The vault is external tenant data; fetch it asynchronously before applying the initial snapshot.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchVault();
      if (!cancelled && next) applyVault(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyVault, fetchVault]);

  const configuredCarriers = useMemo(() => {
    if (!vault) return [];
    const ids = new Set(vault.tenantCarriers.map((row) => row.carrier_id));
    return vault.carriers.filter((row) => ids.has(row.id));
  }, [vault]);
  const states = useMemo(
    () =>
      US_STATES.filter(
        ([, name]) =>
          !stateFilter.trim() ||
          name.toLowerCase().includes(stateFilter.trim().toLowerCase()) ||
          name.startsWith(stateFilter.trim().toUpperCase()),
      ),
    [stateFilter],
  );
  const latestByKey = useMemo(() => {
    const latest = new Map<string, AppointmentRow>();
    for (const row of vault?.appointments ?? []) {
      const key = keyFor(row.carrier_id, row.state);
      if (!latest.has(key)) latest.set(key, row);
    }
    return latest;
  }, [vault]);
  const additions = [...selected].filter((key) => !saved.has(key));
  const removals = [...saved].filter((key) => !selected.has(key));
  const dirty = additions.length + removals.length > 0;

  async function save(path: string, payload: unknown, success: string, key: string): Promise<SaveResult> {
    if (!canEdit) return { ok: false, error: "View only" };
    setSaving(key);
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) {
      const error = response.status === 503 ? SCHEMA_PENDING_MESSAGE : (body?.error ?? "Could not save changes");
      return { ok: false, error };
    }
    notify.done(success);
    await load();
    return { ok: true, body };
  }

  /**
   * The grid is the section's draft: checking a cell stages an appointment, unchecking one stages its
   * termination, and Save changes writes both. Unchecking used to be dropped on the floor — the old
   * save only ever sent the checked cells, so a deselected appointment stayed active.
   */
  async function saveGrid() {
    if (!canEdit || !dirty) return;
    const rows = [
      ...additions.map((value) => {
        const [carrier_id, state] = value.split(":");
        return { carrier_id, state, status: "active", effective_from: effectiveFrom, terminated_at: null };
      }),
      ...removals.flatMap((value) => {
        const row = latestByKey.get(value);
        if (!row) return [];
        const endsOn = effectiveFrom > row.effective_from ? effectiveFrom : row.effective_from;
        return [{ carrier_id: row.carrier_id, state: row.state, status: "terminated", effective_from: row.effective_from, terminated_at: endsOn }];
      }),
    ];
    const result = await save(
      "/api/app/appointment-vault/appointments",
      { appointments: rows },
      [additions.length && plural(additions.length, "appointment") + " added", removals.length && plural(removals.length, "appointment") + " ended"].filter(Boolean).join(", "),
      "appointments",
    );
    if (!result.ok) notify.block(result.error);
  }

  const header = inSettings ? (
    <SettingsSectionHeader />
  ) : (
    <PageHeader
      className="portal-appointments-header"
      title="Appointments & licences"
      description="Whether you may legally write this product in this state today."
      actions={!canEdit ? <StatusChip>View only</StatusChip> : undefined}
    />
  );
  const saveBar = canEdit ? (
    <SettingsSaveBar
      visible={dirty}
      note={[additions.length && plural(additions.length, "appointment") + " to add", removals.length && plural(removals.length, "appointment") + " to end"].filter(Boolean).join(", ")}
    >
      <Button type="button" variant="outline" onClick={() => setSelected(new Set(saved))} disabled={saving === "appointments"}>Discard</Button>
      <Button type="button" onClick={() => void saveGrid()} disabled={saving === "appointments"}>{saving === "appointments" ? "Saving…" : "Save changes"}</Button>
    </SettingsSaveBar>
  ) : null;

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  if (!vault)
    return (
      <SettingsStack className="overflow-x-clip">
        {header}
        <TableCard><SectionLoading label="Loading the appointment vault" /></TableCard>
      </SettingsStack>
    );

  const extended = vault.extendedFields !== false;
  const warnings = dueExpiryWarnings(vault, today);
  const activeAppointments = vault.appointments.filter((row) => appointmentIsActiveAt(row, today));
  const appointedStates = new Set(activeAppointments.map((row) => row.state));
  const licencedStates = new Set(vault.licenses.map((row) => row.state));
  const expiringLicences = vault.licenses
    .filter((row) => {
      const days = daysUntilExpiry(row.expires_at, today);
      return Number.isFinite(days) && days >= 0 && days <= 90;
    })
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const licenceNeedle = licenceQuery.trim().toLowerCase();
  const matchesLicence = (state: string, number = "") => !licenceNeedle || stateName(state).toLowerCase().includes(licenceNeedle) || state.toLowerCase() === licenceNeedle || number.toLowerCase().includes(licenceNeedle);
  const licenceRows = [...vault.licenses].sort((a, b) => stateName(a.state).localeCompare(stateName(b.state))).filter((row) => matchesLicence(row.state, row.license_number));
  const unlicensedAppointedStates = [...appointedStates].filter((state) => !licencedStates.has(state)).sort((a, b) => stateName(a).localeCompare(stateName(b))).filter((state) => matchesLicence(state));

  // Active appointments at carriers whose contract requires E&O (Carrier library); null = not recordable yet.
  const eoRequiredCarriers = vault.carrierRequirements ? new Set(vault.carrierRequirements.filter((row) => row.requires_eo).map((row) => row.carrier_id)) : null;
  const eoRequiredAppointments = eoRequiredCarriers ? activeAppointments.filter((row) => eoRequiredCarriers.has(row.carrier_id)).length : null;

  const eoByExpiry = vault.eoPolicies.slice().sort((a, b) => b.expires_at.localeCompare(a.expires_at));
  const eoPolicy = eoByExpiry.find((row) => row.expires_at >= today) ?? eoByExpiry[0] ?? null;
  const eoDays = eoPolicy ? daysUntilExpiry(eoPolicy.expires_at, today) : null;
  const eoLapsed = !eoPolicy || (eoDays !== null && eoDays < 0);

  const ceRecord =
    vault.ceRecords.filter((row) => row.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline))[0] ??
    vault.ceRecords.slice().sort((a, b) => b.deadline.localeCompare(a.deadline))[0] ??
    null;
  const ceTotals = vault.ceRecords.reduce((totals, row) => ({ required: totals.required + row.credits_required, completed: totals.completed + row.credits_completed }), { required: 0, completed: 0 });

  const eoAlert = eoLapsed || (eoDays !== null && eoDays <= 90);
  const eoRequiredText = eoRequiredAppointments ? ` · ${capitalise(inWords(eoRequiredAppointments))} carrier appointment${eoRequiredAppointments === 1 ? " requires" : "s require"} it` : "";

  return (
    <SettingsStack className="overflow-x-clip">
      {header}

      {!canEdit && <Callout tone="info" title="View only — the account owner manages appointments and licences." />}

      <StatStrip label="Readiness">
        <StatTile
          label="State licences"
          value={vault.licenses.length}
          valueTone={expiringLicences.length ? "warning" : undefined}
          footnote={expiringLicences[0] ? `${expiringLicences.length} expiring · next ${shortDate(expiringLicences[0].expires_at)}` : "None expire within 90 days"}
        />
        <StatTile
          label="E&O insurance"
          value={!eoPolicy ? "None" : eoLapsed ? "Expired" : "Active"}
          valueTone={eoLapsed ? "warning" : undefined}
          footnote={eoPolicy ? `${eoLapsed ? "Expired" : "Expires"} ${shortDate(eoPolicy.expires_at)}` : "No policy on file"}
        />
        <StatTile
          label="Continuing education"
          value={`${ceTotals.completed}/${ceTotals.required}`}
          footnote={ceTotals.required ? `Credits across ${plural(vault.ceRecords.length, "state")}` : "No CE cycle recorded"}
        />
        <StatTile label="Carrier appointments" value={activeAppointments.length} footnote={`Across ${plural(configuredCarriers.length, "configured carrier")}`} />
      </StatStrip>

      {warnings.length > 0 && (
        <Callout tone="warning" title="Records need attention">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {warnings.map((warning) => (
              <li key={`${warning.source}-${warning.sourceId}`} className="flex flex-wrap items-center gap-2">
                <Pill tone={warning.days === 90 ? "warning" : "error"}>{plural(warning.daysLeft, "day")}</Pill>
                <span className="font-semibold text-[var(--ink)]">{warning.label}</span>
                <span className="text-[var(--muted)]">expires {shortDate(warning.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <TableCard
        title="Licences"
        toolbar={
          <DataToolbar
            actions={
              <>
                {canEdit && (
                  <Button type="button" onClick={() => setDialog("license")}>
                    <Plus aria-hidden="true" />
                    Add a licence
                  </Button>
                )}
                <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={licenceQuery} onChange={setLicenceQuery} placeholder="Search state or number" />
          </DataToolbar>
        }
      >
        {vault.licenses.length + [...appointedStates].filter((state) => !licencedStates.has(state)).length === 0 ? (
          <EmptyState title="No licences recorded yet" hint="Until one is, no lead can be assigned to an owner or producer." />
        ) : licenceRows.length + unlicensedAppointedStates.length === 0 ? (
          <NoMatches noun="licences" onClear={() => setLicenceQuery("")} />
        ) : (
        <table className={cn(st.table, "min-w-[760px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[120px]")}>State</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Type</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Number</th>
              <th scope="col" className={st.th}>Lines</th>
              <th scope="col" className={cn(st.th, st.num, "w-[150px]")}>Expires</th>
              <th scope="col" className={cn(st.th, st.num, "w-[130px]")}>Status</th>
            </tr>
          </thead>
          <tbody>
            {licenceRows.map((row) => {
              const days = daysUntilExpiry(row.expires_at, today);
              const status: { tone: PillTone; label: string } =
                days < 0 ? { tone: "error", label: "Expired" } : days <= 90 ? { tone: "warning", label: plural(days, "day") } : { tone: "success", label: "Active" };
              return (
                <tr key={row.id}>
                  <td className={st.td}>{stateName(row.state)}</td>
                  <td className={st.td}>{row.licence_type ? LICENCE_TYPE_LABEL[row.licence_type] : <span className="text-[var(--muted)]">Not recorded</span>}</td>
                  <td className={st.td}>{row.license_number}</td>
                  <td className={st.td}>{row.lines_of_authority?.length ? row.lines_of_authority.join(", ") : <span className="text-[var(--muted)]">Not recorded</span>}</td>
                  <td className={cn(st.td, st.num)}>{shortDate(row.expires_at)}</td>
                  <td className={cn(st.td, st.num)}><Pill tone={status.tone}>{status.label}</Pill></td>
                </tr>
              );
            })}
            {unlicensedAppointedStates.map((state) => (
              <tr key={`unlicensed-${state}`}>
                <td className={st.td}>{stateName(state)}</td>
                <td className={st.td}>&mdash;</td>
                <td className={st.td}>&mdash;</td>
                <td className={st.td}>&mdash;</td>
                <td className={cn(st.td, st.num)}>&mdash;</td>
                <td className={cn(st.td, st.num)} title="The agency holds an active carrier appointment here but no licence, so no lead in this state can be assigned.">
                  <Pill tone="error">Not licensed</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </TableCard>

      <SettingsGrid cols={2}>
        <SettingsCard
          title="Errors & omissions cover"
          action={canEdit ? <Button type="button" variant="outline" onClick={() => setDialog("eo")}>{eoPolicy ? "Edit" : <><Plus aria-hidden="true" />Add a policy</>}</Button> : undefined}
        >
          {eoPolicy ? (
            <KeyValues
              items={[
                { label: "Carrier", value: eoPolicy.carrier },
                { label: "Policy", value: eoPolicy.policy_number },
                { label: "Per claim", value: money(eoPolicy.per_claim_cents) },
                { label: "Aggregate", value: money(eoPolicy.aggregate_cents) },
                { label: "Expires", value: longDate(eoPolicy.expires_at) },
                {
                  label: "Days left",
                  value: eoDays !== null && eoDays < 0 ? "Expired" : String(eoDays),
                  tone: eoDays !== null && eoDays < 0 ? "error" : eoDays !== null && eoDays <= 90 ? "warning" : undefined,
                },
              ]}
            />
          ) : (
            <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No E&amp;O policy on file.</p>
          )}
          {eoAlert && (
            <Callout className="mt-4" tone={eoLapsed || (eoDays !== null && eoDays <= 60) ? "error" : "warning"} title={`${eoLapsed ? "E&O cover has lapsed" : `E&O expires in ${plural(eoDays ?? 0, "day")}`}${eoRequiredText}`} />
          )}
        </SettingsCard>

        <SettingsCard
          title="Continuing education"
          sub={ceRecord ? `${stateName(ceRecord.state)}, ${ceRecord.deadline >= today ? "current cycle" : "last recorded cycle"}` : undefined}
          action={canEdit ? <Button type="button" variant="outline" onClick={() => setDialog("ce")}>{ceRecord ? "Edit" : <><Plus aria-hidden="true" />Add a cycle</>}</Button> : undefined}
        >
          {ceRecord ? <CeSummary record={ceRecord} /> : <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No continuing-education cycle recorded.</p>}
        </SettingsCard>
      </SettingsGrid>

      {configuredCarriers.length === 0 ? (
        <TableCard title="Carrier appointments">
          <EmptyState title="Connect a carrier first" hint="Choose a carrier in Settings › Carrier library before recording appointments." />
        </TableCard>
      ) : (
        <AppointmentGrid
          carriers={configuredCarriers}
          states={states}
          selected={selected}
          setSelected={setSelected}
          stateFilter={stateFilter}
          setStateFilter={setStateFilter}
          effectiveFrom={effectiveFrom}
          setEffectiveFrom={setEffectiveFrom}
          canEdit={canEdit}
          pending={{ additions: additions.length, removals: removals.length }}
        />
      )}

      {canEdit && (
        <>
          {dialog === "license" && <LicenceDialog
            open
            onOpenChange={(open) => setDialog(open ? "license" : null)}
            licences={vault.licenses}
            extended={extended}
            saving={saving === "license"}
            onSave={async (payload) => save("/api/app/appointment-vault/licenses", payload, "Licence saved", "license")}
          />}
          {dialog === "eo" && <EoDialog
            open
            onOpenChange={(open) => setDialog(open ? "eo" : null)}
            policies={vault.eoPolicies}
            current={eoPolicy}
            extended={extended}
            saving={saving === "eo"}
            onSave={async (payload) => save("/api/app/appointment-vault/eo-policies", payload, "E&O policy saved", "eo")}
          />}
          {dialog === "ce" && <CeDialog
            open
            onOpenChange={(open) => setDialog(open ? "ce" : null)}
            records={vault.ceRecords}
            current={ceRecord}
            extended={extended}
            saving={saving === "ce"}
            onSave={async (payload) => save("/api/app/appointment-vault/ce-records", payload, "CE record saved", "ce")}
          />}
        </>
      )}

      {saveBar}
    </SettingsStack>
  );
}
