import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { deviceZone, zoneShort } from "@/components/calls/time";
import { Button, Empty, F, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { usePalette } from "@/theme/use-palette";

import { StepFrame } from "./frame";
import { beneficiaryLine, dateWords, face, insuredName, nextDraftDate, premium, submittedStatus, tierLabel, todayKey } from "./logic";
import { ErrorLine, KVCard } from "./parts";
import { StepsLeft, useSaveDraft } from "./save-draft";
import { SignaturePad, type Stroke } from "./signature-pad";
import type { StepProps } from "./step-props";

/** "24 Nov 2026, 2:46 pm ET" in the phone's own clock and zone. */
export function signedLine(d: Date): string {
  const zone = deviceZone();
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()} ${zoneShort(zone, d)}`;
}

/**
 * The summary the client reads before signing (board E4): Insured, Plan, Coverage, Monthly, First
 * draft, Beneficiary — each from the attempt as saved; a fact not saved yet is left out. The first
 * draft is the next date the saved draft day comes round.
 */
export function summaryPairs({ attempt, caseView }: Pick<StepProps, "attempt" | "caseView">, today = todayKey()): [string, string][] {
  const quote = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId) ?? null;
  const pairs: [string, string][] = [["Insured", insuredName(attempt, caseView.clientName)]];
  if (attempt.productLabel || quote) pairs.push(["Plan", [quote?.productLabel ?? attempt.productLabel, tierLabel(quote?.tier ?? attempt.tier)].filter(Boolean).join(" · ")]);
  if (quote) pairs.push(["Coverage", face(quote.faceAmountCents)], ["Monthly", premium(quote.monthlyPremiumCents)]);
  if (attempt.payment?.draftDay) pairs.push(["First draft", dateWords(nextDraftDate(attempt.payment.draftDay, today))]);
  const ben = beneficiaryLine(attempt);
  if (ben) pairs.push(["Beneficiary", ben]);
  return pairs;
}

/**
 * Board E4 · sign and submit, in person: the client reads the summary, signs on the glass, and the
 * agent submits. Submit marks the application ready if Review has not (the server's QA check, POST
 * …/transition — its refusal comes back in its own words) and records the submission (POST
 * …/submissions), as the web's Review and Record do. The server keeps no signature image: what is
 * recorded is that the client signed on this phone, and when, in the submission's notes. A phone sale
 * skips the glass for the carrier's own e-sign, which the carrier's site sends (Insurvas has no e-sign
 * service of its own to send it from).
 */
export function SignStep(props: StepProps) {
  const p = usePalette();
  const { attempt, caseView } = props;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [signedAt, setSignedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = props.firstName;
  const carrier = attempt.carrierName ?? "the carrier";
  const line = { left: `Sign · ${props.index + 1} of ${props.total}`, right: props.carrier, total: props.total, current: props.index };
  const draft = useSaveDraft(props);

  if (submittedStatus(attempt.status)) {
    const last = [...attempt.submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return (
      <StepFrame testID="app-submitted" back={first} onBack={props.leave} line={line}
        bar={<Button testID="app-open-case" label="Open the case" icon="fileCheck" onPress={() => router.replace({ pathname: "/cases/[caseId]", params: { caseId: caseView.caseId } } as never)} />}>
        <Empty icon="checkC" title={`Submitted to ${carrier}`} body={last ? `Recorded ${signedLine(new Date(last.submittedAt))}. Requirements and the carrier’s answer arrive on the case.` : "Requirements and the carrier’s answer arrive on the case."} />
      </StepFrame>
    );
  }

  const gate = caseView.submitGate && !caseView.submitGate.canSubmit ? caseView.submitGate.reason ?? "You can’t submit this application." : null;

  // A step before Review still open: nothing to sign yet. The draft is saved and finished elsewhere.
  if (draft.left.length) {
    return (
      <StepFrame testID="app-sign-blocked" back={props.firstName} onBack={props.leave} line={line}
        bar={<Button testID="app-save-draft" label="Save draft" icon="file" busy={draft.busy} onPress={() => void draft.save()} />}>
        <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 14 }}>
          <KVCard testID="app-sign-summary" pairs={summaryPairs(props)} />
          <StepsLeft props={props} left={draft.left} />
        </View>
      </StepFrame>
    );
  }

  async function submit() {
    if (!signedAt) return;
    setBusy(true);
    setError(null);
    try {
      if (attempt.status === "draft") await props.actions.markReady();
      await props.actions.recordSubmission({ submittedAt: new Date().toISOString(), notes: `The client signed on the agent's phone at ${signedAt.toISOString()}.` });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not submitted. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const portal = attempt.carrierPortalUrl;
  return (
    <StepFrame testID="app-sign" back={props.firstName} onBack={props.leave} line={line}
      bar={(
        <>
          <Button write testID="app-submit" label={`Submit to ${carrier}`} icon="send" busy={busy} disabled={!signedAt || Boolean(gate)} onPress={() => void submit()} />
          {portal ? <View style={{ padding: 4 }}><TextLink label="Send the carrier’s e-sign link instead" onPress={() => void WebBrowser.openBrowserAsync(portal)} /></View> : null}
        </>
      )}>
      <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 14 }}>
        <KVCard testID="app-sign-summary" pairs={summaryPairs(props)} />
        <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{`By signing, ${first} confirms the answers were read to them and are true, and agrees to the carrier’s terms and the HIPAA authorization.`}</Text>
        <SignaturePad testID="app-sign-pad" strokes={strokes} onChange={(next) => { setStrokes(next); if (!signedAt) setSignedAt(new Date()); }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ flexShrink: 1, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{signedAt ? `Signed on this phone · ${signedLine(signedAt)}` : `${first} signs above with a finger`}</Text>
          {strokes.length ? (
            <Pressable testID="app-sign-clear" accessibilityRole="button" accessibilityLabel="Clear the signature" hitSlop={8} onPress={() => { setStrokes([]); setSignedAt(null); }}>
              <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk }}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <ErrorLine text={gate ?? error} testID="app-sign-error" />
      </View>
    </StepFrame>
  );
}
