"use client";

/**
 * /app/appointments — Carrier appointments & licences (board p-app-appointments).
 *
 * "Whether you may legally write this product in this state today." A producer reads it; an owner
 * with full access edits it. Every answer on it comes from lib/appointments/readiness.ts, whose
 * routing rule is the row-level copy of assignment_candidate_is_eligible, so a cell that says
 * "Expired" is a cell the router has stopped using.
 *
 * Settings › States & licences renders appointment-vault-settings.tsx instead; both share the
 * dialogs and the checkbox grid in appointment-vault-parts.tsx.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import {
  Callout,
  Field,
  KeyValues,
  Pill,
  SettingsMeter,
  btn,
  control,
  st,
  type PillTone,
} from "@/components/app/settings/primitives";
import {
  AppointmentGrid,
  CeDialog,
  EoDialog,
  FormFooter,
  LicenceDialog,
  RecordDialog,
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
import { US_REGIONS, US_STATES, regionOf } from "@/lib/appointments/constants";
import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import {
  READINESS_WINDOW_DAYS,
  appointmentCellStatus,
  appointmentFootprint,
  cellDialogDefaults,
  currentCeRecord,
  currentEoPolicy,
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
import type {
  AppointmentRow,
  AppointmentStatus,
  CarrierTrainingRow,
  CeRecordRow,
  EoPolicyRow,
  LicenseRow,
} from "@/lib/appointments/service-types";

type Vault = {
  carriers: CarrierRow[];
  tenantCarriers: Array<{ id: string; carrier_id: string; effective_from: string; is_active: boolean }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
  ceRecords: CeRecordRow[];
  extendedFields?: boolean;
  carrierRequirements?: Array<{ carrier_id: string; requires_eo: boolean }> | null;
  /** False until 20260924310000: no pending status, no expiry. */
  appointmentDetails?: boolean;
  /** Null until 20260924310100. */
  carrierTrainings?: CarrierTrainingRow[] | null;
};

type Dialog = null | "license" | "eo" | "ce" | "training" | { carrierId: string; state: string };

const H2 = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const MUTED = "text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]";

/** The board's padded card, with the page's own h2 (SettingsCard draws an h3 for sections). */
function Card({ title, sub, action, children, labelledBy }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="min-w-0 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={labelledBy} className={H2}>{title}</h2>
          {sub && <p className={cn("mt-1", MUTED)}>{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const CELL_PILL: Record<CellStatus["kind"], { tone: PillTone; label: (status: CellStatus) => string } | null> = {
  none: null,
  appointed: { tone: "success", label: () => "Appointed" },
  expiring: { tone: "warning", label: () => `Expires <${READINESS_WINDOW_DAYS}d` },
  pending: { tone: "neutral", label: () => "Pending" },
  starts: { tone: "neutral", label: (status) => (status.kind === "starts" ? `From ${dayMonth(status.on, false)}` : "") },
  expired: { tone: "error", label: () => "Expired" },
  ended: { tone: "neutral", label: () => "Ended" },
};

export function CarrierAppointmentsPage({ canEdit, isOwner }: { canEdit: boolean; isOwner: boolean }) {
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
  const [refreshing, setRefreshing] = useState(false);

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
    const ids = new Set(vault.tenantCarriers.map((row) => row.carrier_id));
    return vault.carriers.filter((row) => ids.has(row.id));
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

  const header = (
    <PageHeader
      title="Appointments & licences"
      description="Whether you may legally write this product in this state today."
      actions={
        isOwner ? (
          <Button asChild variant="outline">
            <Link href="/app/settings#carrier-library">Connect a carrier</Link>
          </Button>
        ) : undefined
      }
    />
  );

  if (!vault) return <PageLoading />;

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

  const eoPolicy = currentEoPolicy(vault.eoPolicies, today);
  const eoDays = eoPolicy ? daysUntilExpiry(eoPolicy.expires_at, today) : null;
  const ceRecord = currentCeRecord(vault.ceRecords, today);
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
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      {!canEdit && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3 text-sm text-[var(--info-ink)]">
          View only. An owner with full access edits appointments and licences.
        </div>
      )}

      <StatStrip label="Readiness">
        <StatTile label="Readiness" value={summary.label} valueTone={summary.tone === "error" ? "danger" : summary.tone === "warning" ? "warning" : "good"} footnote={`inside ${READINESS_WINDOW_DAYS} days`} />
        <StatTile label="Appointed states" value={appointedStates.size} footnote={plural(activeAppointments.length, "active appointment")} />
        <StatTile label="Licences" value={licenceRows.length} valueTone={unlicensedAppointedStates.length ? "danger" : undefined} footnote={unlicensedAppointedStates.length ? `${plural(unlicensedAppointedStates.length, "appointed state")} unlicensed` : expiringLicences ? `${expiringLicences} need attention` : "all current"} />
        <StatTile label="E&O cover" value={eoPolicy ? (eoDays !== null && eoDays < 0 ? "Expired" : `${eoDays}d`) : "None"} valueTone={!eoPolicy || (eoDays !== null && eoDays < 0) ? "danger" : eoDays !== null && eoDays <= READINESS_WINDOW_DAYS ? "warning" : undefined} footnote={eoPolicy ? `until ${shortDate(eoPolicy.expires_at)}` : "no policy on file"} />
        <StatTile label="CE credits" value={ceRecord ? `${ceRecord.credits_completed}/${ceRecord.credits_required}` : "—"} footnote={ceRecord ? `due ${shortDate(ceRecord.deadline)}` : "no cycle recorded"} />
      </StatStrip>

      {/* Every readiness item, one line each: a fifth blocker is never dropped to keep the page tidy. */}
      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Readiness items">
          {items.map((item) => (
            <li
              key={item.key}
              className={cn(
                "rounded-lg border border-border border-l-[3px] px-4 py-3 text-sm",
                item.tone === "error"
                  ? "border-l-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]"
                  : "border-l-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
              )}
            >
              <span className="font-semibold">{item.title}</span> <span className="text-[var(--body)]">· {item.body}</span>
            </li>
          ))}
        </ul>
      )}

      {editing && canEdit ? (
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
          title="Carrier appointments by state"
          toolbar={
            <DataToolbar
              actions={<>
                {canEdit && tableCarriers.length > 0 && <Button type="button" variant="outline" onClick={() => setEditing(true)}>Edit appointments</Button>}
                {refreshButton}
              </>}
            >
              <ToolbarSearch value={carrierQuery} onChange={setCarrierQuery} placeholder="Search carriers" />
              <select aria-label="Filter states by region" className={toolbarControl} value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                <option value="">All regions</option>
                {US_REGIONS.map((region) => <option key={region.name} value={region.name}>{region.name}</option>)}
              </select>
            </DataToolbar>
          }
          footer={tableCarriers.length > 0 && footprint.length > 0 ? <span>{shownCarriers.length} of {plural(tableCarriers.length, "carrier")} · {columns.length} of {footprint.length} states · grouped by region</span> : undefined}
        >
          {tableCarriers.length === 0 ? (
            noCarrier
          ) : footprint.length === 0 ? (
            <EmptyState title="No appointment or licence recorded yet" hint={canEdit ? "Choose Edit appointments to mark the states where each carrier has appointed you." : "Appointments appear here once an owner records them."} />
          ) : shownCarriers.length === 0 || columns.length === 0 ? (
            <NoMatches noun="appointments" onClear={() => { setCarrierQuery(""); setRegionFilter(""); }} />
          ) : (
            <table className={cn(st.table, "table-fixed")} style={{ minWidth: 170 + 110 * columns.length }}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[170px]")}>Carrier</th>
                  {columns.map((code, index) => {
                    const region = regionOf(code);
                    const startsRegion = index > 0 && regionOf(columns[index - 1]) !== region;
                    return (
                      <th key={code} scope="col" className={cn(st.th, "w-[110px]", startsRegion && "border-l border-[var(--border)]")} title={`${stateName(code)}${region ? ` · ${region}` : ""}`}>
                        {code}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="m-seq">
                {shownCarriers.map((carrier) => (
                  <tr key={carrier.id}>
                    <th scope="row" className={cn(st.td, "truncate text-left font-normal")} title={carrier.name}>
                      {carrier.name}
                    </th>
                    {columns.map((code, index) => {
                      const status = appointmentCellStatus(latestByKey.get(keyFor(carrier.id, code)), today);
                      const pill = CELL_PILL[status.kind];
                      const label = pill ? pill.label(status) : "No appointment";
                      const startsRegion = index > 0 && regionOf(columns[index - 1]) !== regionOf(code);
                      const content = pill ? <Pill tone={pill.tone} dot>{label}</Pill> : <span aria-hidden className="text-[var(--muted)]">&mdash;</span>;
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
      )}

      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <TableCard
            title="State licences"
            toolbar={
              <DataToolbar
                actions={<>
                  {canEdit && (
                    <Button type="button" variant="outline" onClick={() => setDialog("license")}>
                      <Plus aria-hidden="true" />
                      Add a licence
                    </Button>
                  )}
                  {refreshButton}
                </>}
              >
                <ToolbarSearch value={licenceQuery} onChange={setLicenceQuery} placeholder="Search states, licences" />
              </DataToolbar>
            }
          >
            {licenceRows.length + unlicensedAppointedStates.length > 0 && shownLicences.length + shownUnlicensed.length === 0 ? (
              <NoMatches noun="licences" onClear={() => setLicenceQuery("")} />
            ) : (
              <table className={st.table}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[90px]")}>State</th>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Licence</th>
                    <th scope="col" className={cn(st.th, "w-[170px]")}>Lines</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Expires</th>
                    {/* The board's 130px; left to take the remainder so 90+150+170+130+130 = 670px never
                        forces a 2px scroll in the 668px the column has at 1440 wide. */}
                    <th scope="col" className={st.th}><span className="sr-only">Status</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {shownLicences.map((row) => {
                    const status = licenceStatus(row.expires_at, today);
                    return (
                      <tr key={row.id}>
                        <td className={st.td}>{stateName(row.state)}</td>
                        <td className={st.td}>{row.license_number}</td>
                        <td className={st.td}>{row.lines_of_authority?.length ? row.lines_of_authority.join(", ") : <span className="text-[var(--muted)]">Not recorded</span>}</td>
                        <td className={cn(st.td, "tabular-nums")}>{shortDate(row.expires_at)}</td>
                        <td className={st.td}><Pill tone={status.tone} dot>{status.label}</Pill></td>
                      </tr>
                    );
                  })}
                  {shownUnlicensed.map((state) => (
                    <tr key={`unlicensed-${state}`}>
                      <td className={st.td}>{stateName(state)}</td>
                      <td className={st.td}>&mdash;</td>
                      <td className={st.td}>&mdash;</td>
                      <td className={st.td}>&mdash;</td>
                      <td className={st.td} title="The agency holds an active carrier appointment here but no licence, so no lead in this state can be assigned.">
                        <Pill tone="error" dot>Not licensed</Pill>
                      </td>
                    </tr>
                  ))}
                  {licenceRows.length + unlicensedAppointedStates.length === 0 && (
                    <tr>
                      <td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>No licences recorded yet. Until one is, no lead can be assigned to an owner or producer.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </TableCard>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-6 lg:w-[420px] lg:shrink-0">
          <Card
            labelledBy="ce-heading"
            title="Continuing education"
            sub={ceRecord ? `${stateName(ceRecord.state)}, ${ceRecord.deadline >= today ? "current cycle" : "last recorded cycle"}` : undefined}
            action={
              canEdit ? (
                <span className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialog("training")}>Trainings</Button>
                  <Button type="button" variant="outline" onClick={() => setDialog("ce")}>{ceRecord ? "Edit" : <><Plus aria-hidden="true" />Add a cycle</>}</Button>
                </span>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-4">
              {!ceRecord && <p className={MUTED}>No continuing-education cycle recorded.</p>}
              <KeyValues
                items={[
                  ...(ceRecord
                    ? [
                        { label: "Credits earned", value: `${ceRecord.credits_completed} of ${ceRecord.credits_required}` },
                        { label: "Deadline", value: shortDate(ceRecord.deadline), tone: ceRecord.deadline < today ? ("error" as const) : undefined },
                        {
                          label: "Ethics credits",
                          value: ceRecord.ethics_required !== null && ceRecord.ethics_required !== undefined ? `${ceRecord.ethics_completed ?? 0} of ${ceRecord.ethics_required}` : "Not recorded",
                        },
                      ]
                    : []),
                  {
                    label: "Carrier-specific",
                    value: outstanding === null ? "Not recorded" : `${outstanding.length} outstanding`,
                    tone: overdueTrainings > 0 ? ("warning" as const) : undefined,
                  },
                ]}
              />
              {ceRecord && (
                <SettingsMeter
                  value={ceRecord.credits_completed}
                  max={ceRecord.credits_required}
                  tone={ceRecord.credits_required > 0 && ceRecord.credits_completed >= ceRecord.credits_required ? "success" : "warning"}
                  ariaLabel={`${ceRecord.credits_completed} of ${ceRecord.credits_required} credits`}
                  caption={`${ceRecord.credits_completed} of ${ceRecord.credits_required} credits`}
                />
              )}
            </div>
          </Card>

          <Card
            labelledBy="eo-heading"
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
                    tone: eoDays !== null && eoDays < 0 ? "error" : eoDays !== null && eoDays <= READINESS_WINDOW_DAYS ? "warning" : undefined,
                  },
                ]}
              />
            ) : (
              <p className={MUTED}>No E&amp;O policy on file.</p>
            )}
          </Card>
        </div>
      </div>

      {canEdit && (
        <>
          {dialog === "license" && (
            <LicenceDialog
              open
              onOpenChange={(open) => setDialog(open ? "license" : null)}
              licences={vault.licenses}
              extended={extended}
              saving={saving === "license"}
              onSave={async (payload) => save("/api/app/appointment-vault/licenses", payload, "Licence saved", "license")}
            />
          )}
          {dialog === "eo" && (
            <EoDialog
              open
              onOpenChange={(open) => setDialog(open ? "eo" : null)}
              policies={vault.eoPolicies}
              current={eoPolicy}
              extended={extended}
              saving={saving === "eo"}
              onSave={async (payload) => save("/api/app/appointment-vault/eo-policies", payload, "E&O policy saved", "eo")}
            />
          )}
          {dialog === "ce" && (
            <CeDialog
              open
              onOpenChange={(open) => setDialog(open ? "ce" : null)}
              records={vault.ceRecords}
              current={ceRecord}
              extended={extended}
              saving={saving === "ce"}
              onSave={async (payload) => save("/api/app/appointment-vault/ce-records", payload, "CE record saved", "ce")}
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
      description="Product and AML trainings a carrier requires before you sell for it, separate from the state's CE hours. Each stays outstanding until you mark it complete."
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
            const tone: PillTone = row.completed_on ? "success" : days < 0 ? "error" : days <= READINESS_WINDOW_DAYS ? "warning" : "neutral";
            const label = row.completed_on ? `Done ${shortDate(row.completed_on)}` : days < 0 ? "Overdue" : `Due ${shortDate(row.due_on)}`;
            const busy = saving === `training-${row.id}`;
            return (
              <li key={row.id} className="rounded-[8px] border border-[var(--border)] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{row.title}</span>
                    <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                      {nameOf(row.carrier_id)} &middot; due {shortDate(row.due_on)}
                    </span>
                  </span>
                  <Pill tone={tone} dot>{label}</Pill>
                  <button type="button" className={btn("row")} onClick={() => void act(row.id, () => onComplete(row.id, row.completed_on ? null : today))} disabled={busy}>
                    {row.completed_on ? "Mark outstanding" : "Mark complete"}
                  </button>
                  <button type="button" className={btn("danger-row")} onClick={() => void act(row.id, () => onRemove(row.id))} disabled={busy}>
                    Remove
                  </button>
                </div>
                {rowError?.id === row.id && (
                  <p role="alert" className="mt-1.5 text-[12px] leading-[1.5] text-[var(--error-ink)]">{rowError.message}</p>
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
