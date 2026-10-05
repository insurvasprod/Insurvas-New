"use client";

/**
 * Settings › Sales › Carrier field maps (LA-3.13). Reads and writes /api/app/field-maps;
 * `?preview=sample` (outside production) renders the design fixtures and saves nothing.
 *
 * A field map tells the browser extension which element on a carrier's application page each
 * canonical key goes into. Maps that need review sort first. A map cannot be published until every
 * sensitive entry (SSN, routing, account and card numbers) has been verified by a person — the
 * panel names which ones are left, and the database refuses it too. A published map never changes:
 * editing one saves version N + 1 as a draft. Insurvas platform maps are read-only here; "Copy to
 * my agency" starts the agency's own version.
 *
 * The list is the board l3-set-field-maps: one row per map (and a "None" row per agency carrier
 * with no map), then the miss detail of the flagged map. "Propose a map" starts a manual draft —
 * the AI proposal is LA-3.3's, blocked on decision 4, and nothing calls a provider.
 *
 * Layout follows UI-CONSISTENCY: the list and the open map are TableCards, the draft's actions sit
 * in the settings save bar, and the only callouts are the blocked / read-only lines.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Copy, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout, Field, Pill, SettingsStack, control, st, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { isSensitiveKey } from "@/lib/applications/constants";
import { FIELD_MAPS } from "@/lib/applications/settingsFixtures";
import { EDITABLE_FIELD_MAP_STATUSES, FIELD_MAP_INPUT_KINDS, type FieldMapInputKind, type FieldMapStatus } from "@/lib/extension/constants";
import { CANONICAL_OPTIONS, defaultPage, fieldLabel, listOf, mapRequest, newEntry, savePayload, unverifiedSensitive } from "@/lib/extension/mapEditing";
import { FIELD_MAP_TRANSFORMS, TRANSFORM_LABEL, isTransform } from "@/lib/extension/transforms";
import type { FieldMapCarrierOption, FieldMapEntryView, FieldMapView } from "@/lib/extension/types";
import { cn } from "@/lib/utils";

import {
  BackButton, CopyToAgencyButton, DialogActions, PlatformPill, ReadOnlyNotice, RowAction, SalesDialog, SalesLoadError, SalesLoading, SalesPanelTop,
  WithReason, checkbox, notRefreshed, notSaved, shortDay, useSalesSample, warnUnsaved,
} from "./shared";

const KIND_LABEL: Record<FieldMapInputKind, string> = { text: "Text box", select: "Dropdown", radio: "Radio buttons", checkbox: "Checkbox", date: "Date box", masked: "Masked box" };
const STATUS_PILL: Record<FieldMapStatus, { tone: PillTone; label: string }> = {
  needs_review: { tone: "warning", label: "Needs review" },
  draft: { tone: "info", label: "Draft" },
  in_review: { tone: "info", label: "In review" },
  published: { tone: "success", label: "Published" },
  retired: { tone: "neutral", label: "Retired" },
};
const STATUS_ORDER: Record<FieldMapStatus, number> = { needs_review: 0, draft: 1, in_review: 2, published: 3, retired: 4 };
const cell = cn(control, "mt-0");
const versionTone = (status: FieldMapStatus): PillTone => (status === "published" ? "brand" : status === "needs_review" ? "warning" : "neutral");

type MapRow = FieldMapView & { reviewReason?: string | null };

// The design fixtures, in the API's shape, so one editor renders both.
const DAY = 24 * 60 * 60 * 1000;
const SAMPLE_MAPS: MapRow[] = FIELD_MAPS.map((m) => ({
  id: m.id, carrierId: m.id, carrierName: m.carrierName, productId: null, productLabel: m.productLabel, version: m.version, status: m.status, origin: m.origin,
  platform: false, proposalSource: "manual", steps: [], misses: [], updatedAt: new Date(Date.now() - m.updatedDaysAgo * DAY).toISOString(), approvedAt: null, reviewReason: m.reviewReason,
  entries: m.entries.map((e, i) => ({
    id: `${m.id}-e${i}`, pageKey: defaultPage(e.key), fieldKey: e.key, selector: e.selector, selectorFallback: null,
    inputKind: e.kind === "date_parts" ? "date" : e.kind, transform: e.transform === "none" ? null : e.transform, optionMap: null, confidence: null, verified: e.verified,
  })),
}));

/** The open map's entries, edited in place. */
function Review({ map, entries, editable, setEntries, action }: { map: MapRow; entries: FieldMapEntryView[]; editable: boolean; setEntries: (fn: (e: FieldMapEntryView[]) => FieldMapEntryView[]) => void; action?: ReactNode }) {
  const [adding, setAdding] = useState("");
  const patch = (id: string, p: Partial<FieldMapEntryView>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const verified = entries.filter((e) => e.verified).length;
  const unmapped = CANONICAL_OPTIONS.filter((o) => !entries.some((e) => e.fieldKey === o.key));

  return (
    <TableCard
      title={`${map.carrierName} · ${map.productLabel} · v${map.version}`}
      description={map.reviewReason ?? (map.platform ? "Insurvas platform map — copy it to your agency to change it." : `${verified} of ${entries.length} entries verified`)}
      action={action}
      toolbar={editable ? (
        <DataToolbar>
          <label htmlFor="fm-add" className="sr-only">Field to add</label>
          <select id="fm-add" className={toolbarControl} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a field…</option>
            {[...new Set(unmapped.map((o) => o.group))].map((group) => (
              <optgroup key={group} label={group}>
                {unmapped.filter((o) => o.group === group).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
          <WithReason reason={adding ? null : "Choose a field to add first."}>
            <Button type="button" variant="outline" disabled={!adding} onClick={() => { setEntries((list) => [...list, newEntry(adding)]); setAdding(""); }}>
              <Plus aria-hidden="true" />Add field
            </Button>
          </WithReason>
        </DataToolbar>
      ) : undefined}
    >
      {entries.length === 0 ? (
        <EmptyState title="No fields mapped yet" hint="Add each field the carrier's form asks for, with the selector that finds it on the page." />
      ) : (
        <table className={cn(st.table, "min-w-[900px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[230px]")}>Canonical key</th>
              <th scope="col" className={st.th}>Selector on the carrier page</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Kind</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Transform</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const label = fieldLabel(e.fieldKey);
              const sensitive = isSensitiveKey(e.fieldKey);
              const transform = e.transform ?? "none";
              return (
                <tr key={e.id} className={cn(sensitive && !e.verified && "bg-[var(--warning-surface)]")}>
                  <td className={st.td}>
                    <span className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-[12px] text-[var(--ink)]">{e.fieldKey}</code>
                      {sensitive && <Pill tone={e.verified ? "neutral" : "warning"}>Sensitive</Pill>}
                    </span>
                    <span className={st.sub}>{label}</span>
                  </td>
                  <td className={st.td}>
                    {/* A changed selector is a new claim: it has to be checked again. */}
                    <input className={cn(cell, "font-mono md:text-[12px]")} spellCheck={false} disabled={!editable} aria-label={`Selector for ${label}`} placeholder="#field-id or [name=…]" value={e.selector} onChange={(ev) => patch(e.id, { selector: ev.target.value, verified: false })} />
                  </td>
                  <td className={st.td}>
                    <select className={cell} disabled={!editable} aria-label={`Kind for ${label}`} value={e.inputKind} onChange={(ev) => patch(e.id, { inputKind: ev.target.value as FieldMapInputKind, verified: false })}>
                      {FIELD_MAP_INPUT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className={st.td}>
                    <select className={cell} disabled={!editable} aria-label={`Transform for ${label}`} value={transform} onChange={(ev) => patch(e.id, { transform: ev.target.value === "none" ? null : ev.target.value, verified: false })}>
                      {FIELD_MAP_TRANSFORMS.map((t) => <option key={t} value={t}>{TRANSFORM_LABEL[t]}</option>)}
                      {!isTransform(transform) && <option value={transform}>{transform}</option>}
                    </select>
                  </td>
                  <td className={st.td}>
                    <label className="inline-flex items-center gap-2 text-[14px] text-[var(--body)]" title={editable && !e.selector.trim() ? "Give it a selector first." : undefined}>
                      <input type="checkbox" className={checkbox} disabled={!editable || !e.selector.trim()} checked={e.verified} onChange={(ev) => patch(e.id, { verified: ev.target.checked })} />
                      {e.verified ? "Verified" : "Not yet"}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function NewMapDialog({ carriers, initialCarrierId, onClose, onCreate }: { carriers: FieldMapCarrierOption[]; initialCarrierId?: string; onClose: () => void; onCreate: (input: { carrierId: string; productId: string | null; origin: string }) => Promise<void> }) {
  const first = carriers.find((c) => c.id === initialCarrierId) ?? carriers[0];
  const [carrierId, setCarrierId] = useState(first?.id ?? "");
  const carrier = carriers.find((c) => c.id === carrierId);
  const [productId, setProductId] = useState("");
  const [origin, setOrigin] = useState(first?.portalOrigin ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = /^https:\/\/[^\s/]+\.[^\s]+$/.test(origin.trim());
  const originError = tried && !valid ? "Enter the carrier portal address, starting https://." : null;

  async function submit() {
    setTried(true);
    if (!carrierId || !valid) return;
    setBusy(true);
    try {
      await onCreate({ carrierId, productId: productId || null, origin: origin.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SalesDialog open onOpenChange={(open) => !open && onClose()} title="Propose a map" description="It starts as a draft and fills nothing. Add its fields, verify them, then publish.">
      {carriers.length === 0 ? (
        <EmptyState title="No carriers yet" hint="Add a carrier to your agency in Carriers and products first." />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Carrier" htmlFor="fm-new-carrier" required>
            <select id="fm-new-carrier" className={control} value={carrierId} onChange={(e) => { setCarrierId(e.target.value); setProductId(""); setOrigin(carriers.find((c) => c.id === e.target.value)?.portalOrigin ?? ""); }}>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Product" htmlFor="fm-new-product">
            <select id="fm-new-product" className={control} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">All products</option>
              {(carrier?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Carrier portal URL" htmlFor="fm-new-origin" required hint="The site the application form is on." error={originError}>
            <input id="fm-new-origin" type="url" inputMode="url" className={cn(control, "font-mono")} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="https://" spellCheck={false} />
          </Field>
          <DialogActions>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft"}</Button>
          </DialogActions>
        </form>
      )}
    </SalesDialog>
  );
}

export function SalesFieldMaps() {
  const sample = useSalesSample();
  const [maps, setMaps] = useState<MapRow[]>(sample ? SAMPLE_MAPS : []);
  const [carriers, setCarriers] = useState<FieldMapCarrierOption[]>([]);
  const [canEdit, setCanEdit] = useState(sample);
  const [loaded, setLoaded] = useState(sample);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entries, setEntriesState] = useState<FieldMapEntryView[] | null>(null);
  /** The propose dialog, optionally for one carrier. */
  const [creating, setCreating] = useState<{ carrierId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/field-maps", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Field maps could not be loaded.");
      } else {
        setMaps(data.maps);
        setCarriers(data.carriers);
        setCanEdit(Boolean(data.canEdit));
        setError(null);
        setLoaded(true);
      }
    } catch {
      setError("Couldn't reach Insurvas. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const shown = [...maps].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.carrierName.localeCompare(b.carrierName) || b.version - a.version);
  const open = maps.find((m) => m.id === openId) ?? null;

  function openMap(map: MapRow | null) {
    setOpenId(map?.id ?? null);
    setEntriesState(map ? map.entries.map((e) => ({ ...e })) : null);
  }

  function replaceMap(next: FieldMapView, previousId?: string) {
    setMaps((list) => [next, ...list.filter((m) => m.id !== next.id)]);
    // A new version or a publish changes other rows too (the version it replaces retires).
    if (previousId) void load();
    openMap(next);
  }

  /** A published map is frozen: its edits become version N + 1, a draft. */
  async function draftFor(map: MapRow, list: FieldMapEntryView[]): Promise<FieldMapView> {
    let target: FieldMapView = map;
    if (!EDITABLE_FIELD_MAP_STATUSES.includes(map.status)) target = await mapRequest(`/api/app/field-maps/${map.id}/versions`, { method: "POST" });
    return mapRequest(`/api/app/field-maps/${target.id}`, { method: "PUT", body: JSON.stringify(savePayload(target, list)) });
  }

  async function save(publish: boolean) {
    if (!open || !entries) return;
    if (sample) return notSaved();
    setBusy(true);
    try {
      let saved = await draftFor(open, entries);
      if (publish) saved = await mapRequest(`/api/app/field-maps/${saved.id}/publish`, { method: "POST" });
      notify.done(publish ? `${saved.carrierName} · ${saved.productLabel} v${saved.version} published` : `Draft v${saved.version} saved`);
      replaceMap(saved, publish || saved.id !== open.id ? open.id : undefined);
    } catch (e) {
      // What was typed stays on screen.
      notify.block(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyToAgency(map: MapRow) {
    setBusy(true);
    try {
      const copy = await mapRequest(`/api/app/field-maps/${map.id}/versions`, { method: "POST" });
      notify.done(`Draft v${copy.version} started for your agency`, { detail: "Sensitive fields need verifying again before it publishes." });
      replaceMap(copy);
    } catch (e) {
      notify.block(e instanceof Error ? e.message : "Couldn't copy that map.");
    } finally {
      setBusy(false);
    }
  }

  async function create(input: { carrierId: string; productId: string | null; origin: string }) {
    try {
      const map = await mapRequest("/api/app/field-maps", { method: "POST", body: JSON.stringify({ carrier_id: input.carrierId, carrier_product_id: input.productId, origin: input.origin }) });
      setCreating(null);
      replaceMap(map);
    } catch (e) {
      notify.block(e instanceof Error ? e.message : "Couldn't create the map.");
    }
  }

  /* ── one map, open ── */
  if (open && entries) {
    const editable = canEdit && !open.platform && open.status !== "retired";
    const blocked = unverifiedSensitive(entries);
    const empty = entries.filter((e) => !e.selector.trim()).length;
    const dirty = JSON.stringify(entries) !== JSON.stringify(open.entries);
    const frozen = !EDITABLE_FIELD_MAP_STATUSES.includes(open.status);
    const next = frozen ? open.version + 1 : open.version;
    const publishBlock = blocked.length ? `Verify ${listOf(blocked)} first.` : empty ? "Give every field a selector first." : entries.length === 0 ? "Add a field first." : frozen && !dirty ? `Version ${open.version} is already published.` : null;
    const copyAction = open.platform && canEdit ? (
      sample ? <CopyToAgencyButton label={`${open.carrierName} ${open.productLabel}`} size="default" /> : (
        <Button type="button" variant="outline" disabled={busy} onClick={() => copyToAgency(open)} aria-label={`Copy ${open.carrierName} ${open.productLabel} to my agency`}>
          <Copy aria-hidden="true" />Copy to my agency
        </Button>
      )
    ) : undefined;
    return (
      <SettingsStack>
        <SalesPanelTop sample={sample} />
        <BackButton onClick={() => (dirty && editable ? warnUnsaved(`${open.carrierName} · ${open.productLabel}`) : openMap(null))}>All field maps</BackButton>
        {!canEdit && <ReadOnlyNotice what="field maps" />}
        {editable && blocked.length > 0 && <Callout tone="warning" title={`Verify ${listOf(blocked)} before publishing.`} />}
        <Review map={open} entries={entries} editable={editable} action={copyAction} setEntries={(fn) => setEntriesState((e) => (e ? fn(e) : e))} />
        {editable && (dirty || !frozen) && (
          <SettingsSaveBar note={dirty ? (frozen ? `Unsaved changes — saving makes version ${next}, a draft` : "Unsaved changes to this draft") : `Draft v${open.version} is saved — publish it to use it`}>
            {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setEntriesState(open.entries.map((e) => ({ ...e })))}>Discard</Button>}
            <WithReason reason={dirty ? null : "No changes to save."}>
              <Button type="button" variant="outline" disabled={!dirty || busy} onClick={() => save(false)}>Save draft</Button>
            </WithReason>
            <WithReason reason={publishBlock}>
              <Button type="button" disabled={Boolean(publishBlock) || busy} onClick={() => save(true)}>Publish version {next}</Button>
            </WithReason>
          </SettingsSaveBar>
        )}
      </SettingsStack>
    );
  }

  /* ── the list ── */
  const mappedCarriers = new Set(maps.map((m) => m.carrierId));
  const unmapped = carriers.filter((c) => !mappedCarriers.has(c.id));
  // The flagged map with misses gets the detail block, as on the board.
  const flagged = shown.find((m) => m.status === "needs_review" && m.misses.length > 0) ?? null;
  const propose = (carrierId?: string) => (sample ? notSaved() : setCreating({ carrierId }));
  const ownerOnly = canEdit ? null : "Only an owner can propose a map.";

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {loading && !loaded ? <SalesLoading label="Loading field maps" columns={7} /> : error && !loaded ? (
        <SalesLoadError message={error} onRetry={load} />
      ) : (
        <>
          {error && <Callout tone="error" title={error} />}
          {!canEdit && <ReadOnlyNotice what="field maps" />}

          <TableCard
            title="Maps"
            description="A draft never fills anything. Only a published map is read by the extension."
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={ownerOnly}>
                      <Button type="button" disabled={!canEdit} onClick={() => propose()}><Plus aria-hidden="true" />Propose a map</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : load} refreshing={loading && !sample} />
                  </>
                }
              />
            }
          >
            {maps.length === 0 && unmapped.length === 0 ? (
              <EmptyState title="No field maps yet" hint="A carrier needs a field map before the browser extension can fill its application." />
            ) : (
              <table className={cn(st.table, "min-w-[880px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Carrier</th>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Form</th>
                    <th scope="col" className={cn(st.th, "w-[84px]")}>Version</th>
                    <th scope="col" className={cn(st.th, "w-[96px]")}>Fields</th>
                    <th scope="col" className={cn(st.th, "w-[84px]")}>To verify</th>
                    <th scope="col" className={cn(st.th, "w-[96px]")}>Last miss</th>
                    <th scope="col" className={cn(st.th, "w-[124px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[170px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {shown.map((m) => {
                    const pill = STATUS_PILL[m.status];
                    const verified = m.entries.filter((e) => e.verified).length;
                    const sensitiveLeft = unverifiedSensitive(m.entries).length;
                    const lastMiss = m.misses[0];
                    return (
                      <tr key={m.id} className="m-row">
                        <td className={st.td}>
                          <span className="flex flex-wrap items-center gap-2"><span className={st.strong}>{m.carrierName}</span>{m.platform && <PlatformPill />}</span>
                          <span className={cn(st.sub, "font-mono")}>{m.origin.replace(/^https:\/\//, "")}</span>
                        </td>
                        <td className={st.td}>{m.productLabel}</td>
                        <td className={st.td}><Pill tone={versionTone(m.status)}>v{m.version}</Pill></td>
                        <td className={cn(st.td, "tabular-nums")}>{m.entries.length ? `${verified} of ${m.entries.length}` : "—"}</td>
                        <td className={cn(st.td, "tabular-nums")} title={sensitiveLeft ? `${sensitiveLeft} of them sensitive — publishing is blocked until they are verified` : undefined}>
                          {m.entries.length ? <span className={cn(sensitiveLeft > 0 && "font-semibold text-[var(--warning-ink)]")}>{m.entries.length - verified}</span> : "—"}
                        </td>
                        <td className={st.td} title={lastMiss ? `${fieldLabel(lastMiss.fieldKey)} was not found on ${lastMiss.url.replace(/^https:\/\//, "")}` : undefined}>
                          {lastMiss ? shortDay(lastMiss.at) : EDITABLE_FIELD_MAP_STATUSES.includes(m.status) ? "—" : "None"}
                        </td>
                        <td className={st.td}><Pill tone={pill.tone} dot={m.status === "needs_review"}>{pill.label}</Pill></td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <RowAction onClick={() => openMap(m)} label={`Review ${m.carrierName} ${m.productLabel} v${m.version}`}>
                            {EDITABLE_FIELD_MAP_STATUSES.includes(m.status) ? "Review the draft" : "Review"}
                            <ArrowRight aria-hidden="true" />
                          </RowAction>
                        </td>
                      </tr>
                    );
                  })}
                  {unmapped.map((c) => (
                    <tr key={`none-${c.id}`} className="m-row">
                      <td className={st.td}><span className={st.strong}>{c.name}</span></td>
                      <td className={st.td}>All products</td>
                      <td className={st.td}>—</td>
                      <td className={st.td}>—</td>
                      <td className={st.td}>—</td>
                      <td className={st.td}>—</td>
                      <td className={st.td}><Pill tone="error">None</Pill></td>
                      <td className={cn(st.td, "whitespace-nowrap text-right")}>
                        <RowAction onClick={() => propose(c.id)} label={`Propose a map for ${c.name}`} disabled={!canEdit} reason={ownerOnly}>
                          Propose a map
                          <ArrowRight aria-hidden="true" />
                        </RowAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>

          {flagged && <MissDetail map={flagged} now={now} onReview={() => openMap(flagged)} />}
        </>
      )}
      {creating && <NewMapDialog carriers={carriers} initialCarrierId={creating.carrierId} onClose={() => setCreating(null)} onCreate={create} />}
    </SettingsStack>
  );
}

/** The board's miss block: how often the published map missed in 30 days, and on which fields. */
function MissDetail({ map, now, onReview }: { map: MapRow; now: number; onReview: () => void }) {
  const cutoff = now - 30 * DAY;
  const recent = map.misses.filter((x) => new Date(x.at).getTime() >= cutoff);
  const byField = new Map<string, { fieldKey: string; count: number; last: string; url: string }>();
  for (const x of recent) {
    const row = byField.get(x.fieldKey) ?? { fieldKey: x.fieldKey, count: 0, last: x.at, url: x.url };
    row.count += 1;
    if (x.at > row.last) {
      row.last = x.at;
      row.url = x.url;
    }
    byField.set(x.fieldKey, row);
  }
  const fields = [...byField.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
  return (
    <TableCard
      title={`Map misses · ${map.carrierName} · ${map.productLabel} · v${map.version}`}
      description={`${recent.length} ${recent.length === 1 ? "miss" : "misses"} in the last 30 days — a field the published map could not find on the carrier's page is left empty.`}
      action={<Button type="button" variant="outline" onClick={onReview}>Review</Button>}
    >
      {fields.length === 0 ? (
        <EmptyState title="No misses in the last 30 days" hint="The map was flagged by an earlier miss. Review it to clear the flag with a new version." />
      ) : (
        <table className={cn(st.table, "min-w-[620px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[220px]")}>Field</th>
              <th scope="col" className={cn(st.th, st.num, "w-[80px]")}>Misses</th>
              <th scope="col" className={cn(st.th, "w-[104px]")}>Last seen</th>
              <th scope="col" className={st.th}>Page</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {fields.map((f) => (
              <tr key={f.fieldKey} className="m-row">
                <td className={st.td}>
                  <code className="font-mono text-[12px] text-[var(--ink)]">{f.fieldKey}</code>
                  <span className={st.sub}>{fieldLabel(f.fieldKey)}</span>
                </td>
                <td className={cn(st.td, st.num)}>{f.count}</td>
                <td className={st.td}>{shortDay(f.last)}</td>
                <td className={cn(st.td, "max-w-[360px] truncate font-mono text-[12px]")} title={f.url}>{f.url.replace(/^https:\/\//, "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
