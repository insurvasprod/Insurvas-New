import { useState, type ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";

import { comparePeople, dayMonth, dayMonthYear, sourceKind, type PersonCard } from "@/components/leads/logic";
import type { FullWorkspace, PreflightMatch } from "@/components/leads/types";
import { Button, Card, Empty, F, Failed, Header, Loading, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { leadFact, leadName, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board D9 · Same person? When the existing-customer check (the lead's stored pre-flight, LA-1.24)
 * matches an earlier lead, the two records side by side, read from GET /api/app/leads/:id for each.
 * What matched is the check's own `matchedOn`; what differs is compared from the two records.
 * "Same person" records the two as one person (POST /api/app/leads/:id/preflight, action
 * same_person: the web's Clean answer for a pair of leads; nothing is merged, both keep their
 * owners), then opens this lead. "Keep both" leaves them apart. Tapping the other record opens it.
 */
function card(w: FullWorkspace, now: number): PersonCard {
  const v = w.lead.values;
  const created = new Date(w.lead.created_at);
  const today = new Date(now).toDateString() === created.toDateString();
  const dob = leadFact(v, "date_of_birth", "dob", "birth_date", "birthdate");
  return {
    when: today ? "New today" : `Since ${dayMonth(w.lead.created_at)}`,
    name: leadName(v),
    phone: phoneLabel(leadFact(v, "phone", "phone_number", "mobile_phone")),
    dob: dob ? dayMonthYear(dob) : null,
    place: [leadFact(v, "city"), leadFact(v, "state")].filter(Boolean).join(", ") || null,
    source: [w.partner?.name ?? w.lineage?.vendorName ?? sourceKind(w.lineage?.sourceType), w.owner?.name ?? w.submitter?.name ?? null].filter(Boolean).join(" · ") || null,
  };
}

export default function SamePerson() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const mine = useLoad(() => api<FullWorkspace>(`/api/app/leads/${id}`), [id]);
  const match: PreflightMatch | null = (mine.data?.preflight?.matches ?? []).find((m) => m.leadId && m.sourceType !== "contact" && m.leadId !== id) ?? null;
  const otherId = match?.leadId ?? null;
  const other = useLoad(() => (otherId ? api<FullWorkspace>(`/api/app/leads/${otherId}`) : Promise.resolve(null)), [otherId]);
  const [now] = useState(() => Date.now());
  const [linking, setLinking] = useState(false);

  async function link() {
    if (!otherId) return;
    setLinking(true);
    try {
      await api(`/api/app/leads/${id}/preflight`, { method: "POST", body: { action: "same_person", other_lead_id: otherId } });
      router.replace(`/lead/${id}` as Href);
    } catch (e) {
      Alert.alert("Not linked", e instanceof ApiError ? e.message : "The two leads were not linked. Try again.");
    } finally {
      setLinking(false);
    }
  }

  const header = <Header back="Leads" onBack={router.back} large={false} title="Possible duplicate" />;
  const frame = (body: ReactNode) => <Screen header={header}>{body}</Screen>;
  if ((mine.loading && !mine.data) || (otherId && other.loading && !other.data && !other.error)) return frame(<Loading rows={3} />);
  if (mine.error && !mine.data) return frame(<Failed message={mine.error} onRetry={mine.reload} />);
  if (!mine.data || !match || !otherId) return frame(<Empty icon="users" title="No earlier lead matches" body="The existing-customer check found no other lead for this person." />);
  if (!other.data) return frame(<Empty icon="lock" title="The other lead isn’t yours to open" body={other.error ?? "It may be with another producer."} />);

  const a = card(mine.data, now);
  const b = card(other.data, now);
  const { differs, line } = comparePeople(a, b, match.matchedOn ?? []);
  const total = (mine.data.preflight?.matches ?? []).filter((m) => m.leadId && m.sourceType !== "contact").length;

  const column = (c: PersonCard, testID: string, onPress?: () => void) => (
    <Card style={{ flex: 1 }} onPress={onPress}>
      <View testID={testID}>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{c.when}</Text>
        <Text numberOfLines={2} style={{ marginTop: 4, fontFamily: F.s, fontSize: 15, color: p.ink }}>{c.name}</Text>
        <View style={{ marginTop: 8, gap: 6 }}>
          {(["phone", "dob", "place", "source"] as const).map((k) => c[k] ? (
            <Text key={k} numberOfLines={2} style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: (differs as string[]).includes(k) ? p.goldInk : p.body }}>{c[k]}</Text>
          ) : null)}
        </View>
      </View>
    </Card>
  );

  return (
    <Screen header={header} footer={
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Button testID="same-keep" label="Keep both" kind="outline" onPress={() => router.back()} /></View>
        <View style={{ flex: 1 }}><Button write testID="same-link" label="Same person" kind="primary" icon="link" busy={linking} onPress={() => void link()} /></View>
      </View>
    }>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {column(a, "same-this")}
          {column(b, "same-other", () => router.push(`/lead/${otherId}` as Href))}
        </View>
        <Text testID="same-line" style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{line}{total > 1 ? ` · 1 of ${total} matches` : ""}</Text>
      </View>
    </Screen>
  );
}
