import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Button, Empty, F, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { usePalette } from "@/theme/use-palette";

import { BankDetails } from "./bank-details";
import { DraftDate } from "./draft-date";
import { StepFrame } from "./frame";
import { stepLabel, webStep, type StepKey } from "./logic";
import { ButtonRow, ErrorLine, KVCard } from "./parts";
import { StepsLeft, useSaveDraft } from "./save-draft";
import { summaryPairs } from "./sign";
import type { StepProps } from "./step-props";

/** What each step the phone hands to the computer is for (the web step's own purpose line). */
const WHY: Partial<Record<StepKey, string>> = {
  verify: "Confirming each fact the client gave against the record.",
  personal: "The application's own fields: address, height and weight, the SSN and the owner.",
  beneficiaries: "Who is paid, their shares, and the contingent beneficiaries.",
};

const openOnComputer = (caseId: string, web: string, title: string, why: string) =>
  router.push({ pathname: "/computer", params: { path: `/app/applications/${caseId}?step=${web}`, title, why } });

/**
 * A step the board leaves to the computer (decision 6 keeps the deep flow on the phone; these steps
 * are tables and many fields). It says so, opens the exact step on the web (the J2 hand-off), and the
 * agent can still go on through the steps that are on the phone.
 */
export function ComputerStep({ props, step, done }: { props: StepProps; step: StepKey; done: boolean }) {
  const label = stepLabel(step);
  return (
    <StepFrame testID={`app-computer-${step}`} back={props.firstName} onBack={props.leave}
      line={{ left: `${label} · ${props.index + 1} of ${props.total}`, right: props.carrier, total: props.total, current: props.index }}
      bar={(
        <ButtonRow>
          <View style={{ flex: 1 }}><Button label="Back" kind="outline" onPress={props.previous} /></View>
          <View style={{ flex: 1 }}><Button testID="app-computer-next" label="Next" onPress={props.next} /></View>
        </ButtonRow>
      )}>
      <Empty icon={done ? "checkC" : "laptop"} title={done ? `${label} is done` : `${label} is filled on a computer`} body={WHY[step]}
        action={<Button testID="app-computer-open" label="Open on a computer" kind={done ? "outline" : "primary"} icon="laptop" onPress={() => openOnComputer(props.caseView.caseId, webStep(step), label, WHY[step] ?? "")} />} />
    </StepFrame>
  );
}

/** The Payment step: where the money comes from (E2c), then the draft date (E3). */
export function PaymentStep(props: StepProps) {
  const pay = props.attempt.payment;
  // A bank already on file with no day yet resumes on the day.
  const [part, setPart] = useState<"bank" | "draft">(pay?.account?.hasValue && !pay.draftDay ? "draft" : "bank");
  if (part === "draft") return <DraftDate props={{ ...props, previous: () => setPart("bank") }} onBank={() => setPart("bank")} />;
  return <BankDetails props={props} onSaved={() => setPart("draft")} />;
}

/**
 * Review (9 of 10): the summary the client will sign, the disclosures still to be read (the web's
 * Disclosures step, recorded one by one on the computer), and Mark ready — the server's QA check
 * (POST …/transition to ready), refused in its own words. Once ready it goes on to Sign.
 */
export function ReviewStep(props: StepProps) {
  const p = usePalette();
  const { attempt } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = attempt.disclosures.filter((d) => d.status === "required").length;
  const ready = attempt.status !== "draft";
  const draft = useSaveDraft(props);
  const blocked = !ready && draft.left.length > 0;

  async function markReady() {
    setBusy(true);
    setError(null);
    try {
      await props.actions.markReady();
      props.next();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not marked ready. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepFrame testID="app-review" back={props.firstName} onBack={props.leave}
      line={{ left: `Review · ${props.index + 1} of ${props.total}`, right: props.carrier, total: props.total, current: props.index }}
      bar={(
        <ButtonRow>
          {ready
            ? <View style={{ flex: 1 }}><Button label="Back" kind="outline" onPress={props.previous} /></View>
            : <View style={{ flex: 1 }}><Button testID="app-save-draft" label="Save draft" kind="outline" icon="file" busy={draft.busy} onPress={() => void draft.save()} /></View>}
          <View style={{ flex: 1 }}><Button write={!ready} testID="app-review-ready" label={ready ? "Next" : "Mark ready"} busy={busy} disabled={blocked} onPress={ready ? props.next : () => void markReady()} /></View>
        </ButtonRow>
      )}>
      <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 14 }}>
        <KVCard testID="app-review-summary" pairs={summaryPairs(props)} />
        <StepsLeft props={props} left={draft.left} />
        {required ? (
          <View style={{ gap: 6 }}>
            <Text testID="app-review-disclosures" style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>
              {`${required} disclosure${required === 1 ? "" : "s"} still to read and record.`}
            </Text>
            <View style={{ alignItems: "flex-start" }}>
              <TextLink center={false} label="Record them on a computer" onPress={() => openOnComputer(props.caseView.caseId, "disclosures", "Disclosures", "Each notice read aloud or sent, recorded one by one.")} />
            </View>
          </View>
        ) : null}
        <ErrorLine text={error} testID="app-review-error" />
      </View>
    </StepFrame>
  );
}
