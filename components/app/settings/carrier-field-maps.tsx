"use client";

/**
 * Settings › Carriers › 3 · Field maps (owner pick "B", 2026-10-27, as a tab of its own). LA-3.13: a field
 * map tells the browser extension where each answer goes on a carrier's application. It replaces the
 * Settings › Carrier field maps section, whose table of CSS selectors is still here behind "Show
 * selectors" with every edit it had (selector, kind, format, checked, add a field, save, publish).
 *
 * The list on the left is your carriers with each one's autofill state; the card on the right is the
 * carrier's contract at a glance, then its Autofill: what is wrong in plain words, one main action,
 * the fill rate, the version and the fields by page of the form, each Checked, To check or Not found.
 *
 * Rules kept from the old screen (and enforced again by the API): a published map never changes, so an
 * edit saves the next version as a draft; a map cannot publish until every sensitive field (SSN,
 * routing, account and card numbers) is checked by a person; an Insurvas map is read-only until it is
 * copied to the agency. Building and checking a map on the carrier's page is the extension's job
 * (board C, later): the "in the extension" buttons open the carrier's site, where the extension runs.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Plus } from "lucide-react";

import { Callout, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { isSensitiveKey } from "@/lib/applications/constants";
import { EDITABLE_FIELD_MAP_STATUSES, FIELD_MAP_INPUT_KINDS, type FieldMapInputKind } from "@/lib/extension/constants";
import { CANONICAL_OPTIONS, INPUT_KIND_LABEL, PAGE_LABEL, fieldLabel, listOf, mapRequest, newEntry, savePayload, unverifiedSensitive } from "@/lib/extension/mapEditing";
import { FIELD_MAP_TRANSFORMS, TRANSFORM_LABEL, isTransform } from "@/lib/extension/transforms";
import type { FieldMapCarrierOption, FieldMapEntryView, FieldMapView } from "@/lib/extension/types";
import { cardInset } from "@/components/ui/card";
import { LeaveGuard } from "@/components/ui/leave-guard";

export type MapsCarrier = { id: string; name: string; dot: string; level: string | null; products: string[]; states: number };

type Autofill = "ready" | "review" | "draft" | "insurvas" | "none";
const LOOK: Record<Autofill, { label: string; fg: string; tint: string; line: string }> = {
  ready: { label: "Ready", fg: "text-[var(--accent-ink)]", tint: "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]", line: "border-[var(--border)]" },
  review: { label: "Needs you", fg: "text-[var(--warning-ink)]", tint: "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]", line: "border-[color-mix(in_srgb,var(--warning)_55%,transparent)]" },
  draft: { label: "Draft", fg: "text-[var(--info-ink)]", tint: "bg-[color-mix(in_srgb,var(--info)_14%,transparent)]", line: "border-[color-mix(in_srgb,var(--info)_45%,transparent)]" },
  insurvas: { label: "Insurvas map", fg: "text-[var(--accent-ink)]", tint: "bg-[var(--surface-alt)]", line: "border-[var(--border)]" },
  none: { label: "No map", fg: "text-[var(--error-ink)]", tint: "bg-[color-mix(in_srgb,var(--error)_14%,transparent)]", line: "border-[var(--border)]" },
};
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const tile = `${cardInset} px-3 py-2.5`;
const CHIP = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--body)] hover:border-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50";
const DAY = 24 * 60 * 60 * 1000;
const PAGE_ORDER = ["applicant", "health", "coverage", "payment"];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The one map a carrier's card shows: the agency's working one first, else Insurvas's. */
function mapFor(maps: FieldMapView[], carrierId: string): FieldMapView | null {
  const mine = maps.filter((m) => m.carrierId === carrierId && m.status !== "retired");
  const rank = (m: FieldMapView) => (m.status === "needs_review" ? 0 : EDITABLE_FIELD_MAP_STATUSES.includes(m.status) ? 1 : 2) + (m.platform ? 3 : 0);
  return mine.sort((a, b) => rank(a) - rank(b) || b.version - a.version)[0] ?? null;
}
function stateOf(map: FieldMapView | null): Autofill {
  if (!map) return "none";
  if (map.status === "needs_review") return "review";
  if (EDITABLE_FIELD_MAP_STATUSES.includes(map.status)) return "draft";
  return map.platform ? "insurvas" : "ready";
}
/** Fields the published map could not find on the carrier's page in the last 30 days. */
function missedKeys(map: FieldMapView, now: number) {
  const since = now - 30 * DAY;
  return new Set(map.misses.filter((x) => new Date(x.at).getTime() >= since).map((x) => x.fieldKey));
}

function Hint({ id, text, label }: { id: string; text: string; label: string }) {
  return <HoverHint id={id} label={label}>{text}</HoverHint>;
}

export function CarrierFieldMaps({ carriers, currentId, onPick, listCard, listBody, cardClass }: {
  carriers: MapsCarrier[];
  currentId: string | null;
  onPick: (id: string) => void;
  listCard: (children: ReactNode) => ReactNode;
  listBody: (children: ReactNode) => ReactNode;
  cardClass: string;
}) {
  const [maps, setMaps] = useState<FieldMapView[] | null>(null);
  const [options, setOptions] = useState<FieldMapCarrierOption[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/app/field-maps", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "Field maps could not be loaded."); return; }
      setMaps(data.maps as FieldMapView[]);
      setOptions(data.carriers as FieldMapCarrierOption[]);
      setCanEdit(Boolean(data.canEdit));
      setError(null);
    } catch {
      setError("Couldn't reach Insurvas. Check your connection and try again.");
    }
  }, []);
  useEffect(() => { const t = window.setTimeout(load, 0); return () => window.clearTimeout(t); }, [load]);

  const current = carriers.find((c) => c.id === currentId) ?? carriers[0] ?? null;
  const ready = maps ? carriers.filter((c) => { const s = stateOf(mapFor(maps, c.id)); return s === "ready" || s === "insurvas"; }).length : 0;

  return (
    <>
      {listCard(<>
        <span className="flex items-center justify-between gap-2"><span className={KICKER}>Your carriers<Hint id="hint-fm-carriers" label="About the badges" text="The badge is the autofill state of each carrier's application: whether the browser extension can fill it." /></span>{maps && carriers.length > 0 && <span className="text-xs text-[var(--muted)]">{ready} of {carriers.length} ready</span>}</span>
        {listBody(carriers.length === 0
          ? <p className="m-0 px-2 py-3 text-sm text-[var(--muted)]">No carriers yet. Add the first one you write with.</p>
          : carriers.map((carrier) => {
            const state = maps ? stateOf(mapFor(maps, carrier.id)) : null;
            const on = current?.id === carrier.id;
            return (
              <button key={carrier.id} type="button" onClick={() => onPick(carrier.id)} aria-pressed={on} className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left hover:bg-[var(--surface-alt)]", on && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}>
                <span className={cn("size-2.5 shrink-0 rounded-full", carrier.dot)} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--ink)]">{carrier.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{carrier.level ? `${carrier.level}%` : "No level"} · {carrier.states} state{carrier.states === 1 ? "" : "s"}</span>
                </span>
                {state && <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold", LOOK[state].fg, LOOK[state].tint)}>{LOOK[state].label}</span>}
              </button>
            );
          }))}
      </>)}

      <div className={cn(cardClass, "flex min-h-0 flex-col gap-4 p-5 [&>*]:shrink-0")}>
        {!current ? <p className="m-auto text-sm text-[var(--muted)]">Add a carrier to set it up.</p> : (
          <>
            <h3 className="m-0 flex items-center gap-2.5 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]"><span className={cn("size-3 rounded-full", current.dot)} aria-hidden="true" />{current.name}</h3>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className={tile}><span className={KICKER}>Contract level</span><strong className="mt-1 block text-base font-semibold text-[var(--ink)]">{current.level ? `${current.level}%` : "Not set"}</strong></div>
              <div className={tile}><span className={KICKER}>Products</span><strong className="mt-1 block truncate text-sm font-semibold text-[var(--ink)]" title={current.products.join(" · ")}>{current.products.length ? current.products.join(" · ") : "None yet"}</strong></div>
              <div className={tile}><span className={KICKER}>Appointed</span><strong className="mt-1 block text-sm font-semibold text-[var(--ink)]">{current.states} state{current.states === 1 ? "" : "s"}</strong></div>
            </div>
            <div className="h-px bg-[var(--border)]" />
            {error ? <Callout tone="error" title={error} /> : !maps ? <SectionLoading label="Loading field maps" /> : (
              <Autofill
                key={`${current.id}:${mapFor(maps, current.id)?.id ?? "none"}`}
                carrier={current}
                map={mapFor(maps, current.id)}
                option={options.find((o) => o.id === current.id) ?? null}
                canEdit={canEdit}
                now={now}
                onChanged={async (next) => { setMaps((list) => (list ? [next, ...list.filter((m) => m.id !== next.id)] : [next])); await load(); }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function Autofill({ carrier, map, option, canEdit, now, onChanged }: {
  carrier: MapsCarrier;
  map: FieldMapView | null;
  option: FieldMapCarrierOption | null;
  canEdit: boolean;
  now: number;
  onChanged: (map: FieldMapView) => Promise<void>;
}) {
  const state = stateOf(map);
  const look = LOOK[state];
  const [selectors, setSelectors] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [entries, setEntries] = useState<FieldMapEntryView[]>(() => (map ? map.entries.map((e) => ({ ...e })) : []));
  const [adding, setAdding] = useState("");
  const [origin, setOrigin] = useState(option?.portalOrigin ?? "");
  const [busy, setBusy] = useState(false);

  const site = map?.origin ?? option?.portalOrigin ?? null;
  const missed = map ? missedKeys(map, now) : new Set<string>();
  const editable = canEdit && !!map && !map.platform && map.status !== "retired";
  const frozen = !!map && !EDITABLE_FIELD_MAP_STATUSES.includes(map.status);
  const dirty = !!map && JSON.stringify(entries) !== JSON.stringify(map.entries);
  const blocked = unverifiedSensitive(entries).map(fieldLabel);
  const nextVersion = map ? (frozen ? map.version + 1 : map.version) : 1;
  const mapped = entries.filter((e) => e.selector.trim());
  const fills = mapped.filter((e) => !missed.has(e.fieldKey)).length;
  const used = entries.filter((e) => e.confidence !== null);
  const rate = used.length ? Math.round((used.reduce((n, e) => n + (e.confidence ?? 0), 0) / used.length) * 100) : null;
  const ownerOnly = canEdit ? null : "Only an owner can change field maps.";

  const blurb = !map
    ? `No map yet, so agents retype ${carrier.name}'s application by hand. A map says where each answer goes on the carrier's form; once it is published the browser extension fills it for them.`
    : state === "review"
      ? `${missed.size || "Some"} field${missed.size === 1 ? " was" : "s were"} not found on ${map.misses[0] ? day(map.misses[0].at) : "the carrier's page"}. ${carrier.name} most likely changed its form. Those fields are left empty for agents until the map is fixed.`
      : state === "draft"
        ? `${entries.filter((e) => e.verified).length} of ${entries.length} fields checked. A draft fills nothing.${blocked.length ? ` ${listOf(blocked)} must be checked by a person before it can be published.` : " It can be published."}`
        : state === "insurvas"
          ? "Insurvas keeps this map up to date for every agency. Copy it to your agency only if your form differs."
          : `The extension fills ${fills} of ${entries.length} fields on ${carrier.name}'s ${map.productLabel} application. Agents check them and press submit themselves.`;

  async function run(label: string, work: () => Promise<FieldMapView>, done: (m: FieldMapView) => string) {
    setBusy(true);
    try {
      const next = await work();
      notify.done(done(next));
      await onChanged(next);
    } catch (e) {
      notify.block(e instanceof Error ? e.message : `${label} didn't work. Try again.`);
    } finally {
      setBusy(false);
    }
  }
  /** A published map is frozen: its edits become version N + 1, a draft. */
  const draftFor = async (m: FieldMapView) => {
    const target = EDITABLE_FIELD_MAP_STATUSES.includes(m.status) ? m : await mapRequest(`/api/app/field-maps/${m.id}/versions`, { method: "POST" });
    return mapRequest(`/api/app/field-maps/${target.id}`, { method: "PUT", body: JSON.stringify(savePayload(target, entries)) });
  };
  const save = (publish: boolean) => map && run(publish ? "Publishing" : "Saving", async () => {
    const saved = dirty || !EDITABLE_FIELD_MAP_STATUSES.includes(map.status) ? await draftFor(map) : map;
    return publish ? mapRequest(`/api/app/field-maps/${saved.id}/publish`, { method: "POST" }) : saved;
  }, (m) => (publish ? `${carrier.name} v${m.version} published. Agents get it on their next fill.` : `Draft v${m.version} saved`));
  const newVersion = () => map && run("Starting a version", () => mapRequest(`/api/app/field-maps/${map.id}/versions`, { method: "POST" }), (m) => (map.platform ? `Draft v${m.version} started for your agency. Check the sensitive fields again before it publishes.` : `Draft v${m.version} started`));
  const validOrigin = /^https:\/\/[^\s/]+\.[^\s]+$/.test(origin.trim());
  const start = () => run("Starting a map", () => mapRequest("/api/app/field-maps", { method: "POST", body: JSON.stringify({ carrier_id: carrier.id, carrier_product_id: null, origin: origin.trim() }) }), (m) => `Draft v${m.version} started for ${carrier.name}`);

  const openSite = site ? (label: string) => (
    <a href={site} target="_blank" rel="noopener noreferrer" title="Opens the carrier's site. The Insurvas extension's side panel highlights each field the map finds." className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--accent-hover)]">
      {label}<ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  ) : () => null;

  // The fields, by page of the carrier's form.
  const pages = PAGE_ORDER.filter((key) => entries.some((e) => e.pageKey === key)).concat([...new Set(entries.map((e) => e.pageKey))].filter((key) => !PAGE_ORDER.includes(key)));
  const statusOf = (e: FieldMapEntryView) => (missed.has(e.fieldKey) ? { text: "Not found", cls: "text-[var(--error-ink)]" } : e.verified ? { text: "Checked", cls: "text-[var(--accent-ink)]" } : { text: "To check", cls: "text-[var(--warning-ink)]" });
  const patch = (id: string, p: Partial<FieldMapEntryView>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const unmapped = CANONICAL_OPTIONS.filter((o) => !entries.some((e) => e.fieldKey === o.key));
  const publishBlock = blocked.length ? `Check ${listOf(blocked)} first.` : entries.some((e) => !e.selector.trim()) ? "Give every field a selector first." : entries.length === 0 ? "Add a field first." : frozen && !dirty ? `Version ${map?.version} is already published.` : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1 text-sm font-semibold tracking-[0.04em] uppercase text-[var(--ink)]">Autofill<Hint id="hint-fm-autofill" label="About autofill" text="The field map: where each answer goes on this carrier's application, so the browser extension can type it in for the agent." /></span>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", look.fg, look.tint)}>{look.label}</span>
          {site && <code className="font-mono text-xs text-[var(--muted)]">{site.replace(/^https:\/\//, "")}</code>}
        </span>
        {map && <button type="button" onClick={() => setSelectors(!selectors)} aria-pressed={selectors} className={CHIP}>{selectors ? "Hide selectors" : "Show selectors"}</button>}
      </div>

      <p className={cn("m-0 rounded-[12px] border m-glass-inset px-3.5 py-3 text-sm leading-[1.5] text-[var(--body)]", look.line)}>{blurb}</p>

      <div className="flex flex-wrap items-center gap-2">
        {state === "ready" && <>{openSite("Check in the extension")}<Button type="button" variant="outline" disabled={busy || !canEdit} title={ownerOnly ?? "Starts the next version as a draft; this one keeps filling until it is published"} onClick={() => void newVersion()}>New version</Button></>}
        {state === "review" && <>{openSite("Fix in the extension")}<Button type="button" variant="outline" aria-pressed={onlyProblems} onClick={() => setOnlyProblems(!onlyProblems)}>{onlyProblems ? "Show all fields" : `Show the ${missed.size} field${missed.size === 1 ? "" : "s"}`}</Button></>}
        {state === "draft" && <>{openSite("Continue in the extension")}<Button type="button" disabled={busy || !canEdit || Boolean(publishBlock)} title={ownerOnly ?? publishBlock ?? "Agents get it on their next fill"} onClick={() => void save(true)}>Publish version {nextVersion}</Button></>}
        {state === "insurvas" && <>{openSite("See it in the extension")}<Button type="button" variant="outline" disabled={busy || !canEdit} title={ownerOnly ?? undefined} onClick={() => void newVersion()}>Copy to my agency</Button></>}
        {state === "none" && (
          <>
            {!option?.portalOrigin && <input className={cn(control, "mt-0 w-[300px] font-mono")} type="url" inputMode="url" aria-label="Carrier portal address" placeholder="https://agents.carrier.com" spellCheck={false} value={origin} onChange={(e) => setOrigin(e.target.value)} />}
            <Button type="button" disabled={busy || !canEdit || !validOrigin} title={ownerOnly ?? (validOrigin ? "Starts a draft. It fills nothing until it is published." : "Enter the carrier portal address, starting https://")} onClick={() => void start()}><Plus aria-hidden="true" />Start a map</Button>
          </>
        )}
      </div>

      {!map && (
        <div className="grid flex-1 place-items-center rounded-[14px] border-[1.5px] border-dashed border-[var(--border-strong)] p-8">
          <div className="flex max-w-[460px] flex-col items-center gap-2.5 text-center">
            <strong className="text-base font-semibold text-[var(--ink)]">Three steps, about twenty minutes</strong>
            <span className="text-sm leading-[1.5] text-[var(--muted)]">1 · Open the carrier&apos;s application with the extension and press Propose map.<br />2 · Check each suggestion: Highlight shows the box it will fill.<br />3 · Confirm SSN, routing and account, then publish.</span>
          </div>
        </div>
      )}

      {map && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-4">
            <div className={tile}><span className={KICKER}>Fills<Hint id="hint-fm-fills" label="About fills" text="How many of the application's fields the extension puts in for the agent." /></span><strong className="mt-1 block text-xl font-semibold text-[var(--ink)]">{fills} of {entries.length}</strong></div>
            <div className={tile}>
              <span className={KICKER}>Last 30 days<Hint id="hint-fm-rate" label="About the fill rate" text="Of the fields agents needed, the share the map found on the carrier's page. A drop means the carrier changed its form." /></span>
              <strong className={cn("mt-1 block text-xl font-semibold", rate === null ? "text-[var(--muted)]" : rate >= 90 ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>{rate === null ? "Not used yet" : `${rate}%`}</strong>
              {rate !== null && <span className="mt-1.5 block h-1 rounded-full bg-[var(--surface-alt)]"><span className={cn("block h-1 rounded-full", rate >= 90 ? "bg-[var(--primary)]" : "bg-[var(--warning)]")} style={{ width: `${rate}%` }} /></span>}
            </div>
            <div className={tile}><span className={KICKER}>Version<Hint id="hint-fm-version" label="About versions" text="A published map never changes. Fixing it publishes the next version; the old one is kept." /></span><strong className="mt-1 block text-base font-semibold text-[var(--ink)]">v{map.version} · {frozen ? "published" : "draft"}</strong></div>
            <div className={tile}><span className={KICKER}>Checked</span><strong className="mt-1 block text-sm font-semibold text-[var(--ink)]">{day(map.approvedAt ?? map.updatedAt)}{map.platform ? " · Insurvas" : ""}</strong></div>
          </div>

          {editable && selectors && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={cn(control, "mt-0 w-[240px]")} aria-label="Field to add" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a field…</option>
                {[...new Set(unmapped.map((o) => o.group))].map((group) => <optgroup key={group} label={group}>{unmapped.filter((o) => o.group === group).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}
              </select>
              <Button type="button" variant="outline" disabled={!adding} onClick={() => { setEntries((list) => [...list, newEntry(adding)]); setAdding(""); }}><Plus aria-hidden="true" />Add field</Button>
            </div>
          )}

          {entries.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">No fields mapped yet.{editable ? " Show selectors to add them, or build the map in the extension." : ""}</p>}
          {pages.map((pageKey) => {
            const rows = entries.filter((e) => e.pageKey === pageKey && (!onlyProblems || missed.has(e.fieldKey)));
            if (!rows.length) return null;
            const all = entries.filter((e) => e.pageKey === pageKey);
            const ok = all.filter((e) => e.verified && !missed.has(e.fieldKey)).length;
            return (
              <div key={pageKey} className="overflow-hidden rounded-[12px] border border-[var(--border)]">
                <div className="flex items-center justify-between bg-[var(--surface-alt)] px-3 py-2"><span className={KICKER}>{PAGE_LABEL[pageKey] ?? pageKey}</span><span className={cn("text-xs font-bold", ok === all.length ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>{ok} of {all.length}</span></div>
                {rows.map((e) => {
                  const status = statusOf(e);
                  const sensitive = isSensitiveKey(e.fieldKey);
                  const label = fieldLabel(e.fieldKey);
                  const format = e.transform && e.transform !== "none" ? ` · ${isTransform(e.transform) ? TRANSFORM_LABEL[e.transform] : e.transform}` : "";
                  const miss = map.misses.find((x) => x.fieldKey === e.fieldKey);
                  return (
                    <div key={e.id} className={cn("grid items-center gap-2.5 border-t border-[var(--border)] px-3 py-2 text-sm", selectors && editable ? "grid-cols-[150px_minmax(0,1fr)_130px_150px_auto_96px]" : "grid-cols-[170px_minmax(0,1fr)_auto_96px]")}>
                      <strong className="truncate font-semibold text-[var(--ink)]" title={e.fieldKey}>{label}</strong>
                      {selectors && editable ? (
                        <>
                          <input className={cn(control, "mt-0 font-mono md:text-xs")} spellCheck={false} aria-label={`Selector for ${label}`} placeholder="#field-id or [name=…]" value={e.selector} onChange={(ev) => patch(e.id, { selector: ev.target.value, verified: false })} />
                          <select className={cn(control, "mt-0")} aria-label={`Kind for ${label}`} value={e.inputKind} onChange={(ev) => patch(e.id, { inputKind: ev.target.value as FieldMapInputKind, verified: false })}>
                            {FIELD_MAP_INPUT_KINDS.map((k) => <option key={k} value={k}>{INPUT_KIND_LABEL[k]}</option>)}
                          </select>
                          <select className={cn(control, "mt-0")} aria-label={`Format for ${label}`} value={e.transform ?? "none"} onChange={(ev) => patch(e.id, { transform: ev.target.value === "none" ? null : ev.target.value, verified: false })}>
                            {FIELD_MAP_TRANSFORMS.map((t) => <option key={t} value={t}>{TRANSFORM_LABEL[t]}</option>)}
                            {e.transform && !isTransform(e.transform) && <option value={e.transform}>{e.transform}</option>}
                          </select>
                        </>
                      ) : (
                        <span className="min-w-0 truncate text-xs text-[var(--muted)]">{INPUT_KIND_LABEL[e.inputKind]}{format}{selectors && <code className="ml-2.5 font-mono text-xs text-[var(--accent-ink)]">{e.selector || "no selector"}</code>}</span>
                      )}
                      <span className="text-xs font-bold text-[var(--cat-2)]">{sensitive ? "Sensitive" : ""}</span>
                      {selectors && editable ? (
                        <button type="button" disabled={!e.selector.trim()} onClick={() => patch(e.id, { verified: !e.verified })} aria-pressed={e.verified} title={e.selector.trim() ? "Mark it checked once Highlight shows the right box" : "Give it a selector first"} className={cn("justify-self-end text-xs font-bold disabled:opacity-50", status.cls)}>{e.verified ? "✓ Checked" : "Mark checked"}</button>
                      ) : (
                        <span className={cn("justify-self-end text-xs font-bold", status.cls)} title={miss && missed.has(e.fieldKey) ? `Not found on ${miss.url.replace(/^https:\/\//, "")} on ${day(miss.at)}` : undefined}>{status.text}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {editable && (dirty || (selectors && !frozen)) && (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] px-3.5 py-2.5">
              <span className="mr-auto text-sm text-[var(--body)]">{dirty ? (frozen ? `Unsaved changes. Saving makes version ${nextVersion}, a draft.` : "Unsaved changes to this draft.") : `Draft v${map.version} is saved. Publish it to use it.`}</span>
              <LeaveGuard dirty={dirty} onDiscard={() => setEntries(map.entries.map((e) => ({ ...e })))} what="this field map" />
            {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setEntries(map.entries.map((e) => ({ ...e })))}>Discard</Button>}
              <Button type="button" variant="outline" disabled={!dirty || busy} onClick={() => void save(false)}>Save draft</Button>
              <Button type="button" disabled={Boolean(publishBlock) || busy} title={publishBlock ?? undefined} onClick={() => void save(true)}>Publish version {nextVersion}</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
