import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { CallSheet } from "@/components/call-sheet";
import { Ring } from "@/components/home/parts";
import { DialogModal } from "@/components/calls/parts";
import { StagePath } from "@/components/leads/parts";
import { ActionSheet, Toast } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Header, IOS, Loading, Screen } from "@/components/ui";
import { codeLabel, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { LogAttemptSheet } from "./log-attempt-sheet";
import { LADDER, STEP_LABEL, caseName, caseSteps, dayMonth, deadlineCard, firstWord, isOpenCase, money } from "./logic";
import { StepsList } from "./parts";
import type { CaseAnswer, CaseDetail } from "./types";

const CLOSED_LABEL: Record<string, string> = { saved: "Saved: a carrier file proved it", lost: "Lost", closed_no_save: "Closed without a save" };

/**
 * Board F4 · Retention case (GET /api/app/retention/cases?id=). Where it stands on the ladder, the carrier's
 * real date (a passed one stays passed and says how many days over), what the carrier file said and which file row,
 * and the steps for this reason, ticked from what the case shows. Log attempt is F5.
 *
 * Call goes through the dialer: the call sheet of the lead behind the policy (the server names it, `leadId`), with
 * every server check (disclosure, DNC, calling window, consent) before the phone's own dialer opens — never a bare
 * tel: link. When the case has no lead, or this person's role has no dialer (the server's `canDial`: the dialer is
 * owners', producers' and setters'), Call says so and offers Log attempt; the number is shown to copy, as the web's
 * case page shows it.
 */
export function CaseScreen({ id }: { id: string }) {
  const p = usePalette();
  const { api } = useSession();
  const load = useLoad(() => api<CaseAnswer>(`/api/app/retention/cases?id=${encodeURIComponent(id)}`), [id]);
  const [logging, setLogging] = useState(false);
  const [calling, setCalling] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const c = load.data?.case ?? null;

  const header = (
    <Header title={c ? caseName(c) : "Case"} back={IOS ? "Cases" : undefined} onBack={() => router.back()} large={false}
      actions={[{ icon: "moreH", label: "More", onPress: () => setMenu(true) }]} />
  );
  if (!c) {
    return (
      <Screen header={header}>
        {load.loading ? <Loading rows={4} /> : load.errorCode?.status === 404 ? <Empty icon="buoy" title="This case isn’t here" body="It may be closed, or it is someone else’s." />
          : <Failed what="this case" message={load.error ?? "Try again."} onRetry={load.reload} />}
      </Screen>
    );
  }

  const open = isOpenCase(c);
  const who = firstWord(c.clientName);
  // Through the dialer only when the server names the lead and lets this person dial.
  const dials = Boolean(c.canDial && c.leadId);
  const footer = open ? (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Button testID="case-log" kind="outline" label="Log attempt" icon="note" onPress={() => setLogging(true)} style={{ flex: 1 }} />
      <Button testID="case-call" label={who ? `Call ${who}` : "Call"} icon="phone" onPress={() => setCalling(true)} style={{ flex: 1 }} />
    </View>
  ) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} footer={footer} onRefresh={load.refresh} refreshing={load.refreshing}>
        <View style={{ paddingHorizontal: 16 }}>
          <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 26, lineHeight: 31, letterSpacing: -0.5, color: p.ink }}>{caseName(c)}</Text>
          <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 20, color: p.muted }}>
            {[c.carrierName, codeLabel(c.product)].filter(Boolean).join(" · ")}{" · "}
            <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{c.policyNumber}</Text>
            {c.monthlyCents !== null ? ` · ${money(c.monthlyCents)}/mo` : ""}
          </Text>
          {!open ? <View style={{ marginTop: 8, flexDirection: "row" }}><Chip tone={c.status === "saved" ? "ok" : "neutral"}>{CLOSED_LABEL[c.status] ?? c.status}</Chip></View> : null}
        </View>
        <View style={{ marginTop: 14 }}>
          {c.step === "paperwork"
            ? <View style={{ paddingHorizontal: 16, flexDirection: "row" }}><Chip tone="info">{`Paperwork · ${c.reasonLabel}`}</Chip></View>
            : <StagePath testID="case-path" stages={LADDER.map((s) => ({ id: s, name: STEP_LABEL[s] }))} current={LADDER.indexOf(c.step)} />}
        </View>
        <View style={{ paddingHorizontal: 16, gap: 14, marginTop: 14 }}>
          <Deadline c={c} />
          <Card>
            <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>What the carrier file said</Text>
            {c.evidence.carrierWord ? (
              <Text selectable style={{ marginTop: 8, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{`“${c.evidence.carrierWord}”`}</Text>
            ) : (
              <Text style={{ marginTop: 8, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{c.evidence.byPerson ? "No file says this yet: a person opened the case." : c.reasonLabel}</Text>
            )}
            <Text style={{ marginTop: 4, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>
              {evidenceSource(c)}
            </Text>
          </Card>
          <Card>
            <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>Steps</Text>
            {open ? <StepsList steps={caseSteps(c)} /> : <Text style={{ marginTop: 8, fontFamily: F.r, fontSize: 15, color: p.body }}>{c.outcomeReason ?? (c.resolvedAt ? `Closed ${dayMonth(c.resolvedAt)}.` : "Nothing left to do.")}</Text>}
          </Card>
        </View>
      </Screen>

      {logging ? (
        <LogAttemptSheet item={c} visible onClose={() => setLogging(false)}
          onSaved={(message) => { setLogging(false); setToast(message); load.reload(); }} />
      ) : null}
      {dials && calling ? (
        <CallSheet leadId={c.leadId!} visible backLabel={caseName(c)} onClose={() => setCalling(false)}
          onSaved={() => { setCalling(false); setLogging(true); }} />
      ) : (
        <CallDialog c={c} visible={calling} onClose={() => setCalling(false)} onLog={() => { setCalling(false); setLogging(true); }} />
      )}
      <ActionSheet visible={menu} title={caseName(c)} onClose={() => setMenu(false)} actions={[
        { key: "computer", label: "Open on the computer", icon: "laptop", onPress: () => router.push({ pathname: "/computer", params: { path: `/app/retention/${c.id}`, title: "Retention case", why: "The case's calls, its policy and its history, and closing it." } }) },
      ]} />
      <Toast text={toast} onHide={() => setToast(null)} />
    </View>
  );
}

/** The deadline card (F4): the label, the date in 26px, how many days, and the ring of time gone. */
function Deadline({ c }: { c: CaseDetail }) {
  const p = usePalette();
  const d = deadlineCard(c);
  if (!d) return null;
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{d.label}</Text>
        <Text testID="case-deadline" style={{ fontFamily: F.db, fontSize: 26, lineHeight: 31, letterSpacing: -0.5, color: p.ink, fontVariant: ["tabular-nums"] }}>{d.big}</Text>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: c.daysLeft !== null && c.daysLeft < 0 ? p.bad : p.muted }}>{d.line}</Text>
      </View>
      {c.deadline ? <Ring pct={d.pct} size={72} label={d.ring} bad={c.daysLeft !== null && c.daysLeft < 0} /> : null}
    </Card>
  );
}

/** "Mutual of Omaha policy file · 18 Nov · row 1,204"; a person-opened case says who opened it. */
export function evidenceSource(c: Pick<CaseDetail, "carrierName" | "evidence" | "reasonLabel" | "ownerName" | "fileRow">): string {
  if (!c.evidence.fileDate) return `${c.reasonLabel}${c.ownerName ? ` · ${c.ownerName}` : ""}`;
  return [`${c.carrierName} policy file`, dayMonth(c.evidence.fileDate), c.fileRow ? `row ${c.fileRow.toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
}

/** Why Call can't open the dialer here, in the server's terms. */
export function noDialReason(c: Pick<CaseDetail, "canDial" | "leadId">): string {
  if (!c.canDial) return "The dialer is for owners, producers and setters, so it won’t place this call from your role. Call the way your agency calls clients, then log the attempt.";
  return "No lead is linked to this policy, so the dialer has no record to run its checks on. Call the way your agency calls clients, then log the attempt.";
}

/** Call when the dialer can't place it (no lead, or a role with no dialer): the number to copy, or Log attempt. Also the retention Home's (B7). */
export function CallDialog({ c, visible, onClose, onLog }: { c: CaseDetail; visible: boolean; onClose: () => void; onLog: () => void }) {
  const number = phoneLabel(c.phone);
  if (!number) {
    return <DialogModal visible={visible} onClose={onClose} title="No phone on file" body="Find a number on the application, or ask the carrier." actions={[{ label: "Close", bold: true, onPress: onClose }]} />;
  }
  return (
    <DialogModal visible={visible} onClose={onClose} title={`Call ${caseName(c)}`}
      body={`${number}\n\n${noDialReason(c)}`}
      actions={[
        { label: "Log attempt", bold: true, onPress: onLog, testID: "call-dialog-log" },
        { label: "Copy the number", onPress: () => { void Clipboard.setStringAsync(c.phone ?? "").catch(() => undefined); onClose(); }, testID: "call-dialog-copy" },
        { label: "Close", onPress: onClose },
      ]} />
  );
}
