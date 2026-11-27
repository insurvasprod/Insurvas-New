import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { money } from "@/components/book/format";
import { MoneyFigure } from "@/components/book/parts";
import { Dialog } from "@/components/leads/sheets";
import { DangerRow } from "@/components/menu/danger-row";
import { Card, F, Failed, Group, Header, Loading, Row, Screen } from "@/components/ui";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { breakdownText, monthTitle, nextPayout, pageAllowed, runMeta, shortDay } from "./logic";
import { usePartnerSession } from "./session";
import type { PartnerUser, PayoutsAnswer } from "./types";

/**
 * Board K4 · the Account tab: what the organisation is owed next and every statement the agency
 * published, from the agency's ledger (/api/partner/payouts?phone=1: "Next payout · 5 Dec" by the agency's
 * own timer, "41 sold leads × $95 + 12 transfers × $35" from the statement's lines, and how the agency
 * pays), then the company's own rows: Team access (K6), Payout details, Notifications and Sign out.
 * Statements, Payout details and Team access are the partner admin's (lib/partnerAuth/portalAccess.ts),
 * so a partner user sees neither money nor the team, only their own account rows.
 *
 * Payout details shows the payment method the agency recorded; the bank and account ending the board
 * draws ("Regions ••0912") are not stored anywhere yet, so they are not shown.
 */
export function PartnerAccount() {
  const p = usePalette();
  const { api, me, signOut } = usePartnerSession();
  const [asking, setAsking] = useState(false);
  const statements = me ? pageAllowed("statements", me) : false;
  const team = me ? pageAllowed("team", me) : false;
  const data = useLoad(async () => {
    const [runs, users] = await Promise.all([
      statements ? api<PayoutsAnswer>("/api/partner/payouts?phone=1") : Promise.resolve(null),
      team ? api<{ users: PartnerUser[] }>("/api/partner/users").then((a) => a.users, () => null) : Promise.resolve(null),
    ]);
    return { runs, users };
  }, [statements, team]);

  const header = <Header title="Account" />;
  if (!me || (data.loading && !data.data)) return <Screen header={header}><Loading rows={4} /></Screen>;
  if (data.error && !data.data) return <Screen header={header}><Failed message={data.error} onRetry={data.refresh} what="your statements" /></Screen>;
  const d = data.data!;
  const runs = d.runs?.runs ?? null;
  const facts = d.runs?.payout ?? null;
  const owed = runs ? nextPayout(runs) : null;
  const payDay = owed ? facts?.expectedOn[owed.id] ?? null : null;
  const breakdown = owed && facts?.next?.runId === owed.id ? breakdownText(facts.next.lines, facts.next.revenueShareCents) : null;
  const people = d.users?.filter((u) => u.status === "active").length ?? null;

  return (
    <Screen header={header} onRefresh={data.refresh} refreshing={data.refreshing}>
      {runs ? (
        <>
          <View style={{ paddingHorizontal: 16 }}>
            <Card>
              <Text testID="next-payout" style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{owed ? `Next payout · ${payDay ? shortDay(payDay) : monthTitle(owed.periodStart)}` : "Next payout"}</Text>
              <MoneyFigure testID="owed" cents={owed?.netCents ?? 0} size={38} />
              <Text testID="owed-breakdown" style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{owed ? breakdown ?? (owed.invoiceNumber ? `Statement ${owed.invoiceNumber} · published, not paid yet` : "Published, not paid yet") : "Nothing published and unpaid"}</Text>
            </Card>
          </View>
          <Group title="Statements">
            {runs.length ? runs.map((r, i) => (
              <Row key={r.id} testID={`statement-${r.id}`} first={i === 0} icon="file" iconTone="plain" title={monthTitle(r.periodStart)} meta={runMeta(r)} right={money(r.netCents)} />
            )) : <Row first title="No statements yet" meta="The agency publishes one when a payout period closes." />}
          </Group>
        </>
      ) : null}
      <Group title="Your company">
        {team ? <Row first icon="users" title="Team access" right={people !== null ? `${people} ${people === 1 ? "person" : "people"}` : undefined} onPress={() => router.push("/partner/team" as never)} /> : null}
        {statements ? <Row first={!team} testID="payout-details" icon="landmark" title="Payout details" right={facts?.method ?? undefined} chevron={false} /> : null}
        <Row first={!team && !statements} testID="partner-notifications" icon="bell" title="Notifications" onPress={() => router.push("/partner/notifications" as never)} />
        <DangerRow testID="partner-sign-out" icon="logout" title="Sign out" onPress={() => setAsking(true)} />
      </Group>
      <Dialog visible={asking} title="Sign out?" onClose={() => setAsking(false)}
        actions={[{ label: "Cancel", onPress: () => setAsking(false) }, { label: "Sign out", kind: "destructive", testID: "partner-sign-out-confirm", onPress: () => { setAsking(false); void signOut(); } }]}>
        <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>This signs you out of the partner portal everywhere, on this phone and in any browser.</Text>
      </Dialog>
    </Screen>
  );
}
