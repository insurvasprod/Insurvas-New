import { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CallSheet } from "@/components/call-sheet";
import { takePage } from "@/components/cases/capture";
import { caseLine, latestSubmission, openRequirements, pickAttempt, stillToCome, whereItIs, type CaseEvent, type CaseView } from "@/components/cases/model";
import { RequirementCard } from "@/components/cases/parts";
import { CardTitle, KV, Timeline } from "@/components/leads/parts";
import { ActionSheet, Toast } from "@/components/leads/sheets";
import { Card, Chip, Empty, F, Failed, Header, Loading, Screen, TextLink } from "@/components/ui";
import { firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board E6 · Case detail: where the case is, what the carrier waits for, and the fastest fix. The camera
 * adds pages to a requirement (E6b); a requirement on the client is one checked call away (the call
 * sheet, never tel:). Data: GET /api/app/applications/cases/:id and its /timeline.
 */
export default function CaseDetail() {
  const p = usePalette();
  const { api } = useSession();
  const { caseId, requirement } = useLocalSearchParams<{ caseId: string; requirement?: string }>();
  const [menu, setMenu] = useState(false);
  const [calling, setCalling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const load = useLoad(async () => {
    const [view, timeline] = await Promise.all([
      api<CaseView>(`/api/app/applications/cases/${caseId}`),
      // The timeline only adds "Where it is"; the case still opens without it.
      api<{ events: CaseEvent[] }>(`/api/app/applications/cases/${caseId}/timeline`).catch(() => ({ events: [] as CaseEvent[] })),
    ]);
    return { view, events: timeline.events };
  }, [caseId]);

  const view = load.data?.view;
  const attempt = view ? pickAttempt(view, requirement) : null;
  const header = (
    <Header title={view?.clientName ?? "Case"} back="Cases" onBack={() => router.back()} large={false}
      actions={view ? [{ icon: "moreH", label: "More", onPress: () => setMenu(true) }] : []} />
  );

  const scan = async (requirementId: string) => {
    if (!attempt) return;
    try {
      const page = await takePage(1);
      if (!page) return;
      router.push({ pathname: "/cases/[caseId]/scan", params: { caseId, attempt: attempt.id, requirement: requirementId, page: page.uri, name: page.name, type: page.type } } as never);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "The camera didn’t open.");
    }
  };

  let body;
  if (!load.data && load.loading) body = <Loading rows={5} />;
  else if (!view) body = <Failed what="this case" message={load.error ?? "Something went wrong."} onRetry={load.reload} />;
  else if (!attempt) body = <Empty icon="file" title="No application yet" body="This case has not started an application." />;
  else {
    const sub = latestSubmission(attempt);
    const open = openRequirements(attempt);
    const counter = attempt.counteroffers.find((o) => o.status === "pending_client");
    const where = whereItIs(load.data?.events ?? [], attempt.attemptNo);
    const line = caseLine(attempt);
    body = (
      <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 14 }}>
        <View>
          <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 26, lineHeight: 31, letterSpacing: -0.5, color: p.ink }}>{view.clientName}</Text>
          <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 20, color: p.muted }}>
            {line}{sub?.carrierReference ? <>{line ? " · " : ""}<Text style={{ fontFamily: F.mono, fontSize: 13 }}>{sub.carrierReference}</Text></> : null}
          </Text>
        </View>
        {open.map((r) => (
          <RequirementCard key={r.id} r={r} highlighted={r.id === requirement} onScan={() => void scan(r.id)}
            onCall={() => setCalling(true)} callLabel={`Call ${firstName(view.clientName)}`} />
        ))}
        {counter ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1 }}><CardTitle>Counteroffer</CardTitle></View>
              <Chip tone="warn">Client to answer</Chip>
            </View>
            <Text style={{ marginTop: 4, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{counter.reason}</Text>
          </Card>
        ) : null}
        {where.length ? (
          <Card>
            <CardTitle>Where it is</CardTitle>
            {/* The latest four, as the board draws it; the rest one tap away rather than a long scroll. */}
            <View style={{ marginTop: 10 }}><Timeline items={allSteps ? where : where.slice(0, 4)} /></View>
            {where.length > 4 && !allSteps ? <View style={{ marginTop: 6 }}><TextLink center={false} label={`Show all ${where.length}`} onPress={() => setAllSteps(true)} /></View> : null}
          </Card>
        ) : null}
        <Card>
          <CardTitle>Still to come</CardTitle>
          <View style={{ marginTop: 8 }}><KV pairs={stillToCome(attempt)} /></View>
        </Card>
      </View>
    );
  }

  return (
    <>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      {view ? (
        <ActionSheet visible={menu} title={view.clientName} onClose={() => setMenu(false)} actions={[
          { key: "lead", label: "Open the lead", icon: "user", onPress: () => router.push(`/lead/${view.leadId}` as never) },
          { key: "web", label: "Open it on the computer", icon: "laptop", onPress: () => router.push({ pathname: "/computer", params: { path: `/app/applications/${view.caseId}`, title: view.clientName, why: "The whole application, its quotes and every requirement." } }) },
        ]} />
      ) : null}
      {view && calling ? <CallSheet leadId={view.leadId} visible={calling} backLabel="Case" onClose={() => setCalling(false)} onSaved={() => { setCalling(false); load.reload(); }} /> : null}
      <Toast text={toast} onHide={() => setToast(null)} />
    </>
  );
}
