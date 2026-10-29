"use client";

/**
 * Settings › Contracting › Set up (manager review 28 Oct, §5; settings redesign R6). The guided page a
 * first-time owner lands on: "I'm sitting here trying to figure out what to do. If you don't tell me, I
 * don't know." Two steps on one page, no pop-up:
 *
 *   1 · Your carriers: tick each carrier you are contracted with; its contract level, start date and
 *       writing number open beside it, all optional (they only feed commission figures).
 *   2 · Your states: tick the states you sell in. A state covers all your carriers by default; open a
 *       row to narrow it to some carriers (an Aetna-only state, say).
 *
 * Every tick shows at once and saves in the background, in order (it was a wait on every click). Work
 * is saved as it happens, and the step you were on is remembered, so leaving and coming back loses
 * nothing. Progress comes from what is saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";

import { control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow } from "@/lib/appointments/service-types";
import { applyAppointmentChanges, appointmentChange, bpToLevel, carriersIn, forServer, levelToBp, statesFor, todayIso } from "@/lib/appointments/tickModel";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";
import { Pager } from "@/components/ui/pager";

/** Carriers on one page of step 1 (manager review 29 Oct, 06:09: pages, not one long scroll). */
const CARRIERS_PER_PAGE = 10;
/** One carrier row's height in step 1 (the row's inputs plus its padding). */
const CARRIER_ROW_HEIGHT = 53;
/** A step's footer stays at the bottom of the view while the list scrolls, so Next is always there. */
const STEP_FOOTER = "sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 rounded-b-[12px] border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3";

export type SetupVault = {
  carriers: { id: string; name: string }[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  carrierRequirements: { carrier_id: string; contracted: boolean }[] | null;
};

type Send = (url: string, method: string, body?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/** Step 1's columns: the carrier, then its three optional contract fields. */
const ROW = "grid-cols-[minmax(0,1fr)_96px_150px_170px] items-center gap-3";

const STEP_KEY = "insurvas.contracting.step";
const readStep = (): 1 | 2 => { try { return window.localStorage.getItem(STEP_KEY) === "2" ? 2 : 1; } catch { return 1; } };
const writeStep = (step: 1 | 2) => { try { window.localStorage.setItem(STEP_KEY, String(step)); } catch { /* private mode: the step is simply not remembered */ } };

/** The carriers the agency sells now: added (contract or switch row) and not switched off. */
export function activeCarriers(vault: SetupVault) {
  const off = new Set((vault.carrierRequirements ?? []).filter((row) => row.contracted === false).map((row) => row.carrier_id));
  const added = new Set([...vault.tenantCarriers.filter((row) => row.is_active).map((row) => row.carrier_id), ...(vault.carrierRequirements ?? []).map((row) => row.carrier_id)]);
  return vault.carriers.filter((carrier) => added.has(carrier.id) && !off.has(carrier.id));
}

/** How far set-up is: half for having carriers, the other half shared by carriers that have a state. */
export function setupProgress(vault: SetupVault, today = todayIso()) {
  const mine = activeCarriers(vault);
  const withStates = mine.filter((carrier) => statesFor(vault.appointments, carrier.id, today).length > 0);
  const percent = mine.length === 0 ? 0 : 50 + Math.round((50 * withStates.length) / mine.length);
  return { mine, withStates, percent, complete: mine.length > 0 && withStates.length === mine.length };
}

export function ContractingSetup({ vault, setVault, salesAvailable, send, reload, onStatesSaved, onFinish }: {
  vault: SetupVault;
  setVault: (update: (current: SetupVault) => SetupVault) => void;
  /** Applications is on: a new carrier is also put on the applications list (its products). */
  salesAvailable: boolean;
  send: Send;
  /** Reads everything again once the queue of saves is empty. */
  /** Reads the lists again; `isStale` says newer ticks overtook this read, so it must not apply. */
  reload: (isStale?: () => boolean) => Promise<unknown>;
  /** After state ticks save: keep licences in step with the states (the parent's existing rule). */
  onStatesSaved: (states: string[]) => Promise<void>;
  onFinish: () => void;
}) {
  const today = todayIso();
  const [step, setStepState] = useState<1 | 2>(1);
  // The remembered step, read after mount (localStorage is not there on the server).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a stored preference, read once on mount
  useEffect(() => { setStepState(readStep()); }, []);
  const setStep = (next: 1 | 2) => { setStepState(next); writeStep(next); document.getElementById("contracting-setup")?.scrollIntoView({ block: "start", behavior: "smooth" }); };

  // ── one queue of saves, in order, never blocking the screen ──────────────────────────────────
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  // Every tick counts; a read that started before the latest tick is dropped so it never undoes it.
  const edits = useRef(0);
  const enqueue = useCallback((work: () => Promise<boolean>) => {
    edits.current += 1;
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      const ok = await work().catch(() => false);
      if (!ok) setFailed("Something didn't save. The list has been read again, so it shows what is saved.");
    }).finally(() => {
      setPending((n) => {
        const left = n - 1;
        if (left === 0) { const at = edits.current; void reload(() => edits.current !== at); }
        return left;
      });
    });
  }, [reload]);

  const progress = useMemo(() => setupProgress(vault, today), [vault, today]);
  const mine = progress.mine;
  const mineIds = new Set(mine.map((carrier) => carrier.id));

  /* ── step 1 · carriers ─────────────────────────────────────────────────────────────────────── */

  const [query, setQuery] = useState("");
  const [libraryPage, setLibraryPage] = useState(1);
  // As many carriers as fit above the step's footer on a desktop, so the step needs no scroll
  // (owner, 29 Oct); never more than ten. A phone scrolls anyway and keeps ten.
  const listRef = useRef<HTMLUListElement | null>(null);
  const [perPage, setPerPage] = useState(CARRIERS_PER_PAGE);
  useEffect(() => {
    const measure = () => {
      const list = listRef.current;
      if (!list || window.innerWidth < 1024) { setPerPage(CARRIERS_PER_PAGE); return; }
      // 32px: the shell's bottom padding; 72px: the footer and the gap above it.
      const room = window.innerHeight - list.getBoundingClientRect().top - 32 - 72;
      setPerPage(Math.min(CARRIERS_PER_PAGE, Math.max(4, Math.floor(room / CARRIER_ROW_HEIGHT))));
    };
    const timer = window.setTimeout(measure, 0);
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", measure); };
  }, [step]);
  const needle = query.trim().toLowerCase();
  const library = vault.carriers.filter((carrier) => !needle || carrier.name.toLowerCase().includes(needle));
  const shownPage = Math.min(libraryPage, Math.max(1, Math.ceil(library.length / perPage)));

  function toggleCarrier(carrier: { id: string; name: string }) {
    const on = !mineIds.has(carrier.id);
    setFailed(null);
    setVault((current) => ({ ...current, carrierRequirements: [...(current.carrierRequirements ?? []).filter((row) => row.carrier_id !== carrier.id), { carrier_id: carrier.id, contracted: on }] }));
    enqueue(async () => {
      const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: carrier.id, contracted: on });
      if (!result.ok) return false;
      if (on && salesAvailable) {
        const listed = await send("/api/app/settings/sales/carriers", "POST", { carrier_id: carrier.id });
        if (!listed.ok && !/already on your list/i.test(listed.error)) notify.warn(`Products could not be loaded for ${carrier.name}`, { detail: "The carrier is added. Open it on Carriers to try again." });
      }
      return true;
    });
  }

  /* ── step 2 · states ───────────────────────────────────────────────────────────────────────── */

  const [stateQuery, setStateQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const stateNeedle = stateQuery.trim().toLowerCase();
  const states = US_STATES.filter(([code, name]) => !stateNeedle || code.toLowerCase() === stateNeedle || name.toLowerCase().includes(stateNeedle));
  const carriersHere = (code: string) => carriersIn(vault.appointments, code, today).filter((id) => mineIds.has(id));

  function setAppointments(codes: string[], carrierIds: string[], on: boolean) {
    const changes = codes.flatMap((code) => carrierIds.flatMap((id) => appointmentChange(vault.appointments, id, code, on, today)));
    if (!changes.length) return;
    setFailed(null);
    setVault((current) => ({ ...current, appointments: applyAppointmentChanges(current.appointments, changes, today) }));
    enqueue(async () => {
      const result = await send("/api/app/appointment-vault/appointments", "POST", { appointments: forServer(changes) });
      if (!result.ok) return false;
      await onStatesSaved(codes);
      return true;
    });
  }

  const allIds = mine.map((carrier) => carrier.id);
  const chosenStates = US_STATES.filter(([code]) => carriersHere(code).length > 0).length;
  const missing = mine.filter((carrier) => statesFor(vault.appointments, carrier.id, today).length === 0);

  /* ── layout ────────────────────────────────────────────────────────────────────────────────── */

  const saving = pending > 0;
  const status = failed
    ? <span role="alert" className="text-xs text-[var(--error-ink)]">{failed}</span>
    : <span role="status" aria-live="polite" className="text-xs text-[var(--muted)]">{saving ? "Saving…" : "Saved as you go. You can leave and come back."}</span>;

  return (
    <div id="contracting-setup" className="flex min-w-0 scroll-mt-24 flex-col gap-4">
      {/* Where you are: two steps, each with its own bar, no card and no connector line (manager review
          29 Oct, 08:32: "these lines don't look good"). Green when done, the brand colour for the step
          you are on. Either step can be opened from here. */}
      <ol aria-label="Set-up steps" className="m-0 grid list-none grid-cols-2 gap-3 p-0">
        {([[1, "Your carriers", mine.length > 0], [2, "Your states", progress.complete]] as const).map(([n, label, done]) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => setStep(n)}
              aria-current={step === n ? "step" : undefined}
              className="group flex w-full flex-col gap-2 rounded-md pt-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              <span aria-hidden="true" className={cn("h-1 w-full rounded-full transition-colors", step === n ? "bg-[var(--primary)]" : done ? "bg-[var(--success)]" : "bg-[var(--border)] group-hover:bg-[var(--border-strong)]")} />
              <span className={cn("flex items-center gap-2 text-sm font-medium", step === n ? "text-[var(--ink)]" : "text-[var(--muted)] group-hover:text-[var(--ink)]")}>
                <span className="text-xs tabular-nums text-[var(--muted)]">Step {n}</span>
                {label}
                {done && <Check aria-label="done" className="size-3.5 text-[var(--success)]" />}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {step === 1 ? (
        <section aria-labelledby="contracting-step-1" className={cn(cardSurface, "flex flex-col gap-4 p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="contracting-step-1" className="m-0 flex items-center gap-1 text-card-title text-[var(--ink)]">
              Which carriers are you contracted with?
              <InfoTip label="About this step">Tick each one. Contract details are optional: add them now or later, they only feed commission figures.</InfoTip>
            </h3>
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--muted)] tabular-nums">{mine.length} selected</span>
              <input className={cn(control, "mt-0 w-64 max-w-full")} aria-label="Search carriers" placeholder="Search carriers" value={query} onChange={(event) => { setQuery(event.target.value); setLibraryPage(1); }} />
            </span>
          </div>
          {/* One header for the three optional fields, not a label on every row. */}
          <div aria-hidden="true" className={cn(ROW, "hidden border-b border-[var(--border)] pb-2 text-label text-[var(--muted)] sm:grid")}>
            <span>Carrier</span><span>Level</span><span>Contracted from</span><span>Writing number</span>
          </div>
          <ul ref={listRef} className="-mt-4 m-0 flex list-none flex-col p-0">
            {library.length === 0 && <li className="py-3 text-sm text-[var(--muted)]">No carrier matches. <a className="font-medium text-[var(--accent-ink)] hover:underline" href="mailto:support@insurvas.com?subject=Please%20add%20a%20carrier%20to%20the%20library">Ask Insurvas to add it</a></li>}
            {library.slice((shownPage - 1) * perPage, shownPage * perPage).map((carrier) => (
              <CarrierRow
                key={carrier.id}
                carrier={carrier}
                on={mineIds.has(carrier.id)}
                contract={vault.tenantCarriers.find((row) => row.carrier_id === carrier.id && row.is_active) ?? null}
                onToggle={() => toggleCarrier(carrier)}
                send={send}
                enqueue={enqueue}
              />
            ))}
          </ul>
          {/* Always in view while the step is done (manager review 29 Oct, 05:39). The pages sit here
              with Next, one bar of controls, rather than loose under the list. */}
          <footer className={STEP_FOOTER}>
            {status}
            <span className="flex flex-wrap items-center gap-4">
              {library.length > perPage && (
                <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <Pager page={shownPage} total={library.length} noun="carriers" pageSize={perPage} onPage={setLibraryPage} />
                </span>
              )}
              <Button type="button" disabled={mine.length === 0} onClick={() => setStep(2)}>Next: set up states →</Button>
            </span>
          </footer>
        </section>
      ) : (
        <section aria-labelledby="contracting-step-2" className={cn(cardSurface, "flex flex-col gap-4 p-4")}>
          {/* Owner, 29 Oct: no scrolling. All 51 states fit as tiles; the state in focus shows its
              carriers on the right, one tick each (manager review 29 Oct, 08:05: "a card … showing
              me all the carriers, tick by tick"). A tile only opens its state: nothing is ticked until the
              person ticks a carrier in the card (owner, 29 Oct). No region shortcuts (owner, 29 Oct). */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="contracting-step-2" className="m-0 flex items-center gap-1 text-card-title text-[var(--ink)]">
              Which states do you sell in?
              <InfoTip label="About this step">Pick a state to see your carriers in it, then tick the ones you are appointed with there.</InfoTip>
            </h3>
            {mine.length > 0 && (
              <span className="flex flex-wrap items-center gap-3">
                {missing.length > 0 && <StatusChip tone="warning">{missing.map((carrier) => carrier.name).join(", ")} {missing.length === 1 ? "has" : "have"} no state yet</StatusChip>}
                <span className="text-sm text-[var(--muted)] tabular-nums">{chosenStates} state{chosenStates === 1 ? "" : "s"} chosen</span>
                <input className={cn(control, "mt-0 w-56 max-w-full")} aria-label="Search states" placeholder="Search states" value={stateQuery} onChange={(event) => setStateQuery(event.target.value)} />
              </span>
            )}
          </div>
          {mine.length === 0 ? (
            <p className="m-0 text-sm text-[var(--body)]">Choose your carriers first. <button type="button" className="font-medium text-[var(--accent-ink)] hover:underline" onClick={() => setStep(1)}>Go to step 1</button></p>
          ) : (
            <>
              <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_240px] @6xl:grid-cols-[minmax(0,1fr)_300px]">
                <ul aria-label="States" className="m-0 grid list-none content-start gap-1.5 p-0 grid-cols-[repeat(auto-fill,minmax(62px,1fr))] @6xl:grid-cols-[repeat(auto-fill,minmax(96px,1fr))]">
                  {states.length === 0 && <li className="col-span-full py-3 text-sm text-[var(--muted)]">No state matches.</li>}
                  {states.map(([code, name]) => {
                    const here = carriersHere(code);
                    const on = here.length > 0;
                    const focused = open === code;
                    return (
                      <li key={code}>
                        <button
                          type="button"
                          aria-pressed={focused}
                          aria-label={`${name}${on ? `, ${here.length} of ${mine.length} carriers` : ", no carriers"}`}
                          title={name}
                          onClick={() => setOpen(code)}
                          className={cn(
                            "flex h-9 w-full flex-col items-start justify-center rounded-[8px] border px-2 text-left transition-colors",
                            on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]",
                            focused && "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]",
                          )}
                        >
                          <span className="flex w-full items-center justify-between gap-1">
                            <span className={cn("font-mono text-xs font-semibold", on ? "text-[var(--accent-ink)]" : "text-[var(--ink)]")}>{code}</span>
                            {on && (here.length === mine.length ? <Check aria-hidden="true" className="size-3 text-[var(--accent-ink)]" /> : <span className="text-xs leading-none font-semibold tabular-nums text-[var(--accent-ink)]">{here.length}/{mine.length}</span>)}
                          </span>
                          <span className="w-full truncate text-xs leading-tight text-[var(--muted)]">{name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* The card is as tall as its carriers (it was held to the tiles' height and squeezed its list, owner
                    29 Oct); only a very long list scrolls, inside the card. */}
                <div className="flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] p-3 @3xl:self-start">
                  {(() => {
                    const focus = open ? US_STATES.find(([code]) => code === open) : null;
                    if (!focus) return <p className="m-0 py-8 text-center text-sm text-[var(--muted)]">Pick a state to see its carriers here.</p>;
                    const [code, name] = focus;
                    const here = carriersHere(code);
                    return (
                      <div role="group" aria-label={`Carriers in ${name}`} className="flex min-h-0 flex-1 flex-col gap-2">
                        <div className="flex items-baseline justify-between gap-2 px-1">
                          <span className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                          <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{here.length} of {mine.length} carriers</span>
                        </div>
                        <div className="flex max-h-[min(45vh,400px)] flex-col overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1">
                          {mine.map((carrier) => {
                            const has = here.includes(carrier.id);
                            return (
                              <button key={carrier.id} type="button" role="checkbox" aria-checked={has} onClick={() => setAppointments([code], [carrier.id], !has)} className="flex shrink-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-alt)]">
                                <span aria-hidden="true" className={cn("inline-grid size-4 shrink-0 place-items-center rounded-[4px] border", has ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>{has && <Check className="size-3" />}</span>
                                <span className={cn("min-w-0 flex-1 truncate", has ? "text-[var(--ink)]" : "text-[var(--muted)]")}>{carrier.name}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-2 px-1">
                          {here.length < mine.length ? (
                            <button type="button" onClick={() => setAppointments([code], allIds, true)} className="rounded-md py-0.5 text-xs font-medium text-[var(--accent-ink)] hover:underline">Tick all</button>
                          ) : <span />}
                          {here.length > 0 && (
                            <button type="button" onClick={() => setAppointments([code], allIds, false)} className="rounded-md py-0.5 text-xs font-medium text-[var(--error-ink)] hover:underline">
                              Remove {name}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
          <footer className={STEP_FOOTER}>
            <Button type="button" variant="outline" onClick={() => setStep(1)}>← Back</Button>
            <span className="flex flex-wrap items-center gap-3">
              {status}
              <Button type="button" disabled={chosenStates === 0 || saving} onClick={() => { writeStep(1); onFinish(); }}>Finish set-up</Button>
            </span>
          </footer>
        </section>
      )}
    </div>
  );
}

/** One library carrier: its tick, and once ticked its three optional contract fields on the same row. */
function CarrierRow({ carrier, on, contract, onToggle, send, enqueue }: {
  carrier: { id: string; name: string };
  on: boolean;
  contract: TenantCarrierRow | null;
  onToggle: () => void;
  send: Send;
  enqueue: (work: () => Promise<boolean>) => void;
}) {
  const [level, setLevel] = useState(bpToLevel(contract?.contract_level_bp));
  const [from, setFrom] = useState(contract?.effective_from ?? todayIso());
  const [writing, setWriting] = useState(contract?.writing_number ?? "");
  const levelBad = level.trim() !== "" && levelToBp(level) === null;

  // Saved when all three are there (the contract needs all three); a half-filled row waits quietly.
  function save() {
    const bp = levelToBp(level);
    if (bp === null || !from || !writing.trim()) return;
    if (contract && bp === contract.contract_level_bp && from === contract.effective_from && writing.trim() === contract.writing_number) return;
    enqueue(async () => (await send("/api/app/carrier-library/tenant-carriers", "POST", { carrier_id: carrier.id, contract_level_bp: bp, writing_number: writing.trim(), effective_from: from })).ok);
  }

  const id = `contracting-${carrier.id}`;
  return (
    <li className={cn("-mx-4 border-b border-[var(--border)] px-4 py-2 last:border-b-0", on && "bg-[color-mix(in_srgb,var(--primary-soft)_45%,transparent)]")}>
      <div className={cn("flex flex-col gap-2 sm:grid", ROW)}>
        <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className="flex min-w-0 items-center gap-3 rounded-md py-1.5 text-left">
          <span aria-hidden="true" className={cn("inline-grid size-[18px] shrink-0 place-items-center rounded-[5px] border", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>{on && <Check className="size-3" />}</span>
          <span className="truncate text-sm font-medium text-[var(--ink)]">{carrier.name}</span>
        </button>
        {on && (
          <>
            <span className="relative block">
              <input id={`${id}-level`} aria-label={`${carrier.name} contract level, percent`} className={cn(control, "mt-0 pr-7 tabular-nums")} inputMode="decimal" placeholder="Level" value={level} aria-invalid={levelBad || undefined} title={levelBad ? "A number, like 110" : undefined} onChange={(event) => setLevel(event.target.value)} onBlur={save} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
            </span>
            <input id={`${id}-from`} aria-label={`${carrier.name} contracted from`} className={cn(control, "mt-0")} type="date" value={from} onChange={(event) => setFrom(event.target.value)} onBlur={save} />
            <input id={`${id}-writing`} aria-label={`${carrier.name} writing number`} className={cn(control, "mt-0 font-mono")} autoComplete="off" spellCheck={false} placeholder="Optional" value={writing} onChange={(event) => setWriting(event.target.value)} onBlur={save} />
          </>
        )}
      </div>
    </li>
  );
}
