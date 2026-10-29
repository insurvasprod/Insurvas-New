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

import { Callout, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { CarrierCard, ProgressLine, carrierProgress } from "@/components/app/settings/carrier-card";
import { CarrierFieldMaps } from "@/components/app/settings/carrier-field-maps";
import { ContractingSetup, setupProgress } from "@/components/app/settings/contracting-setup";
import { Pager } from "@/components/ui/pager";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import { licenceExpiryValue, licenceNumberValue } from "@/lib/appointments/tickModel";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import {
  appointedStatesFor, bpToLevel, carriersIn, pendingStatesFor, todayIso,
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

/** Each carrier's dot, by its place in your list. Tokens only. */
const DOTS = ["bg-[var(--primary)]", "bg-[var(--info)]", "bg-[var(--warning)]", "bg-[var(--error)]", "bg-[var(--accent-ink)]", "bg-[var(--muted)]"];
/** A quiet scrollbar for the long lists (owner, 2026-10-26: not the browser's white one). */
const SCROLL =
  "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
/** The two panes fill the screen on desktop; on a phone they stack and the list scrolls in place. */
// Each pane is only as tall as what is in it, up to the screen's height, where it scrolls
// (owner, 2026-10-29: no empty card when a list is short).
const PANES = "grid items-start gap-4 @3xl:h-[calc(100dvh-var(--top-bar-h)-250px)] @3xl:grid-cols-[300px_minmax(0,1fr)] @5xl:grid-cols-[360px_minmax(0,1fr)] [&>*]:max-h-[26rem] @3xl:[&>*]:max-h-full";
/** The kit's glass card (UI-CONSISTENCY §5b), not a local copy of it. */
const PANE = cardSurface;
async function send(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return response.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string } | null)?.error ?? "That could not be saved" };
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
  const [carrierId, setCarrierId] = useState<string | null>(null);
  // The carrier open in the Edit dialog (Carriers is a read-only grid; editing opens on demand).
  const [editingId, setEditingId] = useState<string | null>(null);
  const today = todayIso();

  // The two panes fill exactly what is left of the screen, so the page itself does not scroll
  // (owner, 2026-10-26); only the lists and cards inside scroll. Desktop only: a phone stacks them.
  const panes = useRef<HTMLDivElement | null>(null);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const fit = useCallback(() => {
    const element = panes.current;
    // Only while the two panes sit side by side (48rem of content); stacked, each is as tall as it is.
    if (!element || (element.parentElement?.clientWidth ?? 0) < 768) { setPaneHeight(null); return; }
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
  const current = yours.find((carrier) => carrier.id === carrierId) ?? yours[0] ?? null;
  const editing = editingId ? yours.find((carrier) => carrier.id === editingId) ?? null : null;

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


  // Saves run in a queue; once it is empty the lists are read again, and the licences follow the
  // states that were ticked (one sync for the batch, not one per click). A read that newer ticks
  // overtook is dropped, so it never undoes them.
  async function afterSetupSaves(isStale?: () => boolean) {
    const fresh = await loadVault(isStale);
    if (fresh && touched.current.size) await syncLicences(fresh, [...touched.current], isStale);
    if (!isStale?.()) touched.current.clear();
    await loadSales();
  }

  const nAppointed = appointedStates.size;
  const setup = setupProgress(vault, today);
  const setupDone = setup.complete;

  const listCard = (children: ReactNode) => <div className={cn(PANE, "flex min-h-0 flex-col gap-2.5 p-3.5")}>{children}</div>;
  const listBody = (children: ReactNode) => <div className={cn(SCROLL, "-mx-1.5 max-h-[420px] min-h-0 flex-1 px-1.5 lg:max-h-none")}>{children}</div>;

  const openStep = (next: Step) => { setStep(next); };
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
      {/* Manager review 29 Oct (10:02–11:10): once set up, the wizard goes and Carriers and States are
          read-only overviews; one button reopens the set-up to change them. No Add Carriers, no ⋯:
          a person only ticks the carriers that are there, and Field maps (postponed) has its link. */}
      <ViewTabs
        label="Contracting"
        value={step}
        onChange={pickStep}
        tabs={[
          ...(!setupDone || step === "setup" ? [{ key: "setup" as const, label: setupDone ? "Set Up" : `Set Up · ${setup.percent}%` }] : []),
          { key: "carriers" as const, label: "Carriers", count: yours.length },
          { key: "states" as const, label: "States", count: nAppointed },
          ...(step === "maps" ? [{ key: "maps" as const, label: "Field maps" }] : []),
        ]}
        actions={setupDone && step !== "setup" ? (
          <Button type="button" variant="outline" data-guide="carrier-library-add" onClick={() => pickStep("setup")}>Change Carriers or States</Button>
        ) : undefined}
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
        yours.length === 0 ? (
          <div className={cn(PANE, "flex flex-col items-center gap-3 p-8 text-center")}>
            <p className="m-0 text-sm font-semibold text-[var(--ink)]">No carriers yet</p>
            <p className="m-0 text-sm text-[var(--muted)]">Tick the carriers you are contracted with, then the states you sell in.</p>
            <Button type="button" onClick={() => pickStep("setup")}>Start set-up</Button>
          </div>
        ) : (
          <FittedGrid
            items={yours}
            noun="carriers"
            rowHeight={144}
            className="grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3"
            keyOf={(carrier) => carrier.id}
            render={(carrier) => {
              const contract = vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active) ?? null;
              const off = Boolean(vault.carrierRequirements?.some((row) => row.carrier_id === carrier.id && row.contracted === false));
              const appointed = appointedStatesFor(vault.appointments, carrier.id, today);
              return (
                <div className={cn(PANE, "flex h-full flex-col gap-3 overflow-hidden p-4", off && "opacity-70")}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-2.5 shrink-0 rounded-full", dotOf(carrier.id))} aria-hidden="true" />
                      <span className="truncate text-sm font-semibold text-[var(--ink)]" title={carrier.name}>{carrier.name}</span>
                    </span>
                    <ProgressLine progress={progressOf(carrier.id)} switchedOff={off} />
                  </div>
                  <dl className="m-0 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-[var(--muted)]">Level</dt><dd className="m-0 font-semibold tabular-nums text-[var(--ink)]">{contract ? `${bpToLevel(contract.contract_level_bp)}%` : "—"}</dd></div>
                    <div className="min-w-0"><dt className="text-[var(--muted)]">Writing number</dt><dd className="m-0 truncate font-mono text-[var(--ink)]">{contract?.writing_number || "—"}</dd></div>
                    <div><dt className="text-[var(--muted)]">States</dt><dd className="m-0 font-semibold tabular-nums text-[var(--ink)]">{appointed.length}</dd></div>
                  </dl>
                  {/* Any number of states fits one line: the first few, then "+N" (all of them on hover). */}
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <p className="m-0 min-w-0 truncate font-mono text-xs text-[var(--muted)]" title={appointed.join(", ")}>{appointed.length ? firstFew(appointed, 6, " · ") : "No states yet"}</p>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditingId(carrier.id)}>Edit</Button>
                  </div>
                </div>
              );
            }}
          />
        )
      )}
      {editing && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditingId(null); }}>
          <DialogContent size={"lg"} className="max-h-[90vh] overflow-y-auto p-0">
            <DialogTitle className="sr-only">{editing.name}</DialogTitle>
            <CarrierCard
              key={editing.id}
              // The header row leaves room for the dialog's X, which sat on the status chip.
              className="p-5 [&>*:first-child]:pr-9"
              carrier={editing}
              dot={dotOf(editing.id)}
              contract={vault.tenantCarriers.find((row) => row.carrier_id === editing.id && row.is_active) ?? null}
              switchedOff={Boolean(vault.carrierRequirements?.some((row) => row.carrier_id === editing.id && row.contracted === false))}
              states={appointedStatesFor(vault.appointments, editing.id, today)}
              pendingStates={pendingStatesFor(vault.appointments, editing.id, today)}
              sales={salesOf(editing.id)}
              salesAvailable={sales !== null}
              productLines={sales?.productLines ?? []}
              canEdit={sales?.canEdit ?? true}
              onSetStates={() => { setEditingId(null); pickStep("setup"); }}
              onSaved={async () => { await Promise.all([loadVault(), loadSales()]); }}
            />
          </DialogContent>
        </Dialog>
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

      {step === "states" && (() => {
        const held = US_STATES.map(([code, name]) => ({ code: code as string, name, ids: carriersIn(vault.appointments, code, today).filter((id) => yours.some((carrier) => carrier.id === id)) })).filter((row) => row.ids.length > 0);
        return held.length === 0 ? (
          <div className={cn(PANE, "flex flex-col items-center gap-3 p-8 text-center")}>
            <p className="m-0 text-sm font-semibold text-[var(--ink)]">No states yet</p>
            <p className="m-0 text-sm text-[var(--muted)]">Pick the states you sell in, in the set-up.</p>
            <Button type="button" onClick={() => pickStep("setup")}>Open set-up</Button>
          </div>
        ) : (
          <FittedGrid
            items={held}
            noun="states"
            rowHeight={80}
            className="grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4"
            keyOf={(row) => row.code}
            render={(row) => {
              const names = row.ids.map((id) => yours.find((carrier) => carrier.id === id)?.name ?? "");
              return (
                <div className={cn(PANE, "flex h-full flex-col justify-center gap-2 overflow-hidden px-4")}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]"><span className="mr-2 font-mono text-xs text-[var(--muted)]">{row.code}</span>{row.name}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--accent-ink)]">{row.ids.length === yours.length ? "All carriers" : `${row.ids.length} of ${yours.length}`}</span>
                  </span>
                  {/* Any number of carriers fits one line: the first two, then "+N more" (all on hover). */}
                  <span className="flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap" title={names.join(", ")}>
                    {row.ids.slice(0, 2).map((id, index) => (
                      <span key={id} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--body)]"><span className={cn("size-2 shrink-0 rounded-full", dotOf(id))} aria-hidden="true" /><span className="truncate">{names[index]}</span></span>
                    ))}
                    {row.ids.length > 2 && <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">+{row.ids.length - 2} more</span>}
                  </span>
                </div>
              );
            }}
          />
        );
      })()}
    </SettingsStack>
  );
}

/** "AK · AL · AZ · GA +12": the first `count`, then how many more. */
function firstFew(list: string[], count: number, joiner: string) {
  return list.length > count ? `${list.slice(0, count).join(joiner)} +${list.length - count}` : list.join(joiner);
}

/**
 * Same-height cards paged to fit the screen (owner, 29 Oct: "we don't want scrolling … what if there
 * are a lot"). On a desktop, the rows that fit between the grid's top and the window's bottom, less
 * the pager, make a page; the columns are the grid's own. A phone scrolls anyway, so it shows six rows.
 */
function FittedGrid<T>({ items, noun, rowHeight, className, keyOf, render }: {
  items: T[];
  noun: string;
  rowHeight: number;
  className: string;
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  const grid = useRef<HTMLUListElement | null>(null);
  const [perPage, setPerPage] = useState(12);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const columns = Math.max(1, style.gridTemplateColumns.split(" ").filter(Boolean).length);
      const gap = parseFloat(style.rowGap) || 0;
      // 32px: the shell's bottom padding; 52px: the pager and the gap above it.
      const room = window.innerWidth >= 1024 ? window.innerHeight - element.getBoundingClientRect().top - 32 - 52 : (rowHeight + gap) * 6;
      setPerPage(columns * Math.max(1, Math.floor((room + gap) / (rowHeight + gap))));
    };
    const timer = window.setTimeout(measure, 0);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(timer); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [rowHeight]);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const shown = Math.min(page, pages);
  return (
    <div className="flex flex-col gap-3">
      <ul ref={grid} className={cn("m-0 grid list-none gap-3 p-0", className)} style={{ gridAutoRows: `${rowHeight}px` }}>
        {items.slice((shown - 1) * perPage, shown * perPage).map((item) => <li key={keyOf(item)} className="min-w-0">{render(item)}</li>)}
      </ul>
      {items.length > perPage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)]">
          <Pager page={shown} total={items.length} noun={noun} pageSize={perPage} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
