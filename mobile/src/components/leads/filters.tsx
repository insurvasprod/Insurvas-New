import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { AGE_LABEL, IN_STAGE_LABEL, leadSource, matchesFilters, NO_FILTERS, OWNER_ME, OWNER_NONE, type AgeBand, type InStage, type LeadFilters } from "@/components/leads/logic";
import { PickerSheet } from "@/components/leads/parts";
import { ChoiceChips, Sheet } from "@/components/leads/sheets";
import type { BoardLead } from "@/components/leads/types";
import { Button, F, Row, Toggle } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

const MORE = "__more";

/** The most common values first, with how many more there are behind a "+ N" chip. */
function byCount(values: (string | null | undefined)[]): string[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

/** The words a filter shows as a removable chip under the stages. */
export function filterChips(f: LeadFilters): { key: keyof LeadFilters; label: string }[] {
  const out: { key: keyof LeadFilters; label: string }[] = [];
  if (f.owner) out.push({ key: "owner", label: f.owner === OWNER_ME ? "Mine" : f.owner === OWNER_NONE ? "Unassigned" : f.owner });
  if (f.source) out.push({ key: "source", label: f.source });
  if (f.inStage) out.push({ key: "inStage", label: `In stage ${IN_STAGE_LABEL[f.inStage].toLowerCase()}` });
  if (f.state) out.push({ key: "state", label: f.state });
  if (f.age) out.push({ key: "age", label: `Age ${AGE_LABEL[f.age].toLowerCase()}` });
  if (f.callable) out.push({ key: "callable", label: "Callable now" });
  return out;
}

/**
 * Board D8 · Filter leads. Owner, source, time in stage, state, age and "Callable now only", read from
 * the leads already loaded (the route filters by search only). Callable now is the server's own
 * calling-window answer per lead (GET /api/app/leads?callable=1), asked for when the switch is first
 * turned on (`onNeedCallable`); until it is in, the switch waits. "Show N leads" is the exact count
 * once every page is in; before that it counts the loaded pages and says so.
 */
export function FilterSheet({ visible, onClose, value, onApply, rows, meId, complete, callableKnown, onNeedCallable }: {
  visible: boolean; onClose: () => void; value: LeadFilters; onApply: (f: LeadFilters) => void; rows: BoardLead[]; meId: string | null; complete: boolean;
  /** Whether the loaded rows carry the calling-window answer. */
  callableKnown?: boolean; onNeedCallable?: () => void;
}) {
  const p = usePalette();
  const [f, setF] = useState<LeadFilters>(value);
  const [allOwners, setAllOwners] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const [picking, setPicking] = useState<"state" | "age" | null>(null);
  const owners = useMemo(() => byCount(rows.map((r) => r.owner_name)), [rows]);
  const sources = useMemo(() => byCount(rows.map((r) => leadSource(r))), [rows]);
  const states = useMemo(() => byCount(rows.map((r) => (typeof r.values.state === "string" ? r.values.state.trim() : null))).sort(), [rows]);
  const count = useMemo(() => rows.filter((r) => matchesFilters(r, f, meId)).length, [rows, f, meId]);
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const ownerItems = [{ key: OWNER_ME, label: "Me" }, { key: OWNER_NONE, label: "Unassigned" }, ...(allOwners ? owners : owners.slice(0, 2)).map((o) => ({ key: o, label: o })),
    ...(!allOwners && owners.length > 2 ? [{ key: MORE, label: `+ ${owners.length - 2}` }] : [])];
  const sourceItems = [...(allSources ? sources : sources.slice(0, 5)).map((s) => ({ key: s, label: s })), ...(!allSources && sources.length > 5 ? [{ key: MORE, label: `+ ${sources.length - 5}` }] : [])];
  const label = (t: string) => <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted, marginTop: 12, marginBottom: 6 }}>{t}</Text>;

  return (
    <Sheet visible={visible} title="Filters" onClose={onClose} testID="filter-sheet">
      <View style={{ gap: 0 }}>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted, marginTop: 4, marginBottom: 6 }}>Owner</Text>
        <ChoiceChips testID="filter-owner" items={ownerItems} value={f.owner} onChange={(v) => (v === MORE ? setAllOwners(true) : set("owner", v))} />
        {sources.length ? label("Source") : null}
        {sources.length ? <ChoiceChips testID="filter-source" items={sourceItems} value={f.source} onChange={(v) => (v === MORE ? setAllSources(true) : set("source", v))} /> : null}
        {label("Time in stage")}
        <ChoiceChips testID="filter-in-stage" items={(Object.keys(IN_STAGE_LABEL) as InStage[]).map((k) => ({ key: k, label: IN_STAGE_LABEL[k] }))} value={f.inStage} onChange={(v) => set("inStage", v as InStage | null)} />
        <View style={{ marginHorizontal: -16, marginTop: 12 }}>
          <Row first title="State" right={f.state ?? "Any"} chevron onPress={() => setPicking("state")} testID="filter-state" />
          <Row title="Age" right={f.age ? AGE_LABEL[f.age] : "Any"} chevron onPress={() => setPicking("age")} testID="filter-age" />
          <Row title="Callable now only" meta={f.callable && !callableKnown ? "Checking the calling windows…" : undefined} chevron={false} testID="filter-callable"
            right={<Toggle label="Callable now only" value={Boolean(f.callable)} onChange={(on) => { set("callable", on ? true : null); if (on && !callableKnown) onNeedCallable?.(); }} />} />
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10, paddingBottom: 6 }}>
          <View style={{ flex: 1 }}><Button testID="filter-clear" label="Clear" kind="outline" onPress={() => setF(NO_FILTERS)} /></View>
          <View style={{ flex: 1 }}><Button testID="filter-apply" label={`Show ${count.toLocaleString()} ${complete ? "" : "loaded "}${count === 1 ? "lead" : "leads"}`} kind="primary" onPress={() => { onApply(f); onClose(); }} /></View>
        </View>
      </View>
      <PickerSheet title="State" visible={picking === "state"} onClose={() => setPicking(null)} value={f.state ?? "__any"}
        onPick={(k) => set("state", k === "__any" ? null : k)} items={[{ key: "__any", label: "Any" }, ...states.map((s) => ({ key: s, label: s }))]} />
      <PickerSheet title="Age" visible={picking === "age"} onClose={() => setPicking(null)} value={f.age ?? "__any"}
        onPick={(k) => set("age", k === "__any" ? null : (k as AgeBand))} items={[{ key: "__any", label: "Any" }, ...(Object.keys(AGE_LABEL) as AgeBand[]).map((k) => ({ key: k, label: AGE_LABEL[k] }))]} />
    </Sheet>
  );
}
