"use client";

/**
 * /admin/field-maps — staff review of the platform field maps (board l3-ov-map-review, LA-3.13), inside the Catalog
 * frame (admin round 1, catalog screen 12): where each carrier's application form keeps each of our fields. One row
 * per carrier and product, with its published version, the draft waiting behind it, when it last filled and its
 * misses in the last 30 days; drafts and flagged maps first. A row opens the review editor as a wide right sheet
 * (`?map=<id>`). Search (`q`), "Needs review" (`review=1`) and a carrier (`carrier=<code>`) are in the URL. Reads
 * and writes /api/admin/field-maps; with `sample` (the page's `?preview=sample`) it edits the design fixtures
 * locally and saves nothing.
 *
 * Staff verify entries and publish (the approver is recorded in approved_by_admin / verified_by_admin —
 * 20260926102510; until it is applied the API refuses with a plain sentence). Publishing is refused while an SSN or
 * bank / card entry is unverified — the database's own message is shown. A published map is frozen; "Start version
 * N + 1" makes the next draft. A draft can be rejected and a published map retired: both are moves to `retired` the
 * status rules already allow (a rejected draft is one that was never approved), so no migration was needed.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/lib/notify";

import { FmapReviewSheet, isRejected } from "@/components/admin/catalog/fmap-review-sheet";
import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { carrierHref } from "@/components/admin/layout-maps/shared";
import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, RefreshButton, ToolbarSearch, type ActiveFilter } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { patchQuery } from "@/components/admin/catalog/layout-url";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { control, Field } from "@/components/app/settings/primitives";
import { WithReason } from "@/components/app/settings/sales/shared";
import { useSampleRefresh } from "@/components/app/applications/applications-list";
import { isSensitiveKey } from "@/lib/applications/constants";
import { EDITABLE_FIELD_MAP_STATUSES, FILLABLE_FIELD_MAP_STATUSES } from "@/lib/extension/constants";
import { mapRequest, savePayload } from "@/lib/extension/mapEditing";
import type { FieldMapCarrierOption, FieldMapView } from "@/lib/extension/types";
import { cn } from "@/lib/utils";

const SAMPLE_NOTE = { detail: "Sample data — nothing is saved." };
const MISS_WINDOW_MS = 30 * 86_400_000;
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const same = (a: FieldMapView, b: FieldMapView | undefined) => JSON.stringify(a.entries) === JSON.stringify(b?.entries) && JSON.stringify(a.steps) === JSON.stringify(b?.steps);

/** One row of the board: a carrier + product, its live version, the draft behind it, and its newest version of any kind. */
type Group = { key: string; carrierId: string; carrierName: string; productLabel: string; live: FieldMapView | null; draft: FieldMapView | null; newest: FieldMapView; mapIds: string[]; lastFilled: string | null };

function groups(maps: FieldMapView[], lastFilled: Record<string, string>): Group[] {
  const by = new Map<string, FieldMapView[]>();
  for (const m of maps) by.set(`${m.carrierId}|${m.productId ?? ""}`, [...(by.get(`${m.carrierId}|${m.productId ?? ""}`) ?? []), m]);
  return [...by.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.version - a.version);
    const live = sorted.find((m) => FILLABLE_FIELD_MAP_STATUSES.includes(m.status)) ?? null;
    const draft = sorted.find((m) => EDITABLE_FIELD_MAP_STATUSES.includes(m.status)) ?? null;
    const filled = list.map((m) => lastFilled[m.id]).filter(Boolean).sort().pop() ?? null;
    return { key, carrierId: sorted[0].carrierId, carrierName: sorted[0].carrierName, productLabel: sorted[0].productLabel, live, draft, newest: sorted[0], mapIds: list.map((m) => m.id), lastFilled: filled };
  }).sort((a, b) => Number(needsLook(b)) - Number(needsLook(a)) || a.carrierName.localeCompare(b.carrierName));
}
const needsLook = (g: Group) => Boolean(g.draft) || g.live?.status === "needs_review";

export function FieldMapsReview({ initialMaps, carriers, sample, pending = false, lastFilled = {}, misses30, carrierCodes = {} }: {
  initialMaps: FieldMapView[];
  carriers: FieldMapCarrierOption[];
  sample: boolean;
  /** The field-map tables are not there yet. */
  pending?: boolean;
  lastFilled?: Record<string, string>;
  /** map_miss events per map in the last 30 days; null when they could not be read; undefined counts them from each map's misses. */
  misses30?: Record<string, number> | null;
  /** carrier id → code, for `?carrier=<code>` and the link to the carrier's record. */
  carrierCodes?: Record<string, string>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [maps, setMaps] = useState(initialMaps);
  // What the server last said, per map: an edit is "unsaved" against this.
  const [saved, setSaved] = useState<Record<string, FieldMapView>>(() => Object.fromEntries(initialMaps.map((m) => [m.id, m])));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now] = useState(() => Date.now());
  const sampleRefresh = useSampleRefresh();

  const query = (params.get("q") ?? "").trim().toLowerCase();
  // `?status=review` is the Catalog workspace's spelling of the same filter.
  const onlyReview = params.get("review") === "1" || params.get("status") === "review";
  const carrierCode = (params.get("carrier") ?? "").toLowerCase();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const selectedId = params.get("map");
  const creating = params.get("propose") === "1";
  const set = (patch: Record<string, string | null>) => patchQuery(patch);
  const select = (id: string | null) => set({ map: id, propose: null });

  const rows = useMemo(() => groups(maps, lastFilled), [maps, lastFilled]);
  const codeOf = (carrierId: string) => carrierCodes[carrierId] ?? "";
  const missesOf = (g: Group): number | null => {
    if (misses30 === null) return null;
    if (misses30) return g.mapIds.reduce((sum, id) => sum + (misses30[id] ?? 0), 0);
    return maps.filter((m) => g.mapIds.includes(m.id)).reduce((sum, m) => sum + m.misses.filter((x) => now - Date.parse(x.at) <= MISS_WINDOW_MS).length, 0);
  };
  const focusName = carrierCode ? rows.find((g) => codeOf(g.carrierId).toLowerCase() === carrierCode)?.carrierName ?? carriers.find((c) => codeOf(c.id).toLowerCase() === carrierCode)?.name ?? params.get("carrier") : null;
  const filtered = rows.filter((g) => {
    if (onlyReview && !needsLook(g)) return false;
    if (carrierCode && codeOf(g.carrierId).toLowerCase() !== carrierCode) return false;
    return !query || `${g.carrierName} ${g.productLabel}`.toLowerCase().includes(query);
  });
  const pageSize = useFittingPageSize(420, 45);
  const { current, rows: pageRows } = paginate(filtered, page, pageSize);
  const selected = maps.find((map) => map.id === selectedId) ?? null;
  const selectedGroup = selected ? rows.find((g) => g.mapIds.includes(selected.id)) ?? null : null;

  const figures = {
    forms: rows.length,
    published: rows.filter((g) => g.live).length,
    drafts: rows.filter((g) => g.draft).length,
    inReview: rows.filter((g) => g.draft?.status === "in_review").length,
    flagged: rows.filter((g) => g.live?.status === "needs_review").length,
    look: rows.filter(needsLook).length,
  };

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/field-maps", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Field maps could not be loaded.");
      // Unsaved edits on the open map survive a refresh.
      setMaps((list) => (data.maps as FieldMapView[]).map((m) => list.find((x) => x.id === m.id && x.id === selectedId && !same(x, saved[x.id])) ?? m));
      setSaved(Object.fromEntries((data.maps as FieldMapView[]).map((m) => [m.id, m])));
      // Last filled and the miss counts are the server page's.
      router.refresh();
    } catch (e) {
      notify.block(errorText(e, "Field maps could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [saved, selectedId, router]);

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
      const next: FieldMapView = { ...map, id, version, status: "draft", approvedAt: null, misses: [], updatedAt: new Date().toISOString(), entries: map.entries.map((entry, i) => ({ ...entry, id: `${id}-e${i + 1}`, verified: isSensitiveKey(entry.fieldKey) ? false : entry.verified })) };
      accept(next);
      select(id);
      return notify.done(`Draft v${version} started.`, SAMPLE_NOTE);
    }
    setBusy(true);
    try {
      const next = await mapRequest(`/api/admin/field-maps/${map.id}/versions`, { method: "POST" });
      accept(next);
      select(next.id);
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

  /** Reject a draft or retire a live map: both end in `retired` (a rejected one was never approved). */
  async function close(map: FieldMapView, how: "reject" | "retire", reason: string): Promise<boolean> {
    const what = how === "reject" ? `Draft v${map.version} rejected.` : `${map.carrierName} · ${map.productLabel} v${map.version} retired.`;
    if (sample) {
      patchMap(map.id, (m) => ({ ...m, status: "retired", ...(how === "reject" ? { approvedAt: null } : {}) }));
      notify.done(what, SAMPLE_NOTE);
      return true;
    }
    setBusy(true);
    try {
      accept(await mapRequest(`/api/admin/field-maps/${map.id}/${how}`, { method: "POST", body: JSON.stringify({ reason: reason || null }) }));
      notify.done(what);
      void reload();
      return true;
    } catch (e) {
      notify.block(errorText(e, how === "reject" ? "Couldn't reject the draft." : "Couldn't retire the map."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(input: { carrierId: string; productId: string | null; origin: string }) {
    if (sample) {
      const carrier = carriers.find((c) => c.id === input.carrierId);
      const id = `fm-new-${Date.now()}`;
      accept({ id, carrierId: input.carrierId, carrierName: carrier?.name ?? input.carrierId, productId: input.productId, productLabel: input.productId ?? "All products", version: 1, status: "draft", origin: input.origin, platform: true, proposalSource: "manual", steps: [], entries: [], misses: [], updatedAt: new Date().toISOString(), approvedAt: null });
      select(id);
      return;
    }
    try {
      const map = await mapRequest("/api/admin/field-maps", { method: "POST", body: JSON.stringify({ carrier_id: input.carrierId, carrier_product_id: input.productId, origin: input.origin }) });
      accept(map);
      select(map.id);
    } catch (e) {
      notify.block(errorText(e, "Couldn't create the map."));
    }
  }

  const carrierFilter: ActiveFilter[] = carrierCode ? [{ key: "carrier", label: "Carrier", value: focusName ?? carrierCode, onRemove: () => set({ carrier: null, page: null }) }] : [];
  const proposeFor = carrierCode ? carriers.find((c) => codeOf(c.id).toLowerCase() === carrierCode)?.id : undefined;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
      {pending ? (
        <BillingStatusLine tone="bad" lead={{ text: "Field maps need a database update" }} parts={["apply the latest migrations to review them"]} />
      ) : misses30 === null || sample ? (
        <BillingStatusLine
          tone={misses30 === null ? "bad" : "warn"}
          lead={{ text: misses30 === null ? "The misses could not be read" : "Sample data — nothing is saved" }}
          parts={[misses30 === null && sample ? "sample data — nothing is saved" : null]}
        />
      ) : null}

      {!pending && (
        <StatStrip label="Field maps">
          <StatTile label="Carrier forms" value={figures.forms.toLocaleString("en-US")} footnote="carrier and product pairs" />
          <StatTile label="Published" value={figures.published.toLocaleString("en-US")} footnote="filling applications" />
          <StatTile label="Drafts" value={figures.drafts.toLocaleString("en-US")} footnote={`${figures.inReview.toLocaleString("en-US")} in review`} href="/admin/field-maps?review=1" />
          <StatTile label="Needs review" labelTitle="A published map whose fill missed a field" value={figures.flagged.toLocaleString("en-US")} footnote="a fill missed a field" href="/admin/field-maps?review=1" />
        </StatStrip>
      )}

      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={sample ? sampleRefresh.refresh : () => void reload()} refreshing={sample ? sampleRefresh.refreshing : loading} />}>
            <ToolbarSearch value={params.get("q") ?? ""} onChange={(next) => set({ q: next || null, page: null })} placeholder="Search carrier or product" />
            <ToggleChip selected={onlyReview} count={figures.look} onClick={() => set({ review: onlyReview ? null : "1", status: null, page: null })}>Needs review</ToggleChip>
            <ActiveFilters inline filters={carrierFilter} onClear={() => set({ carrier: null, q: null, review: null, status: null, page: null })} />
          </DataToolbar>
        }
        footer={filtered.length > 0 ? <Pager page={current} pageSize={pageSize} total={filtered.length} noun="carrier forms" onPage={(next) => set({ page: next > 1 ? String(next) : null })} suffix="drafts and flagged first" /> : undefined}
      >
        {rows.length === 0
          ? <EmptyState title={pending ? "Field maps are not set up yet" : "No field maps yet"} hint={pending ? "The database update in the status line comes first." : "A map tells the extension which box on a carrier's form takes each of our fields. Start one with Propose a map."} />
          : filtered.length === 0
            ? <NoMatches noun="carrier forms" onClear={() => set({ q: null, review: null, status: null, carrier: null, page: null })} />
            : <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="min-w-[160px]">Carrier</th>
                    <th className="min-w-[150px]">Product</th>
                    <th className="w-[170px]">Published</th>
                    <th className="w-[150px]">Draft</th>
                    <th className="w-[150px]">Last filled</th>
                    <th className="w-[120px] text-right">Misses · 30 days</th>
                    <th className="w-[100px] text-right"><span className="sr-only">Review</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {pageRows.map((g) => {
                    const target = g.draft ?? g.live ?? g.newest;
                    const code = codeOf(g.carrierId);
                    const missed = missesOf(g);
                    const flagged = g.live?.status === "needs_review";
                    return (
                      <tr key={g.key} className={cn("m-row", g.mapIds.includes(selectedId ?? "") && "bg-[var(--primary-soft)]")}>
                        <td className="max-w-[220px] truncate font-semibold">{code ? <Link href={carrierHref(code)} className="text-[var(--ink)] hover:underline">{g.carrierName}</Link> : <span className="text-[var(--ink)]">{g.carrierName}</span>}</td>
                        <td className="max-w-[220px] truncate">{g.productLabel}</td>
                        <td className="whitespace-nowrap">
                          {g.live
                            ? <span className="inline-flex items-center gap-2 tabular-nums">v{g.live.version}{flagged && <StatusChip tone="warning">Needs review</StatusChip>}</span>
                            : <span className="text-muted-foreground">{isRejected(g.newest) ? "None · last draft rejected" : g.newest.status === "retired" ? "None · retired" : "None"}</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          {g.draft
                            ? (flagged ? <span className="tabular-nums">v{g.draft.version} {g.draft.status === "in_review" ? "in review" : "proposed"}</span> : <StatusChip tone={g.draft.status === "in_review" ? "info" : "action"}>v{g.draft.version} {g.draft.status === "in_review" ? "in review" : "proposed"}</StatusChip>)
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{g.lastFilled ? stamp(g.lastFilled) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right tabular-nums">{missed === null ? <span className="text-muted-foreground">—</span> : missed > 0 ? <button type="button" className="text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]" onClick={() => select((g.live ?? target).id)}>{missed.toLocaleString("en-US")}</button> : <span className="text-muted-foreground">0</span>}</td>
                        <td className="text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => select(target.id)} aria-label={`Review ${g.carrierName} ${g.productLabel}`}>{EDITABLE_FIELD_MAP_STATUSES.includes(target.status) || flagged ? "Review" : "Open"}</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>

      {selected && (
        <FmapReviewSheet
          key={selected.id}
          map={selected}
          liveMisses={selectedGroup?.live && selectedGroup.live.id !== selected.id ? { version: selectedGroup.live.version, misses: selectedGroup.live.misses } : null}
          busy={busy}
          dirty={!same(selected, saved[selected.id])}
          onClose={() => select(null)}
          onChange={(patch) => patchMap(selected.id, patch)}
          onSave={() => saveDraft(selected)}
          onPublish={() => publish(selected)}
          onNewVersion={() => newVersion(selected)}
          onReject={(reason) => close(selected, "reject", reason)}
          onRetire={(reason) => close(selected, "retire", reason)}
        />
      )}

      {creating && !pending && <NewMapDialog carriers={carriers} initialCarrierId={proposeFor} onClose={() => set({ propose: null })} onCreate={create} />}
    </div>
  );
}

function NewMapDialog({ carriers, initialCarrierId, onClose, onCreate }: { carriers: FieldMapCarrierOption[]; initialCarrierId?: string; onClose: () => void; onCreate: (input: { carrierId: string; productId: string | null; origin: string }) => Promise<void> | void }) {
  const first = carriers.find((c) => c.id === initialCarrierId) ?? carriers[0];
  const [carrierId, setCarrierId] = useState<string>(first?.id ?? "");
  const carrier = carriers.find((c) => c.id === carrierId);
  const [productId, setProductId] = useState("");
  const [origin, setOrigin] = useState(first?.portalOrigin ?? "");
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
          <DialogTitle className="text-title-sm font-semibold leading-[1.28] tracking-[-0.015em]">Propose a map</DialogTitle>
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
