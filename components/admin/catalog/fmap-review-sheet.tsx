"use client";

import { useState } from "react";
import { Check, ExternalLink, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { control, Field } from "@/components/app/settings/primitives";
import { WithReason } from "@/components/app/settings/sales/shared";
import { isSensitiveKey } from "@/lib/applications/constants";
import { EDITABLE_FIELD_MAP_STATUSES } from "@/lib/extension/constants";
import { CANONICAL_OPTIONS, PAGE_LABEL, fieldLabel, listOf, newEntry } from "@/lib/extension/mapEditing";
import type { FieldMapEntryView, FieldMapMissView, FieldMapView } from "@/lib/extension/types";
import { cn } from "@/lib/utils";

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const pathOf = (url: string) => { try { return new URL(url).pathname || "/"; } catch { return url || "—"; } };

/** A retired version that was never approved: a draft someone rejected (admin round 1; no migration needed). */
export const isRejected = (map: Pick<FieldMapView, "status" | "approvedAt">) => map.status === "retired" && !map.approvedAt;

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground" title="Not used for a fill yet">—</span>;
  return <StatusChip tone={value >= 0.7 ? "good" : "warning"}>{value >= 0.7 ? "High" : "Low"}</StatusChip>;
}

/**
 * One field map's review editor as a wide right sheet (admin round 1, catalog screen 12; it was a dialog): the entries
 * a wrong selector would cost most come first (sensitive, unverified, low confidence), with confidence and a verified
 * tick; add a field, set each page's address, open the carrier's form. A draft saves and publishes (refused while a
 * sensitive entry is unverified) or is rejected; a published map starts its next version or is retired. The misses
 * that flagged a published map are listed under the fields.
 */
export function FmapReviewSheet({ map, liveMisses, busy, dirty, onClose, onChange, onSave, onPublish, onNewVersion, onReject, onRetire }: {
  map: FieldMapView;
  /** When the draft is open: the misses on the published version behind it, which is what sent it to review. */
  liveMisses: { version: number; misses: FieldMapMissView[] } | null;
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
  onChange: (patch: (map: FieldMapView) => FieldMapView) => void;
  onSave: () => void;
  onPublish: () => void;
  onNewVersion: () => void;
  onReject: (reason: string) => Promise<boolean>;
  onRetire: (reason: string) => Promise<boolean>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState("");
  const [confirming, setConfirming] = useState<"reject" | "retire" | null>(null);
  const [reason, setReason] = useState("");
  const editable = EDITABLE_FIELD_MAP_STATUSES.includes(map.status);
  const live = map.status === "published" || map.status === "needs_review";
  const rejected = isRejected(map);
  const unverified = map.entries.filter((e) => !e.verified);
  const blocked = map.entries.filter((e) => isSensitiveKey(e.fieldKey) && !e.verified);
  const emptySelectors = map.entries.filter((e) => !e.selector.trim()).length;
  // The ones a wrong selector would cost most: sensitive, unverified, or low-confidence.
  const risky = map.entries.filter((e) => isSensitiveKey(e.fieldKey) || !e.verified || (e.confidence !== null && e.confidence < 0.7));
  const shown = showAll || risky.length === 0 ? map.entries : risky;
  const publishBlock = !editable ? undefined : map.entries.length === 0 ? "Add a field first." : blocked.length ? `Verify ${listOf(blocked.map((e) => e.fieldKey))} first.` : emptySelectors ? "Give every field a selector first." : undefined;
  const unmapped = CANONICAL_OPTIONS.filter((option) => !map.entries.some((entry) => entry.fieldKey === option.key));
  const pages = [...new Set([...map.steps.map((s) => s.pageKey), ...map.entries.map((e) => e.pageKey)])];
  const misses = live || !liveMisses ? { version: map.version, misses: map.misses } : liveMisses;

  const setEntry = (id: string, patch: Partial<FieldMapEntryView>) => onChange((m) => ({ ...m, entries: m.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const urlPattern = (pageKey: string) => map.steps.find((s) => s.pageKey === pageKey)?.urlPattern ?? "*";
  const setUrlPattern = (pageKey: string, value: string) => onChange((m) => {
    const exists = m.steps.some((s) => s.pageKey === pageKey);
    return { ...m, steps: exists ? m.steps.map((s) => (s.pageKey === pageKey ? { ...s, urlPattern: value } : s)) : [...m.steps, { pageKey, urlPattern: value, sortOrder: m.steps.length }] };
  });

  const sub = editable
    ? `Draft map v${map.version} · proposed ${shortDay(map.updatedAt)} · not published`
    : rejected ? `Map v${map.version} · rejected — never filled anything`
    : map.status === "retired" ? `Map v${map.version} · retired — no longer used for fills`
    : `Map v${map.version} · published${map.approvedAt ? ` ${shortDay(map.approvedAt)}` : ""}${map.status === "needs_review" ? " · a fill missed a field" : ""}`;

  async function confirm() {
    if (!confirming) return;
    const done = await (confirming === "reject" ? onReject(reason.trim()) : onRetire(reason.trim()));
    if (done) { setConfirming(null); setReason(""); }
  }

  return (
    <>
      <Sheet
        title={`${map.carrierName} · ${map.productLabel} application`}
        subtitle={sub}
        status={unverified.length > 0 ? <StatusChip tone="warning">{unverified.length} unverified</StatusChip> : undefined}
        onClose={onClose}
        className="lg:w-[min(100%,920px)]"
        bodyClassName="flex flex-col gap-4 p-4"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{editable ? (dirty ? "Unsaved changes to this draft" : "Draft saved — not published") : rejected ? "Rejected — kept on record" : map.status === "retired" ? "Retired — no longer used for fills" : "Published — edits go into a new version"}</span>
            <span className="flex flex-wrap gap-2">
              {editable && <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={busy} onClick={() => setConfirming("reject")}>Reject draft…</Button>}
              {live && <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={busy} onClick={() => setConfirming("retire")}>Retire…</Button>}
              {!editable && <Button type="button" variant={map.status === "needs_review" ? "default" : "outline"} disabled={busy} onClick={onNewVersion}>Start version {map.version + 1}</Button>}
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
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-[var(--body)]">
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

        {editable && blocked.length > 0 && (
          <p role="status" className="m-0 flex items-start gap-2 text-sm text-[var(--error-ink)]">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--error)]" aria-hidden="true" />
            Publishing waits until every sensitive entry is verified — {listOf(blocked.map((e) => e.fieldKey))} {blocked.length === 1 ? "is" : "are"} unverified.
          </p>
        )}

        {map.entries.length > 0 && (
          <TableCard>
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th className="w-[210px]">Our field</th>
                  <th className="min-w-[200px]">{map.proposalSource === "ai" ? "Proposed selector" : "Selector"}</th>
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
                      <td className="max-w-[210px] truncate" title={`${entry.fieldKey} · ${label}`}>
                        <span className="font-mono text-xs text-[var(--ink)]">{entry.fieldKey}</span>
                        <span className="text-xs text-muted-foreground"> · {label}{pages.length > 1 ? ` · ${PAGE_LABEL[entry.pageKey] ?? entry.pageKey}` : ""}</span>
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

        {misses.misses.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold text-foreground">Misses{misses.version !== map.version ? ` on v${misses.version}, the published map` : ""}</h3>
            <TableCard>
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th className="w-[260px]">Field the fill could not find</th><th>Page</th><th className="w-[150px]">When</th></tr></thead>
                <tbody>
                  {misses.misses.slice(0, 12).map((miss) => (
                    <tr key={miss.id}>
                      <td className="max-w-[260px] truncate" title={miss.fieldKey}><span className="font-mono text-xs">{miss.fieldKey}</span><span className="text-xs text-muted-foreground"> · {fieldLabel(miss.fieldKey)}</span></td>
                      <td className="max-w-[280px] truncate font-mono text-xs" title={miss.url}>{pathOf(miss.url)}</td>
                      <td className="tabular-nums">{stamp(miss.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
            {misses.misses.length > 12 && <p className="m-0 text-xs text-muted-foreground">The 12 newest of {misses.misses.length.toLocaleString("en-US")}.</p>}
          </section>
        )}
      </Sheet>

      <Dialog open={confirming !== null} onOpenChange={(next) => { if (!next && !busy) { setConfirming(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{confirming === "reject" ? `Reject draft v${map.version}?` : `Retire v${map.version}?`}</DialogTitle>
            <DialogDescription>
              {confirming === "reject"
                ? "It never fills anything and stays on record as rejected. Its fields can be copied into a new version later."
                : `Fills stop using it for ${map.carrierName} · ${map.productLabel}; a carrier-wide map, if there is one, takes over. It stays on record, and a new version can start from it.`}
            </DialogDescription>
          </DialogHeader>
          <Field label="Why (kept in the audit log)" htmlFor="fm-confirm-reason">
            <input id="fm-confirm-reason" className={control} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={confirming === "reject" ? "Wrong form, selectors don't match…" : "The carrier changed its form…"} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirming(null); setReason(""); }}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? "Working…" : confirming === "reject" ? "Reject draft" : "Retire the map"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
