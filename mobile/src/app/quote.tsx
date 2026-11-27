import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CardField } from "@/components/applications/card-field";
import { face, premium, tierLabel, toCents } from "@/components/applications/logic";
import { BottomBar, ErrorLine } from "@/components/applications/parts";
import { ageOf, QUICK_TIERS, quickMeta, quickQuoteRows, type QuickCatalog } from "@/components/applications/quick-quote";
import { STATE_NAMES, stateName } from "@/components/calls/time";
import { ageFromDob } from "@/components/leads/logic";
import { SegControl, Sheet } from "@/components/leads/sheets";
import type { FullWorkspace } from "@/components/leads/types";
import { Button, Chip, Empty, F, Failed, Group, Header, Loading, Row, SearchBox, SectionHead } from "@/components/ui";
import { leadFact } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { SearchHit } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/** A saved quote, as GET /api/app/quotes lists it (lib/applications/listRules.ts QuoteRow). */
type SavedQuote = { id: string; caseId: string; clientName: string; carrierName: string; productLabel: string | null; tier: string | null; faceAmountCents: number; monthlyPremiumCents: number; createdAt: string };
const LEAD_HREF = /^\/app\/leads\/([0-9a-f-]{36})/i;

/**
 * Board E1 · Quick quote, from Menu (or from a lead, ?leadId=, which fills the answers in). Four
 * answers — Age, State, Coverage, Tobacco — and the tier, then the agency's carriers for that state
 * (GET /api/app/quoting/catalog: switched on in Settings › Carriers, appointment checked for the state,
 * each product's tiers, issue ages and face limits). Insurvas has no premium rate tables, so the list
 * prices nothing and marks no "Best": each premium is typed from the carrier's own quote tool on the
 * case's Quote step, where this pick (carrier, tier, coverage) is carried by "Apply with …" through
 * Start an application (E1b). The clock opens the quotes already saved (GET /api/app/quotes).
 */
export default function QuickQuote() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { leadId } = useLocalSearchParams<{ leadId?: string }>();
  const { api } = useSession();
  const lead = useLoad(() => (leadId ? api<FullWorkspace>(`/api/app/leads/${leadId}`) : Promise.resolve(null)), [leadId]);
  const values = lead.data?.lead.values ?? {};
  const fromLead = {
    age: leadFact(values, "age") ?? (ageFromDob(leadFact(values, "date_of_birth", "dob", "birth_date", "birthdate"))?.toString() ?? ""),
    state: (leadFact(values, "state") ?? "").toUpperCase(),
    coverage: (leadFact(values, "coverage_amount", "face_amount", "coverage", "desired_coverage") ?? "").replace(/[^\d.]/g, "").replace(/\.\d*$/, ""),
    tobacco: leadFact(values, "tobacco", "smoker", "tobacco_use"),
  };
  // What is typed here wins; until then the lead's own answers show.
  const [typed, setTyped] = useState<{ age?: string; state?: string; coverage?: string; tobacco?: boolean }>({});
  const age = typed.age ?? fromLead.age;
  const state = typed.state ?? (fromLead.state in STATE_NAMES ? fromLead.state : "");
  const coverage = typed.coverage ?? fromLead.coverage;
  const tobacco = typed.tobacco ?? (fromLead.tobacco ? /^(y|yes|true|1)$/i.test(fromLead.tobacco) : null);
  const [tier, setTier] = useState("level");
  const [chosen, setChosen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"state" | "tobacco" | "history" | "who" | null>(null);
  const [query, setQuery] = useState("");

  const catalog = useLoad<QuickCatalog | null>(() => (state ? api<QuickCatalog>(`/api/app/quoting/catalog?state=${state}&product=final_expense`) : Promise.resolve(null)), [state]);
  const history = useLoad<{ quotes: SavedQuote[] } | null>(() => (sheet === "history" ? api<{ quotes: SavedQuote[] }>("/api/app/quotes") : Promise.resolve(null)), [sheet === "history"]);
  const q = query.trim();
  const found = useLoad<{ hits: SearchHit[] } | null>(() => (sheet === "who" && q.length >= 2 ? api<{ hits: SearchHit[] }>(`/api/app/search?q=${encodeURIComponent(q)}&limit=20`) : Promise.resolve(null)), [sheet === "who", q]);

  const faceCents = toCents(coverage);
  const rows = quickQuoteRows(catalog.data ?? null, { age: ageOf(age), faceCents, tier });
  const pick = rows.find((r) => r.carrierId === chosen) ?? rows.find((r) => !r.problem) ?? null;
  const leads = (found.data?.hits ?? []).map((h) => ({ hit: h, id: LEAD_HREF.exec(h.href)?.[1] ?? null })).filter((x): x is { hit: SearchHit; id: string } => Boolean(x.id));

  const apply = (forLead: string) => {
    if (!pick) return;
    setSheet(null);
    router.push({
      pathname: "/application/start",
      params: {
        leadId: forLead, from: "quote", carrier: pick.carrierId, carrierName: pick.carrierName, product: pick.productLabel, productCode: pick.productCode, tier: pick.tier,
        ...(faceCents ? { face: String(faceCents) } : {}),
      },
    });
  };

  const head = (
    <Header title="Quote" large back="Menu" onBack={() => router.back()}
      actions={[{ icon: "history", label: "Saved quotes", onPress: () => setSheet("history") }]} />
  );

  return (
    <KeyboardAvoidingView testID="quick-quote" behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, paddingTop: insets.top }}>
        {head}
        {leadId && lead.loading && !lead.data ? <Loading rows={4} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 130 + insets.bottom }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 16 }}>
              <View style={{ backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <CardField testID="qq-age" label="Age" value={age} onChangeText={(t) => setTyped((s) => ({ ...s, age: t.replace(/\D/g, "").slice(0, 3) }))} keyboardType="number-pad" placeholder="68" />
                  <CardField testID="qq-state" label="State" value={stateName(state) ?? ""} onPress={() => setSheet("state")} />
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <CardField testID="qq-coverage" label="Coverage" value={coverage ? `$${Number(coverage).toLocaleString("en-US")}` : ""} onChangeText={(t) => setTyped((s) => ({ ...s, coverage: t.replace(/\D/g, "").slice(0, 9) }))} keyboardType="number-pad" placeholder="$15,000" />
                  <CardField testID="qq-tobacco" label="Tobacco" value={tobacco === null ? "" : tobacco ? "Yes" : "No"} onPress={() => setSheet("tobacco")} />
                </View>
                <SegControl items={QUICK_TIERS} value={tier} onChange={(k) => { setTier(k); setChosen(null); }} />
              </View>
            </View>

            {!state ? (
              <Empty icon="pin" title="Pick the client’s state" body="Carriers and appointments depend on where the client lives." />
            ) : catalog.loading && !catalog.data ? <Loading rows={4} />
              : catalog.error && !catalog.data ? (
                catalog.errorCode?.status === 403 ? <Empty icon="lock" title="Quoting isn’t on your plan or role" body="Owners and producers quote clients." />
                  : <Failed what="the carriers" message={catalog.error} onRetry={catalog.reload} />
              ) : (
                <>
                  <SectionHead>{`${rows.length} carrier${rows.length === 1 ? "" : "s"} · ${tierLabel(tier).toLowerCase()}`}</SectionHead>
                  {rows.length ? (
                    <Group footer="No rate tables on file: each premium comes from the carrier’s own quote tool, typed on the application’s Quote step.">
                      {rows.map((r, i) => (
                        <Row key={r.carrierId} testID={`qq-row-${r.carrierId}`} first={i === 0} selected={pick?.carrierId === r.carrierId} chevron={false}
                          lead={<Text style={{ width: 20, fontFamily: F.mono, fontSize: 13, color: p.muted }}>{i + 1}</Text>}
                          title={r.carrierName} meta={quickMeta(r)}
                          chip={r.problem ? <Chip tone="warn">{/^Not appointed/.test(r.problem) ? "Not appointed" : "Outside limits"}</Chip> : null}
                          onPress={() => setChosen(r.carrierId)} />
                      ))}
                    </Group>
                  ) : <Empty icon="building" title={`No carrier offers ${tierLabel(tier).toLowerCase()} here`} body="Carriers are switched on in Settings › Carriers on the computer." />}
                </>
              )}
          </ScrollView>
        )}
        {pick ? (
          <BottomBar>
            <Button write testID="qq-apply" label={`Apply with ${pick.carrierName}`} icon="filePen" onPress={() => (leadId ? apply(leadId) : setSheet("who"))} />
          </BottomBar>
        ) : null}
      </View>

      <Sheet visible={sheet === "state"} title="State" onClose={() => setSheet(null)} full>
        <View style={{ marginHorizontal: -16 }}>
          {Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, label], i) => (
            <Row key={code} testID={`qq-state-${code}`} first={i === 0} title={label} chevron={false} selected={code === state}
              onPress={() => { setTyped((s) => ({ ...s, state: code })); setChosen(null); setSheet(null); }} />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === "tobacco"} title="Tobacco or nicotine in the last 12 months" onClose={() => setSheet(null)}>
        <View style={{ marginHorizontal: -16 }}>
          {[false, true].map((v, i) => (
            <Row key={String(v)} first={i === 0} title={v ? "Yes" : "No"} chevron={false} selected={tobacco === v} onPress={() => { setTyped((s) => ({ ...s, tobacco: v })); setSheet(null); }} />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === "history"} title="Saved quotes" onClose={() => setSheet(null)} full testID="qq-history">
        {history.loading && !history.data ? <Loading rows={3} /> : history.error && !history.data ? <ErrorLine text={history.error} /> : (history.data?.quotes ?? []).length ? (
          <View style={{ marginHorizontal: -16 }}>
            {[...(history.data?.quotes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map((s, i) => (
              <Row key={s.id} first={i === 0} title={s.clientName} meta={[s.carrierName, tierLabel(s.tier), face(s.faceAmountCents)].filter(Boolean).join(" · ")} right={premium(s.monthlyPremiumCents)}
                onPress={() => { setSheet(null); router.push({ pathname: "/application/[caseId]", params: { caseId: s.caseId, step: "quote" } }); }} />
            ))}
          </View>
        ) : <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>No quotes saved yet. A quote is saved on an application’s Quote step.</Text>}
      </Sheet>
      <Sheet visible={sheet === "who"} title="Whose application?" onClose={() => setSheet(null)} full testID="qq-who">
        <View style={{ gap: 12 }}>
          <SearchBox testID="qq-who-search" value={query} onChangeText={setQuery} placeholder="Lead name or phone" autoFocus />
          {q.length < 2 ? <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>An application starts from the client’s lead. Find it by name or phone.</Text>
            : found.loading && !found.data ? <Loading rows={3} />
            : leads.length ? (
              <View style={{ marginHorizontal: -16 }}>
                {leads.map(({ hit, id }, i) => <Row key={id} testID={`qq-who-${id}`} first={i === 0} icon="user" title={hit.title} meta={hit.meta} onPress={() => apply(id)} />)}
              </View>
            ) : <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>{found.error ?? "No lead matches."}</Text>}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
