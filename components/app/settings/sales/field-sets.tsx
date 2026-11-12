"use client";

/**
 * Settings › Sales process › Carrier application (was Application field sets, LA-3.7). Reads and writes
 * /api/app/settings/sales/templates?kind=application_field_set; `?preview=sample` (outside production) renders the
 * design fixtures and saves nothing.
 *
 * Settings round 8 (owner pick A, sales-process board "3 · Carrier application", 2026-11-12): the carriers on the
 * left (one row per carrier and product), the picked carrier's application on the right — every field an
 * application can carry, one line each, Not asked / Optional / Required, drag to reorder, and whether the
 * carrier's autofill map places it. Required is what the set is for: the Application step marks those fields and
 * pre-submit checks refuse a case without them (lib/applications/service.ts reads only `required`). A field opens
 * in a right sheet (its label, help, where autofill puts it, the versions).
 *
 * One save model: a change goes into the agency's draft as it is made (on the Insurvas set, the first change
 * copies it into a draft); Publish vN puts the draft live. Also here: what changed from the platform set (the
 * Changed filter), Give a carrier its own set, Use for other carriers, Discard draft, Retire and Reset to default.
 *
 * The board's PDF page and box per field are not stored (the autofill map keys fields by name, not by box), so
 * the sheet says whether the map places a field and links to the map; it does not pick a box.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical, Lock, Plus } from "lucide-react";

import { SettingsSectionHeader, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { FILLABLE_FIELD_MAP_STATUSES } from "@/lib/extension/constants";
import type { FieldMapView } from "@/lib/extension/types";
import { notify } from "@/lib/notify";
import { agoText } from "@/lib/salesSettings/salesProcess";
import {
  FIELD_SET_GROUPS, FIELD_STATE_LABEL, addCustom, changesFrom, editEntry, groupEntries, moveWithinGroup, requireAsked, setKeyState, stateOfKey, unplacedKeys,
  type FieldState, type QuestionDraft,
} from "@/lib/salesSettings/fieldSetView";
import { CUSTOM_TYPE_LABEL, fieldMeta, fieldSetEntries, fieldSetFromEntries, type FieldSetEntry } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { GoldCount, Pane, SelectRow, SheetSection, StatusLine, TabBody, TabFrame, ThreeWay, useDraftAutosave, WIDE_SHEET, type StatusTone } from "../sales-process/parts";
import { AddFieldSetDialog, CopyToCarriersDialog, FieldSetPublishDialog, FieldSetRetireDialog, QuestionDialog, type StartFrom } from "./field-sets-dialogs";
import { RowMenu, SalesPanelTop, WithReason, plural, salesApi, shortDay } from "./shared";
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
  /** The agency's open draft for this pair, if any — what Discard draft deletes. */
  draftOwn: TemplateRowView | null;
  /** The platform set this pair falls back to without its own. */
  platform: TemplateRowView | null;
  /** The agency's versions for this pair, newest first. */
  versions: TemplateRowView[];
};

type Show = "all" | "required" | "changed";
type Dialog = { kind: "add"; carrierId: string | null; productCode: string } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | { kind: "copy" } | null;
type Side = "preview" | "versions" | null;

/** Carriers › 3 · Field maps, where a carrier's autofill map is built and checked. */
const FIELD_MAP_HREF = "/app/settings#carriers/carriers-maps";

const newestOf = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;
const storedJson = (t: TemplateRowView) => JSON.stringify(fieldSetFromEntries(fieldSetEntries(t.definition)));
const entriesOf = (t: TemplateRowView | null) => fieldSetEntries(t?.definition);

/**
 * Each carrier's autofill map keys, from the map the extension fills with (published or needing review; the
 * agency's own before Insurvas's). Null while loading, in sample mode, or without the extension feature: the
 * page then says nothing about autofill. The Sales process Overview reads it too.
 */
export function useAutofillKeys(enabled: boolean) {
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
        // Autofill is a hint here; without it the page still works.
      }
    })();
    return () => { gone = true; };
  }, [enabled]);
  return keys;
}

export function SalesFieldSets({ focus = null }: { focus?: string | null } = {}) {
  const api = useSalesTemplates("application_field_set");
  const router = useRouter();
  const { payload, sample } = api;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<FieldSetEntry[]>([]);
  /** The field sheet: adding a question to a section, or one field. */
  const [question, setQuestion] = useState<{ mode: "add"; group: string } | { mode: "edit"; key: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const listRefs = useRef<Record<string, HTMLUListElement | null>>({});
  const startingDraft = useRef(false);
  const [query, setQuery] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [side, setSide] = useState<Side>(null);

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
  const ownerOnly = canEdit ? null : "Only an owner can change carrier applications.";

  /** The asked fields the carrier's map does not place; null when there is no map (or no word on maps). */
  const unplacedOf = (r: SetRow, list: FieldSetEntry[]) => (mapKeys && r.carrierId ? unplacedKeys(list, mapKeys.get(r.carrierId) ?? null) : null);

  const load = (r: SetRow) => {
    setSelectedKey(r.key);
    setEntries(entriesOf(r.own ?? r.inUse));
    setFieldQuery("");
    setSaveError(null);
  };
  const autosave = useDraftAutosave({
    signature: JSON.stringify({ key: selectedKey, definition }),
    dirty,
    enabled: Boolean(editing && !readOnly && !problem && !sample),
    save: async () => {
      if (!editing) return false;
      const { saved, error } = await api.save(editing.id, { definition: definition as Record<string, unknown> });
      setSaveError(error);
      return Boolean(saved);
    },
  });
  const open = (r: SetRow) => {
    if (r.key === selectedKey) return;
    autosave.reset();
    load(r);
  };

  // A wide screen opens the first carrier (or the one a link names: "fs.<carrier>|<product>").
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    const named = focus?.startsWith("fs.") ? rows.find((r) => r.key === focus.slice(3)) : null;
    const want = named ?? (!autoOpened.current && !selectedKey && window.matchMedia("(min-width: 1024px)").matches ? rows[0] : null);
    if (!want || autoOpened.current === (focus ?? "first")) return;
    autoOpened.current = focus ?? "first";
    const timer = window.setTimeout(() => load(want), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, focus]);

  /**
   * Every edit goes through here. On the agency's own set it edits the draft in hand; on a platform set it first
   * copies the set into the agency's draft (as Customise does), then applies the edit.
   */
  const change = (fn: (list: FieldSetEntry[]) => FieldSetEntry[]) => {
    if (!canEdit || !selected) return;
    setSaveError(null);
    if (editing) { setEntries(fn); return; }
    if (!selected.inUse || startingDraft.current) return;
    startingDraft.current = true;
    void createFrom(selected.inUse.id, selected.carrierId, selected.productCode)
      .then(() => setEntries((list) => fn(list)))
      .finally(() => { startingDraft.current = false; });
  };
  const setState = (key: string, state: FieldState) => change((list) => setKeyState(list, key, state));
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

  /** A new draft for a pair, copied from any set; opens it. */
  const createFrom = async (fromId: string, carrierId: string | null, productCode: string) => {
    const carrierName = payload?.carriers.find((c) => c.id === carrierId)?.name ?? rows.find((r) => r.carrierId === carrierId)?.carrierName ?? "Carrier";
    const line = payload?.productLines.find((p) => p.code === productCode)?.name ?? productCode;
    const copied = await api.copy(fromId, { product_code: productCode, carrier_id: carrierId, name: `${carrierName} · ${line}` }, "Draft created. Publish it when it matches the carrier's form.");
    autosave.reset();
    setSelectedKey(`${carrierId ?? ""}|${productCode}`);
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
      title: `Discard draft v${selected.draftOwn.version}?`,
      description: selected.liveOwn ? `Your changes since v${selected.liveOwn.version} are lost. v${selected.liveOwn.version} stays live.` : `${selected.carrierName} goes back to the platform set. This cannot be undone.`,
      confirmLabel: "Discard draft",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    if (await api.remove(selected.draftOwn.id)) { autosave.reset(); setEntries(entriesOf(selected.liveOwn ?? selected.platform)); }
  };

  const backToPlatform = async () => {
    if (!selected?.own) return;
    const platformReq = entriesOf(selected.platform).filter((e) => e.required).length;
    const ok = await confirmAction({
      title: "Reset to the Insurvas default?",
      description: `${[selected.liveOwn && `v${selected.liveOwn.version} is retired`, selected.draftOwn && `draft v${selected.draftOwn.version} is deleted`].filter(Boolean).join(" and ")}. New ${selected.carrierName} applications then use the platform set (${platformReq} required). Started applications keep their version.`,
      confirmLabel: "Reset to default", cancelLabel: "Keep mine",
    });
    if (!ok) return;
    if (sample) {
      if (selected.draftOwn) await api.remove(selected.draftOwn.id);
      if (selected.liveOwn) await api.retire(selected.liveOwn.id);
    } else {
      await runAll([
        ...(selected.draftOwn ? [{ url: `${base}/${selected.draftOwn.id}`, method: "DELETE" }] : []),
        ...(selected.liveOwn ? [{ url: `${base}/${selected.liveOwn.id}/retire`, method: "POST" }] : []),
      ], `${selected.carrierName} is back on the Insurvas default`);
    }
    autosave.reset();
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
  const changes = selected ? changesFrom(entriesOf(selected.platform), entries) : [];
  const changedKeys = new Set(changes.map((c) => c.key));
  const unplacedList = selected ? unplacedOf(selected, entries) : null;
  const unplaced = new Set(unplacedList ?? []);
  const platformKeys = entriesOf(selected?.platform ?? null);
  const platformRequired = platformKeys.filter((e) => e.required).length;
  const pair = selected ? `${selected.carrierName} · ${selected.productLabel}` : "";
  const fq = fieldQuery.trim().toLowerCase();
  const allCount = FIELD_SET_GROUPS.reduce((n, g) => n + g.keys.length, 0) + entries.filter((e) => e.custom).length;
  // Each section: its asked fields in the agent's order (they move), then the built-in fields it does not ask.
  const visibleGroups = FIELD_SET_GROUPS.map((g) => {
    const asked = groupEntries(entries, g.key);
    const off = show === "all" ? g.keys.filter((k) => !asked.some((e) => e.key === k)) : [];
    const keep = (key: string, entry: FieldSetEntry | null) => {
      if (show === "required" && !entry?.required) return false;
      if (show === "changed" && !changedKeys.has(key)) return false;
      return !fq || `${entry?.label ?? ""} ${fieldMeta(key).label} ${entry?.help ?? ""}`.toLowerCase().includes(fq);
    };
    return { ...g, asked, shown: [...asked.map((e) => ({ key: e.key, entry: e as FieldSetEntry | null })), ...off.map((k) => ({ key: k, entry: null as FieldSetEntry | null }))].filter((r) => keep(r.key, r.entry)) };
  }).filter((g) => g.shown.length > 0 || (!fq && show === "all"));

  const status: { tone: StatusTone; text: string } = !payload ? { tone: "muted", text: "Reading your carrier applications" }
    : !selected ? { tone: "muted", text: rows.length ? "Pick a carrier" : "No carriers yet" }
    : saveError ? { tone: "bad", text: `${pair} · couldn't save to the draft: ${saveError}` }
    : dirty && problem ? { tone: "warn", text: `${pair} · not saved yet: ${problem}` }
    : autosave.state === "saving" || dirty ? { tone: "muted", text: `${pair} · saving to the draft` }
    : unplacedList?.length ? { tone: "warn", text: `${pair} · ${plural(unplacedList.length, "field")} autofill can't place on the carrier's form` }
    : !selected.own ? { tone: "muted", text: `${pair} · on the Insurvas default${canEdit ? " · a change starts your own draft" : ""}` }
    : selected.draftOwn ? { tone: "warn", text: `${pair} · v${selected.draftOwn.version} draft, not live${selected.liveOwn ? ` · v${selected.liveOwn.version} stays live until you publish` : ""} · edited${selected.draftOwn.editedBy ? ` by ${selected.draftOwn.editedBy}` : ""} ${agoText(selected.draftOwn.updatedAt)}` }
    : { tone: "ok", text: `${pair} · v${selected.liveOwn?.version} live${mapKeys && selected.carrierId ? " · autofill places every field" : ""}` };

  const primary = !selected ? (
    <WithReason reason={ownerOnly}>
      <Button type="button" variant="outline" disabled={!canEdit || !payload} onClick={() => payload && setDialog({ kind: "add", carrierId: rows.find((r) => !r.own)?.carrierId ?? payload.carriers[0]?.id ?? null, productCode: (payload.productLines.find((p) => p.sold !== false) ?? payload.productLines[0])?.code ?? "final_expense" })}>Give a carrier its own set</Button>
    </WithReason>
  ) : !selected.own ? (
    <WithReason reason={ownerOnly ?? (selected.inUse ? null : "There is no platform set to copy for this product.")}>
      <Button type="button" disabled={!canEdit || !selected.inUse} onClick={() => { if (selected.inUse) void createFrom(selected.inUse.id, selected.carrierId, selected.productCode); }}>Customise for {selected.carrierName}</Button>
    </WithReason>
  ) : selected.draftOwn && editing?.status === "draft" ? (
    <WithReason reason={dirty ? "Saving to the draft — a moment." : ownerOnly ?? problem}>
      <Button type="button" disabled={!canEdit || dirty || Boolean(problem)} onClick={() => setDialog({ kind: "publish", template: editing })}>Publish v{editing.version}</Button>
    </WithReason>
  ) : null;

  const editEntryOf = question?.mode === "edit" ? entries.find((e) => e.key === question.key) ?? null : null;

  return (
    <TabFrame>
      <SettingsSectionHeader actions={primary} />
      <SalesPanelTop sample={sample} />
      {api.schemaPending ? (
        <StatusLine tone="warn">Carrier applications need a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>
      ) : api.error && !payload ? (
        <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={() => { void api.reload(); }}>Try again</Button>}>Could not load the carrier applications. Nothing was changed. {api.error}</StatusLine>
      ) : (
        <StatusLine tone={status.tone} action={unplacedList?.length && selected?.carrierId ? <Link href={FIELD_MAP_HREF} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Open the field map</Link> : undefined}>
          {status.text}{!canEdit && payload ? " · read only: only an owner changes carrier applications" : ""}
        </StatusLine>
      )}

      <TabBody>
        <Pane
          className="lg:w-[270px] lg:shrink-0"
          label="Carriers"
        >
          <div className="border-b border-[var(--border)] px-3 py-2">
            <input type="search" aria-label="Search carriers" className={cn(control, "mt-0")} placeholder="Search carriers" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!payload ? <SectionLoading rows={6} columns={1} label="Loading carriers" /> : rows.length === 0 ? (
            <EmptyState title="No carriers yet" hint="Add a carrier in Carriers. It uses the platform set until you give it its own." />
          ) : (
            rows.filter((r) => { const q = query.trim().toLowerCase(); return !q || `${r.carrierName} ${r.productLabel}`.toLowerCase().includes(q); }).map((r) => {
              const list = r.key === selectedKey ? entries : entriesOf(r.own ?? r.inUse);
              const gaps = unplacedOf(r, list)?.length ?? 0;
              const req = list.filter((e) => e.required).length;
              return (
                <SelectRow
                  key={r.key}
                  selected={r.key === selectedKey}
                  onClick={() => open(r)}
                  title={r.carrierName}
                  sub={`${r.productLabel} · ${gaps ? `${gaps} unplaced` : `${req} required`}${r.draftOwn ? " · draft" : r.own ? "" : " · Insurvas"}`}
                  end={gaps ? <GoldCount value={gaps} label={`${gaps} fields autofill can't place`} /> : undefined}
                />
              );
            })
          )}
        </Pane>

        <Pane
          className="lg:flex-1"
          title="Fields on the carrier's application"
          actions={selected && shown ? (
            <>
              {selected.own && canEdit && <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: "copy" })}>Use for other carriers</Button>}
              <ThreeWay
                label="Fields to show"
                value={show}
                onChange={setShow}
                options={[{ key: "all", label: `All ${allCount}` }, { key: "required", label: `Required ${required}` }, { key: "changed", label: `Changed ${changes.length}` }]}
              />
              <input type="search" aria-label="Find a field" className={cn(control, "mt-0 w-40")} placeholder="Find a field" value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} />
              <RowMenu
                label={`the ${pair} application`}
                items={[
                  { label: "What the agent sees", onSelect: () => setSide("preview") },
                  selected.versions.length > 0 && { label: "Versions", onSelect: () => setSide("versions") },
                  Boolean(selected.carrierId) && mapKeys !== null && { label: "Open the field map", onSelect: () => router.push(FIELD_MAP_HREF) },
                  canEdit && Boolean(selected.draftOwn) && { label: `Discard draft v${selected.draftOwn?.version}`, onSelect: () => { void deleteDraft(); }, danger: true },
                  canEdit && Boolean(selected.liveOwn) && { label: `Retire v${selected.liveOwn?.version}`, onSelect: () => setDialog({ kind: "retire", template: selected.liveOwn! }), danger: true },
                ]}
              />
            </>
          ) : undefined}
          footer={selected && shown ? (
            <>
              <span className="min-w-0 flex-1">
                {selected.own ? `${plural(changes.length, "change")} from the platform set · ` : ""}Review refuses a case missing any of {plural(required, "Required field")}{optional ? ` · ${optional} optional` : ""}
              </span>
              {selected.own && canEdit && <Button type="button" variant="ghost" size="sm" onClick={() => { void backToPlatform(); }}>Reset to default</Button>}
            </>
          ) : undefined}
        >
          {!payload ? <SectionLoading rows={8} columns={3} label="Loading fields" /> : !selected || !shown ? (
            <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">Pick a carrier. Each uses the Insurvas set until you give it its own; Required fields must be filled before Submit.</p>
          ) : (
            <div className="flex flex-col">
              <p className="sr-only" aria-live="polite">{announce}</p>
              {visibleGroups.length === 0 && <p className="m-0 px-4 py-6 text-center text-sm text-[var(--muted)]">No field matches. Clear the search or show All.</p>}
              {visibleGroups.map((g, gi) => {
                const movable = !readOnly && !fq && show === "all";
                return (
                  <div key={g.key}>
                    <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-1.5 text-xs font-semibold text-[var(--body)]">
                      <span className="min-w-0 flex-1">{g.label} <span className="font-normal text-[var(--muted)]">· {g.asked.filter((e) => e.required).length} required</span></span>
                      {!readOnly && g.asked.length > g.asked.filter((e) => e.required).length && <Button type="button" variant="ghost" size="xs" onClick={() => change((list) => requireAsked(list, g.asked.map((e) => e.key)))}>Require all asked</Button>}
                      {!readOnly && <Button type="button" variant="ghost" size="xs" onClick={() => setQuestion({ mode: "add", group: g.key })}><Plus aria-hidden="true" />Add question</Button>}
                      {gi === 0 && mapKeys && selected.carrierId && <span className="w-28 shrink-0 text-right">Autofill</span>}
                    </div>
                    <ul ref={(el) => { listRefs.current[g.key] = el; }} className="m-0 list-none p-0">
                      {g.shown.map(({ key: k, entry }) => {
                        const state = entry ? (entry.required ? "required" : "optional") : "off";
                        const meta = fieldMeta(k);
                        const name = entry?.custom ? entry.label : meta.label;
                        const sensitive = Boolean(entry?.sensitive) || meta.type === "Masked text";
                        const wording = entry && !entry.custom && entry.label !== entry.canonicalLabel ? entry.label : "";
                        const changed = selected.own && (Boolean(entry?.custom) || stateOfKey(platformKeys, k) !== state || Boolean(wording) || Boolean(entry?.help));
                        const place = !mapKeys || !selected.carrierId ? null : !entry ? "—" : entry.custom ? "By hand" : unplaced.has(k) ? "Can't place" : "Placed";
                        return (
                          <li
                            key={k}
                            data-asked-key={entry ? k : undefined}
                            className={cn("flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 transition-shadow last:border-b-0", !entry && "opacity-70", dragKey === k && "shadow-[var(--shadow-overlay)] ring-1 ring-[var(--brand-500)]")}
                          >
                            {entry && movable ? (
                              <button
                                type="button"
                                aria-label={`Move ${name}. Drag, or use the up and down arrow keys.`}
                                className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] active:cursor-grabbing"
                                onPointerDown={(e) => startDrag(e, k, g.key)}
                                onKeyDown={(e) => onHandleKey(e, k)}
                              >
                                <GripVertical className="size-4" aria-hidden="true" />
                              </button>
                            ) : <span className="size-7 shrink-0" aria-hidden="true" />}
                            <button
                              type="button"
                              disabled={!entry}
                              title={!entry ? "Ask it first to change its label" : wording ? `The carrier calls it “${wording}”` : undefined}
                              onClick={() => entry && setQuestion({ mode: "edit", key: k })}
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] text-left text-sm text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] enabled:hover:underline disabled:cursor-default"
                            >
                              {sensitive && <Lock className="size-3 shrink-0 text-[var(--muted)]" aria-label="Masked" />}
                              <span className="truncate">{name}{wording ? ` · “${wording}”` : ""}</span>
                              {changed && <span className="size-1.5 shrink-0 rounded-full bg-[var(--brand-500)]" title="Differs from the platform set" aria-label="Differs from the platform set" role="img" />}
                            </button>
                            {readOnly ? (
                              <StatusChip dot={false} tone={state === "required" ? "good" : "neutral"}>{FIELD_STATE_LABEL[state]}</StatusChip>
                            ) : (
                              <ThreeWay
                                label={`How ${name} is asked`}
                                value={state}
                                onChange={(st) => setState(k, st)}
                                options={(entry?.custom ? (["optional", "required"] as const) : (["off", "optional", "required"] as const)).map((st) => ({ key: st, label: FIELD_STATE_LABEL[st] }))}
                              />
                            )}
                            {place !== null && <span className={cn("w-28 shrink-0 text-right text-xs", place === "Can't place" ? "font-semibold text-[var(--highlight-ink)]" : "text-[var(--muted)]")}>{place}</span>}
                          </li>
                        );
                      })}
                      {g.shown.length === 0 && <li className="px-4 py-2 text-xs text-[var(--muted)]">Nothing asked here.</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Pane>
      </TabBody>

      <LeaveGuard dirty={Boolean(editing && !readOnly && dirty)} onSave={async () => { if (!editing) return false; const { saved, error } = await api.save(editing.id, { definition: definition as Record<string, unknown> }); setSaveError(error); return Boolean(saved); }} onDiscard={() => { if (selected) setEntries(entriesOf(selected.own ?? selected.inUse)); }} what="this carrier application" />

      {side === "preview" && selected && (
        <Sheet title="What the agent sees" subtitle={`${pair} · the Application step; * must be filled before Submit`} onClose={() => setSide(null)} className={WIDE_SHEET}>
          {[
            { key: "insured", label: "Insured", list: entries.filter((e) => e.group === "insured") },
            { key: "address", label: "Address and contact", list: entries.filter((e) => e.group === "addr" || e.group === "contact") },
            { key: "owner", label: "Owner and coverage", list: entries.filter((e) => !e.custom && (e.group === "owner" || e.group === "cov")) },
            { key: "questions", label: `${selected.carrierName} questions`, list: entries.filter((e) => e.custom && ["owner", "cov", "pay"].includes(e.group)) },
            { key: "payment", label: "Payment (on the Payment step)", list: entries.filter((e) => !e.custom && e.group === "pay") },
          ].filter((sec) => sec.list.length).map((sec) => (
            <SheetSection key={sec.key} title={sec.label}>
              <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                {sec.list.map((e) => (
                  <li key={e.key} className="flex flex-col gap-0.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--ink)]">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      {e.sensitive && <Lock className="size-3 text-[var(--muted)]" aria-label="Masked" />}
                      {e.custom ? e.label : e.canonicalLabel}
                      {e.required && <span className="text-[var(--success-ink)]" aria-label="required">*</span>}
                    </span>
                    {!e.custom && e.label !== e.canonicalLabel && <span className="text-[var(--body)]">On the form: &ldquo;{e.label}&rdquo;</span>}
                    {e.help && <span className="text-[var(--body)]">{e.help}</span>}
                  </li>
                ))}
              </ul>
            </SheetSection>
          ))}
        </Sheet>
      )}
      {side === "versions" && selected && (
        <Sheet title="Versions" subtitle={`${pair} · a published version never changes; applications keep the version they started on`} onClose={() => setSide(null)}>
          <VersionList versions={selected.versions} />
        </Sheet>
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
      {question && selected && (question.mode === "add" || editEntryOf) && (
        <QuestionDialog
          key={question.mode === "add" ? `add-${question.group}` : question.key}
          mode={question.mode}
          pair={pair}
          builtIn={editEntryOf && !editEntryOf.custom ? { key: editEntryOf.key, name: editEntryOf.canonicalLabel, typeLabel: editEntryOf.typeLabel, sensitive: editEntryOf.sensitive } : null}
          initial={editEntryOf ? {
            label: editEntryOf.label, help: editEntryOf.help, type: editEntryOf.custom?.type ?? "text", options: editEntryOf.custom?.options ?? [], group: editEntryOf.group, state: editEntryOf.required ? "required" : "optional",
          } : { label: "", help: "", type: "text", options: [], group: question.mode === "add" ? question.group : "insured", state: "optional" }}
          groups={FIELD_SET_GROUPS.map((g) => ({ key: g.key, label: g.label }))}
          types={CUSTOM_TYPE_LABEL}
          onSubmit={saveQuestion}
          onRemove={editEntryOf?.custom ? () => removeQuestion(editEntryOf.key) : undefined}
          onClose={() => setQuestion(null)}
          extra={editEntryOf ? (
            <>
              {selected.carrierId && mapKeys && (
                <SheetSection title="Where autofill puts it" sub="The browser extension writes the answer onto the carrier's form when the case is sent.">
                  {editEntryOf.custom ? (
                    <p className="m-0 text-sm text-[var(--body)]">Your own question: the agent types it into the carrier&apos;s form.</p>
                  ) : unplaced.has(editEntryOf.key) ? (
                    <p className="m-0 text-sm text-[var(--error-ink)]">Not placed. The agent will write it by hand. <Link href={FIELD_MAP_HREF} className="font-semibold text-[var(--accent-ink)] hover:underline">Place it in the field map</Link></p>
                  ) : (
                    <p className="m-0 text-sm text-[var(--body)]">Placed by the {selected.carrierName} field map.</p>
                  )}
                </SheetSection>
              )}
              {selected.versions.length > 0 && (
                <SheetSection title="Versions" sub={selected.draftOwn ? `v${selected.draftOwn.version} draft is yours.${selected.liveOwn ? ` v${selected.liveOwn.version} is live.` : ""}` : undefined}>
                  <VersionList versions={selected.versions} />
                </SheetSection>
              )}
            </>
          ) : undefined}
        />
      )}
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
    </TabFrame>
  );
}

function VersionList({ versions }: { versions: TemplateRowView[] }) {
  if (!versions.length) return <p className="m-0 text-sm text-[var(--muted)]">Your agency has no versions of this set yet. It uses the platform set.</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center gap-3 border-t border-[var(--border)] py-2 text-sm first:border-t-0">
          <StatusChip dot={false} tone={v.status === "published" ? "good" : v.status === "draft" ? "info" : "neutral"}>{v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}</StatusChip>
          <span className="min-w-0 flex-1 truncate text-[var(--body)]">v{v.version} · {[v.editedBy, shortDay(v.updatedAt)].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}
