import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CallSheet } from "@/components/call-sheet";
import { CardTitle, KV } from "@/components/leads/parts";
import { ActionSheet, Toast, type SheetAction } from "@/components/leads/sheets";
import { NewCaseSheet } from "@/components/retention/new-case-sheet";
import { Button, Card, Chip, Empty, F, Failed, Header, IOS, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { dayMonth, dayMonthYear, draftDayText, firstWord, money, monthOf, toneOf } from "./format";
import { FigureTile, FigureText, MoneyFigure, Sourced, SourceSheet, TilePair } from "./parts";
import type { AwaitingPolicy, CarrierPolicy, PolicyAnswer } from "./types";

/**
 * Board F2 · Policy — the web's policy page, round 6: the client as the title with the Health chip, one muted line
 * (carrier · product · policy number), the figure strip, the Policy card where each value says where it came from
 * (tap ⓘ, or a figure), the Commission card (its lines are F2b), then Call and Open the case. Contact goes only
 * through the dialer (the call sheet's server checks), never a number on the page. GET /api/app/policy-book with
 * the carrier and policy number: the same reads as the web page, a producer only their own.
 */
const DIALERS = ["owner", "producer"];

export function policyHref(carrierId: string, policyNumber: string, part?: "ledger") {
  return { pathname: part ? "/book/[carrierId]/[policyNumber]/ledger" : "/book/[carrierId]/[policyNumber]", params: { carrierId, policyNumber } } as never;
}

type Source = { title: string; text: string; file?: string | null };

export function PolicyScreen({ carrierId, policyNumber }: { carrierId: string; policyNumber: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, me } = useSession();
  const answer = useLoad(() => api<PolicyAnswer>(`/api/app/policy-book?carrierId=${encodeURIComponent(carrierId)}&policyNumber=${encodeURIComponent(policyNumber)}`), [carrierId, policyNumber]);
  const [calling, setCalling] = useState(false);
  const [menu, setMenu] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const policy = answer.data?.policy ?? null;
  const roles = me ? [me.role, ...(me.roles ?? [])] : [];
  const canDial = roles.some((r) => DIALERS.includes(r));
  // Call is always drawn for a caller; with no lead behind the policy there is no number the dialer can check.
  const call = () => (policy?.leadId ? setCalling(true) : setToast("No lead is linked to this policy, so the dialer has no number to check. Link the client on the computer."));

  const webPath = `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}`;
  const actions: SheetAction[] = [
    ...(policy?.kind === "policy" ? [{ key: "ledger", label: "Commission ledger", icon: "receipt" as const, onPress: () => router.push(policyHref(carrierId, policyNumber, "ledger")) }] : []),
    { key: "copy", label: "Copy policy number", icon: "copy", onPress: () => void Clipboard.setStringAsync(policyNumber).then(() => setToast("Policy number copied"), () => setToast("Could not copy")) },
    { key: "web", label: "Open on the computer", icon: "laptop", onPress: () => router.push({ pathname: "/computer", params: { path: webPath, title: "This policy", why: "Its history, its client link, the carrier's row as sent, and every file it came from." } }) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header back={IOS ? "Book" : undefined} onBack={router.back} large={false} title=""
        actions={[{ icon: "moreH", label: "More actions", onPress: () => setMenu(true) }]} />
      {answer.loading && !policy ? <View style={{ paddingTop: 8 }}><Loading rows={5} /></View> : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 + insets.bottom }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={answer.refreshing} onRefresh={answer.refresh} tintColor={p.green} colors={[p.green]} progressBackgroundColor={p.surf} />}>
          {answer.error && !policy ? (
            answer.errorCode?.status === 404 ? <Empty icon="book" title="This policy is not in your book" body={answer.error} />
              : answer.errorCode?.status === 403 ? <Empty icon="lock" title="The book isn’t open to your role" body={answer.error} />
                : <Failed what="this policy" message={answer.error} onRetry={answer.reload} />
          ) : policy?.kind === "policy" ? (
            <CarrierBody policy={policy} canDial={canDial} canCase={Boolean(answer.data?.canOpenCase)} onSource={setSource} onCall={call}
              onCase={(id) => (id ? router.push({ pathname: "/retention/[id]", params: { id } } as never) : setOpening(true))} />
          ) : policy?.kind === "awaiting" ? (
            <AwaitingBody policy={policy} canDial={canDial} onCall={call} />
          ) : null}
        </ScrollView>
      )}
      <ActionSheet visible={menu} title={policy?.title ?? "This policy"} actions={actions} onClose={() => setMenu(false)} />
      <SourceSheet open={source} onClose={() => setSource(null)} />
      {canDial && calling && policy?.leadId ? <CallSheet leadId={policy.leadId} visible backLabel="Policy" onClose={() => setCalling(false)} onSaved={() => setCalling(false)} /> : null}
      {opening && policy?.kind === "policy" ? (
        <NewCaseSheet visible initial={{ carrierId, carrierName: policy.carrierName, policyNumber: policy.policyNumber, clientName: policy.title.startsWith("Policy ") ? null : policy.title, phone: null, status: null }}
          onClose={() => setOpening(false)} onOpened={(id) => { setOpening(false); answer.reload(); router.push({ pathname: "/retention/[id]", params: { id } } as never); }} />
      ) : null}
      <Toast text={toast} onHide={() => setToast(null)} bottom={24 + insets.bottom} />
    </View>
  );
}

/** The title block: the client, the chip, and "carrier · product · <mono>number</mono>". */
function TitleBlock({ title, chip, carrierName, product, policyNumber }: { title: string; chip: { label: string; tone: string } | null; carrierName: string; product: string | null; policyNumber: string }) {
  const p = usePalette();
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Text accessibilityRole="header" numberOfLines={2} style={{ flex: 1, fontFamily: F.db, fontSize: 28, lineHeight: 33, letterSpacing: -0.56, color: p.ink }}>{title}</Text>
        {chip ? <Chip tone={toneOf(chip.tone)}>{chip.label}</Chip> : null}
      </View>
      <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>
        {[carrierName, product].filter(Boolean).join(" · ")}{" · "}
        <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{policyNumber}</Text>
      </Text>
    </View>
  );
}

/** The Issued tile's line, as drawn: "Month 9 of 12 chargeback window". */
export function issuedDetail(policy: Pick<CarrierPolicy, "inClawbackWindow" | "clawbackMonths" | "monthsPaid">): string | null {
  if (policy.inClawbackWindow && policy.clawbackMonths && policy.monthsPaid !== null) return `Month ${Math.min(policy.monthsPaid, policy.clawbackMonths)} of ${policy.clawbackMonths} chargeback window`;
  return policy.inClawbackWindow ? "Inside the chargeback window" : null;
}

/** The Next draft tile's line: "Last 3 drafts cleared" when the server can say so, else how far behind or months paid. */
export function nextDetail(policy: Pick<CarrierPolicy, "behind" | "monthsPaid" | "draftsCleared">): string | null {
  if (policy.behind) return policy.behind;
  if (policy.draftsCleared) return `Last ${policy.draftsCleared} ${policy.draftsCleared === 1 ? "draft" : "drafts"} cleared`;
  return policy.monthsPaid !== null ? `${policy.monthsPaid} ${policy.monthsPaid === 1 ? "month" : "months"} paid` : null;
}

function CarrierBody({ policy, canDial, canCase, onSource, onCall, onCase }: {
  policy: CarrierPolicy; canDial: boolean; canCase: boolean; onSource: (s: Source) => void; onCall: () => void; onCase: (id: string | null) => void;
}) {
  const file = policy.file ? `${policy.file.name}${policy.file.rowNumber ? ` · row ${policy.file.rowNumber}` : ""}` : null;
  const say = (title: string, text: string | null) => (text ? () => onSource({ title, text, file }) : undefined);
  // The board's "Monthly": the premium when it is drafted monthly, else the annual premium spread over twelve.
  const monthly = policy.premiumMode === "monthly" ? policy.premiumCents : policy.monthlyCents;
  const window = issuedDetail(policy);
  // Board: "AMAM file · 14 Nov". The server keeps no short carrier code, so the carrier's name says whose file it is.
  const statusFrom = policy.file ? [`${policy.carrierName} file`, policy.file.date ? dayMonth(policy.file.date) : null].filter(Boolean).join(" · ") : "Not in a carrier file";
  const m = policy.money;
  const showMoney = m.available && (m.advancedCents !== null || m.lines.length > 0);
  const advanced = m.advancedCents !== null ? [money(m.advancedCents), monthOf(m.advancedOn)].filter(Boolean).join(" · ") : "—";
  const name = firstWord(policy.title);
  const call = canDial ? <View style={{ flex: 1 }}><Button testID="policy-call" label={policy.title.startsWith("Policy ") ? "Call" : `Call ${name}`} icon="phone" onPress={onCall} /></View> : null;
  const caseBtn = canCase ? <View style={{ flex: 1 }}><Button testID="policy-case" label="Open the case" kind="outline" icon="fileCheck" onPress={() => onCase(policy.caseId)} /></View> : null;

  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <TitleBlock title={policy.title} chip={policy.health} carrierName={policy.carrierName} product={policy.product} policyNumber={policy.policyNumber} />
      <View style={{ gap: 10 }}>
        <TilePair>
          <FigureTile testID="policy-monthly" label="Monthly" onPress={say("Where the premium comes from", policy.sources.premium)}>
            {monthly !== null ? <MoneyFigure cents={monthly} /> : "—"}
          </FigureTile>
          <FigureTile testID="policy-coverage" label="Coverage" onPress={say("Where the face amount comes from", policy.sources.face)}>
            {policy.faceCents !== null ? <MoneyFigure cents={policy.faceCents} dropZero /> : "—"}
          </FigureTile>
        </TilePair>
        <TilePair>
          <FigureTile testID="policy-issued" label="Issued" detail={window} onPress={say("Where the issue date comes from", policy.sources.issued)}>
            {dayMonthYear(policy.issuedOn)}
          </FigureTile>
          <FigureTile testID="policy-next" label={policy.next ? (policy.next.label === "Next payment due" ? "Next draft" : policy.next.label) : policy.behind ? "Paid to" : "Next draft"}
            detail={nextDetail(policy)}
            onPress={say("Where the paid-to date comes from", policy.sources.paidTo)}>
            {policy.next ? dayMonth(policy.next.date) : policy.behind ? dayMonth(policy.paidTo) : "None"}
          </FigureTile>
        </TilePair>
      </View>

      <Card>
        <CardTitle>Policy</CardTitle>
        <View style={{ marginTop: 8 }}>
          <KV pairs={[
            // One ⓘ, as drawn: on "Status from" only.
            ["Writing agent", policy.agentName ?? policy.agentCode ?? "—"],
            ["Beneficiary", policy.beneficiary ?? "—"],
            ["Draft day", draftDayText(policy.draftDay) ?? "—"],
            ["Status from", <Sourced key="status" label="Status" text={statusFrom} onInfo={say("Where the status comes from", policy.sources.status) ?? null} />],
          ]} />
        </View>
      </Card>

      {showMoney ? (
        <Card>
          <CardTitle>Commission</CardTitle>
          <View testID="policy-commission" style={{ marginTop: 8 }}>
            <KV pairs={[
              ["Advance paid", advanced],
              ["Earned so far", money(m.earnedCents)],
              ["At risk if it lapses", money(m.atRiskCents)],
            ]} />
          </View>
        </Card>
      ) : null}

      {call || caseBtn ? <View style={{ flexDirection: "row", gap: 10 }}>{call}{caseBtn}</View> : null}
    </View>
  );
}

/** A sale recorded as issued: in the book before its carrier's file lists it (Module 4, Door 1). */
function AwaitingBody({ policy, canDial, onCall }: { policy: AwaitingPolicy; canDial: boolean; onCall: () => void }) {
  const p = usePalette();
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <TitleBlock title={policy.title} chip={policy.health} carrierName={policy.carrierName} product={policy.product} policyNumber={policy.policyNumber} />
      <TilePair>
        <FigureTile label="Monthly">{policy.monthlyCents !== null ? <MoneyFigure cents={policy.monthlyCents} /> : "—"}</FigureTile>
        <FigureTile label="Coverage">{policy.faceCents !== null ? <MoneyFigure cents={policy.faceCents} dropZero /> : "—"}</FigureTile>
      </TilePair>
      <TilePair>
        <FigureTile label="Issued" detail="Recorded on the sale"><FigureText>{dayMonthYear(policy.issuedOn)}</FigureText></FigureTile>
        <View style={{ flex: 1 }} />
      </TilePair>
      <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 20, color: p.muted }}>Issued, waiting for the carrier’s file. The policy’s status, payments and commission arrive with it.</Text>
      {canDial ? <Button testID="policy-call" label={`Call ${firstWord(policy.title)}`} icon="phone" onPress={onCall} /> : null}
    </View>
  );
}
