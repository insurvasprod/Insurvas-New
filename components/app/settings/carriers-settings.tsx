"use client";

/**
 * Settings › Carriers (owner pick D, 2026-10-26): one place, three steps, one layout. A full-height
 * list on the left, the picked item's card on the right.
 *
 * 1 · Your carriers — LA-0.4: contract level and start date (tenant_carriers, saved
 *     effective-dated), LA-3.17: the products you sell with each one, and LA-3.13's field-map status.
 * 2 · States — LA-0.5 / LA-3.6: pick a state (or tick several) and tick which carriers appointed you
 *     there. A tick saves an active appointment from today; an untick ends it today (never deleted).
 * 3 · State licences — LA-0.5: one licence per state, its number, type and expiry.
 *
 * Replaces Carrier library and States & licences. E&O and continuing education were removed from the
 * platform the same day. Portal, reference and product details stay in Carrier details; field maps are
 * still built and checked in the extension (Settings › Carrier field maps).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Callout, SettingsSectionHeader, SettingsStack, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/appointments/constants";
import { LINES_OF_AUTHORITY, type AppointmentRow, type LicenceType, type LicenseRow } from "@/lib/appointments/service-types";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import { formatDay } from "@/lib/carriers/contracts";
import {
  appointmentChange, bpToLevel, carriersIn, coverage, currentAppointment, levelToBp, licenceStatus, statesFor, todayIso,
  type AppointmentChange,
} from "@/lib/appointments/tickModel";
import type { CarrierProductView, CarriersPayload, FieldMapChip } from "@/lib/salesSettings/views";

type Vault = {
  carriers: { id: string; name: string }[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  extendedFields: boolean;
  carrierRequirements: { carrier_id: string; contracted: boolean }[] | null;
};
type Sales = (Omit<CarriersPayload, "canEdit"> & { canEdit: boolean }) | null;
type Step = "carriers" | "states" | "licences";
type Filter = "all" | "yes" | "no";

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
/** Each carrier's dot, by its place in your list. Tokens only. */
const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
/** A quiet scrollbar for the long lists (owner, 2026-10-26: not the browser's white one). */
const SCROLL =
  "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
/** The two panes fill the screen on desktop; on a phone they stack and the list scrolls in place. */
const PANES = "grid gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-250px)] lg:grid-cols-[360px_minmax(0,1fr)]";
const CARD = "rounded-[12px] border border-[var(--border)] bg-[var(--surface)]";
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const FIELD = "flex flex-col text-xs font-semibold text-[var(--muted)]";
const CHIP = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:border-[var(--accent-ink)]");
const BOX = (state: "all" | "some" | "none") =>
  cn("inline-grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] text-xs font-bold leading-none",
    state === "all" ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : state === "some" ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-transparent");
const MAP_CHIP: Record<FieldMapChip["status"], { label: string; tone: StatusTone }> = {
  published: { label: "Map published", tone: "good" },
  draft: { label: "Map in draft", tone: "neutral" },
  needs_review: { label: "Map needs review", tone: "warning" },
  none: { label: "No map yet", tone: "neutral" },
};

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

export function CarriersSettings() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [sales, setSales] = useState<Sales>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("carriers");
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [licState, setLicState] = useState<string | null>(null);
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

  async function addCarrier(id: string, name: string) {
    setBusy(true);
    const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: id, contracted: true });
    setBusy(false);
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(`${name} added.`);
    setAdding(false);
    setStep("carriers");
    setCarrierId(id);
    await Promise.all([loadVault(), loadSales()]);
  }

  const needle = query.trim().toLowerCase();
  const matchState = (code: string, name: string) => !needle || code.toLowerCase() === needle || name.toLowerCase().startsWith(needle) || name.toLowerCase().includes(` ${needle}`);
  const keepState = (code: string) => filter === "all" || (step === "licences" ? (filter === "yes") === licences.has(code) : (filter === "yes") === appointedStates.has(code));
  const states = US_STATES.filter(([code, name]) => matchState(code, name) && keepState(code));
  const nLic = licences.size;
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
      {(["states", "licences"] as const).map((target) => (
        <button key={target} id={`carriers-${target}`} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" onClick={() => openStep(target)} onFocus={() => openStep(target)} />
      ))}
      <ViewTabs
        label="Carrier setup"
        value={step}
        onChange={(next) => { setStep(next); setQuery(""); setFilter("all"); }}
        tabs={[
          { key: "carriers", label: "1 · Your carriers", count: yours.length },
          { key: "states", label: "2 · States", count: nAppointed },
          { key: "licences", label: "State licences", count: nLic },
        ]}
        actions={<Button type="button" data-guide="carrier-library-add" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add carrier</Button>}
      />

      {step === "carriers" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <Kicker id="hint-your-carriers" text="Your carriers" hint="The carriers you hold a contract with. Click one to set its contract and products." />
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
                      <span className="block truncate text-xs text-[var(--muted)]">{off ? "Switched off" : contract ? `${bpToLevel(contract.contract_level_bp)}% contract level` : "No contract level yet"}</span>
                    </span>
                    <span className="text-xs font-semibold text-[var(--muted)]">{statesFor(vault.appointments, carrier.id, today).length} states</span>
                  </button>
                );
              }))}
            <Button type="button" variant="outline" onClick={() => setAdding(true)}>+ Add carrier</Button>
          </>)}
          {current ? (
            <CarrierCard
              key={current.id}
              carrier={current}
              dot={dotOf(current.id)}
              contract={vault.tenantCarriers.find((row) => row.carrier_id === current.id && row.is_active) ?? null}
              switchedOff={Boolean(vault.carrierRequirements?.some((row) => row.carrier_id === current.id && row.contracted === false))}
              states={statesFor(vault.appointments, current.id, today)}
              sales={sales?.carriers.find((row) => row.id === current.id) ?? null}
              salesAvailable={sales !== null}
              canEditProducts={sales?.canEdit ?? false}
              onSetStates={() => { setStep("states"); setQuery(""); setFilter("all"); }}
              onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
            />
          ) : (
            <div className={cn(CARD, "grid place-items-center p-6 text-sm text-[var(--muted)]")}>Add a carrier to set it up.</div>
          )}
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

      {step === "licences" && (
        <div ref={panes} className={PANES} style={paneHeight ? { height: paneHeight } : undefined}>
          {listCard(<>
            <Kicker id="hint-licence-state" text="Pick a state" hint="Click a state to add or update your licence there." />
            {search("Find a state: Arkansas, AR…")}
            {filters("Licensed", "No licence", nLic)}
            {listBody(states.map(([code, name]) => {
              const status = licenceStatus(licences.get(code), today);
              const on = (licState ?? [...licences.keys()][0]) === code;
              return (
                <button key={code} type="button" onClick={() => setLicState(code)} aria-pressed={on} className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                  <span className="w-7 text-sm font-semibold text-[var(--ink)]">{code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">{name}</span>
                  {status && <span className={cn("text-xs font-semibold", status.tone === "good" ? "text-[var(--accent-ink)]" : status.tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--error-ink)]")}>{status.label}</span>}
                </button>
              );
            }))}
          </>)}
          <div className="grid min-h-0 gap-3 lg:grid-rows-[auto_minmax(0,1fr)]">
            <div className={cn(CARD, "flex flex-wrap gap-2 px-4 py-3.5")}>
              <span className="basis-full"><Kicker id="hint-your-licences" text="Your licences" hint="Every state you hold a licence in, and when each one needs renewing." /></span>
              {nLic === 0 && <span className="text-sm text-[var(--muted)]">None yet. Pick a state on the left to add one.</span>}
              {[...licences.values()].sort((a, b) => a.state.localeCompare(b.state)).map((row) => {
                const status = licenceStatus(row, today);
                return <button key={row.state} type="button" onClick={() => setLicState(row.state)} className={CHIP(false)}>{row.state} · <span className={status?.tone === "good" ? "text-[var(--accent-ink)]" : status?.tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--error-ink)]"}>{status?.label}</span></button>;
              })}
            </div>
            {(licState ?? [...licences.keys()][0] ?? null) ? (
              <LicenceCard
                key={licState ?? [...licences.keys()][0]}
                state={(licState ?? [...licences.keys()][0]) as string}
                licence={licences.get((licState ?? [...licences.keys()][0]) as string) ?? null}
                extended={vault.extendedFields}
                carriers={carriersIn(vault.appointments, (licState ?? [...licences.keys()][0]) as string, today).map((id) => ({ id, name: yours.find((c) => c.id === id)?.name ?? "", dot: dotOf(id) })).filter((c) => c.name)}
                today={today}
                onSaved={async () => { await loadVault(); }}
              />
            ) : (
              <div className={cn(CARD, "grid place-items-center p-6 text-sm text-[var(--muted)]")}>Pick a state on the left to add your licence there.</div>
            )}
          </div>
        </div>
      )}

      {adding && (
        <AddCarrierDialog
          options={vault.carriers.filter((carrier) => !yours.some((row) => row.id === carrier.id))}
          busy={busy}
          onAdd={(id, name) => void addCarrier(id, name)}
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

/* ── step 1: one carrier ─────────────────────────────────────────────────────────────────────── */

function productBody(p: CarrierProductView, isActive: boolean) {
  return {
    product_code: p.productCode, name: p.name, tiers: p.tiers, issue_age_min: p.issueAgeMin, issue_age_max: p.issueAgeMax,
    face_min_cents: p.faceMinCents, face_max_cents: p.faceMaxCents, band_min: p.bandMin, band_max: p.bandMax,
    accepted_payment_methods: p.acceptedPaymentMethods, is_active: isActive, term_lengths: p.termLengths, health_classes: p.healthClasses,
    exam_required_above_face_cents: p.examAboveFaceCents, convertible: p.convertible, conversion_deadline_rule: p.conversionDeadlineRule, renewal_type: p.renewalType,
  };
}

function CarrierCard({ carrier, dot, contract, switchedOff, states, sales, salesAvailable, canEditProducts, onSetStates, onSaved }: {
  carrier: { id: string; name: string };
  dot: string;
  contract: TenantCarrierRow | null;
  switchedOff: boolean;
  states: string[];
  sales: NonNullable<Sales>["carriers"][number] | null;
  salesAvailable: boolean;
  canEditProducts: boolean;
  onSetStates: () => void;
  onSaved: () => Promise<void>;
}) {
  const [level, setLevel] = useState(bpToLevel(contract?.contract_level_bp));
  const [from, setFrom] = useState(contract?.effective_from ?? todayIso());
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [productBusy, setProductBusy] = useState<string | null>(null);

  // The writing number is not asked here (owner, 2026-10-26). It is entered on the Rate card; every
  // contract row must carry one, so a level saved here keeps the number already on file.
  async function saveContract() {
    const bp = levelToBp(level);
    if (bp === null || !from || !contract) return;
    if (bp === contract.contract_level_bp && from === contract.effective_from) return;
    setSaving("saving");
    setError(null);
    const result = await send("/api/app/carrier-library/tenant-carriers", "POST", { carrier_id: carrier.id, contract_level_bp: bp, writing_number: contract.writing_number, effective_from: from });
    if (!result.ok) { setSaving("idle"); setError(result.error); return; }
    setSaving("saved");
    await onSaved();
  }

  async function toggleProduct(product: CarrierProductView) {
    setProductBusy(product.id);
    let target = product;
    // A platform product is read-only: the agency's own copy carries its on/off.
    if (!product.tenantOwned) {
      const copy = await send(`/api/app/settings/sales/products/${product.id}/copy`, "POST");
      if (!copy.ok) { setProductBusy(null); notify.block(copy.error); return; }
      target = (copy.data as { product: CarrierProductView }).product;
    }
    const result = await send(`/api/app/settings/sales/products/${target.id}`, "PATCH", productBody(target, !product.isActive));
    setProductBusy(null);
    if (!result.ok) { notify.block(result.error); return; }
    await onSaved();
  }

  async function setSwitch(next: boolean) {
    const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: carrier.id, contracted: next });
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(next ? `${carrier.name} is switched back on` : `${carrier.name} is switched off: no new quotes, applications or leads for it`);
    await onSaved();
  }

  const levelBad = level.trim() !== "" && levelToBp(level) === null;
  const map = sales ? MAP_CHIP[sales.fieldMap.status] : null;
  return (
    <div className={cn(CARD, SCROLL, "flex min-h-0 flex-col gap-4 border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2.5"><span className={cn("size-3 rounded-full", dot)} aria-hidden="true" /><h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{carrier.name}</h3></span>
          <p className={cn("m-0 mt-1 text-xs", states.length ? "text-[var(--muted)]" : "text-[var(--warning-ink)]")}>{switchedOff ? "Switched off: no new quotes, applications or leads" : states.length ? `Appointed in ${states.length} state${states.length === 1 ? "" : "s"}` : "No states yet"}</p>
        </div>
        {map && <StatusChip tone={map.tone}>{map.label}</StatusChip>}
      </div>

      <Kicker id={`hint-contract-${carrier.id}`} text="Contract" />
      <div className="grid gap-3.5 sm:grid-cols-[160px_200px]">
        <label className={FIELD}>
          <Label id={`hint-level-${carrier.id}`} text="Contract level" hint="Your commission rate with this carrier, as they quote it: 110 means 110%. Every commission figure is worked out from it." />
          <span className="relative">
            <input className={cn(control, "pr-7")} inputMode="decimal" disabled={!contract} aria-invalid={levelBad || undefined} value={level} onChange={(event) => setLevel(event.target.value)} onBlur={() => void saveContract()} placeholder="110" />
            <span className="pointer-events-none absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
          </span>
        </label>
        <label className={FIELD}>
          <Label id={`hint-from-${carrier.id}`} text="Contracted from" hint="The date your contract with this carrier started. A new level saved from a later date keeps the earlier one for older policies." />
          <input className={control} type="date" disabled={!contract} value={from} onChange={(event) => setFrom(event.target.value)} onBlur={() => void saveContract()} />
        </label>
      </div>
      {!contract && (
        <p className="m-0 text-xs text-[var(--warning-ink)]">
          This carrier has no contract on file yet. Start it on the <Link href="/app/rate-card" className="font-semibold underline">Rate card</Link> (it asks for your writing number), then set the level here.
        </p>
      )}
      {levelBad && <p className="m-0 text-xs text-[var(--error-ink)]">Write the level as a number, like 110.</p>}
      {error && <Callout tone="error" title={error} />}

      {salesAvailable && (<>
        <Kicker id={`hint-products-${carrier.id}`} text="Products you sell with them" hint="Tick every product you are contracted to sell with this carrier. Only these show up when you quote." />
        {sales && sales.products.length ? (
          <div className="flex flex-wrap gap-1.5">
            {sales.products.map((product) => (
              <button key={product.id} type="button" onClick={() => void toggleProduct(product)} aria-pressed={product.isActive} disabled={!canEditProducts || productBusy !== null} className={CHIP(product.isActive)}>
                {product.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-[var(--muted)]">{sales ? "No products for this carrier in the library yet." : "Save the contract above and this carrier's products appear here."}</p>
        )}
      </>)}

      <Kicker id={`hint-states-${carrier.id}`} text="Appointed states" hint="Set on the States step: pick a state, tick this carrier." />
      <div className="flex flex-wrap items-center gap-1.5">
        {states.map((code) => <span key={code} className="inline-flex h-7 items-center rounded-full bg-[var(--primary-soft)] px-2.5 text-xs font-semibold text-[var(--accent-ink)]">{code}</span>)}
        <button type="button" onClick={onSetStates} className={CHIP(false)}>Set states →</button>
      </div>

      {salesAvailable && (<>
        <Kicker id={`hint-map-${carrier.id}`} text="Field map" hint="Built in the browser extension; it lets the extension fill this carrier's application for you." />
        <p className="m-0 text-sm text-[var(--body)]">
          {map ? <><strong className="font-semibold text-[var(--ink)]">{map.label}.</strong> </> : null}
          Maps are proposed and checked in the extension. <Link href="/app/settings#sales-field-maps" className="font-semibold text-[var(--accent-ink)] hover:underline">Field maps</Link> · <Link href="/app/settings#sales-carriers" className="font-semibold text-[var(--accent-ink)] hover:underline">Portal and product details</Link>
        </p>
      </>)}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--muted)]">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Saved as you change it"}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void setSwitch(switchedOff)} className={switchedOff ? undefined : "text-[var(--error-ink)]"}>
          {switchedOff ? "Sell this carrier again" : "Stop selling this carrier"}
        </Button>
      </div>
    </div>
  );
}

/* ── step 3: one state's licence ─────────────────────────────────────────────────────────────── */

function LicenceCard({ state, licence, extended, carriers, today, onSaved }: {
  state: string;
  licence: LicenseRow | null;
  extended: boolean;
  carriers: { id: string; name: string; dot: string }[];
  today: string;
  onSaved: () => Promise<void>;
}) {
  const [number, setNumber] = useState(licence?.license_number ?? "");
  const [type, setType] = useState<LicenceType>(licence?.licence_type ?? "non_resident");
  const [expires, setExpires] = useState(licence?.expires_at ?? "");
  const [lines, setLines] = useState<string[]>(licence?.lines_of_authority ?? []);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const status = licenceStatus(licence, today);

  async function save(nextType = type, nextLines = lines) {
    if (!number.trim() || !expires) return;
    const sameLines = [...nextLines].sort().join() === [...(licence?.lines_of_authority ?? [])].sort().join();
    if (licence && number.trim() === licence.license_number && expires === licence.expires_at && nextType === (licence.licence_type ?? "non_resident") && sameLines) return;
    setSaving("saving");
    setError(null);
    const result = await send("/api/app/appointment-vault/licenses", "POST", { state, license_number: number.trim(), expires_at: expires, ...(extended ? { licence_type: nextType, lines_of_authority: nextLines } : {}) });
    if (!result.ok) { setSaving("idle"); setError(result.error); return; }
    setSaving("saved");
    await onSaved();
  }

  return (
    <div className={cn(CARD, SCROLL, "flex min-h-0 flex-col gap-4 border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] p-5")}>
      <div>
        <h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{STATE_NAME.get(state)}</h3>
        <p className={cn("m-0 mt-1 text-xs font-semibold", !status ? "text-[var(--warning-ink)]" : status.tone === "good" ? "text-[var(--accent-ink)]" : status.tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--error-ink)]")}>
          {status ? `${status.label} · expires ${formatDay(licence?.expires_at)}` : "No licence on file. Add it to sell here."}
        </p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_190px]">
        <label className={FIELD}>
          <Label id={`hint-licno-${state}`} text="Licence number" hint="The number on the licence the state's insurance department issued you." />
          <input className={control} value={number} onChange={(event) => setNumber(event.target.value)} onBlur={() => void save()} placeholder="From your state licence" />
        </label>
        {extended && (
          <span className={FIELD}>
            <Label id={`hint-lictype-${state}`} text="Type" hint="Resident: the state you live in. Non-resident: any other state you are licensed in." />
            <span className="mt-1.5 flex gap-1.5">
              {(["resident", "non_resident"] as const).map((value) => (
                <button key={value} type="button" onClick={() => { setType(value); void save(value); }} aria-pressed={type === value} className={cn(CHIP(type === value), "h-9")}>{value === "resident" ? "Resident" : "Non-resident"}</button>
              ))}
            </span>
          </span>
        )}
        <label className={FIELD}>
          <Label id={`hint-licexp-${state}`} text="Expires" hint="The renewal date on the licence. We remind you before it runs out." />
          <input className={control} type="date" value={expires} onChange={(event) => setExpires(event.target.value)} onBlur={() => void save()} />
        </label>
      </div>
      {extended && (<>
        <Kicker id={`hint-liclines-${state}`} text="Lines of authority" hint="What the licence lets you sell in this state, as printed on it: Life, Health and so on." />
        <div className="flex flex-wrap gap-1.5">
          {LINES_OF_AUTHORITY.map((line) => {
            const on = lines.includes(line);
            return (
              <button key={line} type="button" onClick={() => { const next = on ? lines.filter((l) => l !== line) : [...lines, line]; setLines(next); void save(type, next); }} aria-pressed={on} className={CHIP(on)}>{line}</button>
            );
          })}
        </div>
      </>)}
      {error && <Callout tone="error" title={error} />}
      <Kicker id={`hint-licarriers-${state}`} text="Carriers that appointed you here" hint="Set on the States step." />
      <div className="flex flex-wrap items-center gap-1.5">
        {carriers.length === 0 && <span className="text-sm text-[var(--muted)]">None yet.</span>}
        {carriers.map((carrier) => <span key={carrier.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 text-xs font-semibold text-[var(--ink)]"><span className={cn("size-2 rounded-full", carrier.dot)} aria-hidden="true" />{carrier.name}</span>)}
      </div>
      <div className="mt-auto border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Saved as you change it"}</div>
    </div>
  );
}

/* ── add a carrier ───────────────────────────────────────────────────────────────────────────── */

function AddCarrierDialog({ options, busy, onAdd, onClose }: { options: { id: string; name: string }[]; busy: boolean; onAdd: (id: string, name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = options.filter((carrier) => carrier.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="border-[var(--border)] bg-[var(--surface)] sm:max-w-md">
        <DialogHeader><DialogTitle className="text-[var(--ink)]">Add a carrier you are contracted with</DialogTitle></DialogHeader>
        <input className={cn(control, "mt-0")} aria-label="Search the carrier library" placeholder="Search the carrier library" value={q} onChange={(event) => setQ(event.target.value)} autoFocus />
        <div className={cn(SCROLL, "max-h-[360px]")}>
          {shown.length === 0 && <p className="m-0 px-2 py-3 text-sm text-[var(--muted)]">{options.length ? "No carrier matches." : "Every carrier in the library is already yours."}</p>}
          {shown.map((carrier) => (
            <button key={carrier.id} type="button" onClick={() => onAdd(carrier.id, carrier.name)} disabled={busy} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2.5 text-left text-sm text-[var(--ink)] hover:bg-[var(--surface-alt)] disabled:cursor-wait">
              {carrier.name}<span className="font-semibold text-[var(--accent-ink)]">Add</span>
            </button>
          ))}
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">Not listed? Ask support to add it to the library.</p>
      </DialogContent>
    </Dialog>
  );
}
