import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SegControl, Sheet } from "@/components/leads/sheets";
import { Button, Chip, F, Group, Header, Row, SectionHead } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { CardField } from "./card-field";
import { DEFAULT_TIERS, face, premium, rankQuotes, tierLabel, toCents } from "./logic";
import { BottomBar, ErrorLine, MiniLine } from "./parts";
import type { StepProps } from "./step-props";
import type { Catalog } from "./types";

/**
 * The Quote step (2 of 10), on the case; Quick quote (E1, app/quote.tsx) carries its pick in through
 * `props.pick`. Insurvas has no rate tables: each premium is typed from the
 * carrier's own quote tool (the web's Add quote, POST …/cases/:id/quotes — premium ≥ face is refused,
 * anything merely unusual comes back as a warning and is saved). The quotes on the case then line up
 * cheapest first, and Apply selects one for the application (POST /api/app/quotes/:id/select).
 */
export function QuoteStep(props: StepProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { attempt, caseView, actions } = props;
  const catalog = useLoad<Catalog>(() => actions.catalog(), [caseView.caseId]);
  // What Quick quote (E1) picked comes in first; else the case's own requested coverage.
  const [carrierId, setCarrierId] = useState<string | null>(props.pick?.carrierId ?? null);
  const [picking, setPicking] = useState(false);
  const [tier, setTier] = useState<string | null>(props.pick?.tier ?? null);
  const startFace = props.pick?.faceCents ?? caseView.requestedFaceCents ?? null;
  const [coverage, setCoverage] = useState(startFace ? String(Math.round(startFace / 100)) : "");
  const [monthly, setMonthly] = useState("");
  const [chosen, setChosen] = useState<string | null>(attempt.selectedQuoteId);
  const [busy, setBusy] = useState<"add" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const productCode = attempt.productCode ?? "final_expense";
  const carrier = catalog.data?.carriers.find((c) => c.id === carrierId) ?? null;
  const product = carrier?.products.find((x) => x.productCode === productCode) ?? null;
  const tiers = product?.tiers.length ? product.tiers : DEFAULT_TIERS;
  const pickedTier = tier && tiers.includes(tier) ? tier : tiers[0];
  const ranked = rankQuotes(attempt.quotes);
  const apply = ranked.find((q) => q.id === chosen) ?? ranked[0] ?? null;
  const readOnly = attempt.status !== "draft";

  async function add() {
    const faceCents = toCents(coverage);
    const monthlyCents = toCents(monthly);
    if (!carrier) { setError("Choose the carrier."); return; }
    if (!faceCents) { setError("Type the coverage, like 15000."); return; }
    if (!monthlyCents) { setError("Type the monthly premium from the carrier’s quote, like 52.18."); return; }
    setBusy("add");
    setError(null);
    try {
      const saved = await actions.saveQuote({ carrier_id: carrier.id, carrier_product_id: product?.id ?? null, product_code: productCode, tier: pickedTier, face_amount_cents: faceCents, monthly_premium_cents: monthlyCents });
      setWarnings((saved.warnings ?? []).map((w) => w.message));
      setMonthly("");
      setChosen(saved.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The quote wasn’t saved. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function applyWith() {
    if (!apply) return;
    setBusy("apply");
    setError(null);
    try {
      if (attempt.selectedQuoteId !== apply.id) await actions.selectQuote(apply.id);
      props.next();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The quote wasn’t picked. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView testID="app-quote" behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <Header title="Quote" large back={props.firstName} onBack={props.leave} actions={[{ icon: "listCheck", label: "All steps", onPress: props.openSteps }]} />
        <ScrollView contentContainerStyle={{ paddingBottom: 130 + insets.bottom }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {readOnly ? null : (
            <View style={{ paddingHorizontal: 16 }}>
              <View style={{ backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <CardField testID="app-quote-carrier" label="Carrier" value={carrier?.name ?? ""} onPress={() => setPicking(true)} />
                  <CardField label="State" value={caseView.clientState ?? "—"} editable={false} />
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <CardField testID="app-quote-coverage" label="Coverage" value={coverage ? `$${Number(coverage).toLocaleString("en-US")}` : ""} onChangeText={(t) => setCoverage(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="$15,000" />
                  <CardField testID="app-quote-monthly" label="Monthly" value={monthly ? `$${monthly}` : ""} onChangeText={(t) => setMonthly(t.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" placeholder="$52.18" />
                </View>
                <SegControl items={tiers.map((t) => ({ key: t, label: tierLabel(t) }))} value={pickedTier} onChange={setTier} />
                <Button write testID="app-quote-add" small kind="tonal" icon="plus" label="Add this quote" busy={busy === "add"} onPress={() => void add()} />
              </View>
            </View>
          )}
          <SectionHead>{ranked.length ? `${ranked.length} carrier${ranked.length === 1 ? "" : "s"} · monthly` : "No quotes yet"}</SectionHead>
          {ranked.length ? (
            <Group footer="Each premium as the carrier’s own quote tool gave it.">
              {ranked.map((q, i) => (
                <Row key={q.id} testID={`app-quote-${q.id}`} first={i === 0} selected={apply?.id === q.id} chevron={false}
                  lead={<Text style={{ width: 20, fontFamily: F.mono, fontSize: 13, color: p.muted }}>{i + 1}</Text>}
                  title={q.carrierName} meta={[q.productLabel, tierLabel(q.tier), face(q.faceAmountCents)].filter(Boolean).join(" · ")}
                  chip={i === 0 ? <Chip tone="ok">Best</Chip> : !q.appointed.ok ? <Chip tone="warn">Not appointed</Chip> : null}
                  right={premium(q.monthlyPremiumCents)} onPress={readOnly ? undefined : () => setChosen(q.id)} />
              ))}
            </Group>
          ) : (
            <Text style={{ paddingHorizontal: 16, fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>Run the quote in each carrier’s tool, then type the premium above. They line up here cheapest first.</Text>
          )}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
            {warnings.map((w) => <MiniLine key={w} icon="triangle">{w}</MiniLine>)}
            <ErrorLine text={error} testID="app-quote-error" />
          </View>
        </ScrollView>
        {apply ? (
          <BottomBar>
            <Button write={!readOnly} testID="app-quote-apply" label={readOnly ? "Next" : `Apply with ${apply.carrierName}`} icon={readOnly ? undefined : "filePen"} busy={busy === "apply"} onPress={readOnly ? props.next : () => void applyWith()} />
          </BottomBar>
        ) : null}
      </View>
      <Sheet visible={picking} title="Carrier" onClose={() => setPicking(false)}>
        <View style={{ marginHorizontal: -16 }}>
          {catalog.error && !catalog.data ? <View style={{ paddingHorizontal: 16 }}><ErrorLine text={catalog.error} /></View> : null}
          {(catalog.data?.carriers ?? []).map((c, i) => (
            <Row key={c.id} first={i === 0} title={c.name} meta={c.appointed.ok ? null : c.appointed.reason ?? "Not appointed in this state"} chevron={false} selected={c.id === carrierId}
              chip={c.appointed.ok ? null : <Chip tone="warn">Not appointed</Chip>} onPress={() => { setCarrierId(c.id); setTier(null); setPicking(false); }} />
          ))}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
