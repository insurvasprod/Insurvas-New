import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { AddLeadSheet } from "@/components/leads/add-lead";
import { Board } from "@/components/leads/board";
import { FilterSheet, filterChips } from "@/components/leads/filters";
import { activeFilterCount, leadSource, matchesFilters, nextStage, NO_FILTERS, pronoun, rowChip, type FormTemplate, type LeadFilters, type StageMeta } from "@/components/leads/logic";
import { MoveSheet } from "@/components/leads/move-sheet";
import { useIntentOpen } from "@/components/native/intents";
import { LeadsSplit, useLeadSelected, useOpenLead } from "@/components/native/record-split";
import { PickerSheet } from "@/components/leads/parts";
import { ActiveChips, Fab, SegControl, Toast } from "@/components/leads/sheets";
import type { BoardLead } from "@/components/leads/types";
import { Button, Chip, Empty, F, Failed, FilterChips, Header, IOS, Loading, Row, SearchBox, type HeaderAction } from "@/components/ui";
import { useAndroidKeyboardShown } from "@/lib/sheet-inset";
import { ago, firstName, leadFact, leadName } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { LeadsAnswer, Pipeline } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board D1 · Leads, list, and D2 · Leads, board, with D7 · Add a lead and D8 · Filter leads. The
 * pipeline picker and List / Board, the stages as chips (All carries the pipeline's exact total),
 * the filters as removable chips, then rows or lanes. Pages of 500 from the server; the stage chips,
 * Mine and the filters narrow the pages already loaded (the route takes only a search), and paging
 * carries on as the list scrolls. A row's chip says what the lead is (New, Needs review, Assigned, or
 * its stage). Long-press a card on the board to move it: straight to D6 on the next stage.
 */
/** The picker's "All pipelines" row (a producer's own book spans every pipeline). */
const ALL_PIPELINES = "__all";

/** Page 0 also carries the open pipeline's stage counts (stageTotals, 2026-11-25; absent from an older server). */
type Answer = LeadsAnswer & { template?: { template?: FormTemplate }; stageTotals?: Record<string, number | null> | null };
const MOVERS = ["owner", "producer", "assistant"];

/** Board L6: on a tablet the list sits left of the lead it opened; on a phone a lead still opens full screen. */
export default function LeadsTab() {
  return <LeadsSplit><Leads /></LeadsSplit>;
}

/** The same Leads as a pushed screen (/leads-page) for the roles whose tab bar has no Leads tab. */
export function LeadsPage() {
  return <LeadsSplit><Leads stacked /></LeadsSplit>;
}

function Leads({ stacked }: { stacked?: boolean }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, me } = useSession();
  const openLead = useOpenLead();
  const isOpen = useLeadSelected();
  // Board L3: the "Add a lead" shortcut lands here with ?add=… and opens the sheet once.
  const addIntent = useIntentOpen("add");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  /** Null: the server's default pipeline (the first answer names it). */
  const [chosen, setChosen] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<BoardLead[]>([]);
  const [stage, setStage] = useState<string>("all");
  const [mine, setMine] = useState(false);
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const [filters, setFilters] = useState<LeadFilters>(NO_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<BoardLead | null>(null);
  const [moveTo, setMoveTo] = useState<{ id: string; name: string } | null>(null);
  /** Rows carry the calling-window answer once "Callable now only" has been asked for (?callable=1). */
  const [askCallable, setAskCallable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stageTotals, setStageTotals] = useState<{ pipelineId: string | null; counts: Record<string, number | null> } | null>(null);

  // Typing settles for 350ms before the search runs; a new search starts at page 0.
  useEffect(() => { const h = setTimeout(() => { setQ(query.trim()); setPage(0); }, 350); return () => clearTimeout(h); }, [query]);
  const choose = (id: string) => { setChosen(id); setStage("all"); setPage(0); };

  const load = useLoad(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (chosen) params.set("pipeline", chosen);
    if (q) params.set("q", q);
    if (askCallable) params.set("callable", "1");
    const d = await api<Answer>(`/api/app/leads?${params}`);
    if (d.pipelines?.length) setPipelines(d.pipelines);
    if (d.page === 0) setStageTotals(d.stageTotals ? { pipelineId: d.pipelineId, counts: d.stageTotals } : null);
    setRows((prev) => (d.page === 0 ? (d.leads as BoardLead[]) : [...prev, ...(d.leads as BoardLead[])]));
    return d;
  }, [chosen, q, page, askCallable]);
  // A producer's (narrowed) session reads its own leads whole, every pipeline, and names no pipeline: the
  // picker then starts on "All pipelines" and a choice narrows the loaded rows here (board D1 for everyone).
  const narrowedBook = Boolean(load.data) && !load.data?.pipelineId;
  const pipelineId = chosen ?? load.data?.pipelineId ?? null;
  const pipeline = pipelines.find((pl) => pl.id === pipelineId) ?? null;
  const total = pipelineId && load.data?.totals ? load.data.totals[pipelineId] : undefined;
  // Every page's answer carries the person's template (the form D7 draws).
  const template = load.data?.template?.template ?? null;
  const readOnly = Boolean(load.data?.readOnly);
  const canAdd = !readOnly && me?.role !== "setter" && Boolean(template);
  const canMove = !readOnly && MOVERS.includes(me?.role ?? "");
  const complete = Boolean(load.data && !load.data.hasMore);
  const refresh = () => { if (page === 0) load.reload(); else setPage(0); };

  // A search looks in one pipeline; the answer counts matches in every one, so an empty result can
  // point at the pipeline that has them.
  const elsewhere = q ? pipelines.find((pl) => pl.id !== pipelineId && (load.data?.totals?.[pl.id] ?? 0) > 0) ?? null : null;
  const elsewhereCount = elsewhere ? load.data?.totals?.[elsewhere.id] ?? 0 : 0;
  const typing = useAndroidKeyboardShown();

  const stageMeta = (pipeline?.stages ?? []) as StageMeta[];
  const stageNames = useMemo(() => new Map(pipelines.flatMap((pl) => (pl.stages ?? []).map((s) => [s.id, s.name] as const))), [pipelines]);
  const filtered = useMemo(() => rows.filter((r) => (!narrowedBook || !pipelineId || r.pipeline_id === pipelineId) && (!mine || r.owner_user_id === me?.user.id) && matchesFilters(r, filters, me?.user.id)), [rows, narrowedBook, pipelineId, mine, filters, me?.user.id]);
  // The narrowed book's counts come from its own rows (all of them are loaded).
  const localCounts = useMemo(() => {
    if (!narrowedBook) return null;
    const byPipeline: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    for (const r of rows) {
      if (r.pipeline_id) byPipeline[r.pipeline_id] = (byPipeline[r.pipeline_id] ?? 0) + 1;
      if (r.pipeline_id === pipelineId && r.stage_id) byStage[r.stage_id] = (byStage[r.stage_id] ?? 0) + 1;
    }
    return { byPipeline, byStage };
  }, [narrowedBook, rows, pipelineId]);
  const shown = useMemo(() => filtered.filter((r) => stage === "all" || r.stage_id === stage), [filtered, stage]);
  const stageLabel = stage === "all" ? null : stageNames.get(stage) ?? null;
  const narrowed = activeFilterCount(filters) > 0;

  const stageCounts = localCounts ? localCounts.byStage : stageTotals && stageTotals.pipelineId === pipelineId ? stageTotals.counts : null;
  const allCount = localCounts && pipelineId ? localCounts.byPipeline[pipelineId] ?? 0 : total;
  const chips = [{ key: "all", label: "All", count: allCount }, ...(pipeline?.stages ?? []).map((s) => ({ key: s.id, label: s.name, count: stageCounts?.[s.id] ?? (localCounts ? 0 : undefined) }))];
  const stageTotal = stage === "all" ? undefined : stageCounts?.[stage] ?? undefined;
  // The lanes' exact counts hold only while nothing narrows what the board was sent.
  const laneTotals = !narrowed && !mine && stageCounts ? stageCounts : null;
  const line = stageLabel
    ? stageTotal !== undefined && !narrowed && !mine ? `${stageTotal.toLocaleString()} ${stageLabel.toLowerCase()} · sorted by newest` : `${stageLabel} · sorted by newest`
    : narrowed ? `${shown.length.toLocaleString()} ${complete ? "" : "loaded "}${shown.length === 1 ? "lead" : "leads"} · sorted by newest`
    : allCount !== undefined ? `${allCount.toLocaleString()} ${allCount === 1 ? "lead" : "leads"} · sorted by newest`
    : narrowedBook ? `${rows.length.toLocaleString()} ${rows.length === 1 ? "lead" : "leads"} · sorted by newest` : "Sorted by newest";

  const actions: HeaderAction[] = [
    { icon: searching ? "x" : "search", label: searching ? "Close search" : "Search leads", onPress: () => { if (searching) setQuery(""); setSearching((s) => !s); } },
    { icon: "sliders", label: "Filter leads", onPress: () => setFiltering(true), badge: activeFilterCount(filters) || undefined },
    ...(IOS && canAdd ? [{ icon: "plus" as const, label: "Add lead", onPress: () => setAdding(true) }] : []),
  ];

  const header = (
    <Header title="Leads" actions={actions} onBack={stacked ? () => router.back() : undefined} large={stacked ? true : undefined}
      belowFull={
        <View>
          {searching ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><SearchBox testID="leads-search" value={query} onChangeText={setQuery} placeholder="Name, phone or email" autoFocus /></View> : null}
          <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {pipeline || (narrowedBook && pipelines.length > 1) ? (
              <Pressable testID="leads-pipeline" accessibilityRole="button" accessibilityLabel={`Pipeline: ${pipeline?.name ?? "All pipelines"}`} disabled={pipelines.length < 2} onPress={() => setPicking(true)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: p.line2, maxWidth: "55%" }}>
                <Icon name="kanban" size={16} color={p.ink} />
                <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 14, color: p.ink, flexShrink: 1 }}>{pipeline?.name ?? "All pipelines"}</Text>
                {pipelines.length > 1 ? <Icon name="chevD" size={16} color={p.ink} /> : null}
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              <SegControl items={[{ key: "list", label: "List" }, { key: "board", label: "Board" }]} value={view} onChange={(k) => setView(k as "list" | "board")} />
            </View>
          </View>
          {view === "list" && chips.length > 1 ? <FilterChips items={chips} value={stage} onChange={setStage} /> : null}
          <ActiveChips items={filterChips(filters)} onRemove={(k) => setFilters((f) => ({ ...f, [k]: null }))} />
          <View style={{ height: 10 }} />
        </View>
      } />
  );

  const listHead = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 }}>
      <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{line}</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable testID="leads-mine" accessibilityRole="button" accessibilityState={{ selected: mine }} onPress={() => setMine(true)} hitSlop={6}>
          <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk, textDecorationLine: mine ? "underline" : "none" }}>Mine</Text>
        </Pressable>
        <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk }}> · </Text>
        <Pressable testID="leads-all" accessibilityRole="button" accessibilityState={{ selected: !mine }} onPress={() => setMine(false)} hitSlop={6}>
          <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk, textDecorationLine: !mine ? "underline" : "none" }}>All</Text>
        </Pressable>
      </View>
    </View>
  );

  const overlays = (
    <>
      <PickerSheet title="Pipeline" visible={picking} onClose={() => setPicking(false)} value={pipelineId ?? ALL_PIPELINES} onPick={(id) => (id === ALL_PIPELINES ? (setChosen(null), setStage("all")) : choose(id))}
        items={[
          ...(narrowedBook ? [{ key: ALL_PIPELINES, label: "All pipelines", icon: "kanban" as const, meta: `${rows.length.toLocaleString()} ${rows.length === 1 ? "lead" : "leads"}` }] : []),
          ...pipelines.map((pl) => {
            const n = localCounts ? localCounts.byPipeline[pl.id] ?? 0 : load.data?.totals?.[pl.id];
            return { key: pl.id, label: pl.name, icon: "kanban" as const, meta: n !== undefined ? `${n.toLocaleString()} ${n === 1 ? "lead" : "leads"}` : undefined };
          }),
        ]} />
      {filtering ? <FilterSheet visible onClose={() => setFiltering(false)} value={filters} onApply={setFilters} rows={rows} meId={me?.user.id ?? null} complete={complete}
        callableKnown={askCallable && !load.loading} onNeedCallable={() => { setAskCallable(true); setPage(0); }} /> : null}
      <AddLeadSheet visible={adding || (canAdd && addIntent.open)} onClose={() => { setAdding(false); addIntent.done(); }} template={template} onCreated={refresh} />
      {moving ? (
        <MoveSheet visible={Boolean(moveTo)} leadId={moving.id} firstName={firstName(leadName(moving.values))} source="board" stages={pipeline?.stages ?? []}
          callback={moving.callback_at ? { at: moving.callback_at, timezone: moving.callback_timezone ?? null } : null} pronoun={pronoun(moving.values)}
          from={moving.stage_id ? { id: moving.stage_id, name: stageNames.get(moving.stage_id) ?? "its stage" } : null} to={moveTo}
          onClose={() => { setMoveTo(null); setMoving(null); }} onMoved={(m) => { setMoveTo(null); setMoving(null); setToast(m); refresh(); }} />
      ) : null}
      {canAdd && !typing ? <Fab testID="leads-add" label={view === "list" ? "Add lead" : undefined} icon="plus" onPress={() => setAdding(true)} /> : null}
      <Toast text={toast} onHide={() => setToast(null)} bottom={88} />
    </>
  );

  if (load.error && !rows.length) {
    return (
      <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
        {header}
        {load.errorCode?.status === 403 ? <Empty icon="lock" title="Leads aren’t open to your role" /> : <Failed message={load.error} onRetry={load.reload} />}
        {overlays}
      </View>
    );
  }

  const refreshControl = <RefreshControl refreshing={load.refreshing} onRefresh={() => { setPage(0); void load.refresh(); }} tintColor={p.green} colors={[p.green]} progressBackgroundColor={p.surf} />;

  if (view === "board") {
    return (
      <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
        {header}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} refreshControl={refreshControl}>
          {load.loading && !rows.length ? <Loading rows={5} /> : (pipeline?.stages ?? []).length ? (
            <Board stages={pipeline?.stages ?? []} leads={filtered} complete={complete} hasMore={Boolean(load.data?.hasMore)} totals={laneTotals}
              onLoadMore={() => { if (load.data?.hasMore && !load.loading) setPage((n) => n + 1); }}
              onOpen={(lead) => openLead(lead.id)} onMove={canMove ? (lead) => { const to = nextStage(pipeline?.stages ?? [], lead.stage_id); if (to) { setMoving(lead); setMoveTo(to); } } : undefined} />
          ) : <Empty icon="kanban" title="This pipeline has no stages" />}
        </ScrollView>
        {overlays}
      </View>
    );
  }

  const last = shown.length - 1;
  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      {header}
      <FlatList
        testID="leads-list"
        style={{ flex: 1 }}
        data={shown}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={listHead}
        ListEmptyComponent={load.loading || load.data?.hasMore ? <Loading rows={6} /> : q && elsewhere ? (
          <Empty icon="search" title={`No match in ${pipeline?.name ?? "this pipeline"}`} body={`${elsewhereCount.toLocaleString()} ${elsewhereCount === 1 ? "lead matches" : "leads match"} in ${elsewhere.name}.`}
            action={<Button testID="leads-search-elsewhere" label={`Show ${elsewhere.name}`} kind="tonal" onPress={() => choose(elsewhere.id)} />} />
        ) : <Empty icon="users" title={q ? "No leads match" : narrowed ? "No leads match these filters" : mine ? "None of these are yours" : stageLabel ? `No leads in ${stageLabel}` : "No leads in this pipeline"} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={refreshControl}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (load.data?.hasMore && !load.loading) setPage((n) => n + 1); }}
        renderItem={({ item, index }) => {
          const chip = rowChip(item, stageMeta);
          const fact = [leadFact(item.values, "age"), leadFact(item.values, "state"), leadSource(item), ago(item.created_at)].filter(Boolean).join(" · ");
          // .grp on iOS: one rounded card the rows sit in (1px line, 14px corners); Android rows sit on the canvas.
          const card = IOS ? {
            marginHorizontal: 16, backgroundColor: p.surf, borderColor: p.line, borderLeftWidth: 1, borderRightWidth: 1, overflow: "hidden" as const,
            borderTopWidth: index === 0 ? 1 : 0, borderTopLeftRadius: index === 0 ? 14 : 0, borderTopRightRadius: index === 0 ? 14 : 0,
            borderBottomWidth: index === last ? 1 : 0, borderBottomLeftRadius: index === last ? 14 : 0, borderBottomRightRadius: index === last ? 14 : 0,
          } : null;
          return (
            <View style={[card, index === 0 ? { marginTop: 4 } : null]}>
              <Row testID={`lead-row-${item.id}`} first={index === 0} icon="user" iconTone="plain" title={leadName(item.values)} meta={fact}
                chip={chip ? <Chip tone={chip.tone}>{chip.text}</Chip> : undefined} onPress={() => openLead(item.id)} selected={isOpen(item.id)} />
            </View>
          );
        }}
      />
      {overlays}
    </View>
  );
}
