"use client";

/**
 * Settings › Carriers (owner pick D, 2026-10-26): one place, three steps, one layout. A full-height
 * list on the left, the picked item's card on the right.
 *
 * 1 · Your carriers — LA-0.4: contract level and start date (tenant_carriers, saved
 *     effective-dated), LA-3.17: the products you sell with each one, and LA-3.13's field-map status.
 * 2 · States — LA-0.5 / LA-3.6: pick a state (or tick several) and tick which carriers appointed you
 *     there. A tick saves an active appointment from today; an untick ends it today (never deleted).
 *
 * Replaces Carrier library and States & licences (licences themselves stay on /app/appointments,
 * owner 2026-10-26). E&O and continuing education were removed from the platform the same day.
 *
 * 2026-10-27 (owner, "one carrier, one place"): Carrier details is folded into the carrier card
 * (carrier-card.tsx): the writing number, the agency's portal login, the carrier facts Insurvas keeps
 * (read-only) and the products. Each carrier in the list shows how much of its setup is done; Add
 * carrier opens the new carrier at the first thing to finish.
 *
 * 3 · Field maps (owner pick B, 2026-10-27, as a tab): each carrier's autofill state and its field map,
 * replacing Settings › Carrier field maps (carrier-field-maps.tsx). Building a map on the carrier's
 * page is the extension's (later).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Callout, SettingsCard, SettingsSectionHeader, SettingsStack, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { CarrierCard, ProgressLine, carrierProgress } from "@/components/app/settings/carrier-card";
import { CarrierFieldMaps } from "@/components/app/settings/carrier-field-maps";
import { SettingsRailTabs } from "@/components/ui/settings-rail-tabs";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import type { CarrierSetupDraftRow, TenantCarrierRow } from "@/lib/carriers/service";
import {
  appointmentChange, bpToLevel, carriersIn, coverage, currentAppointment, levelToBp, statesFor, todayIso,
  type AppointmentChange,
} from "@/lib/appointments/tickModel";
import type { CarriersPayload } from "@/lib/salesSettings/views";
import type { FactReportView } from "@/lib/carriers/factReportConstants";

type Vault = {
  carriers: { id: string; name: string }[];
  tenantCarriers: TenantCarrierRow[];
  carrierSetupDrafts: CarrierSetupDraftRow[];
  carrierSetupDraftsAvailable: boolean;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  extendedFields: boolean;
  carrierRequirements: { carrier_id: string; contracted: boolean }[] | null;
};
type Sales = (Omit<CarriersPayload, "canEdit"> & { canEdit: boolean }) | null;
/** "rules" is a link tab to /app/carrier-rules, never a step shown here. */
type Step = "carriers" | "states" | "advanced" | "maps" | "rules";
type Filter = "all" | "yes" | "no";

function ContractSetupFields({ carrier, contract, draft, draftsAvailable, writingFallback, canEdit, onSaved }: {
  carrier: { id: string; name: string };
  contract: TenantCarrierRow | null;
  draft: CarrierSetupDraftRow | null;
  draftsAvailable: boolean;
  writingFallback: string | null;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [level, setLevel] = useState(() => draft?.contract_level_text ?? bpToLevel(contract?.contract_level_bp));
  const [from, setFrom] = useState(() => draft?.effective_from ?? contract?.effective_from ?? "");
  const [writing, setWriting] = useState(() => draft?.writing_number ?? contract?.writing_number ?? writingFallback ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  const levelBad = level.trim() !== "" && levelToBp(level) === null;
  const hasContract = Boolean(level.trim() && from && writing.trim() && levelToBp(level) !== null);

  useEffect(() => {
    const currentRevision = ++revision.current;
    if (contract && levelToBp(level) === contract.contract_level_bp && from === contract.effective_from && writing.trim() === contract.writing_number) return;
    if (!level.trim() && !from && !writing.trim() && !draft) return;
    const timer = window.setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (revision.current !== currentRevision) return;
        setStatus("saving");
        setError(null);
        const payload = {
          carrier_id: carrier.id,
          contract_level_text: level.trim() || null,
          effective_from: from || null,
          writing_number: writing.trim() || null,
        };
        if (hasContract) {
          const contractSave = await send("/api/app/carrier-library/tenant-carriers", "POST", {
            carrier_id: carrier.id,
            contract_level_bp: levelToBp(level),
            effective_from: from,
            writing_number: writing.trim(),
          });
          if (!contractSave.ok) { setStatus("idle"); setError(contractSave.error); return; }
          if (draft) {
            const clearDraft = await send("/api/app/carrier-library/setup-drafts", "PATCH", {
              carrier_id: carrier.id, contract_level_text: null, effective_from: null, writing_number: null,
            });
            if (!clearDraft.ok) setError(`Contract saved. The old setup draft could not be cleared: ${clearDraft.error}`);
          }
          setStatus("saved");
          await onSaved();
          return;
        }
        const draftSave = await send("/api/app/carrier-library/setup-drafts", "PATCH", payload);
        if (!draftSave.ok) { setStatus("idle"); setError(draftSave.error); return; }
        setStatus("saved");
      }).catch(() => { setStatus("idle"); setError("Could not save these setup details. Try again."); });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [carrier.id, contract, draft, draftsAvailable, from, hasContract, level, onSaved, writing]);

  return (
    <div className="ml-5 mt-1.5 flex flex-col gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--body)]">Contract details <span className="font-normal text-[var(--muted)]">· optional</span></span>
        <span aria-live="polite" className="text-xs text-[var(--muted)]">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={FIELD}>Contract level (optional)
          <span className="relative"><input id={`carrier-${carrier.id}-level`} className={cn(control, "mt-0 pr-7")} inputMode="decimal" disabled={!canEdit} aria-invalid={levelBad || undefined} value={level} onChange={(event) => setLevel(event.target.value)} placeholder="110" /><span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[var(--muted)]">%</span></span>
        </label>
        <label className={FIELD}>Contracted from (optional)
          <input className={cn(control, "mt-0")} type="date" disabled={!canEdit} value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className={FIELD}>Writing number (optional)
          <input className={cn(control, "mt-0")} disabled={!canEdit} value={writing} autoComplete="off" spellCheck={false} placeholder="e.g. TA-20914" onChange={(event) => setWriting(event.target.value)} />
        </label>
      </div>
      {levelBad && <p className="m-0 text-xs text-[var(--error-ink)]">Enter the contract level as a number, such as 110.</p>}
      {error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{error}</p>}
      {!draftsAvailable && !error && <p className="m-0 text-xs text-[var(--warning-ink)]">Saving incomplete details needs the pending carrier setup update. Complete and save all three fields to record a contract.</p>}
      {!hasContract && !error && <p className="m-0 text-xs text-[var(--muted)]">Incomplete details save as a private setup draft. A contract is recorded only after all three fields are complete.</p>}
    </div>
  );
}

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
/** Each carrier's dot, by its place in your list. Tokens only. */
const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
/** A quiet scrollbar for the long lists (owner, 2026-10-26: not the browser's white one). */
const SCROLL =
  "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
/** The two panes fill the screen on desktop; on a phone they stack and the list scrolls in place. */
const PANES = "grid gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-250px)] lg:grid-cols-[360px_minmax(0,1fr)]";
/** Opaque Settings surface: keep controls readable over every app background. */
const CARD = "rounded-[12px] border border-[var(--border)] bg-[var(--surface)]";
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const FIELD = "flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]";
const CHIP = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:border-[var(--accent-ink)]");
const BOX = (state: "all" | "some" | "none") =>
  cn("inline-grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] text-xs font-bold leading-none",
    state === "all" ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : state === "some" ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-transparent");

async function send(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return response.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string } | null)?.error ?? "That could not be saved" };
}

function Label({ id, text, hint }: { id: string; text: string; hint: string }) {
  return <span className="flex items-center gap-0.5">{text}<HoverHint id={id} label={`What ${text.toLowerCase()} needs`}>{hint}</HoverHint></span>;
}

function Kicker({ id, text, hint }: { id: string; text: string; hint?: string }) {
  return <span className={KICKER}>{text}{hint && <HoverHint id={id} label={`About ${text.toLowerCase()}`}>{hint}</HoverHint>}</span>;
}

/** `carrierRules`: the agency has carrier rules (statement ingestion), so the Carrier rules tab is shown. */
export function CarriersSettings({ carrierRules = false }: { carrierRules?: boolean } = {}) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [sales, setSales] = useState<Sales>(null);
  const [reports, setReports] = useState<{ reports: FactReportView[]; available: boolean }>({ reports: [], available: false });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("carriers");
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  // The two panes fill exactly what is left of the screen, so the page itself does not scroll
  // (owner, 2026-10-26); only the lists and cards inside scroll. Desktop only: a phone stacks them.
  const panes = useRef<HTMLDivElement | null>(null);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const fit = useCallback(() => {
    const element = panes.current;
    if (!element || window.innerWidth < 1024) { setPaneHeight(null); return; }
    // From the panes' own top to the bottom of the window, less the page's 32px bottom padding (lg:p-8).
    // Not from the document height, which other columns (the settings rail) can stretch.
    const top = element.getBoundingClientRect().top + window.scrollY;
    setPaneHeight(Math.max(420, Math.round(window.innerHeight - top - 32)));
  }, []);

  const loadVault = useCallback(async () => {
    const response = await fetch("/api/app/appointment-vault", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setLoadError(body?.error ?? "Could not load your carriers"); return null; }
    setLoadError(null);
    setVault(body as Vault);
    return body as Vault;
  }, []);
  // Products and field maps come from Settings › Sales (the Applications feature). Without it the
  // carrier card simply leaves those two parts out.
  const loadSales = useCallback(async () => {
    const response = await fetch("/api/app/settings/sales/carriers", { cache: "no-store" });
    setSales(response.ok ? ((await response.json().catch(() => null)) as Sales) : null);
  }, []);
  // The agency's reports to Insurvas (20261027200000). Until that is applied, available stays false
  // and Tell us writes an email instead.
  const loadReports = useCallback(async () => {
    const response = await fetch("/api/app/carrier-fact-reports", { cache: "no-store" });
    if (response.ok) setReports((await response.json()) as { reports: FactReportView[]; available: boolean });
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the section's external data, loaded once
  useEffect(() => { void loadVault(); void loadSales(); void loadReports(); }, [loadVault, loadSales, loadReports]);
  const loaded = vault !== null;
  useEffect(() => {
    if (!loaded) return;
    // Whatever sits above the panes (the header, the rail's badges) settles after this mounts, so
    // measure again whenever the page's layout changes. The height depends only on where the panes
    // start, so setting it cannot loop.
    const timer = window.setTimeout(fit, 0);
    const observer = new ResizeObserver(() => fit());
    observer.observe(document.body);
    window.addEventListener("resize", fit);
    return () => { window.clearTimeout(timer); observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [fit, loaded, step]);
  // "#carriers/carriers-maps" (and old "#sales-field-maps") opens Field maps, "#carriers/carriers-states"
  // opens States. Read from the link itself too: the hidden buttons below only hear it when the page has focus.
  useEffect(() => {
    if (!loaded) return;
    const fromHash = () => {
      const { tab, anchor } = parseSettingsHash(window.location.hash);
      if (tab !== "carriers") return;
      if (anchor === "carriers-maps") setStep("maps");
      else if (anchor === "carriers-states") setStep("states");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [loaded]);

  const yours = useMemo(() => {
    if (!vault) return [];
    const added = new Set<string>([
      ...vault.tenantCarriers.filter((row) => row.is_active).map((row) => row.carrier_id),
      ...(vault.carrierRequirements ?? []).map((row) => row.carrier_id),
    ]);
    // Switched-off carriers sit at the bottom: still yours (their history and money stay), not sold now.
    const off = new Set((vault.carrierRequirements ?? []).filter((row) => row.contracted === false).map((row) => row.carrier_id));
    return vault.carriers.filter((carrier) => added.has(carrier.id)).sort((a, b) => Number(off.has(a.id)) - Number(off.has(b.id)));
  }, [vault]);
  const dotOf = (id: string) => DOTS[Math.max(0, yours.findIndex((carrier) => carrier.id === id)) % DOTS.length];
  const salesOf = (id: string) => sales?.carriers.find((row) => row.id === id) ?? null;

  if (!vault) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {loadError ? <Callout tone="error" title={loadError} /> : <div className={CARD}><SectionLoading label="Loading your carriers" /></div>}
      </SettingsStack>
    );
  }

  const appointedStates = new Set(vault.appointments.filter((row) => carriersIn([row], row.state, today).length).map((row) => row.state));
  const carrierProgressRows = yours.map((carrier) => carrierProgress(vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active) ?? null, salesOf(carrier.id), sales !== null, statesFor(vault.appointments, carrier.id, today)));
  const readyCount = carrierProgressRows.filter((progress) => progress.ready).length;
  const progressDone = carrierProgressRows.reduce((sum, progress) => sum + progress.done, 0);
  const progressTotal = carrierProgressRows.reduce((sum, progress) => sum + progress.total, 0);
  const progressPercent = progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0;
  const current = yours.find((carrier) => carrier.id === carrierId) ?? yours[0] ?? null;
  const pickedStates = selected.length ? selected : [];

  async function saveAppointments(rows: AppointmentChange[]) {
    if (!rows.length) return;
    const before = vault?.appointments ?? [];
    const stamped = new Date().toISOString();
    const optimistic = rows.map((change) => {
      const existing = change.id ? before.find((row) => row.id === change.id) : undefined;
      const terminatedAt = change.terminated_at ?? null;
      return existing
        ? {
            ...existing, ...change, id: existing.id,
            terminated_at: terminatedAt,
            updated_at: stamped,
          }
        : {
            id: `optimistic-${change.carrier_id}-${change.state}`, tenant_id: "", carrier_id: change.carrier_id,
            state: change.state, status: change.status, effective_from: change.effective_from,
            terminated_at: terminatedAt,
            created_at: stamped, updated_at: stamped,
          };
    });
    if (vault) setVault({ ...vault, appointments: [...before.filter((row) => !optimistic.some((next) => next.id === row.id)), ...optimistic] });
    setBusy(true);
    const result = await send("/api/app/appointment-vault/appointments", "POST", { appointments: rows });
    setBusy(false);
    if (!result.ok) {
      if (vault) setVault((current) => current ? { ...current, appointments: before } : current);
      notify.block(result.error);
      return;
    }
    await loadVault();
  }

  function tick(carrier: string, on: boolean) {
    if (!vault) return;
    void saveAppointments(pickedStates.flatMap((state) => appointmentChange(vault.appointments, carrier, state, on, today)));
  }

  function tickAll(on: boolean) {
    if (!vault) return;
    void saveAppointments(yours.flatMap((carrier) => pickedStates.flatMap((state) => appointmentChange(vault.appointments, carrier.id, state, on, today))));
  }

  // One step (2026-10-27): the carrier is switched on and, where Applications is on, put on the
  // applications list too, so its card opens with its products and facts and the three things to finish.
  async function addCarrier(id: string, name: string) {
    setBusy(true);
    const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: id, contracted: true });
    if (result.ok && sales !== null) {
      const listed = await send("/api/app/settings/sales/carriers", "POST", { carrier_id: id });
      // Already on the list is fine; anything else is said, and the carrier stays added.
      if (!listed.ok && !/already on your list/i.test(listed.error)) notify.warn(`${name} was added, but its products could not be loaded`, { detail: listed.error });
    }
    setBusy(false);
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(`${name} added`, { detail: "Finish its contract, products and states to start selling it." });
    setAdding(false);
    setStep("carriers");
    setCarrierId(id);
    await Promise.all([loadVault(), loadSales()]);
  }

  const needle = query.trim().toLowerCase();
  const matchState = (code: string, name: string) => !needle || code.toLowerCase() === needle || name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(` ${needle}`);
  const keepState = (code: string) => filter === "all" || (filter === "yes") === appointedStates.has(code);
  const states = US_STATES.filter(([code, name]) => matchState(code, name) && keepState(code));
  const allShownStatesSelected = states.length > 0 && states.every(([code]) => selected.includes(code));
  const someShownStatesSelected = states.some(([code]) => selected.includes(code));
  const nAppointed = appointedStates.size;
  const total = US_STATES.length;
  const availableCarriers = vault.carriers.filter((carrier) => !yours.some((row) => row.id === carrier.id));
  const matchingAvailableCarriers = availableCarriers.filter((carrier) => !needle || carrier.name.toLowerCase().includes(needle));

  const filters = (yes: string, no: string, nYes: number) => (
    <div className="flex flex-wrap gap-1.5">
      {([["all", `All ${total}`], ["yes", `${yes} · ${nYes}`], ["no", `${no} · ${total - nYes}`]] as const).map(([key, text]) => (
        <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={CHIP(filter === key)}>{text}</button>
      ))}
    </div>
  );
  const search = (placeholder: string) => (
    <input className={cn(control, "mt-0")} aria-label={placeholder} placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} />
  );
  const listCard = (children: ReactNode) => <div className={cn(CARD, "flex min-h-0 flex-col gap-2.5 p-3.5")}>{children}</div>;
  const listBody = (children: ReactNode) => <div className={cn(SCROLL, "-mx-1.5 max-h-[420px] min-h-0 flex-1 px-1.5 lg:max-h-none")}>{children}</div>;

  const openStep = (next: Step) => { setStep(next); setQuery(""); setFilter("all"); };

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {/* Deep links: "#carriers/carriers-states" and "#carriers/carriers-licences" (old "#states-licences"
          links land on the latter). The rail's revealAnchor focuses the element named after the slash. */}
      {(["states", "maps"] as const).map((target) => (
        <button key={target} id={`carriers-${target}`} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" onClick={() => openStep(target)} onFocus={() => openStep(target)} />
      ))}
      <SettingsRailTabs
        label="Carrier setup"
        value={step === "maps" ? "advanced" : step}
        onChange={(next) => { setStep(next); setQuery(""); setFilter("all"); }}
        tabs={[
          { key: "carriers", label: "1 · Your carriers", count: yours.length },
          { key: "states", label: "2 · States", count: nAppointed },
          // Field maps remain available under the secondary Advanced area, outside the main setup.
          ...(sales !== null ? [{ key: "advanced" as const, label: "Other / Advanced" }] : []),
          // Owner, 2026-10-27: not a step of its own here, a link to the Carrier rules page.
          ...(carrierRules ? [{ key: "rules" as const, label: "Carrier rules", href: "/app/carrier-rules" }] : []),
        ]}
        actions={step === "carriers" ? <Button type="button" data-guide="carrier-library-add" onClick={() => setAdding((open) => !open)}>{adding ? null : <Plus aria-hidden="true" />}{adding ? "Close picker" : "Add carrier"}</Button> : undefined}
      />

      {step !== "advanced" && step !== "maps" && <div className="flex items-center gap-3">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]" role="progressbar" aria-label="Carrier setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
          <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
        </div>
        <span className="shrink-0 text-xs font-semibold text-[var(--body)]">{progressPercent}% complete · {readyCount} of {yours.length} carriers ready</span>
      </div>}

      {step === "carriers" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <span className="flex items-center justify-between gap-2"><Kicker id="hint-your-carriers" text="Your carriers" hint="The carriers you hold a contract with. Click one to finish its setup or change it." />{yours.length > 0 && <span className="text-xs text-[var(--muted)]">{readyCount} ready · {yours.length - readyCount} to finish</span>}</span>
            {adding && <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-alt)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3"><strong className="text-sm text-[var(--ink)]">Add carriers</strong><button type="button" className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => { setAdding(false); setQuery(""); }}>Close</button></div>
              <input className={cn(control, "mt-0")} aria-label="Search the carrier library" placeholder="Search carriers" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
              <div className={cn(SCROLL, "mt-2 max-h-48")}>
                {matchingAvailableCarriers.length === 0
                  ? <p className="m-0 px-2 py-3 text-xs text-[var(--muted)]">{availableCarriers.length ? "No carrier matches." : "Every carrier in the library is already selected."}</p>
                  : matchingAvailableCarriers.map((carrier) => <button key={carrier.id} type="button" onClick={() => void addCarrier(carrier.id, carrier.name)} disabled={busy} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--surface)] disabled:cursor-wait">{carrier.name}<span className="font-semibold text-[var(--accent-ink)]">Add</span></button>)}
              </div>
              <p className="mb-0 mt-2 text-xs text-[var(--muted)]">Not listed? <a href="mailto:support@insurvas.com?subject=Please%20add%20a%20carrier%20to%20the%20library" className="font-semibold text-[var(--accent-ink)] hover:underline">Ask Insurvas to add it</a></p>
            </div>}
            {!adding && <input className={cn(control, "mt-0")} aria-label="Find a carrier" placeholder="Find a carrier" value={query} onChange={(event) => setQuery(event.target.value)} />}
            {listBody(yours.length === 0
              ? <p className="m-0 px-2 py-3 text-sm text-[var(--muted)]">No carriers yet. Add the first one you write with.</p>
              : yours.filter((carrier) => !needle || carrier.name.toLowerCase().includes(needle)).map((carrier) => {
                const contract = vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active);
                const on = current?.id === carrier.id;
                const off = vault.carrierRequirements?.some((row) => row.carrier_id === carrier.id && row.contracted === false);
                const setupDraft = vault.carrierSetupDrafts.find((row) => row.carrier_id === carrier.id) ?? null;
                return (
                  <div key={carrier.id}>
                    <button type="button" onClick={() => setCarrierId(carrier.id)} aria-pressed={on} className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                      <span className={cn("size-2.5 shrink-0 rounded-full", dotOf(carrier.id))} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-semibold text-[var(--ink)]", off && "text-[var(--muted)]")}>{carrier.name}</span>
                        <span className="mt-0.5 block"><ProgressLine progress={carrierProgress(contract ?? null, salesOf(carrier.id), sales !== null, statesFor(vault.appointments, carrier.id, today))} switchedOff={Boolean(off)} /></span>
                      </span>
                      {contract && <span className="text-xs font-semibold text-[var(--muted)]">{bpToLevel(contract.contract_level_bp)}%</span>}
                    </button>
                    {on && <ContractSetupFields
                      key={`${carrier.id}-${setupDraft?.updated_at ?? contract?.id ?? "new"}`}
                      carrier={carrier}
                      contract={contract ?? null}
                      draft={setupDraft}
                      draftsAvailable={vault.carrierSetupDraftsAvailable}
                      writingFallback={salesOf(carrier.id)?.portal?.writingNumber ?? null}
                      canEdit={sales?.canEdit ?? true}
                      onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
                    />}
                  </div>
                );
              }))}
            <Button type="button" onClick={() => { setStep("states"); setQuery(""); setFilter("all"); }} disabled={!yours.length}>Next: Set up states</Button>
          </>)}
          {current ? (
            <CarrierCard
              key={current.id}
              className={cn(CARD, SCROLL)}
              carrier={current}
              dot={dotOf(current.id)}
              contract={vault.tenantCarriers.find((row) => row.carrier_id === current.id && row.is_active) ?? null}
              switchedOff={Boolean(vault.carrierRequirements?.some((row) => row.carrier_id === current.id && row.contracted === false))}
              states={statesFor(vault.appointments, current.id, today)}
              sales={salesOf(current.id)}
              salesAvailable={sales !== null}
              productLines={sales?.productLines ?? []}
              canEdit={sales?.canEdit ?? true}
              reports={reports.reports.filter((report) => report.carrierId === current.id)}
              reportsAvailable={reports.available}
              onSetStates={() => { setStep("states"); setQuery(""); setFilter("all"); }}
              onSaved={async () => { await Promise.all([loadVault(), loadSales(), loadReports()]); }}
            />
          ) : (
            <div className={cn(CARD, "grid place-items-center p-6 text-sm text-[var(--muted)]")}>Add a carrier to set it up.</div>
          )}
        </div>
      )}

      {step === "maps" && sales !== null && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          <div className="col-span-full flex items-center justify-between gap-3"><h3 className="m-0 text-title-sm font-semibold text-[var(--ink)]">Field maps</h3><Button type="button" variant="outline" onClick={() => setStep("advanced")}>Back to Other / Advanced</Button></div>
          <CarrierFieldMaps
            carriers={yours.map((carrier) => {
              const contract = vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active);
              return {
                id: carrier.id, name: carrier.name, dot: dotOf(carrier.id), level: contract ? String(bpToLevel(contract.contract_level_bp)) : null,
                products: (salesOf(carrier.id)?.products ?? []).filter((product) => product.isActive).map((product) => product.name),
                states: statesFor(vault.appointments, carrier.id, today).length,
              };
            })}
            currentId={current?.id ?? null}
            onPick={setCarrierId}
            listCard={listCard}
            listBody={listBody}
            cardClass={cn(CARD, SCROLL)}
          />
        </div>
      )}

      {step === "advanced" && <SettingsCard title="Other / Advanced">
        {sales !== null ? <button type="button" onClick={() => setStep("maps")} className="-mx-2 flex w-full items-center justify-between rounded-[8px] px-2 py-3 text-left hover:bg-[var(--surface-alt)]">
          <span><span className="block text-sm font-semibold text-[var(--ink)]">Field maps</span><span className="mt-0.5 block text-xs text-[var(--muted)]">Manage browser-extension field mappings for your carriers.</span></span><span className="text-sm font-semibold text-[var(--accent-ink)]">Open</span>
        </button> : <p className="m-0 text-sm text-[var(--muted)]">No advanced carrier tools are available for this workspace.</p>}
      </SettingsCard>}

      {step === "states" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <Kicker id="hint-pick-state" text="Pick a state" hint="Click a state to set its carriers. Tick the boxes to pick several states and set them all at once." />
            <div className="flex flex-wrap items-center justify-between gap-2">{search("Find a state: Arkansas, AR…")}<Button type="button" role="checkbox" aria-label="Select all visible states" aria-checked={allShownStatesSelected ? true : someShownStatesSelected ? "mixed" : false} variant="outline" onClick={() => {
              const shownCodes: string[] = states.map(([code]) => code);
              setSelected(allShownStatesSelected ? selected.filter((code) => !shownCodes.includes(code)) : [...new Set([...selected, ...shownCodes])]);
            }}>{allShownStatesSelected ? "Clear selection" : "Select all shown"}</Button></div>
            {filters("Appointed", "Not yet", nAppointed)}
            {listBody(states.map(([code, name]) => {
              const on = selected.includes(code);
              const here = carriersIn(vault.appointments, code, today).filter((id) => yours.some((carrier) => carrier.id === id));
              return (
                <div key={code} className={cn("flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                  <button type="button" onClick={() => setSelected(on ? selected.filter((s) => s !== code) : [...selected, code])} role="checkbox" aria-checked={on} aria-label={`Select ${name}`} className={BOX(on ? "all" : "none")}>✓</button>
                  <button type="button" onClick={() => setSelected([code])} className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left">
                    <span className="w-7 text-sm font-semibold text-[var(--ink)]">{code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">{name}</span>
                    <span className="flex gap-1" aria-hidden="true">{here.map((id) => <span key={id} className={cn("size-2 rounded-full", dotOf(id))} />)}</span>
                    <span className={cn("min-w-12 text-right text-xs font-semibold", here.length ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>
                      {here.length ? `${here.length} of ${yours.length}` : ""}
                    </span>
                  </button>
                </div>
              );
            }))}
            <Button type="button" variant="outline" onClick={() => { setStep("carriers"); setQuery(""); setFilter("all"); }}>Back to carriers</Button>
          </>)}
          <div className="grid min-h-0 gap-3 lg:grid-rows-[auto_minmax(0,1fr)]">
            <div className={cn(CARD, "flex flex-wrap gap-x-5 gap-y-2 px-4 py-3.5")}>
              <span className="basis-full"><Kicker id="hint-by-carrier" text="By carrier" hint="How many states each carrier has appointed you in so far." /></span>
              {yours.map((carrier) => {
                const n = statesFor(vault.appointments, carrier.id, today).length;
                return <span key={carrier.id} className="flex items-center gap-1.5 text-xs text-[var(--body)]"><span className={cn("size-2 rounded-full", dotOf(carrier.id))} aria-hidden="true" /><strong className="font-semibold text-[var(--ink)]">{carrier.name}</strong>{n ? `${n} states` : "no states yet"}</span>;
              })}
            </div>
            <div className={cn(CARD, SCROLL, "flex min-h-0 flex-col gap-3 p-5")}>
              {pickedStates.length === 0 ? (
                <p className="m-0 text-sm text-[var(--muted)]">Pick a state on the left, or tick several to set them together.</p>
              ) : (<>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{pickedStates.length === 1 ? STATE_NAME.get(pickedStates[0]) : `${pickedStates.length} states selected`}</h3>
                    <p className="m-0 mt-1 text-xs text-[var(--muted)]">Record carrier appointments here. Licence checks still apply when selling or routing business.</p>
                  </div>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => tickAll(true)} disabled={busy || !yours.length} className={CHIP(false)}>All carriers</button>
                    <button type="button" onClick={() => tickAll(false)} disabled={busy} className={CHIP(false)}>None</button>
                  </span>
                </div>
                <Label id="hint-which-carriers" text="Which of your carriers appointed you here?" hint="Tick a carrier once it has approved you to sell in this state. Quotes in a state you are not appointed in are flagged." />
                {yours.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">Add your carriers first, on step 1.</p>}
                {yours.map((carrier) => {
                  const state = coverage(vault.appointments, carrier.id, pickedStates, today);
                  const some = state === "some" ? pickedStates.filter((code) => currentAppointment(vault.appointments, carrier.id, code, today)).join(", ") : "";
                  const pending = pickedStates.length === 1 && currentAppointment(vault.appointments, carrier.id, pickedStates[0], today)?.status === "pending";
                  return (
                    <button
                      key={carrier.id}
                      type="button"
                      onClick={() => tick(carrier.id, state !== "all")}
                      role="checkbox"
                      aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                      disabled={busy}
                      className={cn("flex w-full items-center gap-3.5 rounded-[12px] border border-[var(--border)] p-3.5 text-left disabled:cursor-wait", state !== "none" && "bg-[var(--primary-soft)]")}
                    >
                      <span className={BOX(state)} aria-hidden="true">{state === "some" ? "–" : "✓"}</span>
                      <span className={cn("size-2.5 rounded-full", dotOf(carrier.id))} aria-hidden="true" />
                      <span className="flex-1 text-sm font-semibold text-[var(--ink)]">{carrier.name}</span>
                      {some && <span className="text-xs text-[var(--accent-ink)]">in {some} only</span>}
                      {pending && <StatusChip tone="info">Pending</StatusChip>}
                    </button>
                  );
                })}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <span className="text-xs text-[var(--muted)]">{busy ? "Saving…" : "Saved as you tick"}</span>
                  <Button type="button" onClick={() => { setStep("carriers"); setSelected([]); }}>Finish setup</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const order = US_STATES.map(([code]) => code as string);
                      const from = order.indexOf(pickedStates[pickedStates.length - 1]);
                      const next = order.slice(from + 1).find((code) => !appointedStates.has(code)) ?? order.find((code) => !appointedStates.has(code));
                      if (next) setSelected([next]);
                    }}
                  >
                    Next state without carriers →
                  </Button>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}

    </SettingsStack>
  );
}
