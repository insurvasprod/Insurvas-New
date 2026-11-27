import { useState } from "react";
import { Linking, ScrollView, Share, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { face, PHONE_PRODUCTS } from "@/components/applications/logic";
import { BottomBar, ErrorLine } from "@/components/applications/parts";
import { stateName } from "@/components/calls/time";
import { whyNotStart } from "@/components/leads/application";
import { ageFromDob } from "@/components/leads/logic";
import type { FullWorkspace } from "@/components/leads/types";
import { Button, Chip, F, Failed, Group, Header, Loading, Row } from "@/components/ui";
import { API_URL, ApiError } from "@/lib/api";
import { firstName, leadFact, leadName } from "@/lib/format";
import { linkMail } from "@/lib/links";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

type Product = { code: string; name: string; category: string };
type Params = { leadId: string; from?: string; carrier?: string; carrierName?: string; product?: string; productCode?: string; tier?: string; face?: string };

/**
 * Board E1b · which product the application is for. The agency's products (GET /api/app/products/sold);
 * the deep-flow ones (final expense, whole life, term) apply on the phone, the rest carry the laptop
 * mark and email the person the lead's link. Coming from Quick quote (E1, ?from=quote) the back says
 * Quote, the line under the title carries the coverage, and the product quoted is the one picked, its
 * carrier and plan on the row; the pick goes on into the case's Quote step. Start is the web's one
 * doorway (POST /api/app/applications/start with the lead's work item): it opens or resumes the case.
 */
export default function StartApplication() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Params>();
  const { leadId } = params;
  const { api, me } = useSession();
  const lead = useLoad(() => api<FullWorkspace>(`/api/app/leads/${leadId}`), [leadId]);
  const products = useLoad(() => api<{ products: Product[] }>("/api/app/products/sold"), []);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = lead.data;
  const all = products.data?.products ?? [];
  const phone = all.filter((x) => PHONE_PRODUCTS.has(x.code));
  const computer = all.filter((x) => !PHONE_PRODUCTS.has(x.code));
  const quoted = params.productCode && phone.some((x) => x.code === params.productCode) ? params.productCode : null;
  const leadLine = w?.lead.product_line ?? null;
  const chosen = pick ?? quoted ?? (phone.some((x) => x.code === leadLine) ? leadLine : phone[0]?.code ?? null);
  const chosenName = phone.find((x) => x.code === chosen)?.name ?? null;
  const values = w?.lead.values ?? {};
  const name = w ? leadName(values) : "";
  const dob = leadFact(values, "date_of_birth", "dob", "birth_date", "birthdate");
  const age = leadFact(values, "age") ?? (ageFromDob(dob)?.toString() ?? null);
  const faceCents = Number(params.face);
  const coverage = Number.isFinite(faceCents) && faceCents > 0 ? face(faceCents) : null;
  const who = [name, age, stateName(leadFact(values, "state")), coverage].filter(Boolean).join(" · ");
  const blocked = w ? whyNotStart(w.queue, w.currentUserId ?? me?.user.id ?? "") : null;
  const first = name ? firstName(name) : null;
  const fromQuote = params.from === "quote";
  const quoteLine = [params.carrierName, params.product].filter(Boolean).join(" · ");

  async function start() {
    if (!w?.queue || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<{ caseId: string }>("/api/app/applications/start", { method: "POST", body: { work_item_id: w.queue.id, product_line: chosen } });
      // Quick quote's pick rides along to the case's Quote step (only for the product it was quoted on).
      const carry = chosen === quoted ? Object.fromEntries(Object.entries({ carrier: params.carrier, tier: params.tier, face: params.face }).filter(([, v]) => v)) : {};
      router.replace({ pathname: "/application/[caseId]", params: { caseId: answer.caseId, ...carry } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The application didn’t start. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** "Tap one to email yourself the link": straight to the phone's mail app, addressed to the person. */
  const emailLink = (product: Product) => {
    const url = `${API_URL}/app/leads/${leadId}`;
    void Linking.openURL(linkMail(me?.user.email, `${product.name} application${name ? ` for ${name}` : ""}`, url)).catch(() => Share.share({ message: url, url }));
  };
  const loading = (lead.loading && !w) || (products.loading && !products.data);
  const failed = (lead.error && !w) || (products.error && !products.data);

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Start an application" large={false} back={fromQuote ? "Quote" : first ?? "Back"} onBack={() => router.back()} />
      {loading ? <Loading rows={4} /> : failed ? <Failed what="the products" message={lead.error ?? products.error ?? ""} onRetry={() => { lead.reload(); products.reload(); }} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {who ? <Text testID="app-start-for" style={{ paddingHorizontal: 16, paddingTop: 14, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`For ${who}`}</Text> : null}
          {phone.length ? (
            <Group title="Apply on the phone" footer="Every step saves as you go and works with a weak signal.">
              {phone.map((x, i) => (
                <Row key={x.code} testID={`app-start-${x.code}`} first={i === 0} icon="filePen" title={x.name}
                  meta={x.code === quoted && quoteLine ? quoteLine : "10 steps with signature"} chevron={false}
                  chip={x.code === chosen ? <Chip tone="ok">Picked</Chip> : null} onPress={() => setPick(x.code)} />
              ))}
            </Group>
          ) : null}
          {computer.length ? (
            <Group title="Finish on a computer" // The board adds "The quote and…": a Quick quote is not saved until a case exists, so only the answers travel.
              footer={`Tap one to email yourself the link. ${first ? `${first}’s` : "The lead’s"} answers come with it.`}>
              {computer.map((x, i) => <Row key={x.code} testID={`app-start-${x.code}`} first={i === 0} icon="laptop" title={x.name} meta="Uses your agency’s own form" chevron={false} onPress={() => emailLink(x)} />)}
            </Group>
          ) : null}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
            {blocked ? <Text testID="app-start-blocked" style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>{blocked}</Text> : null}
            <ErrorLine text={error} testID="app-start-error" />
          </View>
        </ScrollView>
      )}
      {chosenName && !loading && !failed ? (
        <BottomBar>
          <Button write testID="app-start" label={`Start ${chosenName.toLowerCase()} application`} icon="filePen" busy={busy} disabled={Boolean(blocked)} onPress={() => void start()} />
        </BottomBar>
      ) : null}
    </View>
  );
}
