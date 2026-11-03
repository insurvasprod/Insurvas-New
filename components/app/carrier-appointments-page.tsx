"use client";

/**
 * /app/appointments — Carrier appointments & licences (board p-app-appointments).
 *
 * "Whether you may legally write this product in this state today." A producer reads it; an owner
 * with full access edits it. Every answer on it comes from lib/appointments/readiness.ts, whose
 * routing rule is the row-level copy of assignment_candidate_is_eligible, so a cell that says
 * "Expired" is a cell the router has stopped using.
 *
 * Settings › Carriers sets appointments state by state; licences are edited only here (Licences tab,
 * "?tab=licences"). The dialogs and the checkbox grid live in appointment-vault-parts.tsx.
 *
 * 2026-10-06 redesign: appointments, licences and carrier trainings are three tabs under the
 * strip. (CE and E&O cover were removed from the platform 2026-10-26.)
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md): the tabs are the address (`?tab=`) and
 * sit on Compliance's title line; the figures link to them; every readiness item, and why editing is off,
 * goes to the bell, never a tinted box on the page; Carrier trainings lists every training as a row.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  Callout,
  Field,
  control,
  st,
} from "@/components/app/settings/primitives";
import { ViewTabs } from "@/components/app/view-tabs";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";
import { useUrlTab } from "@/components/app/reports/reports-slot";
import {
  AppointmentGrid,
  FormFooter,
  LicenceDialog,
  RecordDialog,
  keyFor,
  plural,
  shortDate,
  stateName,
  today,
  type SaveResult,
} from "@/components/app/appointment-vault-parts";
import type { CarrierRow } from "@/lib/carriers/constants";
import { US_REGIONS, US_STATES, regionOf } from "@/lib/appointments/constants";
import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import {
  READINESS_WINDOW_DAYS,
  appointmentCellStatus,
  appointmentFootprint,
  cellDialogDefaults,
  dayMonth,
  latestAppointmentByCell,
  licenceStatus,
  outstandingTrainings,
  readinessItems,
  readinessSummary,
  type CellStatus,
} from "@/lib/appointments/readiness";
import { daysUntilExpiry } from "@/lib/appointments/warnings";
import { cn } from "@/lib/utils";
import { licenceExpiryValue, licenceNumberValue } from "@/lib/appointments/tickModel";
import { agencyCarrierModel, offeredCarriers } from "@/lib/carriers/agencyModel";
import type {
  AppointmentRow,
  AppointmentStatus,
  CarrierTrainingRow,
  LicenseRow,
} from "@/lib/appointments/service-types";

type Vault = {
  carriers: CarrierRow[];
  tenantCarriers: Array<{ id: string; carrier_id: string; effective_from: string; is_active: boolean }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  extendedFields?: boolean;
  carrierRequirements?: Array<{ carrier_id: string; contracted?: boolean }> | null;
  /** False until 20260924310000: no pending status, no expiry. */
  appointmentDetails?: boolean;
  /** Null until 20260924310100. */
  carrierTrainings?: CarrierTrainingRow[] | null;
};

type Dialog = null | "license" | "training" | { carrierId: string; state: string };

type Tab = "appointments" | "licences" | "cover";

const MUTED = "text-sm leading-normal tracking-[-0.02em] text-[var(--muted)]";
const TONE: Record<"success" | "warning" | "error" | "neutral", StatusTone> = { success: "good", warning: "warning", error: "danger", neutral: "neutral" };

const CELL_PILL: Record<CellStatus["kind"], { tone: StatusTone; label: (status: CellStatus) => string } | null> = {
  none: null,
  appointed: { tone: "good", label: () => "Appointed" },
  expiring: { tone: "warning", label: () => `Expires <${READINESS_WINDOW_DAYS}d` },
  pending: { tone: "neutral", label: () => "Pending" },
  starts: { tone: "neutral", label: (status) => (status.kind === "starts" ? `From ${dayMonth(status.on, false)}` : "") },
  expired: { tone: "danger", label: () => "Expired" },
  ended: { tone: "neutral", label: () => "Ended" },
};

/**
 * `readOnlyReason`: why editing is off for an owner whose account is read-only (LA-4.10). The edit
 * controls are already hidden (`canEdit`); this one line says why, instead of them just vanishing.
 */
export function CarrierAppointmentsPage({ canEdit, isOwner, readOnlyReason = null, framed = false }: { canEdit: boolean; isOwner: boolean; readOnlyReason?: string | null; framed?: boolean }) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  // The checkbox grid's draft, exactly as Settings › States & licences keeps it.
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [stateFilter, setStateFilter] = useState("");
  const [carrierQuery, setCarrierQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [licenceQuery, setLicenceQuery] = useState("");
  const [carrierPage, setCarrierPage] = useState(1);
  const [licencePage, setLicencePage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const [refreshing, setRefreshing] = useState(false);
  // The tab is the address (foundation pass 2026-11-03), so the figures link to it: "?tab=licences" is where
  // the dialer's licence refusals and a lead list's "Add a licence" point, since Settings › Carriers no longer
  // edits licences (2026-10-26); "&state=TX" (Route's "Add a TX licence", 2026-10-30) also opens Add licence
  // on that state for an editor.
  const pathname = usePathname();
  const { tab, setTab } = useUrlTab<Tab>(["appointments", "licences", "cover"], "appointments");
  const [licenceState, setLicenceState] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== "licences") return;
    const state = (params.get("state") ?? "").toUpperCase();
    if (canEdit && /^[A-Z]{2}$/.test(state)) { setLicenceState(state); setDialog("license"); } // eslint-disable-line react-hooks/set-state-in-effect -- same read
  }, [canEdit]);

  const applyVault = useCallback((next: Vault) => {
    setVault(next);
    const active = new Set(
      [...latestAppointmentByCell(next.appointments).values()].filter((row) => row.status === "active").map((row) => keyFor(row.carrier_id, row.state)),
    );
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

  // The vault is external tenant data; fetch it asynchronously before applying the first snapshot.
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

  const latestByKey = useMemo(() => latestAppointmentByCell(vault?.appointments ?? []), [vault]);
  const configuredCarriers = useMemo(() => {
    if (!vault) return [];
    // LA-0.4: the carriers switched on in Settings › Carriers (agencyModel.ts, the rule every screen uses).
    const on = new Set(offeredCarriers(agencyCarrierModel({ library: vault.carriers, contracts: vault.tenantCarriers, requirements: (vault.carrierRequirements ?? []).map((row) => ({ carrier_id: row.carrier_id, contracted: row.contracted !== false })), appointments: [], today: "" })).map((row) => row.id));
    return vault.carriers.filter((row) => on.has(row.id));
  }, [vault]);
  const gridStates = useMemo(
    () =>
      US_STATES.filter(
        ([, name]) =>
          !stateFilter.trim() || name.toLowerCase().includes(stateFilter.trim().toLowerCase()) || name.startsWith(stateFilter.trim().toUpperCase()),
      ),
    [stateFilter],
  );
  const additions = [...selected].filter((key) => !saved.has(key));
  const removals = [...saved].filter((key) => !selected.has(key));
  const dirty = additions.length + removals.length > 0;

  async function send(path: string, init: { method: "POST" | "DELETE"; payload?: unknown }, success: string, key: string): Promise<SaveResult> {
    if (!canEdit) return { ok: false, error: "View only" };
    setSaving(key);
    const response = await fetch(path, {
      method: init.method,
      headers: init.payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.payload === undefined ? undefined : JSON.stringify(init.payload),
    });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) return { ok: false, error: response.status === 503 ? SCHEMA_PENDING_MESSAGE : (body?.error ?? "Could not save changes") };
    notify.done(success);
    await load();
    return { ok: true, body };
  }
  const save = (path: string, payload: unknown, success: string, key: string) => send(path, { method: "POST", payload }, success, key);

  /** Checking a cell stages an appointment; unchecking one stages its termination (Settings' rule). */
  async function saveGrid(): Promise<boolean> {
    if (!canEdit || !dirty) return false;
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
    return result.ok;
  }

  const connect = isOwner ? (
    <Button asChild variant="outline">
      <Link href="/app/settings#carriers">Connect a carrier</Link>
    </Button>
  ) : undefined;
  // Inside Compliance (owner 2026-11-02) the frame draws the title; the button goes to its corner.
  const header = framed
    ? (connect ? <ComplianceSlot slot="corner">{connect}</ComplianceSlot> : null)
    : <PageHeader title="Appointments & licences" description="Whether you may legally write this product in this state today." actions={connect} />;

  // Inside Compliance the frame already draws the title, so only the rows wait.
  if (!vault) return framed ? <TableCard><SectionLoading rows={6} columns={5} label="Loading appointments and licences" /></TableCard> : <PageLoading />;

  const extended = vault.extendedFields !== false;
  const detailsAvailable = vault.appointmentDetails !== false;
  const trainings = vault.carrierTrainings ?? null;
  const readinessInput = { ...vault, carrierTrainings: trainings };
  const items = readinessItems(readinessInput, today);
  const summary = readinessSummary(items);

  // Rows: every carrier the agency contracts with, plus any carrier it still holds appointment rows for.
  const appointedCarrierIds = new Set(vault.appointments.map((row) => row.carrier_id));
  const tableCarriers = [
    ...configuredCarriers,
    ...[...appointedCarrierIds]
      .filter((id) => !configuredCarriers.some((carrier) => carrier.id === id))
      .map((id) => vault.carriers.find((carrier) => carrier.id === id) ?? ({ id, name: "Carrier" } as CarrierRow)),
  ];
  const footprint = appointmentFootprint(vault.appointments, vault.licenses);
  const columns = regionFilter ? footprint.filter((code) => regionOf(code) === regionFilter) : footprint;
  const carrierNeedle = carrierQuery.trim().toLowerCase();
  const shownCarriers = carrierNeedle ? tableCarriers.filter((carrier) => carrier.name.toLowerCase().includes(carrierNeedle)) : tableCarriers;

  const activeAppointments = vault.appointments.filter((row) => appointmentIsActiveAt(row, today));
  const appointedStates = new Set(activeAppointments.map((row) => row.state));
  const licencedStates = new Set(vault.licenses.map((row) => row.state));
  const licenceRows = [...vault.licenses].sort((a, b) => stateName(a.state).localeCompare(stateName(b.state)));
  const unlicensedAppointedStates = [...appointedStates].filter((state) => !licencedStates.has(state)).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  const licenceNeedle = licenceQuery.trim().toLowerCase();
  const matchesState = (state: string, ...more: Array<string | null | undefined>) =>
    !licenceNeedle || [state, stateName(state), ...more].some((value) => value?.toLowerCase().includes(licenceNeedle));
  const shownLicences = licenceRows.filter((row) => matchesState(row.state, row.license_number));
  const shownUnlicensed = unlicensedAppointedStates.filter((state) => matchesState(state));
  const carrierRows = paginate(shownCarriers, carrierPage, pageSize);
  // Licences first, then the appointed states with none, paged as one list (a state is a string).
  const licenceTotal = shownLicences.length + shownUnlicensed.length;
  const licencePageRows = paginate<LicenseRow | string>([...shownLicences, ...shownUnlicensed], licencePage, pageSize);

  const outstanding = trainings ? outstandingTrainings(trainings) : null;
  const overdueTrainings = outstanding ? outstanding.filter((row) => row.due_on < today).length : 0;
  const cellDialog = dialog && typeof dialog === "object" ? dialog : null;
  const expiringLicences = licenceRows.filter((row) => licenceStatus(row.expires_at, today).tone !== "success").length;

  const closeEditor = () => {
    setEditing(false);
    setStateFilter("");
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };
  const refreshButton = <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />;
  const noCarrier = (
    <EmptyState title="Connect a carrier first" hint="Choose a carrier in Settings › Carrier library before recording appointments." />
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <LeaveGuard dirty={dirty} onSave={saveGrid} onDiscard={() => setSelected(new Set(saved))} what="the appointments grid" />
      {header}
      {/* Why editing is off, and every readiness blocker, go to the bell (owner 2026-11-02): never a box on the page. */}
      {readOnlyReason ? <Callout tone="warning" title="Read-only">{readOnlyReason}</Callout>
        : !canEdit ? <Callout tone="info" title="View only">An owner with full access edits appointments and licences.</Callout> : null}
      {items.map((item) => <Callout key={item.key} tone={item.tone === "error" ? "error" : "warning"} title={item.title}>{item.body}</Callout>)}

      <StatStrip label="Readiness">
        <StatTile label="Readiness" value={summary.label} valueTone={summary.tone === "error" ? "danger" : summary.tone === "warning" ? "warning" : "good"} footnote={`${plural(items.length, "item")} inside ${READINESS_WINDOW_DAYS} days`} href={unlicensedAppointedStates.length || expiringLicences ? `${pathname}?tab=licences` : overdueTrainings ? `${pathname}?tab=cover` : pathname} />
        <StatTile label="Appointed states" value={appointedStates.size} footnote={plural(activeAppointments.length, "active appointment")} href={pathname} />
        <StatTile label="Licences" href={`${pathname}?tab=licences`} value={licenceRows.length} valueTone={unlicensedAppointedStates.length ? "danger" : undefined} footnote={unlicensedAppointedStates.length ? `${plural(unlicensedAppointedStates.length, "appointed state")} unlicensed` : expiringLicences ? `${expiringLicences} need attention` : "all current"} />
      </StatStrip>

      {(() => {
        const tabs = (
          <ViewTabs
            label="Appointment vault views"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "appointments", label: "Carrier appointments", count: activeAppointments.length },
              { key: "licences", label: "State licences", count: licenceRows.length },
              { key: "cover", label: "Carrier trainings" },
            ]}
          />
        );
        return framed ? <ComplianceSlot slot="lead">{tabs}</ComplianceSlot> : tabs;
      })()}

      {tab === "appointments" && (editing && canEdit ? (
        configuredCarriers.length === 0 ? (
          <TableCard toolbar={<DataToolbar actions={<Button type="button" variant="outline" onClick={closeEditor}>Done editing</Button>} />}>
            {noCarrier}
          </TableCard>
        ) : (
          <AppointmentGrid
            carriers={configuredCarriers}
            states={gridStates}
            selected={selected}
            setSelected={setSelected}
            stateFilter={stateFilter}
            setStateFilter={setStateFilter}
            effectiveFrom={effectiveFrom}
            setEffectiveFrom={setEffectiveFrom}
            canEdit={canEdit}
            pending={{ additions: additions.length, removals: removals.length }}
            actions={
              <>
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set(saved))} disabled={!dirty || saving === "appointments"}>Discard</Button>
                <Button type="button" onClick={() => void saveGrid()} disabled={!dirty || saving === "appointments"}>{saving === "appointments" ? "Saving…" : "Save changes"}</Button>
                <Button type="button" variant="outline" onClick={closeEditor} disabled={dirty} title={dirty ? "Save or discard your changes first" : undefined}>
                  Done editing
                </Button>
              </>
            }
          />
        )
      ) : (
        <TableCard
          toolbar={
            <DataToolbar
              actions={<>
                {canEdit && tableCarriers.length > 0 && <Button type="button" variant="outline" onClick={() => setEditing(true)}>Edit appointments</Button>}
                {(carrierQuery || regionFilter) && <ClearFiltersButton onClick={() => { setCarrierQuery(""); setRegionFilter(""); setCarrierPage(1); }} />}
                {refreshButton}
              </>}
            >
              <ToolbarSearch value={carrierQuery} onChange={(value) => { setCarrierQuery(value); setCarrierPage(1); }} placeholder="Search carriers" />
              <select aria-label="Filter states by region" className={toolbarControl} value={regionFilter} onChange={(event) => { setRegionFilter(event.target.value); setCarrierPage(1); }}>
                <option value="">All regions</option>
                {US_REGIONS.map((region) => <option key={region.name} value={region.name}>{region.name}</option>)}
              </select>
            </DataToolbar>
          }
          footer={tableCarriers.length > 0 && footprint.length > 0 ? shownCarriers.length > pageSize && columns.length > 0 ? <Pager page={carrierRows.current} pageSize={pageSize}total={shownCarriers.length} noun="carriers" onPage={setCarrierPage} suffix={`${columns.length} of ${footprint.length} states · grouped by region`} /> : <span>{shownCarriers.length} of {plural(tableCarriers.length, "carrier")} · {columns.length} of {footprint.length} states · grouped by region</span> : undefined}
        >
          {tableCarriers.length === 0 ? (
            noCarrier
          ) : footprint.length === 0 ? (
            <EmptyState title="No appointment or licence recorded yet" hint={canEdit ? "Choose Edit appointments to mark the states where each carrier has appointed you." : "Appointments appear here once an owner records them."} />
          ) : shownCarriers.length === 0 || columns.length === 0 ? (
            <NoMatches noun="appointments" onClear={() => { setCarrierQuery(""); setRegionFilter(""); setCarrierPage(1); }} />
          ) : (
            <table className={st.table} style={{ minWidth: 190 + 120 * columns.length }}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "min-w-[190px] pl-4")}>Carrier</th>
                  {columns.map((code, index) => {
                    const region = regionOf(code);
                    const startsRegion = index > 0 && regionOf(columns[index - 1]) !== region;
                    return (
                      <th key={code} scope="col" className={cn(st.th, "min-w-[120px]", startsRegion && "border-l border-[var(--border)]")} title={`${stateName(code)}${region ? ` · ${region}` : ""}`}>
                        {code}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="m-seq">
                {carrierRows.rows.map((carrier) => (
                  <tr key={carrier.id}>
                    <th scope="row" className={cn(st.td, "max-w-[220px] truncate pl-4 text-left font-normal")} title={carrier.name}>
                      {carrier.name}
                    </th>
                    {columns.map((code, index) => {
                      const status = appointmentCellStatus(latestByKey.get(keyFor(carrier.id, code)), today);
                      const pill = CELL_PILL[status.kind];
                      const label = pill ? pill.label(status) : "No appointment";
                      const startsRegion = index > 0 && regionOf(columns[index - 1]) !== regionOf(code);
                      const content = pill ? <StatusChip tone={pill.tone}>{label}</StatusChip> : <span aria-hidden className="text-[var(--muted)]">&mdash;</span>;
                      return (
                        <td key={code} className={cn(st.td, startsRegion && "border-l border-[var(--border)]")}>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => setDialog({ carrierId: carrier.id, state: code })}
                              aria-label={`${carrier.name} in ${stateName(code)}: ${label}. Edit`}
                              className="inline-flex cursor-pointer items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                            >
                              {content}
                            </button>
                          ) : (
                            <>
                              {content}
                              {!pill && <span className="sr-only">{label}</span>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ))}

      {tab === "licences" && (
        <TableCard
          toolbar={
            <DataToolbar
              actions={<>
                {canEdit && (
                  <Button type="button" variant="outline" onClick={() => setDialog("license")}>
                    <Plus aria-hidden="true" />
                    Add a licence
                  </Button>
                )}
                {licenceQuery && <ClearFiltersButton onClick={() => { setLicenceQuery(""); setLicencePage(1); }} />}
                {refreshButton}
              </>}
            >
              <ToolbarSearch value={licenceQuery} onChange={(value) => { setLicenceQuery(value); setLicencePage(1); }} placeholder="Search states, licences" />
            </DataToolbar>
          }
          footer={licenceRows.length + unlicensedAppointedStates.length > 0 ? licenceTotal > pageSize ? <Pager page={licencePageRows.current} pageSize={pageSize}total={licenceTotal} noun="rows" onPage={setLicencePage} suffix={<>{plural(licenceRows.length, "licence")}{unlicensedAppointedStates.length ? ` · ${plural(unlicensedAppointedStates.length, "appointed state")} without one` : ""}</>} /> : <span>{plural(licenceRows.length, "licence")}{unlicensedAppointedStates.length ? ` · ${plural(unlicensedAppointedStates.length, "appointed state")} without one` : ""}</span> : undefined}
        >
          {licenceRows.length + unlicensedAppointedStates.length === 0 ? (
            <EmptyState title="No licences recorded yet" hint="Until one is, no lead can be assigned to an owner or producer." />
          ) : shownLicences.length + shownUnlicensed.length === 0 ? (
            <NoMatches noun="licences" onClear={() => { setLicenceQuery(""); setLicencePage(1); }} />
          ) : (
            <table className={cn(st.table, "min-w-[760px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "pl-4")}>State</th>
                  <th scope="col" className={st.th}>Licence</th>
                  <th scope="col" className={st.th}>Lines</th>
                  <th scope="col" className={st.th}>Expires</th>
                  <th scope="col" className={cn(st.th, "pr-4")}>Status</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {licencePageRows.rows.filter((row): row is LicenseRow => typeof row !== "string").map((row) => {
                  const status = licenceStatus(row.expires_at, today);
                  return (
                    <tr key={row.id}>
                      <td className={cn(st.td, "whitespace-nowrap pl-4")}>{stateName(row.state)}</td>
                      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{licenceNumberValue(row.license_number) || <span className="text-[var(--muted)]">No number yet</span>}</td>
                      <td className={cn(st.td, "max-w-[320px] truncate")} title={row.lines_of_authority?.join(", ") || undefined}>{row.lines_of_authority?.length ? row.lines_of_authority.join(", ") : <span className="text-[var(--muted)]">Not recorded</span>}</td>
                      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{licenceExpiryValue(row.expires_at) ? shortDate(row.expires_at) : <span className="text-[var(--muted)]">No expiry</span>}</td>
                      <td className={cn(st.td, "pr-4")}><StatusChip tone={TONE[status.tone]}>{status.label}</StatusChip></td>
                    </tr>
                  );
                })}
                {licencePageRows.rows.filter((row): row is string => typeof row === "string").map((state) => (
                  <tr key={`unlicensed-${state}`}>
                    <td className={cn(st.td, "whitespace-nowrap pl-4")}>{stateName(state)}</td>
                    {/* The fact itself, on the row: an active carrier appointment here and no licence. */}
                    <td className={cn(st.td, "text-[var(--error-ink)]")} colSpan={3}>Appointed here with no licence, so no lead in this state can be assigned.</td>
                    <td className={cn(st.td, "pr-4")}>
                      <StatusChip tone="danger">Not licensed</StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {/* Every carrier training as a row (foundation pass 2026-11-03; was one "N outstanding" line in a half-width
          card). Recording and completing them stays in the Trainings pop-up. */}
      {tab === "cover" && (
        <TableCard
          toolbar={<DataToolbar actions={<>
            {canEdit && <Button type="button" variant="outline" onClick={() => setDialog("training")}><Plus aria-hidden="true" />Trainings</Button>}
            {refreshButton}
          </>} />}
          footer={trainings && trainings.length ? <span>{plural(trainings.length, "training")}{outstanding?.length ? ` · ${outstanding.length} outstanding` : ""}{overdueTrainings ? ` · ${overdueTrainings} overdue` : ""}</span> : undefined}
        >
          {trainings === null ? (
            <EmptyState title="Carrier trainings are not recordable yet" hint="They need a database update." />
          ) : trainings.length === 0 ? (
            <EmptyState title="No carrier training recorded" hint="Some carriers require their own product training before you sell." action={canEdit ? <Button type="button" variant="outline" onClick={() => setDialog("training")}>Add a training</Button> : undefined} />
          ) : (
            <table className={cn(st.table, "min-w-[640px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "pl-4")}>Carrier</th>
                  <th scope="col" className={st.th}>Training</th>
                  <th scope="col" className={st.th}>Due</th>
                  <th scope="col" className={cn(st.th, "pr-4")}>Status</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {[...trainings].sort((a, b) => Number(Boolean(a.completed_on)) - Number(Boolean(b.completed_on)) || a.due_on.localeCompare(b.due_on)).map((row) => (
                  <tr key={row.id}>
                    <td className={cn(st.td, "max-w-[220px] truncate pl-4")} title={vault.carriers.find((carrier) => carrier.id === row.carrier_id)?.name}>{vault.carriers.find((carrier) => carrier.id === row.carrier_id)?.name ?? "Carrier"}</td>
                    <td className={cn(st.td, "max-w-[320px] truncate")} title={row.title}>{row.title}</td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{shortDate(row.due_on)}</td>
                    <td className={cn(st.td, "pr-4")}>{row.completed_on ? <StatusChip tone="good">{`Done ${shortDate(row.completed_on)}`}</StatusChip> : row.due_on < today ? <StatusChip tone="danger">Overdue</StatusChip> : <StatusChip tone="warning">Outstanding</StatusChip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {canEdit && (
        <>
          {dialog === "license" && (
            <LicenceDialog
              open
              onOpenChange={(open) => { setDialog(open ? "license" : null); if (!open) setLicenceState(null); }}
              licences={vault.licenses}
              initialState={licenceState}
              extended={extended}
              saving={saving === "license"}
              onSave={async (payload) => save("/api/app/appointment-vault/licenses", payload, "Licence saved", "license")}
            />
          )}
          {dialog === "training" && (
            <TrainingDialog
              onClose={() => setDialog(null)}
              carriers={configuredCarriers.length ? configuredCarriers : tableCarriers}
              allCarriers={vault.carriers}
              trainings={trainings}
              saving={saving}
              onAdd={(payload) => save("/api/app/appointment-vault/carrier-training", { action: "add", ...payload }, "Training added", "training-add")}
              onComplete={(id, completedOn) =>
                save("/api/app/appointment-vault/carrier-training", { action: "complete", id, completed_on: completedOn }, completedOn ? "Training marked complete" : "Training marked outstanding", `training-${id}`)
              }
              onRemove={(id) => send(`/api/app/appointment-vault/carrier-training?id=${encodeURIComponent(id)}`, { method: "DELETE" }, "Training removed", `training-${id}`)}
            />
          )}
          {cellDialog && (
            <AppointmentCellDialog
              key={`${cellDialog.carrierId}:${cellDialog.state}`}
              carrierId={cellDialog.carrierId}
              carrierName={tableCarriers.find((carrier) => carrier.id === cellDialog.carrierId)?.name ?? "Carrier"}
              state={cellDialog.state}
              row={latestByKey.get(keyFor(cellDialog.carrierId, cellDialog.state))}
              detailsAvailable={detailsAvailable}
              saving={saving === "cell"}
              onClose={() => setDialog(null)}
              onSave={(row) => save("/api/app/appointment-vault/appointments", { appointments: [row] }, "Appointment saved", "cell")}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── one carrier × state: status, effective from, expires ───────────────── */

function AppointmentCellDialog({
  carrierId,
  carrierName,
  state,
  row,
  detailsAvailable,
  saving,
  onClose,
  onSave,
}: {
  carrierId: string;
  carrierName: string;
  state: string;
  row: AppointmentRow | undefined;
  detailsAvailable: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (row: Record<string, unknown>) => Promise<SaveResult>;
}) {
  const [initial] = useState(() => cellDialogDefaults(row, today));
  const [status, setStatus] = useState<AppointmentStatus>(initial.status);
  const [effective, setEffective] = useState(initial.effective_from);
  const [expires, setExpires] = useState(initial.expires_at);
  const [ended, setEnded] = useState(initial.terminated_at);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    // Ended needs its date; pending and active carry none.
    const endsOn = status === "terminated" ? ended : null;
    const payload: Record<string, unknown> = {
      ...(row ? { id: row.id } : {}),
      carrier_id: carrierId,
      state,
      status,
      effective_from: effective,
      terminated_at: endsOn,
    };
    // Sent only when it can be stored; an absent key keeps what the database holds.
    if (detailsAvailable) payload.expires_at = expires || null;
    const result = await onSave(payload);
    if (!result.ok) setError(result.error);
    else onClose();
  }

  return (
    <RecordDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`${carrierName} in ${stateName(state)}`}
      description="Only an active appointment inside its dates counts toward routing leads in this state. Pending, expired and ended appointments do not."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="cell-status" hint={detailsAvailable ? undefined : SCHEMA_PENDING_MESSAGE}>
          <select id="cell-status" className={control} value={status} onChange={(event) => setStatus(event.target.value as AppointmentStatus)}>
            <option value="pending" disabled={!detailsAvailable}>Pending with the carrier</option>
            <option value="active">Active</option>
            <option value="terminated">Ended</option>
          </select>
        </Field>
        <Field label="Effective from" htmlFor="cell-effective" required>
          <input id="cell-effective" type="date" className={control} value={effective} onChange={(event) => setEffective(event.currentTarget.value)} required />
        </Field>
        <Field label="Expires" htmlFor="cell-expires" hint={detailsAvailable ? "Leave blank if this appointment does not expire." : SCHEMA_PENDING_MESSAGE}>
          <input
            id="cell-expires"
            type="date"
            className={control}
            value={expires}
            min={effective || undefined}
            onChange={(event) => setExpires(event.currentTarget.value)}
            disabled={!detailsAvailable}
          />
        </Field>
        {status === "terminated" && (
          <Field label="Ended on" htmlFor="cell-ended" required>
            <input id="cell-ended" type="date" className={control} value={ended} min={effective || undefined} onChange={(event) => setEnded(event.currentTarget.value)} required />
          </Field>
        )}
        <FormFooter saving={saving} label={row ? "Save appointment" : "Add appointment"} error={error} onCancel={onClose} />
      </form>
    </RecordDialog>
  );
}

/* ── carrier-specific trainings ─────────────────────────────────────────── */

function TrainingDialog({
  onClose,
  carriers,
  allCarriers,
  trainings,
  saving,
  onAdd,
  onComplete,
  onRemove,
}: {
  onClose: () => void;
  carriers: CarrierRow[];
  allCarriers: CarrierRow[];
  trainings: CarrierTrainingRow[] | null;
  saving: string | null;
  onAdd: (payload: { carrier_id: string; title: string; due_on: string }) => Promise<SaveResult>;
  onComplete: (id: string, completedOn: string | null) => Promise<SaveResult>;
  onRemove: (id: string) => Promise<SaveResult>;
}) {
  const [form, setForm] = useState({ carrier_id: carriers[0]?.id ?? "", title: "", due_on: "" });
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const available = trainings !== null;
  const nameOf = (id: string) => allCarriers.find((carrier) => carrier.id === id)?.name ?? "Carrier";
  const ordered = (trainings ?? []).slice().sort((a, b) => Number(!!a.completed_on) - Number(!!b.completed_on) || a.due_on.localeCompare(b.due_on));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const result = await onAdd(form);
    if (!result.ok) setError(result.error);
    else setForm((current) => ({ ...current, title: "", due_on: "" }));
  }
  async function act(id: string, run: () => Promise<SaveResult>) {
    setRowError(null);
    const result = await run();
    if (!result.ok) setRowError({ id, message: result.error });
  }

  return (
    <RecordDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Carrier-specific trainings"
      description="Product and AML trainings a carrier requires before you sell for it, Each stays outstanding until you mark it complete."
    >
      {!available && (
        <Callout tone="warning" title="Not recordable yet">
          {SCHEMA_PENDING_MESSAGE}
        </Callout>
      )}
      {ordered.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {ordered.map((row) => {
            const days = daysUntilExpiry(row.due_on, today);
            const tone: StatusTone = row.completed_on ? "good" : days < 0 ? "danger" : days <= READINESS_WINDOW_DAYS ? "warning" : "neutral";
            const label = row.completed_on ? `Done ${shortDate(row.completed_on)}` : days < 0 ? "Overdue" : `Due ${shortDate(row.due_on)}`;
            const busy = saving === `training-${row.id}`;
            return (
              <li key={row.id} className="rounded-lg border border-[var(--border)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--ink)]" title={row.title}>{row.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{nameOf(row.carrier_id)} &middot; due {shortDate(row.due_on)}</span>
                  <StatusChip tone={tone}>{label}</StatusChip>
                  <Button type="button" variant="outline" size="sm" onClick={() => void act(row.id, () => onComplete(row.id, row.completed_on ? null : today))} disabled={busy}>
                    {row.completed_on ? "Mark outstanding" : "Mark complete"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" onClick={() => void act(row.id, () => onRemove(row.id))} disabled={busy}>
                    Remove
                  </Button>
                </div>
                {rowError?.id === row.id && (
                  <p role="alert" className="mt-1.5 text-xs leading-normal text-[var(--error-ink)]">{rowError.message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {available && ordered.length === 0 && <p className={MUTED}>No carrier trainings recorded yet.</p>}
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
        <Field label="Carrier" htmlFor="training-carrier" required>
          <select
            id="training-carrier"
            className={control}
            value={form.carrier_id}
            onChange={(event) => {
              const value = event.target.value;
              setForm((current) => ({ ...current, carrier_id: value }));
            }}
            disabled={!available || carriers.length === 0}
            required
          >
            {carriers.map((carrier) => (
              <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Due on" htmlFor="training-due" required>
          <input
            id="training-due"
            type="date"
            className={control}
            value={form.due_on}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setForm((current) => ({ ...current, due_on: value }));
            }}
            disabled={!available}
            required
          />
        </Field>
        <Field label="Training" htmlFor="training-title" required className="sm:col-span-2">
          <input
            id="training-title"
            className={control}
            value={form.title}
            maxLength={160}
            placeholder="Annuity suitability, AML refresher…"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setForm((current) => ({ ...current, title: value }));
            }}
            disabled={!available}
            required
          />
        </Field>
        <FormFooter saving={saving === "training-add"} label="Add training" error={error} onCancel={onClose} />
      </form>
    </RecordDialog>
  );
}
