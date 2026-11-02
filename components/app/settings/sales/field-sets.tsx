"use client";

/**
 * Settings › Sales › Application field sets (LA-3.7; owner pick B, 2026-10-30, canvas page
 * settings-field-sets). Reads and writes /api/app/settings/sales/templates?kind=application_field_set;
 * `?preview=sample` (outside production) renders the design fixtures and saves nothing.
 *
 * The carriers on the left, one row per carrier and product, grouped into the agency's own sets and
 * the ones still on the platform set; the picked one on the right. Every field an application can
 * carry is listed there as Not asked / Optional / Required, because Required is what the set is for:
 * the application step marks those fields and pre-submit QA refuses to pass without them
 * (lib/applications/service.ts reads only `required`). The carrier's wording rides along per field.
 *
 * Also here: what changed from the platform set, the versions with who and when, whether the
 * carrier's autofill map (/api/app/field-maps) places every asked field, Give a carrier its own set
 * (starting from any set), Use for other carriers, Delete draft, Retire and Go back to the platform set.
 * A platform set is read-only until it is customised for the agency.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GripVertical, Lock, Pencil, Plus, Search } from "lucide-react";

import { Callout, SettingsStack, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";
import { FILLABLE_FIELD_MAP_STATUSES } from "@/lib/extension/constants";
import type { FieldMapView } from "@/lib/extension/types";
import { notify } from "@/lib/notify";
import {
  FIELD_SET_GROUPS, FIELD_STATE_LABEL, addCustom, changesFrom, editEntry, groupEntries, moveWithinGroup, requireAsked, setKeyState, stateOfKey, unplacedKeys,
  type FieldState, type QuestionDraft,
} from "@/lib/salesSettings/fieldSetView";
import { CUSTOM_TYPE_LABEL, fieldMeta, fieldSetEntries, fieldSetFromEntries, type FieldSetEntry } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { AddFieldSetDialog, CopyToCarriersDialog, FieldSetPublishDialog, FieldSetRetireDialog, QuestionDialog, type StartFrom } from "./field-sets-dialogs";
import {
  DiscardSave, ReadOnlyNotice, RowMenu, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, WithReason, plural, salesApi, shortDay,
} from "./shared";
import { liveOf, useSalesTemplates } from "./templates-data";

type SetRow = {
  key: string;
  carrierId: string | null;
  carrierName: string;
  productCode: string;
  productLabel: string;
  /** The agency's own set for this pair: its open draft, else its live version. */
  own: TemplateRowView | null;
  /** What an application for this pair uses right now. */
  inUse: TemplateRowView | null;
  /** The agency's own live version for this pair, if any — what Retire retires. */
  liveOwn: TemplateRowView | null;
  /** The agency's open draft for this pair, if any — what Delete draft deletes. */
  draftOwn: TemplateRowView | null;
  /** The platform set this pair falls back to without its own. */
  platform: TemplateRowView | null;
  /** The agency's versions for this pair, newest first. */
  versions: TemplateRowView[];
};

type Filter = "all" | "own" | "draft" | "platform" | "gaps";
type Tab = "fields" | "preview" | "changes" | "versions";
type Show = "all" | "asked" | "required";
type Dialog = { kind: "add"; carrierId: string | null; productCode: string } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | { kind: "copy" } | null;

/** Carriers › 3 · Field maps, where a carrier's autofill map is built and checked. */
const FIELD_MAP_HREF = "/app/settings#carriers/carriers-maps";

const newestOf = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;
const storedJson = (t: TemplateRowView) => JSON.stringify(fieldSetFromEntries(fieldSetEntries(t.definition)));
const entriesOf = (t: TemplateRowView | null) => fieldSetEntries(t?.definition);

function statusOf(r: SetRow): { tone: StatusTone; label: string } {
  if (r.draftOwn && r.liveOwn) return { tone: "good", label: `Live v${r.liveOwn.version} · draft v${r.draftOwn.version}` };
  if (r.draftOwn) return { tone: "info", label: `Draft v${r.draftOwn.version}` };
  if (r.liveOwn) return { tone: "good", label: `Live v${r.liveOwn.version}` };
  return { tone: "neutral", label: "Platform set" };
}

/**
 * Each carrier's autofill map keys, from the map the extension fills with (published or needing
 * review; the agency's own before Insurvas's). Null while loading, in sample mode, or without the
 * extension feature: the section then says nothing about autofill.
 */
function useAutofillKeys(enabled: boolean) {
  const [keys, setKeys] = useState<Map<string, Set<string>> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    void (async () => {
      try {
        const res = await fetch("/api/app/field-maps", { cache: "no-store" });
        if (!res.ok || gone) return;
        const data = (await res.json()) as { maps?: FieldMapView[] };
        const best = new Map<string, FieldMapView>();
        for (const m of data.maps ?? []) {
          if (!FILLABLE_FIELD_MAP_STATUSES.includes(m.status)) continue;
          const had = best.get(m.carrierId);
          if (!had || (had.platform && !m.platform) || (had.platform === m.platform && m.version > had.version)) best.set(m.carrierId, m);
        }
        if (!gone) setKeys(new Map([...best].map(([id, m]) => [id, new Set(m.entries.map((e) => e.fieldKey))])));
      } catch {
        // Autofill is a hint here; without it the section still works.
      }
    })();
    return () => { gone = true; };
  }, [enabled]);
  return keys;
}

export function SalesFieldSets() {
  const api = useSalesTemplates("application_field_set");
  const router = useRouter();
  const { payload, sample } = api;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<FieldSetEntry[]>([]);
  /** The question dialog: adding one to a section, or editing a field. */
  const [question, setQuestion] = useState<{ mode: "add"; group: string } | { mode: "edit"; key: string } | null>(null);
  /** Said to screen readers after a keyboard move. */
  const [announce, setAnnounce] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const listRefs = useRef<Record<string, HTMLUListElement | null>>({});
  const startingDraft = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<Tab>("fields");
  const [fieldQuery, setFieldQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const canEdit = Boolean(payload?.canEdit);
  const mapKeys = useAutofillKeys(Boolean(payload) && !sample);

  const rows = useMemo<SetRow[]>(() => {
    if (!payload) return [];
    const lineName = new Map(payload.productLines.map((p) => [p.code, p.name]));
    const pick = (tenant: boolean, carrierId: string | null, code: string, statuses: string[]) =>
      newestOf(all.filter((t) => t.tenantOwned === tenant && (t.carrierId ?? null) === carrierId && t.productCode === code && statuses.includes(t.status)));
    const platformGeneric = pick(false, null, "final_expense", ["published"]);
    const make = (carrierId: string | null, carrierName: string, code: string): SetRow => {
      const names = payload.carrierProducts.filter((p) => p.carrierId === carrierId && p.productCode === code).map((p) => p.name);
      const draftOwn = pick(true, carrierId, code, ["draft"]);
      const liveOwn = pick(true, carrierId, code, ["published"]);
      const platform = pick(false, carrierId, code, ["published"]) ?? pick(false, null, code, ["published"]) ?? platformGeneric;
      return {
        key: `${carrierId ?? ""}|${code}`, carrierId, carrierName, productCode: code, productLabel: names.length ? names.join(", ") : lineName.get(code) ?? code,
        own: draftOwn ?? liveOwn, inUse: liveOwn ?? platform, liveOwn, draftOwn, platform,
        versions: all.filter((t) => t.tenantOwned && (t.carrierId ?? null) === carrierId && t.productCode === code).sort((a, b) => b.version - a.version),
      };
    };
    const out: SetRow[] = [];
    for (const c of payload.carriers) {
      const codes = [...new Set(payload.carrierProducts.filter((p) => p.carrierId === c.id).map((p) => p.productCode))];
      for (const code of codes.length ? codes : ["final_expense"]) out.push(make(c.id, c.name, code));
    }
    // The agency's sets for a pair not on the list above (a carrier-less set, or a product line added here).
    for (const t of all.filter((x) => x.tenantOwned)) {
      const key = `${t.carrierId ?? ""}|${t.productCode}`;
      if (!out.some((r) => r.key === key)) out.push(make(t.carrierId, t.carrierName ?? "Every carrier", t.productCode));
    }
    return out;
  }, [payload, all]);

  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  const editing = selected?.own ?? null;
  const shown = editing ?? selected?.inUse ?? null;
  // A platform set is not read-only to an owner: the first change copies it into a draft (owner 2026-10-30).
  const readOnly = !canEdit || !shown;
  const definition = useMemo(() => fieldSetFromEntries(entries), [entries]);
  const dirty = Boolean(editing && JSON.stringify(definition) !== storedJson(editing));
  const problem = editing && !readOnly ? definitionProblem("application_field_set", definition) : null;
  const ownerOnly = canEdit ? null : "Only an owner can change field sets.";

  /** The asked fields the carrier's map does not place; null when there is no map (or no word on maps). */
  const unplacedOf = (r: SetRow, list: FieldSetEntry[]) => (mapKeys && r.carrierId ? unplacedKeys(list, mapKeys.get(r.carrierId) ?? null) : null);
  const autofillOf = (r: SetRow, list: FieldSetEntry[]): { text: string; tone: "good" | "warning" | "muted"; gap: boolean } | null => {
    if (!mapKeys || !r.carrierId) return null;
    const missing = unplacedOf(r, list);
    if (missing === null) return { text: "No autofill map", tone: "muted", gap: false };
    return missing.length ? { text: `${plural(missing.length, "field")} not placed`, tone: "warning", gap: true } : { text: "Fills every field", tone: "good", gap: false };
  };

  type FilterOption = { key: Filter; label: string; test: (r: SetRow) => boolean };
  const allFilters: FilterOption[] = [
    { key: "all", label: "All", test: () => true },
    { key: "own", label: "Your own", test: (r) => Boolean(r.own) },
    { key: "draft", label: "Drafts", test: (r) => Boolean(r.draftOwn) },
    { key: "platform", label: "Platform", test: (r) => !r.own },
    { key: "gaps", label: "Autofill gaps", test: (r) => Boolean(autofillOf(r, entriesOf(r.own ?? r.inUse))?.gap) },
  ];
  // "Autofill gaps" shows only when some carrier's map misses an asked field.
  const filters = allFilters.filter((f) => f.key !== "gaps" || rows.some(f.test));
  const activeFilter = filters.find((f) => f.key === filter) ?? filters[0];
  const q = query.trim().toLowerCase();
  const listed = rows.filter((r) => activeFilter.test(r) && (!q || `${r.carrierName} ${r.productLabel}`.toLowerCase().includes(q)));
  const ownListed = listed.filter((r) => r.own);
  const platformListed = listed.filter((r) => !r.own);

  const load = (r: SetRow) => {
    setSelectedKey(r.key);
    setEntries(entriesOf(r.own ?? r.inUse));
    setTab("fields");
    setFieldQuery("");
    setSaveError(null);
  };
  const leaveEdits = async () => {
    if (!dirty || !selected) return true;
    return confirmAction({
      title: "Leave without saving?",
      description: `You changed the ${selected.carrierName} · ${selected.productLabel} field set and have not saved it.`,
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
    });
  };
  const open = async (r: SetRow) => {
    if (r.key === selectedKey) return;
    if (!(await leaveEdits())) return;
    load(r);
  };
  const close = async () => {
    if (!(await leaveEdits())) return;
    setSelectedKey(null);
  };
  const discard = () => { if (selected) { setEntries(entriesOf(selected.own ?? selected.inUse)); setSaveError(null); } };
  /**
   * Every edit goes through here. On the agency's own set it edits the draft in hand; on a platform
   * set it first copies the set into the agency's draft (as Customise does), then applies the edit.
   */
  const change = (fn: (list: FieldSetEntry[]) => FieldSetEntry[]) => {
    if (!canEdit || !selected) return;
    if (editing) { setEntries(fn); return; }
    if (!selected.inUse || startingDraft.current) return;
    startingDraft.current = true;
    void createFrom(selected.inUse.id, selected.carrierId, selected.productCode)
      .then(() => setEntries((list) => fn(list)))
      .finally(() => { startingDraft.current = false; });
  };
  const setState = (key: string, state: FieldState) => change((list) => setKeyState(list, key, state));
  /** One step up or down within the field's section, from the keyboard. */
  const nudge = (key: string, by: number) => {
    const e = entries.find((x) => x.key === key);
    if (!e) return;
    const section = groupEntries(entries, e.group);
    const from = section.findIndex((x) => x.key === key);
    const to = Math.max(0, Math.min(section.length - 1, from + by));
    if (to === from) return;
    change((list) => moveWithinGroup(list, key, to));
    setAnnounce(`${e.label} moved to position ${to + 1} of ${section.length}.`);
  };
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(key, event.key === "ArrowUp" ? -1 : 1);
    }
  };
  /** Drag by the handle (mouse, pen or touch): the field takes the place the pointer is over in its section. */
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, key: string, group: string) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    // On a platform set the first drag starts the agency's draft; the field moves from the next one.
    if (!editing) { change((list) => list); return; }
    setDragKey(key);
    let last = -1;
    const move = (ev: PointerEvent) => {
      const items = [...(listRefs.current[group]?.querySelectorAll<HTMLElement>("[data-asked-key]") ?? [])].filter((el) => el.dataset.askedKey !== key);
      let index = items.findIndex((el) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (index < 0) index = items.length;
      if (index === last) return;
      last = index;
      setEntries((list) => moveWithinGroup(list, key, index));
    };
    const up = () => {
      setDragKey(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const saveQuestion = (draft: QuestionDraft) => {
    if (!question) return;
    if (question.mode === "add") change((list) => addCustom(list, draft));
    else change((list) => editEntry(list, question.key, draft));
    setQuestion(null);
  };
  const removeQuestion = (key: string) => {
    change((list) => list.filter((e) => e.key !== key));
    setQuestion(null);
  };

  const save = async () => {
    if (!editing) return false;
    setSaving(true);
    const { saved, error } = await api.save(editing.id, { definition: definition as Record<string, unknown> });
    setSaving(false);
    setSaveError(error);
    if (saved) setEntries(fieldSetEntries(saved.template.definition));
    return Boolean(saved);
  };

  /** A new draft for a pair, copied from any set; opens it. */
  const createFrom = async (fromId: string, carrierId: string | null, productCode: string) => {
    const carrierName = payload?.carriers.find((c) => c.id === carrierId)?.name ?? rows.find((r) => r.carrierId === carrierId)?.carrierName ?? "Carrier";
    const line = payload?.productLines.find((p) => p.code === productCode)?.name ?? productCode;
    const copied = await api.copy(fromId, { product_code: productCode, carrier_id: carrierId, name: `${carrierName} · ${line}` }, "Draft created. Publish it when it matches the carrier's form.");
    setSelectedKey(`${carrierId ?? ""}|${productCode}`);
    setTab("fields");
    // Sample mode copies on screen only and returns nothing: start from the source's fields.
    setEntries(fieldSetEntries((copied ?? all.find((t) => t.id === fromId))?.definition));
  };

  /** Several steps as one action: one reload and one toast (sample mode: the hook's own steps). */
  const runAll = async (steps: { url: string; method: string; body?: unknown }[], done: string) => {
    let failed: string | null = null;
    for (const s of steps) {
      const res = await salesApi(s.url, { method: s.method, body: s.body });
      if (!res.ok) { failed = res.error; break; }
    }
    await api.reload();
    if (failed) notify.block(failed);
    else notify.done(done);
    return !failed;
  };
  const base = "/api/app/settings/sales/templates";

  const deleteDraft = async () => {
    if (!selected?.draftOwn) return;
    const ok = await confirmAction({
      title: `Delete draft v${selected.draftOwn.version}?`,
      description: selected.liveOwn ? `Your changes since v${selected.liveOwn.version} are lost. v${selected.liveOwn.version} stays live.` : `${selected.carrierName} goes back to the platform set. This cannot be undone.`,
      confirmLabel: "Delete draft",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    if (await api.remove(selected.draftOwn.id)) {
      const live = selected.liveOwn;
      setEntries(entriesOf(live ?? selected.platform));
    }
  };

  const backToPlatform = async () => {
    if (!selected?.own) return;
    const platformReq = entriesOf(selected.platform).filter((e) => e.required).length;
    const ok = await confirmAction({
      title: "Go back to the platform set?",
      description: `${[selected.liveOwn && `v${selected.liveOwn.version} is retired`, selected.draftOwn && `draft v${selected.draftOwn.version} is deleted`].filter(Boolean).join(" and ")}. New ${selected.carrierName} applications then use the platform set (${platformReq} required). Started applications keep their version.`,
      confirmLabel: "Use the platform set",
    });
    if (!ok) return;
    if (sample) {
      if (selected.draftOwn) await api.remove(selected.draftOwn.id);
      if (selected.liveOwn) await api.retire(selected.liveOwn.id);
    } else {
      await runAll([
        ...(selected.draftOwn ? [{ url: `${base}/${selected.draftOwn.id}`, method: "DELETE" }] : []),
        ...(selected.liveOwn ? [{ url: `${base}/${selected.liveOwn.id}/retire`, method: "POST" }] : []),
      ], `${selected.carrierName} is back on the platform set`);
    }
    setEntries(entriesOf(selected.platform));
  };

  const copyTo = async (keys: string[]) => {
    if (!shown || !selected) return;
    const targets = rows.filter((r) => keys.includes(r.key));
    if (sample) {
      for (const r of targets) await api.copy(shown.id, { product_code: r.productCode, carrier_id: r.carrierId, name: `${r.carrierName} · ${r.productLabel}` });
    } else {
      await runAll(targets.map((r) => ({ url: `${base}/${shown.id}/copy`, method: "POST", body: { product_code: r.productCode, carrier_id: r.carrierId, name: `${r.carrierName} · ${r.productLabel}` } })),
        `${plural(targets.length, "draft")} created from ${selected.carrierName}. Publish each one when it matches its carrier's form.`);
    }
    setDialog(null);
  };

  /** For the add dialog: what the pair uses today, then the agency's own sets. */
  const startFrom = (carrierId: string | null, productCode: string): StartFrom[] => {
    const row = rows.find((r) => r.carrierId === carrierId && r.productCode === productCode);
    const now = row?.inUse ?? newestOf(all.filter((t) => !t.tenantOwned && !t.carrierId && t.status === "published" && t.productCode === productCode))
      ?? newestOf(all.filter((t) => !t.tenantOwned && !t.carrierId && t.status === "published"));
    const req = (t: TemplateRowView) => `${entriesOf(t).filter((e) => e.required).length} required`;
    const out: StartFrom[] = now ? [{ id: now.id, label: now.tenantOwned ? "The set it uses now" : "The platform set", detail: req(now) }] : [];
    for (const r of rows) {
      const t = r.own;
      if (!t || t.id === now?.id || r.key === row?.key) continue;
      out.push({ id: t.id, label: `${r.carrierName} · ${r.productLabel}`, detail: `yours, ${t.status === "draft" ? "draft" : "live"} v${t.version} · ${req(t)}` });
    }
    return out;
  };

  // ── the picked set ──
  const required = entries.filter((e) => e.required).length;
  const optional = entries.length - required;
  const notAsked = FIELD_SET_GROUPS.reduce((n, g) => n + g.keys.length, 0) - entries.filter((e) => !e.custom).length;
  const changes = selected ? changesFrom(entriesOf(selected.platform), entries) : [];
  const auto = selected ? autofillOf(selected, entries) : null;
  const unplaced = new Set(selected ? unplacedOf(selected, entries) ?? [] : []);
  const platformKeys = entriesOf(selected?.platform ?? null);
  const status = selected ? statusOf(selected) : null;
  const pair = selected ? `${selected.carrierName} · ${selected.productLabel}` : "";
  const versionLine = !selected ? "" : !selected.own
    ? "The Insurvas default. Any change you make starts your own draft; nothing goes live until you publish it."
    : [
      // The chip already names the version; the line says what it means.
      selected.draftOwn && selected.liveOwn ? `Editing the draft; v${selected.liveOwn.version} stays live until you publish` : selected.draftOwn ? "Never published" : `Changing a field starts draft v${(selected.versions[0]?.version ?? 0) + 1}`,
      selected.own.editedBy ? `edited by ${selected.own.editedBy}, ${shortDay(selected.own.updatedAt)}` : `edited ${shortDay(selected.own.updatedAt)}`,
    ].join(" · ");
  const publishable = Boolean(editing?.status === "draft" && !dirty);
  const shownProblem = saveError ?? (dirty ? problem : null);
  const platformRequired = platformKeys.filter((e) => e.required).length;
  // Changes and Versions belong to the agency's own set; a platform set shows Fields.
  const activeTab: Tab = !selected?.own && (tab === "changes" || tab === "versions") ? "fields" : tab;
  const fq = fieldQuery.trim().toLowerCase();
  // Each section: its asked fields in the agent's order (they move), then the built-in fields it does not ask.
  const visibleGroups = FIELD_SET_GROUPS.map((g) => {
    const asked = groupEntries(entries, g.key);
    const off = show === "all" ? g.keys.filter((k) => !asked.some((e) => e.key === k)) : [];
    const keep = (key: string, entry: FieldSetEntry | null) => {
      if (show === "required" && !entry?.required) return false;
      return !fq || `${entry?.label ?? ""} ${fieldMeta(key).label} ${entry?.help ?? ""} ${key}`.toLowerCase().includes(fq);
    };
    return {
      ...g,
      asked,
      shown: [...asked.map((e) => ({ key: e.key, entry: e as FieldSetEntry | null })), ...off.map((k) => ({ key: k, entry: null as FieldSetEntry | null }))].filter((r) => keep(r.key, r.entry)),
    };
  }).filter((g) => g.shown.length > 0 || (!fq && show === "all"));

  const primary = !selected ? null : !selected.own ? (
    <WithReason reason={ownerOnly ?? (selected.inUse ? null : "There is no platform set to copy for this product.")}>
      <Button type="button" disabled={!canEdit || !selected.inUse} title="Makes a draft copy you can change. Nothing goes live until you publish it." onClick={() => { if (selected.inUse) void createFrom(selected.inUse.id, selected.carrierId, selected.productCode); }}>
        Customise for {selected.carrierName}
      </Button>
    </WithReason>
  ) : dirty ? (
    <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void save(); }} saveLabel={editing?.status === "draft" ? "Save draft" : `Save as draft v${(selected.versions[0]?.version ?? 0) + 1}`} />
  ) : publishable && editing ? (
    <WithReason reason={ownerOnly ?? problem}>
      <Button type="button" disabled={!canEdit || Boolean(problem)} onClick={() => setDialog({ kind: "publish", template: editing })}>Publish v{editing.version}</Button>
    </WithReason>
  ) : null;

  return (
    <SettingsStack>
      <SalesPanelTop
        sample={sample}
        actions={payload && (
          <WithReason reason={ownerOnly}>
            <Button type="button" disabled={!canEdit} onClick={() => setDialog({ kind: "add", carrierId: rows.find((r) => !r.own)?.carrierId ?? payload.carriers[0]?.id ?? null, productCode: (payload.productLines.find((p) => p.sold !== false) ?? payload.productLines[0])?.code ?? "final_expense" })}>
              Give a carrier its own set
            </Button>
          </WithReason>
        )}
      />

      {api.schemaPending ? (
        <SalesSetupPending what="Application field sets" />
      ) : api.loading && !payload ? (
        <SalesLoading label="Loading field sets" columns={4} />
      ) : api.error && !payload ? (
        <SalesLoadError message={api.error} onRetry={() => { void api.reload(); }} />
      ) : (
        <>
          {!canEdit && <ReadOnlyNotice what="field sets" />}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
            {/* The carriers. On a phone the list gives way to the picked set. */}
            <section aria-label="Carriers" className={cn("m-glass flex min-w-0 flex-col gap-3 rounded-lg border p-3.5", selected && "max-lg:hidden")}>
              <label className="relative block">
                <span className="sr-only">Search carriers</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--body)]" aria-hidden="true" />
                <input type="search" className={cn(control, "mt-0 pl-9")} placeholder="Search carriers or products" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <Segmented
                label="Show"
                value={activeFilter.key}
                onChange={setFilter}
                options={filters.map((f) => ({ key: f.key, label: f.label, count: rows.filter(f.test).length, tone: f.key === "gaps" ? "danger" as const : undefined }))}
              />
              {rows.length === 0 ? (
                <EmptyState title="No carriers yet" hint="Add a carrier in Carriers. It uses the platform Final Expense set until you give it its own." />
              ) : listed.length === 0 ? (
                <p className="m-0 px-1 py-4 text-center text-sm text-[var(--body)]">No carrier matches. Clear the search or pick All.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {[{ title: "Your own sets", list: ownListed }, { title: "On the platform set", list: platformListed }].filter((g) => g.list.length).map((g) => (
                    <div key={g.title} className="flex flex-col gap-1.5">
                      <h3 className="m-0 px-1 pt-1.5 text-xs font-semibold text-[var(--body)]">{g.title} · {g.list.length}</h3>
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {g.list.map((r) => {
                          const list = entriesOf(r.own ?? r.inUse);
                          const st = statusOf(r);
                          const a = autofillOf(r, list);
                          const on = r.key === selectedKey;
                          return (
                            <li key={r.key}>
                              <button
                                type="button"
                                aria-current={on ? "true" : undefined}
                                onClick={() => { void open(r); }}
                                className={cn(
                                  "flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                                  on ? "border-[var(--brand-500)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:bg-[var(--surface-alt)]",
                                )}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{r.carrierName}</span>
                                  {on && dirty ? <StatusChip dot={false} tone="warning">Unsaved</StatusChip> : r.own && <StatusChip dot={false} tone={st.tone}>{st.label}</StatusChip>}
                                </span>
                                <span className="flex items-center justify-between gap-2 text-xs text-[var(--body)]">
                                  <span className="min-w-0 truncate">{r.productLabel} · {list.filter((e) => e.required).length} required</span>
                                  {a?.gap && <span className="shrink-0 text-[var(--warning-ink)]">{a.text}</span>}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* The picked set. */}
            <section aria-label={selected ? `${pair} field set` : "Field set"} className={cn("m-glass flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5", !selected && "max-lg:hidden")}>
              {!selected || !shown ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
                  <p className="m-0 text-base font-semibold text-[var(--ink)]">Pick a carrier</p>
                  <p className="m-0 max-w-[420px] text-sm text-[var(--body)]">
                    Each carrier uses the platform set until you give it its own. A field set says which fields an agent must fill before submitting that carrier&apos;s application.
                  </p>
                </div>
              ) : (
                <>
                  <Button type="button" variant="ghost" className="-ml-3 w-fit lg:hidden" onClick={() => { void close(); }}><ArrowLeft aria-hidden="true" />All carriers</Button>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 text-card-title text-[var(--ink)]">{pair}</h2>
                      <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--body)]">
                        {status && <StatusChip dot={false} tone={status.tone}>{status.label}</StatusChip>}
                        {versionLine}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {selected.own && (
                        <WithReason reason={ownerOnly}>
                          <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => setDialog({ kind: "copy" })}>Use for other carriers</Button>
                        </WithReason>
                      )}
                      {/* The one action sits just before the ⋯, which stays last (owner 2026-10-30). */}
                      {primary}
                      <RowMenu
                        label={`the ${pair} field set`}
                        items={[
                          Boolean(selected.carrierId) && mapKeys !== null && { label: "Open the field map", onSelect: () => router.push(FIELD_MAP_HREF) },
                          Boolean(selected.draftOwn) && { label: `Delete draft v${selected.draftOwn?.version}`, onSelect: () => { void deleteDraft(); }, disabled: !canEdit, reason: ownerOnly, danger: true },
                          Boolean(selected.liveOwn) && { label: `Retire v${selected.liveOwn?.version}`, onSelect: () => setDialog({ kind: "retire", template: selected.liveOwn! }), disabled: !canEdit, reason: ownerOnly, danger: true },
                          Boolean(selected.own) && { label: "Go back to the platform set", onSelect: () => { void backToPlatform(); }, disabled: !canEdit, reason: ownerOnly, danger: true },
                        ]}
                      />
                    </div>
                  </div>

                  <StatStrip label={`${pair} at a glance`}>
                    <StatTile label="Required" value={required} valueTone="primary" />
                    <StatTile label="Optional" value={optional} />
                    <StatTile label="Not asked" value={notAsked} />
                    {auto && <StatTile label="Autofill" valueSize="text" value={auto.text} valueTone={auto.tone === "good" ? "good" : auto.tone === "warning" ? "warning" : undefined} />}
                  </StatStrip>

                  <p className="m-0 text-sm leading-[1.5] text-[var(--ink)]">
                    Agents must fill {plural(required, "field")} before they can submit an application to {selected.carrierName}, and pre-submit QA checks them.{" "}
                    {optional > 0 ? `${optional} more ${optional === 1 ? "is" : "are"} asked but can stay blank.` : ""}
                  </p>
                  {auto?.gap && (
                    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--warning-ink)]">
                      {auto.text === "No autofill map"
                        ? `The browser extension has no map for ${selected.carrierName} yet, so agents type these in by hand.`
                        : `The browser extension cannot place ${[...unplaced].map((k) => fieldMeta(k).label).join(", ")} on the ${selected.carrierName} form.`}
                      <a href={FIELD_MAP_HREF} className="font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">{auto.text === "No autofill map" ? "Build a map" : "Open the field map"} →</a>
                    </p>
                  )}
                  {shownProblem && <Callout tone="error" title={shownProblem} />}

                  <UnderlineTabs
                    label="Field set"
                    idPrefix="fs"
                    value={activeTab}
                    onChange={setTab}
                    controls={(k) => `fs-panel-${k}`}
                    tabs={[
                      { key: "fields", label: "Fields" },
                      { key: "preview", label: "What the agent sees" },
                      // A platform set has no changes of its own and none of the agency's versions.
                      ...(selected.own ? [
                        { key: "changes" as const, label: "Changes from platform", count: changes.length },
                        { key: "versions" as const, label: "Versions", count: selected.versions.length },
                      ] : []),
                    ]}
                  />

                  {activeTab === "fields" && (
                    <div id="fs-panel-fields" role="tabpanel" aria-labelledby="fs-tab-fields" className="flex flex-col gap-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="relative block min-w-[200px] flex-1">
                          <span className="sr-only">Find a field</span>
                          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--body)]" aria-hidden="true" />
                          <input type="search" className={cn(control, "mt-0 pl-9")} placeholder="Find a field" value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} />
                        </label>
                        <Segmented
                          label="Fields to show"
                          value={show}
                          onChange={setShow}
                          options={[
                            { key: "all", label: "All" },
                            { key: "asked", label: "Asked", count: entries.length },
                            { key: "required", label: "Required", count: required },
                          ]}
                        />
                      </div>
                      {visibleGroups.length === 0 && (
                        <p className="m-0 py-4 text-center text-sm text-[var(--body)]">No field matches. Clear the search or show All.</p>
                      )}
                      <p className="sr-only" aria-live="polite">{announce}</p>
                      {visibleGroups.map((g) => {
                        const req = g.asked.filter((e) => e.required).length;
                        const builtInAsked = g.asked.filter((e) => !e.custom).length;
                        const own = g.asked.length - builtInAsked;
                        // Moving only makes sense in the full list of a section, not a filtered one.
                        const movable = !readOnly && !fq && show !== "required";
                        return (
                          <div key={g.key} className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                              <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">
                                {g.label} <span className="font-normal text-[var(--body)]">· {req} required · {builtInAsked} of {g.keys.length} asked{own ? ` · ${own} of your own` : ""}</span>
                              </h3>
                              {!readOnly && (
                                <span className="flex items-center gap-1">
                                  {g.asked.length > req && <Button type="button" variant="ghost" size="sm" onClick={() => change((list) => requireAsked(list, g.asked.map((e) => e.key)))}>Require all asked</Button>}
                                  <Button type="button" variant="ghost" size="sm" onClick={() => setQuestion({ mode: "add", group: g.key })}><Plus aria-hidden="true" />Add question</Button>
                                </span>
                              )}
                            </div>
                            <ul ref={(el) => { listRefs.current[g.key] = el; }} className="m-0 flex list-none flex-col gap-1 p-0">
                              {g.shown.map(({ key: k, entry }) => {
                                const state = entry ? (entry.required ? "required" : "optional") : "off";
                                const meta = fieldMeta(k);
                                const name = entry?.custom ? entry.label : meta.label;
                                const sensitive = Boolean(entry?.sensitive) || meta.type === "Masked text";
                                const wording = entry && !entry.custom && entry.label !== entry.canonicalLabel ? entry.label : "";
                                const changed = Boolean(entry?.custom) || stateOfKey(platformKeys, k) !== state || Boolean(wording) || Boolean(entry?.help);
                                return (
                                  <li
                                    key={k}
                                    data-asked-key={entry ? k : undefined}
                                    className={cn(
                                      "flex flex-col gap-2 rounded-md bg-[var(--surface-alt)] px-2 py-2 transition-shadow sm:flex-row sm:items-center",
                                      !entry && "opacity-70",
                                      dragKey === k && "shadow-[var(--shadow-overlay)] ring-1 ring-[var(--brand-500)]",
                                    )}
                                  >
                                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                                      {entry && movable ? (
                                        <button
                                          type="button"
                                          aria-label={`Move ${name}. Drag, or use the up and down arrow keys.`}
                                          className="mt-0.5 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--body)] hover:bg-[var(--surface)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] active:cursor-grabbing"
                                          onPointerDown={(e) => startDrag(e, k, g.key)}
                                          onKeyDown={(e) => onHandleKey(e, k)}
                                        >
                                          <GripVertical className="size-4" aria-hidden="true" />
                                        </button>
                                      ) : <span className="size-7 shrink-0" aria-hidden="true" />}
                                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
                                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-[var(--ink)]">
                                          {name}
                                          <span className="text-xs font-normal text-[var(--body)]">{entry?.typeLabel ?? meta.type}</span>
                                          {entry?.custom && <StatusChip dot={false} tone="info">Your question</StatusChip>}
                                          {sensitive && <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--error-ink)]"><Lock className="size-3" aria-hidden="true" />Masked, each reveal is logged</span>}
                                          {entry && unplaced.has(k) && <span className="text-xs font-semibold text-[var(--warning-ink)]">Autofill can&apos;t place it</span>}
                                          {selected.own && changed && <span className="size-1.5 rounded-full bg-[var(--brand-500)]" title="Differs from the platform set" aria-label="Differs from the platform set" role="img" />}
                                        </span>
                                        {wording && <span className="text-xs text-[var(--body)]">The carrier calls it &ldquo;{wording}&rdquo;</span>}
                                        {entry?.help && <span className="text-xs text-[var(--body)]">{entry.help}</span>}
                                      </div>
                                      {/* On a phone the pencil sits on the title line, so the three choices keep one line. */}
                                      {!readOnly && entry && (
                                        <Button type="button" variant="ghost" size="icon" className="size-9 sm:hidden" aria-label={`Edit ${name}`} onClick={() => setQuestion({ mode: "edit", key: k })}>
                                          <Pencil aria-hidden="true" />
                                        </Button>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {readOnly ? (
                                        <StatusChip dot={false} tone={state === "required" ? "good" : "neutral"}>{FIELD_STATE_LABEL[state]}</StatusChip>
                                      ) : entry?.custom ? (
                                        <Segmented
                                          label={`How ${name} is asked`}
                                          value={state}
                                          onChange={(st) => setState(k, st)}
                                          options={(["optional", "required"] as const).map((st) => ({ key: st, label: FIELD_STATE_LABEL[st] }))}
                                        />
                                      ) : (
                                        <Segmented
                                          label={`How ${name} is asked`}
                                          value={state}
                                          onChange={(st) => setState(k, st)}
                                          options={(["off", "optional", "required"] as const).map((st) => ({ key: st, label: FIELD_STATE_LABEL[st] }))}
                                        />
                                      )}
                                      {!readOnly && entry && (
                                        <Button type="button" variant="ghost" size="icon" className="hidden size-9 sm:inline-flex" aria-label={`Edit ${name}`} onClick={() => setQuestion({ mode: "edit", key: k })}>
                                          <Pencil aria-hidden="true" />
                                        </Button>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                              {g.shown.length === 0 && <li className="px-3 py-2 text-xs text-[var(--body)]">Nothing asked here.</li>}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeTab === "changes" && (
                    <div id="fs-panel-changes" role="tabpanel" aria-labelledby="fs-tab-changes" className="flex flex-col gap-2">
                      {!selected.own ? (
                        <p className="m-0 text-sm text-[var(--body)]">This is the platform set itself.</p>
                      ) : changes.length === 0 ? (
                        <p className="m-0 text-sm text-[var(--body)]">Same as the platform set ({platformRequired} required).</p>
                      ) : (
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                          {changes.map((c) => (
                            <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--surface-alt)] px-3 py-2 text-sm">
                              <span className="font-semibold text-[var(--ink)]">{c.label}</span>
                              <span className="text-[var(--body)]">
                                {[
                                  c.added ? `Your question, ${FIELD_STATE_LABEL[c.to].toLowerCase()}` : c.from !== c.to ? `${FIELD_STATE_LABEL[c.from]} on the platform → ${FIELD_STATE_LABEL[c.to].toLowerCase()} here` : FIELD_STATE_LABEL[c.to],
                                  c.moved ? "moved" : null,
                                  c.wording ? `the carrier calls it “${c.wording}”` : null,
                                  c.help ? "help for the agent" : null,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {selected.own && (
                        <WithReason reason={ownerOnly}>
                          <Button type="button" variant="outline" className="w-fit" disabled={!canEdit} onClick={() => { void backToPlatform(); }}>Go back to the platform set</Button>
                        </WithReason>
                      )}
                    </div>
                  )}

                  {activeTab === "preview" && (
                    <div id="fs-panel-preview" role="tabpanel" aria-labelledby="fs-tab-preview" className="flex flex-col gap-4">
                      <p className="m-0 text-sm text-[var(--body)]">
                        The application step for {pair}, as an agent sees it. Fields marked <span className="font-semibold text-[var(--success-ink)]">*</span> must be filled before Submit.
                      </p>
                      {[
                        { key: "insured", label: "Insured", list: entries.filter((e) => e.group === "insured") },
                        { key: "address", label: "Address and contact", list: entries.filter((e) => e.group === "addr" || e.group === "contact") },
                        { key: "owner", label: "Owner and coverage", list: entries.filter((e) => !e.custom && (e.group === "owner" || e.group === "cov")) },
                        { key: "questions", label: `${selected.carrierName} questions`, list: entries.filter((e) => e.custom && ["owner", "cov", "pay"].includes(e.group)) },
                        { key: "payment", label: "Payment (on the Payment step)", list: entries.filter((e) => !e.custom && e.group === "pay") },
                      ].filter((sec) => sec.list.length).map((sec) => (
                        <div key={sec.key} className="flex flex-col gap-2">
                          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">{sec.label}</h3>
                          <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                            {sec.list.map((e) => (
                              <li key={e.key} className="flex flex-col gap-0.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--ink)]">
                                <span className="inline-flex items-center gap-1 font-semibold">
                                  {e.sensitive && <Lock className="size-3 text-[var(--error-ink)]" aria-label="Masked" />}
                                  {e.custom ? e.label : e.canonicalLabel}
                                  {e.required && <span className="text-[var(--success-ink)]" aria-label="required">*</span>}
                                </span>
                                {!e.custom && e.label !== e.canonicalLabel && <span className="text-[var(--body)]">On the form: &ldquo;{e.label}&rdquo;</span>}
                                {e.help && <span className="text-[var(--body)]">{e.help}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === "versions" && (
                    <div id="fs-panel-versions" role="tabpanel" aria-labelledby="fs-tab-versions" className="flex flex-col gap-2">
                      {selected.versions.length === 0 ? (
                        <p className="m-0 text-sm text-[var(--body)]">Your agency has no versions of this set yet. It uses the platform set.</p>
                      ) : (
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                          {selected.versions.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--surface-alt)] px-3 py-2 text-sm">
                              <span className="w-9 font-semibold text-[var(--ink)]">v{v.version}</span>
                              <StatusChip dot={false} tone={v.status === "published" ? "good" : v.status === "draft" ? "info" : "neutral"}>{v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}</StatusChip>
                              <span className="min-w-0 flex-1 text-[var(--body)]">{[v.editedBy, shortDay(v.updatedAt)].filter(Boolean).join(" · ")}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="m-0 text-xs text-[var(--body)]">A published version never changes. Applications keep the version they started on.</p>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          <LeaveGuard dirty={Boolean(editing && !readOnly && dirty)} onSave={save} onDiscard={discard} what="this field set" />
        </>
      )}

      {dialog?.kind === "add" && payload && (
        <AddFieldSetDialog
          carriers={payload.carriers}
          productLines={payload.productLines}
          initial={{ carrierId: dialog.carrierId, productCode: dialog.productCode }}
          startFrom={startFrom}
          taken={(carrierId, code) => (all.some((x) => x.tenantOwned && x.productCode === code && x.carrierId === carrierId && x.status !== "retired") ? "That carrier already has its own set for this product. Pick it in the list to edit it." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => { await createFrom(c.fromId, c.carrierId, c.productCode); setDialog(null); }}
        />
      )}
      {dialog?.kind === "publish" && selected && (
        <FieldSetPublishDialog
          pair={pair}
          version={dialog.template.version}
          liveVersion={liveOf(all, dialog.template)?.version ?? null}
          required={required}
          optional={optional}
          onClose={() => setDialog(null)}
          onConfirm={async () => { await api.publish(dialog.template.id, true); setDialog(null); }}
        />
      )}
      {dialog?.kind === "retire" && selected && (
        <FieldSetRetireDialog
          pair={pair}
          version={dialog.template.version}
          fallback={selected.draftOwn ? `the platform set until draft v${selected.draftOwn.version} is published` : `the platform set (${platformRequired} required)`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.retire(dialog.template.id);
            if (!dirty) setEntries(entriesOf(selected.draftOwn ?? selected.platform));
            setDialog(null);
          }}
        />
      )}
      {question && selected && (() => {
        const entry = question.mode === "edit" ? entries.find((e) => e.key === question.key) ?? null : null;
        if (question.mode === "edit" && !entry) return null;
        const groups = FIELD_SET_GROUPS.map((g) => ({ key: g.key, label: g.label }));
        return (
          <QuestionDialog
            mode={question.mode}
            builtIn={entry && !entry.custom ? { key: entry.key, name: entry.canonicalLabel, typeLabel: entry.typeLabel, sensitive: entry.sensitive } : null}
            initial={entry ? {
              label: entry.label, help: entry.help, type: entry.custom?.type ?? "text", options: entry.custom?.options ?? [], group: entry.group, state: entry.required ? "required" : "optional",
            } : { label: "", help: "", type: "text", options: [], group: question.mode === "add" ? question.group : "insured", state: "optional" }}
            groups={groups}
            types={CUSTOM_TYPE_LABEL}
            onSubmit={saveQuestion}
            onRemove={entry?.custom ? () => removeQuestion(entry.key) : undefined}
            onClose={() => setQuestion(null)}
          />
        );
      })()}
      {dialog?.kind === "copy" && selected && (
        <CopyToCarriersDialog
          pair={pair}
          targets={rows.filter((r) => r.key !== selected.key && r.productCode === selected.productCode).map((r) => ({
            key: r.key,
            label: r.carrierName,
            free: !r.own,
            why: r.own ? "Already has its own set" : "On the platform set today",
          }))}
          onClose={() => setDialog(null)}
          onSubmit={copyTo}
        />
      )}
    </SettingsStack>
  );
}
