"use client";

/**
 * Settings › Carriers, settings round 8 wave 3 (board docs/design/settings-r8/team-carriers.html,
 * screens 6–11; owner "Build all four", 2026-11-12). "Set up %", the carrier card dialog and the
 * States tab were three editors of one contract; now there is one of each thing:
 *
 *   first run       with no carriers yet the page is the guided set-up (contracting-setup.tsx);
 *                   "#carriers/carriers-setup" still opens it for ticking many states at once.
 *   Carriers        one table, one line a carrier, contract health the only colour.
 *   carrier sheet   contract, products, appointed states and writers, carrier site, commission file.
 *   + Add carrier   the first-run steps as a dialog: carrier → contract → states and writers.
 *   States          the appointment matrix, states down and carriers across, filterable by writer.
 *
 * The Field maps tab is gone: each carrier's map opens from its sheet ("Open the field map");
 * "#carriers/carriers-maps" still lands on it.
 */

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { carrierProgress } from "@/components/app/settings/carrier-card";
import { CarrierFieldMaps } from "@/components/app/settings/carrier-field-maps";
import { ContractingSetup } from "@/components/app/settings/contracting-setup";
import { AddCarrierDialog, type NewCarrier } from "@/components/app/settings/carriers/add-carrier-dialog";
import { CarrierSheet, type CarrierHealth } from "@/components/app/settings/carriers/carrier-sheet";
import { sendJson, writersFor, type FileSummary, type RateFacts, type Sales, type Vault, type Writer } from "@/components/app/settings/carriers/model";
import { StatesMatrix } from "@/components/app/settings/carriers/states-matrix";
import { InlineLink, StatusLine, rowOpen, type LineTone } from "@/components/app/settings/team/parts";
import {
  applyAppointmentChanges, appointedStatesFor, appointmentChange, bpToLevel, carriersIn, forServer, levelToBp, licenceExpiryValue, licenceNumberValue, pendingStatesFor, todayIso,
} from "@/lib/appointments/tickModel";
import { dayMonth } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";

type Tab = "carriers" | "states";
type Note = { tone: LineTone; text: string; retry?: () => void } | null;

const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
const PANES = "grid min-h-0 items-start gap-4 md:grid-cols-[280px_minmax(0,1fr)] [&>*]:max-h-[70vh]";
const PANE = cardSurface;

export function CarriersSettings() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [sales, setSales] = useState<Sales>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("carriers");
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [setupSearch, setSetupSearch] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [mapFor, setMapFor] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [writers, setWriters] = useState<Writer[] | null>(null);
  const [files, setFiles] = useState<Map<string, FileSummary> | null>(null);
  const [rates, setRates] = useState<Map<string, RateFacts> | null>(null);
  const touched = useRef(new Set<string>());
  const today = todayIso();

  const loadVault = useCallback(async (isStale?: () => boolean) => {
    const response = await fetch("/api/app/appointment-vault", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setLoadError(body?.error ?? "Could not load your carriers"); return null; }
    if (isStale?.()) return null;
    setLoadError(null);
    setVault(body as Vault);
    return body as Vault;
  }, []);
  // Products, the portal and field maps come from Settings › Sales (the Applications feature); without it they are left out.
  const loadSales = useCallback(async () => {
    const response = await fetch("/api/app/settings/sales/carriers", { cache: "no-store" });
    setSales(response.ok ? ((await response.json().catch(() => null)) as Sales) : null);
  }, []);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the section's external data, loaded once
    void loadVault().then((fresh) => { if (live && fresh) setFirstRun((current) => current ?? activeIds(fresh).size === 0); });
    void loadSales();
    // Garnish, each on its own: writers (owners read the team), the last commission file per carrier, and the Rate card's figures.
    void fetch("/api/app/team", { cache: "no-store" }).then(async (response) => {
      if (!live || !response.ok) return;
      const body = await response.json().catch(() => null) as { members?: { id: string; name: string; role: string; status: string; acceptedAt: string | null; licensedStates?: string[] }[] } | null;
      setWriters((body?.members ?? []).filter((m) => m.acceptedAt && m.status === "active" && (m.role === "owner" || m.role === "producer")).map((m) => ({ id: m.id, name: m.name, states: m.licensedStates ?? [] })).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => undefined);
    void fetch("/api/app/carrier-files", { cache: "no-store" }).then(async (response) => {
      if (!live || !response.ok) return;
      const body = await response.json().catch(() => null) as { available?: boolean; files?: { carrierId: string | null; fileDate: string | null; receivedAt: string; rowCount: number | null; waitingForLayout?: boolean; heldRows?: number; supersededByFileId: string | null }[] } | null;
      if (!body?.available) return;
      const latest = new Map<string, FileSummary>();
      for (const file of body.files ?? []) {
        if (!file.carrierId || file.supersededByFileId || latest.has(file.carrierId)) continue;
        latest.set(file.carrierId, { date: file.fileDate ?? file.receivedAt.slice(0, 10), rows: file.rowCount, needsMatching: Boolean(file.waitingForLayout) || (file.heldRows ?? 0) > 0, held: file.heldRows ?? 0 });
      }
      setFiles(latest);
    }).catch(() => undefined);
    void fetch("/api/app/carrier-library", { cache: "no-store" }).then(async (response) => {
      if (!live || !response.ok) return;
      const body = await response.json().catch(() => null) as { advanceRules?: { carrier_id: string; advance_months: number; clawback_months: number; effective_from: string }[]; commissionSchedules?: { carrier_id: string; policy_year: number; rate_bp: number; effective_from: string }[] } | null;
      const map = new Map<string, RateFacts>();
      const byDate = <T extends { effective_from: string }>(rows: T[]) => [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      for (const rule of byDate(body?.advanceRules ?? []).filter((row) => row.effective_from <= todayIso())) {
        if (!map.has(rule.carrier_id)) map.set(rule.carrier_id, { renewalPct: null, advanceMonths: rule.advance_months, chargebackMonths: rule.clawback_months });
      }
      for (const row of byDate(body?.commissionSchedules ?? []).filter((item) => item.policy_year === 2 && item.effective_from <= todayIso())) {
        const current = map.get(row.carrier_id) ?? { renewalPct: null, advanceMonths: null, chargebackMonths: null };
        if (current.renewalPct === null) map.set(row.carrier_id, { ...current, renewalPct: row.rate_bp / 100 });
      }
      setRates(map);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [loadVault, loadSales]);

  // "#carriers/carriers-states" opens States, "#carriers/carriers-setup" the guided set-up, "#carriers/carriers-maps" a field map.
  const loaded = vault !== null;
  useEffect(() => {
    if (!loaded) return;
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== "carriers") return;
      if (anchor === "carriers-states") setTab("states");
      else if (anchor === "carriers-setup") setFirstRun(true);
      else if (anchor === "carriers-maps") setMapFor("first");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [loaded]);

  const off = useMemo(() => new Set((vault?.carrierRequirements ?? []).filter((row) => row.contracted === false).map((row) => row.carrier_id)), [vault]);
  const yours = useMemo(() => {
    if (!vault) return [];
    const added = activeIds(vault);
    // Switched-off carriers sit at the bottom: still yours (history and money stay), not sold now.
    return vault.carriers.filter((carrier) => added.has(carrier.id)).sort((a, b) => Number(off.has(a.id)) - Number(off.has(b.id)) || a.name.localeCompare(b.name));
  }, [vault, off]);
  const selling = yours.filter((carrier) => !off.has(carrier.id));
  const salesOf = (id: string) => sales?.carriers.find((row) => row.id === id) ?? null;
  const contractOf = (id: string) => vault?.tenantCarriers.find((row) => row.carrier_id === id && row.is_active) ?? null;
  const canEdit = sales?.canEdit ?? true;

  /** Ticking a carrier in a state records the licence there too; unticking the last carrier takes back a bare licence (the set-up's rule). */
  async function syncLicences(fresh: Vault, states: string[], isStale?: () => boolean) {
    const held = new Map(fresh.licenses.map((row) => [row.state, row]));
    const changes = states.flatMap((code) => {
      const here = carriersIn(fresh.appointments, code, today).length;
      const row = held.get(code);
      if (here > 0 && !row) return [{ code, add: true }];
      if (here === 0 && row && !licenceNumberValue(row.license_number) && !licenceExpiryValue(row.expires_at)) return [{ code, add: false }];
      return [];
    });
    for (let start = 0; start < changes.length; start += 6) {
      const results = await Promise.all(changes.slice(start, start + 6).map((change) => change.add
        ? sendJson("/api/app/appointment-vault/licenses", "POST", { state: change.code })
        : sendJson(`/api/app/appointment-vault/licenses?state=${change.code}`, "DELETE")));
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) { notify.block(failed.error); break; }
    }
    if (changes.length) await loadVault(isStale);
  }

  async function afterSetupSaves(isStale?: () => boolean) {
    const fresh = await loadVault(isStale);
    if (fresh && touched.current.size) await syncLicences(fresh, [...touched.current], isStale);
    if (!isStale?.()) touched.current.clear();
    await loadSales();
  }

  async function setAppointment(state: string, carrierId: string, on: boolean) {
    if (!vault) return;
    const changes = appointmentChange(vault.appointments, carrierId, state, on, today);
    if (!changes.length) return;
    setNote(null);
    setVault((current) => (current ? { ...current, appointments: applyAppointmentChanges(current.appointments, changes, today) } : current));
    const result = await sendJson("/api/app/appointment-vault/appointments", "POST", { appointments: forServer(changes) });
    const fresh = await loadVault();
    if (!result.ok) { setNote({ tone: "bad", text: `Couldn't save the appointment. ${result.error}`, retry: () => void setAppointment(state, carrierId, on) }); return; }
    if (fresh) await syncLicences(fresh, [state]);
  }

  async function addCarrier(input: NewCarrier): Promise<string | null> {
    const name = vault?.carriers.find((carrier) => carrier.id === input.carrierId)?.name ?? "The carrier";
    const on = await sendJson("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: input.carrierId, contracted: true });
    if (!on.ok) return on.error;
    if (sales !== null) {
      const listed = await sendJson("/api/app/settings/sales/carriers", "POST", { carrier_id: input.carrierId });
      if (!listed.ok && !/already on your list/i.test(listed.error)) notify.warn(`Products could not be loaded for ${name}`, { detail: "The carrier is added. Open its sheet to try again." });
    }
    const later: string[] = [];
    if (input.level.trim()) {
      const contract = await sendJson("/api/app/carrier-library/tenant-carriers", "POST", { carrier_id: input.carrierId, contract_level_bp: levelToBp(input.level), writing_number: input.writing.trim(), effective_from: input.from });
      if (!contract.ok) later.push(`the contract (${contract.error})`);
    }
    let fresh = await loadVault();
    if (fresh && input.states.length) {
      const changes = input.states.flatMap((code) => appointmentChange(fresh?.appointments ?? [], input.carrierId, code, true, today));
      const saved = changes.length ? await sendJson("/api/app/appointment-vault/appointments", "POST", { appointments: forServer(changes) }) : { ok: true as const, data: null };
      if (!saved.ok) later.push(`the states (${saved.error})`);
      fresh = await loadVault();
      if (fresh) await syncLicences(fresh, input.states);
    }
    await loadSales();
    setAdding(false);
    setTab("carriers");
    setOpenId(input.carrierId);
    if (later.length) setNote({ tone: "warn", text: `${name} is added, but ${later.join(" and ")} did not save. Fix it in its sheet.` });
    else notify.done(`${name} is added. Pick its products in its sheet.`);
    return null;
  }

  // ── the page ───────────────────────────────────────────────────────────────────────────────────
  if (!vault) {
    return (
      <SettingsStack className="gap-4 lg:min-h-0 lg:flex-1">
        <SettingsSectionHeader />
        {loadError ? (
          <>
            <StatusLine tone="bad">Couldn&rsquo;t load your carriers · <InlineLink onClick={() => void loadVault()}>Try again</InlineLink></StatusLine>
            <TableCard title="Carriers"><ErrorState title="Couldn't load your carriers" detail={loadError} action={<Button type="button" variant="outline" onClick={() => void loadVault()}>Try again</Button>} /></TableCard>
          </>
        ) : (
          <>
            <StatusLine tone="muted">Reading your carriers</StatusLine>
            <TableCard title="Carriers"><SectionLoading label="Loading your carriers" rows={5} columns={6} /></TableCard>
          </>
        )}
      </SettingsStack>
    );
  }

  const openTarget = (target: "setup" | "states" | "maps") => (target === "states" ? setTab("states") : target === "setup" ? setFirstRun(true) : setMapFor("first"));
  const deepLinks = (["setup", "states", "maps"] as const).map((target) => (
    <button key={target} id={`carriers-${target}`} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" onClick={() => openTarget(target)} onFocus={() => openTarget(target)} />
  ));

  // First run: the guided set-up is the page until it is finished or skipped.
  if (firstRun) {
    return (
      <SettingsStack className="gap-4">
        <SettingsSectionHeader actions={<><ToolbarSearch value={setupSearch} onChange={setSetupSearch} placeholder="Find a carrier or state" className="sm:w-60" /><Button type="button" variant="ghost" onClick={() => { setFirstRun(false); if (window.location.hash.includes("carriers-setup")) window.location.hash = "#carriers"; }}>{yours.length ? "Done" : "Skip for now"}</Button></>} />
        {deepLinks}
        <StatusLine tone={selling.length ? "ok" : "warn"}>
          {selling.length ? `${selling.length} ${selling.length === 1 ? "carrier" : "carriers"} picked · saved as you tick` : "No carriers yet · quotes, appointments and commission files need at least one"}
        </StatusLine>
        <div data-guide="carrier-library-add" className="min-w-0">
          <ContractingSetup
            vault={vault}
            setVault={(update) => setVault((current) => (current ? { ...current, ...update(current) } : current))}
            salesAvailable={sales !== null}
            send={sendJson}
            reload={afterSetupSaves}
            onStatesSaved={async (codes) => { for (const code of codes) touched.current.add(code); }}
            search={setupSearch}
            onFinish={() => {
              notify.done("Carriers are set up", { detail: "Change a carrier in its sheet, or a state on States." });
              setFirstRun(false);
              setTab("carriers");
            }}
          />
        </div>
      </SettingsStack>
    );
  }

  const appointedAll = new Set(selling.flatMap((carrier) => appointedStatesFor(vault.appointments, carrier.id, today)));
  // Ready means appointed (active), not applied for: pending is shown but never counts (eligibility.ts).
  const progressOf = (carrierId: string) => carrierProgress(contractOf(carrierId), salesOf(carrierId), sales !== null, appointedStatesFor(vault.appointments, carrierId, today), pendingStatesFor(vault.appointments, carrierId, today));
  const health = (id: string): CarrierHealth => {
    if (off.has(id)) return { tone: "neutral", label: "Switched off" };
    const file = files?.get(id);
    if (file?.needsMatching) return { tone: "warning", label: "File needs matching" };
    const appointed = appointedStatesFor(vault.appointments, id, today);
    const pending = pendingStatesFor(vault.appointments, id, today).filter((code) => !appointed.includes(code));
    if (pending.length) return { tone: "info", label: `${pending.length} ${pending.length === 1 ? "appointment" : "appointments"} pending` };
    const progress = progressOf(id);
    if (!progress.states) return { tone: "warning", label: "Needs states" };
    if (progress.products === false) return { tone: "warning", label: "Needs products" };
    return { tone: "good", label: "Active" };
  };

  const needle = query.trim().toLowerCase();
  const shown = yours.filter((carrier) => !needle || carrier.name.toLowerCase().includes(needle) || (salesOf(carrier.id)?.products ?? []).some((product) => product.isActive && product.name.toLowerCase().includes(needle)));
  const problem = selling.map((carrier) => ({ carrier, h: health(carrier.id) })).find(({ h }) => h.tone === "warning");
  const pendingTotal = selling.reduce((sum, carrier) => sum + pendingStatesFor(vault.appointments, carrier.id, today).filter((code) => !appointedStatesFor(vault.appointments, carrier.id, today).includes(code)).length, 0);

  let tone: LineTone = problem ? "warn" : selling.length ? "ok" : "muted";
  let line: React.ReactNode = (
    <>
      {selling.length} {selling.length === 1 ? "carrier" : "carriers"} · appointed in {appointedAll.size} {appointedAll.size === 1 ? "state" : "states"}
      {tab === "states" && pendingTotal > 0 ? ` · ${pendingTotal} ${pendingTotal === 1 ? "appointment" : "appointments"} pending` : ""}
      {problem ? <> · {problem.carrier.name}: {problem.h.label.toLowerCase()} · <InlineLink onClick={() => setOpenId(problem.carrier.id)}>open it</InlineLink></> : null}
    </>
  );
  if (note) { tone = note.tone; line = <>{note.text}{note.retry && <> · <InlineLink onClick={note.retry}>Try again</InlineLink></>}</>; }

  const current = openId ? yours.find((carrier) => carrier.id === openId) ?? null : null;
  const mapCarrierId = mapFor === "first" ? selling[0]?.id ?? null : mapFor;
  const addButton = canEdit ? <Button type="button" variant="highlight" onClick={() => { setNote(null); setAdding(true); }}><Plus aria-hidden="true" />Add carrier</Button> : undefined;

  return (
    <SettingsStack className="gap-4 lg:min-h-0 lg:flex-1">
      <SettingsSectionHeader
        tabs={
          <UnderlineTabs
            label="Carriers"
            value={tab}
            onChange={(next) => { setTab(next); const hash = next === "states" ? "#carriers/carriers-states" : "#carriers"; if (window.location.hash !== hash) window.history.replaceState(null, "", hash); }}
            tabs={[{ key: "carriers" as const, label: "Carriers", count: yours.length }, { key: "states" as const, label: "States" }]}
          />
        }
        actions={addButton}
      />
      {deepLinks}
      <StatusLine tone={tone}>{line}</StatusLine>

      {tab === "carriers" && (
        <TableCard
          className="lg:min-h-0 lg:flex-1"
          bodyClassName="min-h-[200px] overflow-y-auto lg:min-h-0"
          title="Carriers"
          action={yours.length > 0 ? <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a carrier or product" className="sm:w-56" /> : undefined}
          footer={yours.length > 0 ? <span className="text-xs text-[var(--muted)]">Click a carrier to change its contract, products, states and commission file in one place · <InlineLink onClick={() => setFirstRun(true)}>tick many states at once</InlineLink></span> : undefined}
        >
          {yours.length === 0 ? (
            <EmptyState title="No carriers yet" hint="Quotes, appointments and commission files need at least one." action={canEdit ? <Button type="button" variant="outline" onClick={() => setFirstRun(true)}>Start the set-up</Button> : undefined} />
          ) : shown.length === 0 ? (
            <NoMatches noun="carriers" onClear={() => setQuery("")} />
          ) : (
            <table className={cn(st.table, "min-w-[900px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Carrier</th>
                  {sales !== null && <th scope="col" className={st.th}>Products</th>}
                  <th scope="col" className={cn(st.th, st.num)}>Your % first year</th>
                  <th scope="col" className={st.th}>Appointed in</th>
                  {writers && <th scope="col" className={cn(st.th, st.num)}>Writers</th>}
                  {files && <th scope="col" className={st.th}>Last commission file</th>}
                  <th scope="col" className={st.th}>Contract</th>
                  <th scope="col" className={cn(st.th, "w-8")}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((carrier) => {
                  const contract = contractOf(carrier.id);
                  const appointed = appointedStatesFor(vault.appointments, carrier.id, today);
                  const sold = (salesOf(carrier.id)?.products ?? []).filter((product) => product.isActive).map((product) => product.name);
                  const h = health(carrier.id);
                  const file = files?.get(carrier.id);
                  return (
                    <tr key={carrier.id} {...rowOpen(() => { setNote(null); setOpenId(carrier.id); })} aria-label={`Open ${carrier.name}`}>
                      <td className={cn(st.td, "font-semibold whitespace-nowrap text-[var(--ink)]")}>{carrier.name}</td>
                      {sales !== null && <td className={cn(st.td, "max-w-[260px] truncate whitespace-nowrap")} title={sold.join(", ")}>{sold.length ? (sold.length > 2 ? `${sold.slice(0, 2).join(", ")} +${sold.length - 2}` : sold.join(", ")) : <span className="text-[var(--muted)]">{(salesOf(carrier.id)?.products.length ?? 0) > 0 ? "None ticked" : "—"}</span>}</td>}
                      <td className={cn(st.td, st.num)}>{contract ? `${bpToLevel(contract.contract_level_bp)}%` : <span className="text-[var(--muted)]">—</span>}</td>
                      <td className={cn(st.td, "whitespace-nowrap")} title={appointed.join(", ")}>{appointed.length ? `${appointed.length} ${appointed.length === 1 ? "state" : "states"}` : <span className="text-[var(--muted)]">None yet</span>}</td>
                      {writers && <td className={cn(st.td, st.num)}>{writersFor(writers, appointed).length}</td>}
                      {files && <td className={cn(st.td, "whitespace-nowrap")}>{file ? dayMonth(`${file.date}T12:00:00Z`, "UTC") : <span className="text-[var(--muted)]">None yet</span>}</td>}
                      <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={h.tone}>{h.label}</StatusChip></td>
                      <td className={cn(st.td, "text-[var(--muted)]")} aria-hidden="true">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {tab === "states" && (
        <StatesMatrix carriers={selling} appointments={vault.appointments} today={today} writers={writers} canEdit={canEdit} onToggle={setAppointment} onAddCarrier={() => setAdding(true)} />
      )}

      {current && (
        <CarrierSheet
          key={`${current.id}:${contractOf(current.id)?.id ?? "none"}:${salesOf(current.id)?.portal?.id ?? "none"}`}
          carrier={current}
          contract={contractOf(current.id)}
          health={health(current.id)}
          switchedOff={off.has(current.id)}
          states={appointedStatesFor(vault.appointments, current.id, today)}
          pendingStates={pendingStatesFor(vault.appointments, current.id, today).filter((code) => !appointedStatesFor(vault.appointments, current.id, today).includes(code))}
          sales={salesOf(current.id)}
          salesAvailable={sales !== null}
          productLines={sales?.productLines ?? []}
          canEdit={canEdit}
          writers={writers}
          lastFile={files?.get(current.id) ?? null}
          filesKnown={files !== null}
          rates={rates?.get(current.id) ?? null}
          onOpenStates={() => { setOpenId(null); setTab("states"); }}
          onOpenMap={sales !== null ? () => setMapFor(current.id) : null}
          onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
          onClose={() => setOpenId(null)}
          onError={(text, retry) => setNote(text ? { tone: "bad", text, retry } : null)}
        />
      )}

      {adding && (
        <AddCarrierDialog
          choices={vault.carriers.filter((carrier) => !selling.some((mine) => mine.id === carrier.id)).map((carrier) => ({ id: carrier.id, name: carrier.name, off: off.has(carrier.id) })).sort((a, b) => a.name.localeCompare(b.name))}
          writers={writers}
          defaultStates={[...appointedAll].sort()}
          onClose={() => setAdding(false)}
          onAdd={addCarrier}
        />
      )}

      {mapCarrierId && sales !== null && (
        <Dialog open onOpenChange={(value) => { if (!value) { setMapFor(null); if (window.location.hash.includes("carriers-maps")) window.history.replaceState(null, "", "#carriers"); } }}>
          <DialogContent size="2xl" className="max-h-[90vh] overflow-y-auto">
            <DialogTitle>Field maps · where the extension fills each answer</DialogTitle>
            <div className={PANES}>
              <CarrierFieldMaps
                carriers={selling.map((carrier, index) => ({
                  id: carrier.id, name: carrier.name, dot: DOTS[index % DOTS.length], level: contractOf(carrier.id) ? String(bpToLevel(contractOf(carrier.id)?.contract_level_bp)) : null,
                  products: (salesOf(carrier.id)?.products ?? []).filter((product) => product.isActive).map((product) => product.name),
                  states: appointedStatesFor(vault.appointments, carrier.id, today).length,
                }))}
                currentId={mapCarrierId}
                onPick={setMapFor}
                listCard={(children) => <div className={cn(PANE, "flex min-h-0 flex-col gap-2.5 p-3.5")}>{children}</div>}
                listBody={(children) => <div className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5">{children}</div>}
                cardClass={cn(PANE, "overflow-y-auto")}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </SettingsStack>
  );
}

/** The carriers the agency has: a contract row or a switch row (on or off). */
function activeIds(vault: Vault) {
  return new Set<string>([
    ...vault.tenantCarriers.filter((row) => row.is_active).map((row) => row.carrier_id),
    ...(vault.carrierRequirements ?? []).map((row) => row.carrier_id),
  ]);
}
