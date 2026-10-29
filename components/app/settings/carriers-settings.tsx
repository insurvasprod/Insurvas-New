"use client";

/**
 * Settings › Contracting (was Carriers; manager review 28 Oct §5, settings redesign R6). Three views:
 *
 * Set up — the guided page (contracting-setup.tsx): carriers inline with their optional contract
 *     details, then states with "all carriers" as the default. Opens first until set-up is complete.
 *     It replaces the "Add carriers" pop-up (Umar: no pop-up).
 * Carriers and States — the plain lists of what is set up (below), for changing one thing later.
 * Field maps — for the browser extension (postponed): out of the tabs, under More (§5.6).
 *
 * The list views, from before (owner pick D, 2026-10-26): a full-height list on the left, the picked
 * item's card on the right.
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
import { MoreHorizontal, Plus } from "lucide-react";

import { Callout, SettingsSectionHeader, SettingsStack, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { CarrierCard, ProgressLine, carrierProgress } from "@/components/app/settings/carrier-card";
import { CarrierFieldMaps } from "@/components/app/settings/carrier-field-maps";
import { ContractingSetup, setupProgress } from "@/components/app/settings/contracting-setup";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import { licenceExpiryValue, licenceNumberValue } from "@/lib/appointments/tickModel";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import {
  applyAppointmentChanges, appointedStatesFor, appointmentChange, bpToLevel, carriersIn, coverage, currentAppointment, forServer, pendingStatesFor, statesFor, todayIso,
  type AppointmentChange,
} from "@/lib/appointments/tickModel";
import type { CarriersPayload } from "@/lib/salesSettings/views";

type Vault = {
  carriers: { id: string; name: string }[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  extendedFields: boolean;
  carrierRequirements: { carrier_id: string; contracted: boolean }[] | null;
};
type Sales = (Omit<CarriersPayload, "canEdit"> & { canEdit: boolean }) | null;
type Step = "setup" | "carriers" | "states" | "maps";
type Filter = "all" | "yes" | "no";

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
/** Each carrier's dot, by its place in your list. Tokens only. */
const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
/** A quiet scrollbar for the long lists (owner, 2026-10-26: not the browser's white one). */
const SCROLL =
  "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
/** The two panes fill the screen on desktop; on a phone they stack and the list scrolls in place. */
// Each pane is only as tall as what is in it, up to the screen's height, where it scrolls
// (owner, 2026-10-29: no empty card when a list is short).
const PANES = "grid items-start gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-250px)] lg:grid-cols-[360px_minmax(0,1fr)] lg:[&>*]:max-h-full";
/** The kit's glass card (UI-CONSISTENCY §5b), not a local copy of it. */
const PANE = cardSurface;
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const CHIP = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:border-[var(--accent-ink)]");
const tickBox = (state: "all" | "some" | "none") =>
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

// Owner, 2026-10-28: no Carrier rules tab here ("we don't need them"). The page itself stays for the money screens that link to it.
export function CarriersSettings() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [sales, setSales] = useState<Sales>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set up first until it is complete; decided once, when the data first arrives.
  const [step, setStep] = useState<Step>("carriers");
  const decided = useRef(false);
  // The states Set up ticked since the last sync of licences.
  const touched = useRef(new Set<string>());
  // The States tab's background saves: how many edits so far, the queue, and how many are waiting.
  const edits = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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

  // `isStale`: a read that started before newer ticks must not put the older list back on screen
  // (owner, 2026-10-29: ticking states was slow and ticks flickered away and back).
  const loadVault = useCallback(async (isStale?: () => boolean) => {
    const response = await fetch("/api/app/appointment-vault", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setLoadError(body?.error ?? "Could not load your carriers"); return null; }
    if (isStale?.()) return null;
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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the section's external data, loaded once
  useEffect(() => { void loadVault(); void loadSales(); }, [loadVault, loadSales]);
  const loaded = vault !== null;
  useEffect(() => {
    if (!vault || decided.current) return;
    decided.current = true;
    const { anchor } = parseSettingsHash(window.location.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the opening view, chosen once from the first data
    if (!anchor && !setupProgress(vault, today).complete) setStep("setup");
  }, [vault, today]);
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
      else if (anchor === "carriers-setup") setStep("setup");
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
  const licences = useMemo(() => new Map((vault?.licenses ?? []).map((row) => [row.state, row])), [vault]);

  if (!vault) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {loadError ? <Callout tone="error" title={loadError} /> : <div className={PANE}><SectionLoading label="Loading your carriers" /></div>}
      </SettingsStack>
    );
  }

  const appointedStates = new Set(vault.appointments.filter((row) => carriersIn([row], row.state, today).length).map((row) => row.state));
  // Ready means appointed (active), not applied for: pending is shown but never counts (eligibility.ts).
  const progressOf = (carrierId: string) => carrierProgress(vault.tenantCarriers.find((row) => row.carrier_id === carrierId && row.is_active) ?? null, salesOf(carrierId), sales !== null, appointedStatesFor(vault.appointments, carrierId, today), pendingStatesFor(vault.appointments, carrierId, today));
  const readyCount = yours.filter((carrier) => progressOf(carrier.id).ready).length;
  const current = yours.find((carrier) => carrier.id === carrierId) ?? yours[0] ?? null;
  const pickedStates = selected.length ? selected : [];

  /**
   * One click (owner, 2026-10-28: "if it means I am clicking it and also clicking the carrier I am
   * good to go"): ticking a carrier in a state records that you are licensed there too. Unticking the
   * last carrier in a state takes the licence back off, unless it has a number or expiry on file,
   * which is kept. No details are asked: the endpoint stores placeholders for them.
   */
  async function syncLicences(fresh: Vault, states: string[], isStale?: () => boolean) {
    const held = new Map(fresh.licenses.map((row) => [row.state, row]));
    const changes = states.flatMap((code) => {
      const carriersHere = carriersIn(fresh.appointments, code, today).length;
      const row = held.get(code);
      if (carriersHere > 0 && !row) return [{ code, add: true }];
      const bare = row && !licenceNumberValue(row.license_number) && !licenceExpiryValue(row.expires_at);
      if (carriersHere === 0 && bare) return [{ code, add: false }];
      return [];
    });
    if (!changes.length) return;
    // Six at a time: one by one, thirty states took fifteen seconds. In the background: the ticks are
    // already on screen.
    for (let start = 0; start < changes.length; start += 6) {
      const results = await Promise.all(changes.slice(start, start + 6).map((change) => change.add
        ? send("/api/app/appointment-vault/licenses", "POST", { state: change.code })
        : send(`/api/app/appointment-vault/licenses?state=${change.code}`, "DELETE")));
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) { notify.block(failed.error); break; }
    }
    await loadVault(isStale);
  }

  // A tick shows at once; its save joins one queue, in order, and the screen never waits on it.
  function saveInBackground(changes: AppointmentChange[], states: string[]) {
    if (!changes.length) return;
    edits.current += 1;
    setVault((current) => (current ? { ...current, appointments: applyAppointmentChanges(current.appointments, changes, today) } : current));
    states.forEach((code) => touched.current.add(code));
    setBusy(true);
    pendingSaves.current += 1;
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await send("/api/app/appointment-vault/appointments", "POST", { appointments: forServer(changes) });
      if (!result.ok) { notify.block(result.error); await loadVault(); }
    }).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) {
        const at = edits.current;
        void afterSetupSaves(() => edits.current !== at).finally(() => { if (pendingSaves.current === 0) setBusy(false); });
      }
    });
  }

  function tick(carrier: string, on: boolean) {
    if (!vault) return;
    const states = [...pickedStates];
    saveInBackground(states.flatMap((state) => appointmentChange(vault.appointments, carrier, state, on, today)), states);
  }

  function tickAll(on: boolean) {
    if (!vault) return;
    const states = [...pickedStates];
    saveInBackground(yours.flatMap((carrier) => states.flatMap((state) => appointmentChange(vault.appointments, carrier.id, state, on, today))), states);
  }

  // Saves run in a queue; once it is empty the lists are read again, and the licences follow the
  // states that were ticked (one sync for the batch, not one per click). A read that newer ticks
  // overtook is dropped, so it never undoes them.
  async function afterSetupSaves(isStale?: () => boolean) {
    const fresh = await loadVault(isStale);
    if (fresh && touched.current.size) await syncLicences(fresh, [...touched.current], isStale);
    if (!isStale?.()) touched.current.clear();
    await loadSales();
  }

  const needle = query.trim().toLowerCase();
  const matchState = (code: string, name: string) => !needle || code.toLowerCase() === needle || name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(` ${needle}`);
  const keepState = (code: string) => filter === "all" || (filter === "yes") === appointedStates.has(code);
  const states = US_STATES.filter(([code, name]) => matchState(code, name) && keepState(code));
  const nAppointed = appointedStates.size;
  const setup = setupProgress(vault, today);
  const setupDone = setup.complete;
  const total = US_STATES.length;

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
  const listCard = (children: ReactNode) => <div className={cn(PANE, "flex min-h-0 flex-col gap-2.5 p-3.5")}>{children}</div>;
  const listBody = (children: ReactNode) => <div className={cn(SCROLL, "-mx-1.5 max-h-[420px] min-h-0 flex-1 px-1.5 lg:max-h-none")}>{children}</div>;

  const openStep = (next: Step) => { setStep(next); setQuery(""); setFilter("all"); };
  // A tab the person picks is written to the address too, so the Get set up bar (which reads the
  // hash) knows the States half is open (owner, 2026-10-28). Same anchors as the deep links above.
  const pickStep = (next: Step) => {
    openStep(next);
    const hash = next === "states" ? "#carriers/carriers-states" : next === "maps" ? "#carriers/carriers-maps" : next === "setup" ? "#carriers/carriers-setup" : "#carriers";
    if (window.location.hash !== hash) window.location.hash = hash;
  };

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {/* Deep links: "#carriers/carriers-states" and "#carriers/carriers-licences" (old "#states-licences"
          links land on the latter). The rail's revealAnchor focuses the element named after the slash. */}
      {(["setup", "states", "maps"] as const).map((target) => (
        <button key={target} id={`carriers-${target}`} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" onClick={() => openStep(target)} onFocus={() => openStep(target)} />
      ))}
      <ViewTabs
        label="Contracting"
        value={step}
        onChange={pickStep}
        tabs={[
          { key: "setup", label: setupDone ? "Set up" : `Set up · ${setup.percent}%` },
          { key: "carriers", label: "Carriers", count: yours.length },
          { key: "states", label: "States", count: nAppointed },
          // Field maps (browser extension, postponed): opened from More, shown as a tab only while open.
          ...(step === "maps" ? [{ key: "maps" as const, label: "Field maps" }] : []),
        ]}
        actions={
          <span className="flex items-center gap-2">
            <Button type="button" variant={step === "setup" ? "secondary" : "default"} data-guide="carrier-library-add" onClick={() => pickStep("setup")}><Plus aria-hidden="true" />Add carriers</Button>
            {sales !== null && yours.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon" aria-label="More contracting settings"><MoreHorizontal aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => pickStep("maps")}>Field maps (browser extension)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        }
      />

      {step === "setup" && (
        <ContractingSetup
          vault={vault}
          setVault={(update) => setVault((current) => (current ? { ...current, ...update(current) } : current))}
          salesAvailable={sales !== null}
          send={send}
          reload={afterSetupSaves}
          onStatesSaved={async (codes) => { for (const code of codes) touched.current.add(code); }}
          onFinish={() => {
            notify.done("Contracting is set up", { detail: "Change a carrier or a state any time on Carriers and States." });
            pickStep("carriers");
          }}
        />
      )}

      {step === "carriers" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <span className="flex items-center justify-between gap-2"><Kicker id="hint-your-carriers" text="Your carriers" hint="The carriers you hold a contract with. Click one to finish its setup or change it." />{yours.length > 1 && <span className="text-xs text-[var(--muted)]">{readyCount} ready · {yours.length - readyCount} to finish</span>}</span>
            <input className={cn(control, "mt-0")} aria-label="Find a carrier" placeholder="Find a carrier" value={query} onChange={(event) => setQuery(event.target.value)} />
            {listBody(yours.length === 0
              ? <p className="m-0 px-2 py-3 text-sm text-[var(--muted)]">No carriers yet. Add the first one you write with.</p>
              : yours.filter((carrier) => !needle || carrier.name.toLowerCase().includes(needle)).map((carrier) => {
                const contract = vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active);
                const on = current?.id === carrier.id;
                const off = vault.carrierRequirements?.some((row) => row.carrier_id === carrier.id && row.contracted === false);
                return (
                  <button key={carrier.id} type="button" onClick={() => setCarrierId(carrier.id)} aria-pressed={on} className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                    <span className={cn("size-2.5 shrink-0 rounded-full", dotOf(carrier.id))} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-semibold text-[var(--ink)]", off && "text-[var(--muted)]")}>{carrier.name}</span>
                      <span className="mt-0.5 block"><ProgressLine progress={progressOf(carrier.id)} switchedOff={Boolean(off)} /></span>
                    </span>
                    {contract && <span className="text-xs font-semibold text-[var(--muted)]">{bpToLevel(contract.contract_level_bp)}%</span>}
                  </button>
                );
              }))}
          </>)}
          {current ? (
            <CarrierCard
              key={current.id}
              className={cn(PANE, SCROLL)}
              carrier={current}
              dot={dotOf(current.id)}
              contract={vault.tenantCarriers.find((row) => row.carrier_id === current.id && row.is_active) ?? null}
              switchedOff={Boolean(vault.carrierRequirements?.some((row) => row.carrier_id === current.id && row.contracted === false))}
              states={appointedStatesFor(vault.appointments, current.id, today)}
              pendingStates={pendingStatesFor(vault.appointments, current.id, today)}
              sales={salesOf(current.id)}
              salesAvailable={sales !== null}
              productLines={sales?.productLines ?? []}
              canEdit={sales?.canEdit ?? true}
              onSetStates={() => pickStep("states")}
              onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
            />
          ) : (
            <div className={cn(PANE, "grid place-items-center p-6 text-sm text-[var(--muted)]")}>Add a carrier to set it up.</div>
          )}
        </div>
      )}

      {step === "maps" && sales !== null && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          <CarrierFieldMaps
            carriers={yours.map((carrier) => {
              const contract = vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active);
              return {
                id: carrier.id, name: carrier.name, dot: dotOf(carrier.id), level: contract ? String(bpToLevel(contract.contract_level_bp)) : null,
                products: (salesOf(carrier.id)?.products ?? []).filter((product) => product.isActive).map((product) => product.name),
                states: appointedStatesFor(vault.appointments, carrier.id, today).length,
              };
            })}
            currentId={current?.id ?? null}
            onPick={setCarrierId}
            listCard={listCard}
            listBody={listBody}
            cardClass={cn(PANE, SCROLL)}
          />
        </div>
      )}

      {step === "states" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <Kicker id="hint-pick-state" text="Your states" hint="Tick every state you work in, then mark them all at once on the right. Or click one state to open just that one." />
            {search("Find a state: Arkansas, AR…")}
            {filters("Appointed", "Not yet", nAppointed)}
            {/* Many states, many carriers in one go (owner, 2026-10-28): pick what the list shows, then tick the carriers. */}
            <span className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--muted)]">
              <span className="tabular-nums">{selected.length ? `${selected.length} picked` : "Tick the states you sell in"}</span>
              <span className="flex gap-3">
                <button type="button" onClick={() => setSelected((picked) => [...new Set([...picked, ...states.map(([code]) => code as string)])])} className="font-semibold text-[var(--accent-ink)] hover:underline">Pick all shown</button>
                {selected.length > 0 && <button type="button" onClick={() => setSelected([])} className="font-semibold text-[var(--accent-ink)] hover:underline">Clear</button>}
              </span>
            </span>
            {listBody(states.map(([code, name]) => {
              const on = selected.includes(code);
              const here = carriersIn(vault.appointments, code, today).filter((id) => yours.some((carrier) => carrier.id === id));
              return (
                <div key={code} className={cn("flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                  {/* One look for a picked state (owner, 2026-10-28, S1): the box shows it ticked whether one or several are picked. */}
                  <button type="button" onClick={() => setSelected((picked) => (picked.includes(code) ? picked.filter((s) => s !== code) : [...picked, code]))} role="checkbox" aria-checked={on} aria-label={`Pick ${name}`} className={tickBox(on ? "all" : "none")}>✓</button>
                  <button type="button" onClick={() => setSelected([code])} className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left">
                    <span className="w-7 text-sm font-semibold text-[var(--ink)]">{code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">{name}</span>
                    {licences.has(code) && <span className="text-xs text-[var(--muted)]">Licensed</span>}
                    <span className="flex gap-1" aria-hidden="true">{here.map((id) => <span key={id} className={cn("size-2 rounded-full", dotOf(id))} />)}</span>
                    {yours.length > 1 && here.length > 0 && <span className="min-w-10 text-right text-xs font-semibold text-[var(--accent-ink)]">{here.length} of {yours.length}</span>}
                  </button>
                </div>
              );
            }))}
          </>)}
          {/* One panel (S5): each carrier's state count sits beside its tick, not in a card of its own. */}
          <div className={cn(PANE, SCROLL, "flex min-h-0 flex-col gap-3 p-5")}>
            {pickedStates.length === 0 ? (
              <p className="m-0 text-sm text-[var(--muted)]">Tick the states you work in on the left, or click one, then mark them here.</p>
            ) : (<>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{pickedStates.length === 1 ? STATE_NAME.get(pickedStates[0]) : `${pickedStates.length} states: ${pickedStates.join(", ")}`}</h3>
                {/* S3: only worth showing with more than one carrier. */}
                {yours.length > 1 && (
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => tickAll(true)} className={CHIP(false)}>All carriers</button>
                    <button type="button" onClick={() => tickAll(false)} className={CHIP(false)}>None</button>
                  </span>
                )}
              </div>

              <Label id="hint-which-carriers" text="Which of your carriers can you sell here?" hint="Tick each carrier you are licensed and appointed with in this state. One tick covers both; quotes in a state you have not ticked are flagged." />
              {yours.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">Add your carriers first, on the Your carriers tab.</p>}
              {yours.map((carrier) => {
                const state = coverage(vault.appointments, carrier.id, pickedStates, today);
                const some = state === "some" ? pickedStates.filter((code) => currentAppointment(vault.appointments, carrier.id, code, today)).join(", ") : "";
                const pending = pickedStates.length === 1 && currentAppointment(vault.appointments, carrier.id, pickedStates[0], today)?.status === "pending";
                const total = statesFor(vault.appointments, carrier.id, today).length;
                return (
                  <button
                    key={carrier.id}
                    type="button"
                    onClick={() => tick(carrier.id, state !== "all")}
                    role="checkbox"
                    aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                    className={cn("flex w-full items-center gap-3.5 rounded-[12px] border border-[var(--border)] p-3.5 text-left transition-colors", state !== "none" && "bg-[var(--primary-soft)]")}
                  >
                    <span className={tickBox(state)} aria-hidden="true">{state === "some" ? "–" : "✓"}</span>
                    <span className={cn("size-2.5 rounded-full", dotOf(carrier.id))} aria-hidden="true" />
                    <span className="flex-1 text-sm font-semibold text-[var(--ink)]">{carrier.name}</span>
                    {some && <span className="text-xs text-[var(--accent-ink)]">in {some} only</span>}
                    {pending && <StatusChip tone="info">Pending</StatusChip>}
                    <span className="text-xs tabular-nums text-[var(--muted)]">{total ? `${total} state${total === 1 ? "" : "s"} in all` : "no states yet"}</span>
                  </button>
                );
              })}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--muted)]">{busy ? "Saving…" : "Saved as you tick"}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // An empty state: no licence and no carrier yet.
                    const empty = (code: string) => !appointedStates.has(code) && !licences.has(code);
                    const order = US_STATES.map(([code]) => code as string);
                    const from = order.indexOf(pickedStates[pickedStates.length - 1]);
                    const next = order.slice(from + 1).find(empty) ?? order.find(empty);
                    if (next) setSelected([next]);
                  }}
                >
                  Next empty state →
                </Button>
              </div>
            </>)}
          </div>
        </div>
      )}

    </SettingsStack>
  );
}
