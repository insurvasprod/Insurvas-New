import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { Button, Empty, Failed, FilterChips, Group, Header, Loading, Screen, SearchBox } from "@/components/ui";
import { useLoad } from "@/lib/use-load";

import { filterCounts, inFilter, matches, newestFirst, PIPELINE_FILTERS, pipelineFilters, pipelineLabel, type PipelineFilter } from "./logic";
import { LeadRow } from "./parts";
import { usePartnerSession } from "./session";
import type { PartnerLeadRow, PipelineAnswer } from "./types";

/**
 * Board K3 · Partner pipeline. Every lead this partner sent, where it is now, in the partner's own stages
 * (the server reads them from the partner's own pipeline, never another partner type's): filter chips for
 * Working / Sold / Not sold (and Returned, when the partner's pipeline has that stage) with the server's
 * counts, the rows of the chosen one under its count with each lead's live line ("On a call with Jordan ·
 * 2:09 pm", "Callback Fri", "Agency is reviewing" — ?live=1), and a tap opens the lead (K3b). A partner
 * user sees their own submissions only — the server scopes it.
 */
const PAGE = 250;

export function PartnerPipeline() {
  const { api, me } = usePartnerSession();
  const [filter, setFilter] = useState<PipelineFilter>("open");
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState<PartnerLeadRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const data = useLoad(async () => {
    const answer = await api<PipelineAnswer>(`/api/partner/leads/pipeline?limit=${PAGE}&live=1`);
    setExtra([]);
    setNext(answer.nextOffset);
    return answer;
  }, []);

  const title = pipelineLabel(me?.partnerType ?? "publisher");
  const header = (
    <Header title={title} actions={[{ icon: "search", label: "Search", onPress: () => { setSearching((s) => !s); setQ(""); } }]}
      below={searching ? <SearchBox value={q} onChangeText={setQ} placeholder="Search by name" autoFocus testID="pipeline-search" /> : undefined}
      belowFull={data.data ? (
        <View style={{ paddingBottom: 10 }}>
          <FilterChips value={filter} onChange={(k) => setFilter(k as PipelineFilter)} items={pipelineFilters(data.data.stages).map((it) => ({ ...it, count: filterCounts(data.data!.stages, data.data!.total)[it.key] }))} />
        </View>
      ) : undefined} />
  );

  if (data.loading && !data.data) return <Screen header={header}><Loading /></Screen>;
  if (data.error && !data.data) return <Screen header={header}><Failed message={data.error} onRetry={data.refresh} what="your pipeline" /></Screen>;
  const all = [...data.data!.rows, ...extra];
  const rows = newestFirst(all.filter((r) => inFilter(r, filter) && matches(r, q)));
  const counts = filterCounts(data.data!.stages, data.data!.total);
  const label = PIPELINE_FILTERS.find((it) => it.key === filter)!.label;

  const loadMore = async () => {
    if (next === null) return;
    setMore(true);
    try {
      const page = await api<PipelineAnswer>(`/api/partner/leads/pipeline?limit=${PAGE}&offset=${next}&live=1`);
      setExtra((e) => [...e, ...page.rows]);
      setNext(page.nextOffset);
    } finally {
      setMore(false);
    }
  };

  return (
    <Screen header={header} onRefresh={data.refresh} refreshing={data.refreshing}>
      {rows.length ? (
        <Group title={`${label} · ${counts[filter].toLocaleString()}`}>
          {rows.map((row, i) => <LeadRow key={row.id} row={row} first={i === 0} onPress={() => router.push(`/partner/lead/${row.id}` as never)} />)}
        </Group>
      ) : <Empty icon="kanban" title={q ? "No one by that name" : `Nothing ${label.toLowerCase()} right now`} body={q ? "Try part of their first or last name." : undefined} />}
      {next !== null ? <View style={{ padding: 16 }}><Button kind="outline" label="Show more" onPress={() => void loadMore()} busy={more} /></View> : null}
    </Screen>
  );
}
