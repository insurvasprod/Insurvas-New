import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApplicationListRow } from "@/components/applications/list-row";
import { LIST_FILTERS, listCounts, rowFilter, stepLine, type ListFilter } from "@/components/applications/logic";
import type { ApplicationRow, CaseView } from "@/components/applications/types";
import { Empty, Failed, FilterChips, Group, Header, Loading, SearchBox } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/** How many drafts have their step read from the case (one read each); the rest say the carrier alone. */
const STEP_READS = 20;

/**
 * Board E0 · every application this person may see (GET /api/app/applications, narrowed by the
 * server to their own producers): drafts to resume with the step they stopped on (each read from its
 * case, GET /api/app/applications/cases/:id, the same rule the application screen resumes by), the
 * ones waiting on a signature under "Needs signature", and submitted. Closed attempts are history and
 * stay on the web's list. Resuming opens the case on the first step not finished.
 */
export default function Applications() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const list = useLoad(() => api<{ applications: ApplicationRow[] }>("/api/app/applications"), []);
  const [filter, setFilter] = useState<ListFilter>("progress");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const rows = (list.data?.applications ?? []).filter((r) => rowFilter(r.status) !== null);
  const drafts = rows.filter((r) => r.status === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, STEP_READS);
  const draftKey = drafts.map((r) => `${r.applicationId}@${r.updatedAt}`).join(",");
  const steps = useLoad(async () => {
    const out: Record<string, string> = {};
    await Promise.all(drafts.map(async (r) => {
      try {
        const c = await api<CaseView>(`/api/app/applications/cases/${r.caseId}`);
        const a = c.attempts?.find((x) => x.id === r.applicationId);
        if (a) out[r.applicationId] = stepLine(c, a, (a.insuredRole === "spouse" ? c.interviews?.spouse : c.interviews?.primary) ?? null);
      } catch { /* the row keeps its carrier line */ }
    }));
    return out;
  }, [draftKey]);

  const counts = listCounts(rows);
  const q = query.trim().toLowerCase();
  const matches = (r: ApplicationRow) => !q || r.clientName.toLowerCase().includes(q) || (r.carrierName ?? "").toLowerCase().includes(q);
  const newest = (a: ApplicationRow, b: ApplicationRow) => b.updatedAt.localeCompare(a.updatedAt);
  const of = (f: ListFilter) => rows.filter((r) => rowFilter(r.status) === f && matches(r)).sort(newest);
  const open = (r: ApplicationRow) => router.push({ pathname: "/application/[caseId]", params: { caseId: r.caseId } });

  // "In progress" also lists the ones waiting on a signature under their own heading (the board's E0).
  const groups: { title: string; rows: ApplicationRow[] }[] = filter === "progress"
    ? [{ title: "", rows: of("progress") }, { title: "Needs signature", rows: of("ready") }]
    : [{ title: "", rows: of(filter) }];
  const shown = groups.filter((g) => g.rows.length);

  const below = (
    <View>
      {searching ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><SearchBox testID="app-list-search" value={query} onChangeText={setQuery} placeholder="Search by client or carrier" autoFocus /></View> : null}
      <FilterChips items={LIST_FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] }))} value={filter} onChange={(k) => setFilter(k as ListFilter)} />
      <View style={{ height: 10 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Applications" large back="Menu" onBack={() => router.back()} belowFull={below}
        actions={[{ icon: searching ? "x" : "search", label: searching ? "Close search" : "Search", onPress: () => { setSearching(!searching); setQuery(""); } }]} />
      {list.loading && !list.data ? <View testID="app-list-loading"><Loading rows={5} /></View> : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { list.refresh(); steps.reload(); }} tintColor={p.green} colors={[p.green]} progressBackgroundColor={p.surf} />}>
          {list.error && !list.data ? (
            list.errorCode?.status === 403 ? <Empty icon="lock" title="Applications aren’t on your plan or role" body="Owners and producers take applications." />
              : <Failed what="applications" message={list.error} onRetry={list.reload} />
          ) : shown.length ? shown.map((g) => (
            <Group key={g.title || "main"} title={g.title || undefined}>
              {g.rows.map((r, i) => <ApplicationListRow key={r.applicationId} row={r} first={i === 0} step={steps.data?.[r.applicationId] ?? null} onPress={() => open(r)} />)}
            </Group>
          )) : (
            <Empty icon="filePen" title={q ? "No match" : filter === "submitted" ? "Nothing submitted yet" : filter === "ready" ? "Nothing waiting on a signature" : "Nothing in progress"}
              body={q ? "Try another name." : "An application starts from a lead you are working: Start application on its page."} />
          )}
        </ScrollView>
      )}
    </View>
  );
}
