"use client";

/**
 * /admin/field-maps — staff review of the platform field maps (board l3-ov-map-review, LA-3.13):
 * where each carrier's application form keeps each of our fields. One row per carrier and product,
 * with its published version and the draft waiting behind it; a row opens the review dialog. Reads
 * and writes /api/admin/field-maps; with `sample` (the page's `?preview=sample`) it edits the design
 * fixtures locally and saves nothing.
 *
 * Staff verify entries and publish (the approver is recorded in approved_by_admin /
 * verified_by_admin — 20260926102510; until it is applied the API refuses with a plain sentence).
 * Publishing is refused while an SSN or bank / card entry is unverified — the database's own message
 * is shown. A published map is frozen; "Start version N + 1" makes the next draft.
 *
 * Not built from the board: "Reject the draft" — the field-map API has no reject (a draft can only
 * be saved, published or superseded); see the build report.
 */

import { useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, Plus, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Callout, control, Field } from "@/components/app/settings/primitives";
import { WithReason } from "@/components/app/settings/sales/shared";
import { useSampleRefresh } from "@/components/app/applications/applications-list";
import { SampleDataNotice } from "@/components/app/applications/parts";
import { isSensitiveKey } from "@/lib/applications/constants";
import { EDITABLE_FIELD_MAP_STATUSES, FILLABLE_FIELD_MAP_STATUSES } from "@/lib/extension/constants";
import { CANONICAL_OPTIONS, PAGE_LABEL, fieldLabel, listOf, mapRequest, newEntry, savePayload } from "@/lib/extension/mapEditing";
import type { FieldMapCarrierOption, FieldMapEntryView, FieldMapView } from "@/lib/extension/types";
import { cn } from "@/lib/utils";

const SAMPLE_NOTE = { detail: "Sample data — nothing is saved." };
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
const same = (a: FieldMapView, b: FieldMapView | undefined) => JSON.stringify(a.entries) === JSON.stringify(b?.entries) && JSON.stringify(a.steps) === JSON.stringify(b?.steps);

/** One row of the board: a carrier + product, its live version and the draft behind it. */
type Group = { key: string; carrierName: string; productLabel: string; live: FieldMapView | null; draft: FieldMapView | null; lastFilled: string | null };

function groups(maps: FieldMapView[], lastFilled: Record<string, string>): Group[] {
  const by = new Map<string, FieldMapView[]>();
  for (const m of maps) by.set(`${m.carrierId}|${m.productId ?? ""}`, [...(by.get(`${m.carrierId}|${m.productId ?? ""}`) ?? []), m]);
  return [...by.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.version - a.version);
    const live = sorted.find((m) => FILLABLE_FIELD_MAP_STATUSES.includes(m.status)) ?? null;
    const draft = sorted.find((m) => EDITABLE_FIELD_MAP_STATUSES.includes(m.status)) ?? null;
    const filled = list.map((m) => lastFilled[m.id]).filter(Boolean).sort().pop() ?? null;
    return { key, carrierName: sorted[0].carrierName, productLabel: sorted[0].productLabel, live, draft, lastFilled: filled };
  }).sort((a, b) => Number(Boolean(b.draft) || b.live?.status === "needs_review") - Number(Boolean(a.draft) || a.live?.status === "needs_review") || a.carrierName.localeCompare(b.carrierName));
}

export function FieldMapsReview({ initialMaps, carriers, sample, notice, lastFilled = {} }: { initialMaps: FieldMapView[]; carriers: FieldMapCarrierOption[]; sample: boolean; notice?: string; lastFilled?: Record<string, string> }) {
  const [maps, setMaps] = useState(initialMaps);
  // What the server last said, per map: an edit is "unsaved" against this.
  const [saved, setSaved] = useState<Record<string, FieldMapView>>(() => Object.fromEntries(initialMaps.map((m) => [m.id, m])));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sampleRefresh = useSampleRefresh();

  const rows = useMemo(() => groups(maps, lastFilled), [maps, lastFilled]);
  const { current, rows: pageRows } = paginate(rows, page);
  const selected = maps.find((map) => map.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/field-maps", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Field maps could not be loaded.");
      // Unsaved edits on the open map survive a refresh.
      setMaps((list) => (data.maps as FieldMapView[]).map((m) => list.find((x) => x.id === m.id && x.id === selectedId && !same(x, saved[x.id])) ?? m));
      setSaved(Object.fromEntries((data.maps as FieldMapView[]).map((m) => [m.id, m])));
    } catch (e) {
      notify.block(errorText(e, "Field maps could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [saved, selectedId]);

  function accept(map: FieldMapView) {
    setMaps((list) => [map, ...list.filter((m) => m.id !== map.id)]);
    setSaved((s) => ({ ...s, [map.id]: map }));
  }

  function patchMap(id: string, patch: (map: FieldMapView) => FieldMapView) {
    setMaps((list) => list.map((map) => (map.id === id ? patch(map) : map)));
  }

  async function saveDraft(map: FieldMapView) {
    if (sample) {
      setSaved((s) => ({ ...s, [map.id]: map }));
      return notify.done("Draft saved.", SAMPLE_NOTE);
    }
    setBusy(true);
    try {
      accept(await mapRequest(`/api/admin/field-maps/${map.id}`, { method: "PUT", body: JSON.stringify(savePayload(map, map.entries)) }));
      notify.done(`Draft v${map.version} saved.`);
    } catch (e) {
      // What was typed stays on screen.
      notify.block(errorText(e, "That didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function newVersion(map: FieldMapView) {
    if (sample) {
      const version = Math.max(...maps.filter((m) => m.carrierName === map.carrierName && m.productLabel === map.productLabel).map((m) => m.version)) + 1;
      const id = `${map.id.replace(/-\d+$/, "")}-${version}-${Date.now()}`;
      // Selectors carry over; every sensitive entry must be verified again before the new version publishes.
      const next: FieldMapView = { ...map, id, version, status: "draft", misses: [], updatedAt: new Date().toISOString(), entries: map.entries.map((entry, i) => ({ ...entry, id: `${id}-e${i + 1}`, verified: isSensitiveKey(entry.fieldKey) ? false : entry.verified })) };
      accept(next);
      setSelectedId(id);
      return notify.done(`Draft v${version} started.`, SAMPLE_NOTE);
    }
    setBusy(true);
    try {
      const next = await mapRequest(`/api/admin/field-maps/${map.id}/versions`, { method: "POST" });
      accept(next);
      setSelectedId(next.id);
      notify.done(`Draft v${next.version} started.`);
    } catch (e) {
      notify.block(errorText(e, "Couldn't start a new version."));
    } finally {
      setBusy(false);
    }
  }

  async function publish(map: FieldMapView) {
    if (sample) {
      setMaps((list) => list.map((m) => {
        if (m.id === map.id) return { ...m, status: "published", updatedAt: new Date().toISOString(), approvedAt: new Date().toISOString() };
        if (m.carrierName === map.carrierName && m.productLabel === map.productLabel && FILLABLE_FIELD_MAP_STATUSES.includes(m.status)) return { ...m, status: "retired" };
        return m;
      }));
      return notify.done(`${map.carrierName} · ${map.productLabel} v${map.version} published.`, SAMPLE_NOTE);
    }
    setBusy(true);
    try {
      if (!same(map, saved[map.id])) accept(await mapRequest(`/api/admin/field-maps/${map.id}`, { method: "PUT", body: JSON.stringify(savePayload(map, map.entries)) }));
      const published = await mapRequest(`/api/admin/field-maps/${map.id}/publish`, { method: "POST" });
      accept(published);
      notify.done(`${published.carrierName} · ${published.productLabel} v${published.version} published.`);
      void reload();
    } catch (e) {
      notify.block(errorText(e, "Couldn't publish the map."));
    } finally {
      setBusy(false);
    }
  }

  async function create(input: { carrierId: string; productId: string | null; origin: string }) {
    if (sample) {
      const carrier = carriers.find((c) => c.id === input.carrierId);
      const id = `fm-new-${Date.now()}`;
      accept({ id, carrierId: input.carrierId, carrierName: carrier?.name ?? input.carrierId, productId: input.productId, productLabel: input.productId ?? "All products", version: 1, status: "draft", origin: input.origin, platform: true, proposalSource: "manual", steps: [], entries: [], misses: [], updatedAt: new Date().toISOString(), approvedAt: null });
      setSelectedId(id);
      setCreating(false);
      return;
    }
    try {
      const map = await mapRequest("/api/admin/field-maps", { method: "POST", body: JSON.stringify({ carrier_id: input.carrierId, carrier_product_id: input.productId, origin: input.origin }) });
      accept(map);
      setSelectedId(map.id);
      setCreating(false);
    } catch (e) {
      notify.block(errorText(e, "Couldn't create the map."));
    }
  }

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Field maps"
        subtitle="One published map per carrier and product. A draft never fills anything."
        actions={
          <WithReason reason={notice ? "Field maps aren't set up yet." : null}>
            <Button type="button" variant="outline" onClick={() => setCreating(true)} disabled={Boolean(notice)}><Plus aria-hidden="true" />Propose a map</Button>
          </WithReason>
        }
      />
      {sample && <SampleDataNotice />}
      {notice && <Callout tone="warning" title={notice} />}

      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={sample ? sampleRefresh.refresh : reload} refreshing={sample ? sampleRefresh.refreshing : loading} />} />}
        footer={<Pager page={current} total={rows.length} noun="carrier forms" onPage={setPage} suffix="drafts first" />}
      >
        {rows.length === 0
          ? <EmptyState title="No field maps yet" hint="A map tells the extension which box on a carrier's form takes each of our fields. Start one with Propose a map." />
          : <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th className="w-[190px]">Product</th>
                  <th className="w-[140px]">Published</th>
                  <th className="w-[150px]">Draft</th>
                  <th className="w-[140px]">Last filled</th>
                  <th className="w-[100px] text-right"><span className="sr-only">Review</span></th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {pageRows.map((g) => {
                  const target = g.draft ?? g.live;
                  return (
                    <tr key={g.key} className={cn("m-row", target && target.id === selectedId && "bg-[var(--soft-orange-surface)]")}>
                      <td className="font-semibold text-[var(--ink)]">{g.carrierName}</td>
                      <td>{g.productLabel}</td>
                      <td>
                        {g.live
                          ? <span className="inline-flex flex-wrap items-center gap-2">v{g.live.version}{g.live.status === "needs_review" && <StatusChip tone="action">Needs review</StatusChip>}</span>
                          : <StatusChip tone="neutral">None</StatusChip>}
                      </td>
                      <td>{g.draft ? <StatusChip tone="warning">v{g.draft.version} {g.draft.status === "in_review" ? "in review" : "proposed"}</StatusChip> : "—"}</td>
                      <td>{g.lastFilled ? stamp(g.lastFilled) : "—"}</td>
                      <td className="text-right">
                        <WithReason reason={target ? null : "Every version of this map is retired."}>
                          <Button type="button" variant="outline" size="sm" disabled={!target} onClick={() => target && setSelectedId(target.id)} aria-label={`Review ${g.carrierName} ${g.productLabel}`}>Review</Button>
                        </WithReason>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
      </TableCard>

      {selected && (
        <ReviewDialog
          key={selected.id}
          map={selected}
          busy={busy}
          dirty={!same(selected, saved[selected.id])}
          onClose={() => setSelectedId(null)}
          onChange={(patch) => patchMap(selected.id, patch)}
          onSave={() => saveDraft(selected)}
          onPublish={() => publish(selected)}
          onNewVersion={() => newVersion(selected)}
        />
      )}

      {creating && <NewMapDialog carriers={carriers} onClose={() => setCreating(false)} onCreate={create} />}
    </div>
  );
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground" title="Not used for a fill yet">—</span>;
  return <StatusChip tone={value >= 0.7 ? "good" : "warning"}>{value >= 0.7 ? "High" : "Low"}</StatusChip>;
}

function ReviewDialog({ map, busy, dirty, onClose, onChange, onSave, onPublish, onNewVersion }: {
  map: FieldMapView;
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
  onChange: (patch: (map: FieldMapView) => FieldMapView) => void;
  onSave: () => void;
  onPublish: () => void;
  onNewVersion: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState("");
  const editable = EDITABLE_FIELD_MAP_STATUSES.includes(map.status);
  const unverified = map.entries.filter((e) => !e.verified);
  const blocked = map.entries.filter((e) => isSensitiveKey(e.fieldKey) && !e.verified);
  const emptySelectors = map.entries.filter((e) => !e.selector.trim()).length;
  // The ones a wrong selector would cost most: sensitive, unverified, or low-confidence.
  const risky = map.entries.filter((e) => isSensitiveKey(e.fieldKey) || !e.verified || (e.confidence !== null && e.confidence < 0.7));
  const shown = showAll || risky.length === 0 ? map.entries : risky;
  const publishBlock = !editable ? undefined : map.entries.length === 0 ? "Add a field first." : blocked.length ? `Verify ${listOf(blocked.map((e) => e.fieldKey))} first.` : emptySelectors ? "Give every field a selector first." : undefined;
  const unmapped = CANONICAL_OPTIONS.filter((option) => !map.entries.some((entry) => entry.fieldKey === option.key));
  const pages = [...new Set([...map.steps.map((s) => s.pageKey), ...map.entries.map((e) => e.pageKey)])];

  const setEntry = (id: string, patch: Partial<FieldMapEntryView>) => onChange((m) => ({ ...m, entries: m.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const urlPattern = (pageKey: string) => map.steps.find((s) => s.pageKey === pageKey)?.urlPattern ?? "*";
  const setUrlPattern = (pageKey: string, value: string) => onChange((m) => {
    const exists = m.steps.some((s) => s.pageKey === pageKey);
    return { ...m, steps: exists ? m.steps.map((s) => (s.pageKey === pageKey ? { ...s, urlPattern: value } : s)) : [...m.steps, { pageKey, urlPattern: value, sortOrder: m.steps.length }] };
  });

  const sub = editable
    ? `Draft map v${map.version} · proposed ${shortDay(map.updatedAt)} · not published`
    : map.status === "retired" ? `Map v${map.version} · retired — no longer used for fills`
    : `Map v${map.version} · published${map.approvedAt ? ` ${shortDay(map.approvedAt)}` : ""}${map.status === "needs_review" ? " · a fill missed a field" : ""}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-[920px]">
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px] text-left">
          <div className="min-w-0">
            <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">{map.carrierName} · {map.productLabel} application</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]">{sub}</DialogDescription>
          </div>
          <span className="flex shrink-0 items-center gap-3.5">
            {unverified.length > 0 && <StatusChip tone="warning">{unverified.length} unverified</StatusChip>}
            <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></Button>
          </span>
        </DialogHeader>

        <div className="flex flex-col gap-[18px] p-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-[14px] text-[var(--body)]">
              {map.entries.length === 0 ? "No fields in this map yet." : shown === risky && !showAll ? `${map.entries.length} fields in the ${editable ? "draft" : "map"}. These ${risky.length} are the ones a wrong selector would cost most.` : `All ${map.entries.length} fields in the ${editable ? "draft" : "map"}.`}
            </span>
            <span className="flex flex-wrap gap-2">
              {map.origin && (
                <Button asChild variant="outline">
                  <a href={map.origin} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Open the carrier form</a>
                </Button>
              )}
              {risky.length > 0 && risky.length < map.entries.length && (
                <Button type="button" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? `Show the ${risky.length} to check` : `Show all ${map.entries.length}`}</Button>
              )}
            </span>
          </div>

          {map.entries.length > 0 && (
            <TableCard>
              <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[210px]">Our field</th>
                    <th>{map.proposalSource === "ai" ? "Proposed selector" : "Selector"}</th>
                    <th className="w-[120px]">Confidence</th>
                    <th className="w-[90px] text-center">Verified</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {shown.map((entry) => {
                    const label = fieldLabel(entry.fieldKey);
                    const sensitive = isSensitiveKey(entry.fieldKey);
                    return (
                      <tr key={entry.id} className={cn("m-row", sensitive && !entry.verified && "bg-[var(--warning-surface)]")}>
                        <td>
                          <span className="block font-mono text-xs text-[var(--ink)]">{entry.fieldKey}</span>
                          <span className="block text-xs text-muted-foreground">{label}{pages.length > 1 ? ` · ${PAGE_LABEL[entry.pageKey] ?? entry.pageKey}` : ""}</span>
                        </td>
                        <td>
                          {editable
                            ? <input aria-label={`Selector for ${label}`} className={cn(control, "mt-0 font-mono text-xs md:text-xs")} value={entry.selector} placeholder="#field-id or [name=…]" spellCheck={false}
                                // A changed selector is a new claim: it has to be checked again.
                                onChange={(event) => setEntry(entry.id, { selector: event.target.value, verified: false })} />
                            : <code className="font-mono text-xs">{entry.selector}</code>}
                        </td>
                        <td><Confidence value={entry.confidence} /></td>
                        <td className="text-center">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={entry.verified}
                            aria-label={`${label} verified`}
                            disabled={!editable || !entry.selector.trim()}
                            title={!editable ? "A published map can't change — start a new version." : !entry.selector.trim() ? "Give it a selector first." : entry.verified ? "Verified — click to undo" : "Click once you've checked it on the carrier's form"}
                            onClick={() => setEntry(entry.id, { verified: !entry.verified })}
                            className={cn("inline-flex size-5 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed", entry.verified ? "bg-[var(--success)] text-[var(--surface)]" : "border-[1.5px] border-[var(--border-strong)]")}
                          >
                            {entry.verified && <Check aria-hidden="true" className="size-3.5" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
          )}

          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="fm-add-field" className="sr-only">Field to add</label>
              <select id="fm-add-field" className={toolbarControl} value={adding} onChange={(event) => setAdding(event.target.value)}>
                <option value="">Add a field…</option>
                {[...new Set(unmapped.map((option) => option.group))].map((group) => (
                  <optgroup key={group} label={group}>
                    {unmapped.filter((option) => option.group === group).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <WithReason reason={adding ? null : "Choose a field to add first."}>
                <Button type="button" variant="outline" disabled={!adding} onClick={() => { onChange((m) => ({ ...m, entries: [...m.entries, newEntry(adding)] })); setAdding(""); setShowAll(true); }}><Plus aria-hidden="true" />Add field</Button>
              </WithReason>
            </div>
          )}

          {editable && showAll && pages.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {pages.map((p) => (
                <Field key={p} label={`${PAGE_LABEL[p] ?? p} page address`} htmlFor={`fm-page-${p}`} hint="A path like /eapp/applicant, or * for anywhere on the portal (its misses are not reported).">
                  <input id={`fm-page-${p}`} className={cn(control, "font-mono text-xs md:text-xs")} value={urlPattern(p)} spellCheck={false} onChange={(event) => setUrlPattern(p, event.target.value)} />
                </Field>
              ))}
            </div>
          )}

          {editable && blocked.length > 0 && (
            <Callout tone="error" title={`Publishing is blocked until every sensitive entry is verified — ${listOf(blocked.map((e) => e.fieldKey))} ${blocked.length === 1 ? "is" : "are"} unverified.`} />
          )}
        </div>

        <DialogFooter className="flex-row flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5 sm:justify-between">
          <span className="text-[12px] text-muted-foreground">{editable ? (dirty ? "Unsaved changes to this draft" : "Draft saved — not published") : map.status === "retired" ? "Retired — no longer used for fills" : "Published — edits go into a new version"}</span>
          <span className="flex flex-wrap gap-2.5">
            {!editable && map.status !== "retired" && <Button type="button" variant={map.status === "needs_review" ? "default" : "outline"} disabled={busy} onClick={onNewVersion}>Start version {map.version + 1}</Button>}
            {editable && (
              <WithReason reason={emptySelectors > 0 ? "Give every field a selector first." : !dirty ? "No changes to save." : null}>
                <Button type="button" variant="outline" disabled={!dirty || busy || emptySelectors > 0} onClick={onSave}>Save draft</Button>
              </WithReason>
            )}
            {editable && (
              <WithReason reason={publishBlock}>
                <Button type="button" disabled={Boolean(publishBlock) || busy} onClick={onPublish}>Publish the map</Button>
              </WithReason>
            )}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewMapDialog({ carriers, onClose, onCreate }: { carriers: FieldMapCarrierOption[]; onClose: () => void; onCreate: (input: { carrierId: string; productId: string | null; origin: string }) => Promise<void> | void }) {
  const [carrierId, setCarrierId] = useState<string>(carriers[0]?.id ?? "");
  const carrier = carriers.find((c) => c.id === carrierId);
  const [productId, setProductId] = useState("");
  const [origin, setOrigin] = useState(carriers[0]?.portalOrigin ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const validOrigin = /^https:\/\/[^\s/]+\.[^\s]+$/.test(origin.trim());
  const originError = tried && !validOrigin ? "Enter the carrier portal address, starting https://." : null;

  async function submit() {
    setTried(true);
    if (!carrierId || !validOrigin) return;
    setBusy(true);
    try {
      await onCreate({ carrierId, productId: productId || null, origin: origin.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold leading-[1.28] tracking-[-0.015em]">Propose a map</DialogTitle>
          <DialogDescription>It starts as a draft and fills nothing. Add its fields, verify them, then publish.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <Field label="Carrier" htmlFor="fm-new-carrier" required>
            <select id="fm-new-carrier" className={control} value={carrierId} onChange={(event) => { setCarrierId(event.target.value); setProductId(""); setOrigin(carriers.find((c) => c.id === event.target.value)?.portalOrigin ?? ""); }}>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Product" htmlFor="fm-new-product">
            <select id="fm-new-product" className={control} value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">All products</option>
              {(carrier?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Carrier portal URL" htmlFor="fm-new-origin" required hint="The site the application form is on." error={originError}>
            <input id="fm-new-origin" type="url" inputMode="url" className={cn(control, "font-mono")} value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://" spellCheck={false} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <WithReason reason={carriers.length === 0 ? "There are no carriers in the library yet." : null}>
              <Button type="submit" disabled={busy || carriers.length === 0}>{busy ? "Creating…" : "Create draft"}</Button>
            </WithReason>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
