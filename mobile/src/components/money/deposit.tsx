import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { Toast } from "@/components/leads/sheets";
import { Button, Chip, F, Failed, Group, Header, IOS, Loading, Row, Screen, TextLink } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { dayShort, money, paymentChip } from "./logic";
import { Card, Mini, Pad } from "./parts";
import type { Payment } from "./types";

/**
 * Board G3d · Bank deposit: a carrier payment against what landed in the bank (Bank deposits › Payments, read by
 * GET /api/app/accounting/bank?payment=<statement>). The statement lines the rate card says were paid short are
 * listed; one tap puts them on a pay issue's dispute letter (POST /api/app/commission-discrepancies
 * {action: "draft_dispute"}, the web's own Draft dispute letter: nothing is sent). The line-by-line hunt, accepting
 * as paid, and linking a deposit happen on the computer. Each line is named by the insured and the kind of line
 * ("George Patel · Advance"), as the route names them from the policy book and the statement's own lines.
 */
export function DepositScreen({ id }: { id: string }) {
  const p = usePalette();
  const { api } = useSession();
  const answer = useLoad(() => api<{ payment: Payment }>(`/api/app/accounting/bank?payment=${encodeURIComponent(id)}`).then((a) => a.payment), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pay = answer.data;
  // Every line paid short is listed (they add up to the chip: the payment's short is their sum); the pay issue can
  // only carry the lines the checker already found, so the button names its own amount — and "of" the chip's when a
  // line is not found yet, so the two never disagree.
  const allShorts = (pay?.policies ?? []).filter((x) => x.state === "short");
  const shorts = allShorts.filter((x) => x.findingId);
  const shortTotal = shorts.reduce((s, x) => s + x.shortCents, 0);
  const allShortTotal = allShorts.reduce((s, x) => s + x.shortCents, 0);
  const landedOn = pay?.deposits[0]?.postedOn ?? null;
  const title = pay ? `${pay.carrierName} · ${dayShort(landedOn ?? pay.statementDate)}` : "Bank deposit";

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/app/commission-discrepancies", { method: "POST", body: { action: "draft_dispute", ids: shorts.map((s) => s.findingId), recipient: null } });
      setDrafted(true);
      setToast(`Pay issue opened for ${money(shortTotal)}: its letter is drafted under Pay issues. Nothing is sent yet.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const footer = shorts.length && !drafted ? (
    <View style={{ gap: 10 }}>
      {error ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
      <Button write testID="deposit-issue" label={`Open a pay issue for ${money(shortTotal)}${shortTotal !== allShortTotal ? ` of ${money(allShortTotal)}` : ""}`} busy={busy} onPress={() => void draft()} />
    </View>
  ) : undefined;
  const header = <Header title={title} back={IOS ? "Money" : undefined} onBack={router.back} large={false} />;
  const chip = pay ? paymentChip(pay) : null;
  const accounts = pay ? [...new Set(pay.deposits.map((d) => d.account))].join(", ") : "";

  return (
    <Screen header={header} footer={footer} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !pay ? <Loading rows={3} />
        : answer.error && !pay ? <Failed what="the deposit" message={answer.error} onRetry={answer.reload} />
          : pay && chip ? (
            <>
              <Pad>
                <Card testID="deposit-card">
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Mini style={{ flexShrink: 1 }}>{pay.deposits.length ? `Landed in ${accounts}` : "Nothing landed yet"}</Mini>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </View>
                  <View style={{ marginTop: 4 }}><MoneyFigure cents={pay.landedCents} size={34} /></View>
                  <Mini>{`Statement said ${money(pay.paidCents)}${pay.money === "missing" ? ` · due by ${dayShort(pay.dueBy)}` : ""}`}</Mini>
                </Card>
              </Pad>
              {allShorts.length ? (
                <Group title="Statement lines not paid in full">
                  {allShorts.map((s, i) => (
                    <Row key={s.policyNumber} testID={`deposit-short-${s.policyNumber}`} first={i === 0} chevron={false} title={s.clientName ? displayName(s.clientName) : s.policyNumber}
                      meta={s.lineType ?? (s.clientName ? s.policyNumber : null)} right={money(s.shortCents)} />
                  ))}
                </Group>
              ) : (
                <View style={{ paddingTop: 20 }}>
                  <TextLink label="Open on the computer" onPress={() => router.push({ pathname: "/computer", params: { path: `/app/bank/payments/${pay.id}`, title: "This payment", why: "Linking a deposit and checking each policy need the statement and the bank side by side." } })} />
                </View>
              )}
            </>
          ) : null}
      <Toast text={toast} onHide={() => setToast(null)} bottom={IOS ? 16 : 96} />
    </Screen>
  );
}
