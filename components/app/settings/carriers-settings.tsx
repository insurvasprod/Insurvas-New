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

import { Callout, SettingsSectionHeader, SettingsStack, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { CarrierCard, ProgressLine, carrierProgress } from "@/components/app/settings/carrier-card";
import { CarrierFieldMaps } from "@/components/app/settings/carrier-field-maps";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import {
  appointmentChange, bpToLevel, carriersIn, coverage, currentAppointment, statesFor, todayIso,
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
type Step = "carriers" | "states" | "maps";
type Filter = "all" | "yes" | "no";

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
/** Each carrier's dot, by its place in your list. Tokens only. */
const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
/** A quiet scrollbar for the long lists (owner, 2026-10-26: not the browser's white one). */
const SCROLL =
  "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
/** The two panes fill the screen on desktop; on a phone they stack and the list scrolls in place. */
const PANES = "grid gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-250px)] lg:grid-cols-[360px_minmax(0,1fr)]";
/** Frosted glass over the page's ribbon: the border stays, the surface lets the ribbon through. */
const CARD = "rounded-[12px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_55%,transparent)] backdrop-blur-[20px] backdrop-saturate-150";
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
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

// Owner, 2026-10-28: no Carrier rules tab here ("we don't need them"). The page itself stays for the money screens that link to it.
export function CarriersSettings() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [sales, setSales] = useState<Sales>(null);
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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the section's external data, loaded once
  useEffect(() => { void loadVault(); void loadSales(); }, [loadVault, loadSales]);
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
  const licences = useMemo(() => new Map((vault?.licenses ?? []).map((row) => [row.state, row])), [vault]);

  if (!vault) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {loadError ? <Callout tone="error" title={loadError} /> : <div className={CARD}><SectionLoading label="Loading your carriers" /></div>}
      </SettingsStack>
    );
  }

  const appointedStates = new Set(vault.appointments.filter((row) => carriersIn([row], row.state, today).length).map((row) => row.state));
  const readyCount = yours.filter((carrier) => carrierProgress(vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active) ?? null, salesOf(carrier.id), sales !== null, statesFor(vault.appointments, carrier.id, today)).ready).length;
  const current = yours.find((carrier) => carrier.id === carrierId) ?? yours[0] ?? null;
  const pickedStates = selected.length ? selected : [];

  async function saveAppointments(rows: AppointmentChange[]) {
    if (!rows.length) return;
    setBusy(true);
    const result = await send("/api/app/appointment-vault/appointments", "POST", { appointments: rows });
    setBusy(false);
    if (!result.ok) { notify.block(result.error); return; }
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

  // One step (2026-10-27): each carrier is switched on and, where Applications is on, put on the
  // applications list too, so its card opens with its products and the three things to finish.
  // Several at once (owner, 2026-10-28), one after another; returns the ids that failed so the
  // dialog keeps them ticked to retry.
  async function addCarriers(picked: { id: string; name: string }[], onProgress: (done: number) => void): Promise<string[]> {
    setBusy(true);
    const added: { id: string; name: string }[] = [];
    const failed: { id: string; name: string; error: string }[] = [];
    const noProducts: string[] = [];
    for (const [index, carrier] of picked.entries()) {
      onProgress(index);
      const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: carrier.id, contracted: true });
      if (!result.ok) { failed.push({ ...carrier, error: result.error }); continue; }
      added.push(carrier);
      if (sales !== null) {
        const listed = await send("/api/app/settings/sales/carriers", "POST", { carrier_id: carrier.id });
        // Already on the list is fine; anything else is said, and the carrier stays added.
        if (!listed.ok && !/already on your list/i.test(listed.error)) noProducts.push(carrier.name);
      }
    }
    setBusy(false);
    if (added.length) {
      const title = added.length === 1 ? `${added[0].name} added` : `${added.length} carriers added`;
      notify.done(title, { detail: "Finish each one's contract, products and states to start selling it." });
      if (noProducts.length) notify.warn(`Products could not be loaded for ${noProducts.join(", ")}`, { detail: "The carriers are added. Open each card to try again." });
      setStep("carriers");
      setCarrierId(added[0].id);
      await Promise.all([loadVault(), loadSales()]);
    }
    if (failed.length) {
      notify.block(`Could not add ${failed.map((carrier) => carrier.name).join(", ")}`, { detail: failed[0].error });
    } else {
      setAdding(false);
    }
    return failed.map((carrier) => carrier.id);
  }

  const needle = query.trim().toLowerCase();
  const matchState = (code: string, name: string) => !needle || code.toLowerCase() === needle || name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(` ${needle}`);
  const keepState = (code: string) => filter === "all" || (filter === "yes") === appointedStates.has(code);
  const states = US_STATES.filter(([code, name]) => matchState(code, name) && keepState(code));
  const nAppointed = appointedStates.size;
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
      <ViewTabs
        label="Carrier setup"
        value={step}
        onChange={(next) => { setStep(next); setQuery(""); setFilter("all"); }}
        tabs={[
          { key: "carriers", label: "Your carriers", count: yours.length },
          { key: "states", label: "States", count: nAppointed },
          // Field maps need the Applications feature (the extension reads them); without it the tab is absent.
          // Owner, 2026-10-28: an extension setting, so it waits until there is a carrier to map.
          ...(sales !== null && yours.length > 0 ? [{ key: "maps" as const, label: "Field maps" }] : []),
        ]}
        actions={<Button type="button" data-guide="carrier-library-add" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add carrier</Button>}
      />

      {step === "carriers" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <span className="flex items-center justify-between gap-2"><Kicker id="hint-your-carriers" text="Your carriers" hint="The carriers you hold a contract with. Click one to finish its setup or change it." />{yours.length > 0 && <span className="text-xs text-[var(--muted)]">{readyCount} ready · {yours.length - readyCount} to finish</span>}</span>
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
                      <span className="mt-0.5 block"><ProgressLine progress={carrierProgress(contract ?? null, salesOf(carrier.id), sales !== null, statesFor(vault.appointments, carrier.id, today))} switchedOff={Boolean(off)} /></span>
                    </span>
                    {contract && <span className="text-xs font-semibold text-[var(--muted)]">{bpToLevel(contract.contract_level_bp)}%</span>}
                  </button>
                );
              }))}
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
              onSetStates={() => { setStep("states"); setQuery(""); setFilter("all"); }}
              onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
            />
          ) : (
            <div className={cn(CARD, "grid place-items-center p-6 text-sm text-[var(--muted)]")}>Add a carrier to set it up.</div>
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

      {step === "states" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <Kicker id="hint-pick-state" text="Pick a state" hint="Click a state to set its carriers. Tick the boxes to pick several states and set them all at once." />
            {search("Find a state: Arkansas, AR…")}
            {filters("Appointed", "Not yet", nAppointed)}
            {listBody(states.map(([code, name]) => {
              const on = selected.includes(code);
              const here = carriersIn(vault.appointments, code, today).filter((id) => yours.some((carrier) => carrier.id === id));
              return (
                <div key={code} className={cn("flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                  <button type="button" onClick={() => setSelected(on ? selected.filter((s) => s !== code) : [...selected, code])} role="checkbox" aria-checked={on && selected.length > 1} aria-label={`Select ${name} with others`} className={BOX(on && selected.length > 1 ? "all" : "none")}>✓</button>
                  <button type="button" onClick={() => setSelected([code])} className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left">
                    <span className="w-7 text-sm font-semibold text-[var(--ink)]">{code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">{name}</span>
                    <span className="flex gap-1" aria-hidden="true">{here.map((id) => <span key={id} className={cn("size-2 rounded-full", dotOf(id))} />)}</span>
                    <span className={cn("min-w-12 text-right text-xs font-semibold", here.length ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>
                      {here.length ? `${here.length} of ${yours.length}` : licences.has(code) ? "none" : ""}
                    </span>
                  </button>
                </div>
              );
            }))}
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
                    <StateLicenceLine states={pickedStates} licences={licences} />
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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

      {adding && (
        <AddCarrierDialog
          options={vault.carriers.filter((carrier) => !yours.some((row) => row.id === carrier.id))}
          busy={busy}
          onAdd={addCarriers}
          onClose={() => setAdding(false)}
        />
      )}
    </SettingsStack>
  );
}

function StateLicenceLine({ states, licences }: { states: string[]; licences: Map<string, LicenseRow> }) {
  const missing = states.filter((code) => !licences.has(code));
  const text = states.length === 1
    ? missing.length ? `No ${STATE_NAME.get(states[0])} licence on file. You can still record the appointment; add the licence before selling there.` : `You hold a ${STATE_NAME.get(states[0])} licence.`
    : `${states.join(", ")}${missing.length ? ` · no licence on file for ${missing.join(", ")}` : ""}`;
  return <p className={cn("m-0 mt-1 text-xs", missing.length ? "text-[var(--warning-ink)]" : "text-[var(--muted)]")}>{text}</p>;
}

/* ── add a carrier ───────────────────────────────────────────────────────────────────────────── */

/** Tick several carriers, then add them together (owner, 2026-10-28: one at a time meant reopening the dialog for each). */
function AddCarrierDialog({ options, busy, onAdd, onClose }: {
  options: { id: string; name: string }[];
  busy: boolean;
  /** Adds the ticked carriers; resolves with the ids that failed, which stay ticked. */
  onAdd: (picked: { id: string; name: string }[], onProgress: (done: number) => void) => Promise<string[]>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const shown = options.filter((carrier) => carrier.name.toLowerCase().includes(q.trim().toLowerCase()));
  const picked = options.filter((carrier) => ticked.includes(carrier.id));
  const toggle = (id: string) => setTicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const shownTicked = shown.filter((carrier) => ticked.includes(carrier.id)).length;
  const allShown = shown.length > 0 && shownTicked === shown.length;

  async function submit() {
    if (!picked.length) return;
    const failed = await onAdd(picked, setProgress);
    setProgress(null);
    setTicked(failed);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="border-[var(--border)] bg-[var(--surface)] sm:max-w-md">
        <DialogHeader><DialogTitle className="text-[var(--ink)]">Add carriers you are contracted with</DialogTitle></DialogHeader>
        <input className={cn(control, "mt-0")} aria-label="Search the carrier library" placeholder="Search the carrier library" value={q} onChange={(event) => setQ(event.target.value)} autoFocus />
        <div className="flex items-center justify-between gap-2 px-2.5 text-xs text-[var(--muted)]">
          <span className="tabular-nums">{ticked.length ? `${ticked.length} selected` : "Tick every carrier you write with"}</span>
          {shown.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setTicked((list) => (allShown ? list.filter((id) => !shown.some((carrier) => carrier.id === id)) : [...new Set([...list, ...shown.map((carrier) => carrier.id)])]))}
              className="font-semibold text-[var(--accent-ink)] hover:underline disabled:opacity-60"
            >
              {allShown ? "Clear these" : q.trim() ? "Select these" : "Select all"}
            </button>
          )}
        </div>
        <div className={cn(SCROLL, "max-h-[340px]")}>
          {shown.length === 0 && <p className="m-0 px-2 py-3 text-sm text-[var(--muted)]">{options.length ? "No carrier matches." : "Every carrier in the library is already yours."}</p>}
          {shown.map((carrier) => {
            const on = ticked.includes(carrier.id);
            return (
              <button
                key={carrier.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(carrier.id)}
                disabled={busy}
                className={cn("flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2.5 text-left text-sm text-[var(--ink)] hover:bg-[var(--surface-alt)] disabled:cursor-wait", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}
              >
                <span className={BOX(on ? "all" : "none")} aria-hidden="true">✓</span>
                <span className="min-w-0 flex-1 truncate">{carrier.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || picked.length === 0}>
            {progress !== null
              ? `Adding ${Math.min(progress + 1, picked.length)} of ${picked.length}…`
              : picked.length > 1 ? `Add ${picked.length} carriers` : "Add carrier"}
          </Button>
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">Each one opens its card with what is left to set up. Not listed? <a href="mailto:support@insurvas.com?subject=Please%20add%20a%20carrier%20to%20the%20library" className="font-semibold text-[var(--accent-ink)] hover:underline">Ask Insurvas to add it</a></p>
      </DialogContent>
    </Dialog>
  );
}
