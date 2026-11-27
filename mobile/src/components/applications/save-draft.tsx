import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { Chip, F, Row } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { flushQueue } from "./answer-queue";
import { continuePath, isComputerStep, stepLabel, stepsLeft, webStep, type StepKey } from "./logic";
import type { StepProps } from "./step-props";

/**
 * Save draft: everything typed on the phone is already saved as it is given (each answer, the quote, the
 * bank and the draft day), so saving the draft sends any answer still waiting for signal and then says
 * where to pick it up — the exact web step to continue on, which shows everything filled on the phone.
 * The application stays a draft; nothing is marked ready.
 */
export function useSaveDraft(props: StepProps) {
  const [busy, setBusy] = useState(false);
  const { caseView: c, attempt: a, interview } = props;
  const left = stepsLeft(c, a, interview);
  async function save() {
    setBusy(true);
    let waiting = 0;
    try {
      waiting = await flushQueue(c.caseId, (x) => props.actions.saveAnswers([{ key: x.key, value: x.value }], x.hidden));
    } catch {
      // The answers stay queued; the app's outbox sends them when the signal is back.
      waiting = 1;
    } finally {
      setBusy(false);
    }
    const names = left.map(stepLabel);
    router.push({
      pathname: "/computer",
      params: {
        path: continuePath(c.caseId, left),
        title: "Draft saved",
        saved: "1",
        why: [
          `${props.firstName}’s application is saved as a draft.`,
          names.length ? `Still to finish: ${names.join(", ")}.` : "Every step is filled; mark it ready on Review.",
          "Open it on a computer and everything filled on the phone is already there.",
          waiting ? "Some answers are waiting for signal and send on their own." : "",
        ].filter(Boolean).join(" "),
      },
    });
  }
  return { left, busy, save };
}

/**
 * The steps still to finish before Mark ready, each one tap away: a computer step opens that exact step
 * on the web (the J2 hand-off), a phone step goes there.
 */
export function StepsLeft({ props, left }: { props: StepProps; left: StepKey[] }) {
  const p = usePalette();
  if (!left.length) return null;
  const open = (k: StepKey) => (isComputerStep(k)
    ? router.push({ pathname: "/computer", params: { path: `/app/applications/${props.caseView.caseId}?step=${webStep(k)}`, title: stepLabel(k), why: "This step is filled on a computer." } })
    : props.goTo(k));
  return (
    <View testID="app-steps-left" style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>
        {`Finish ${left.length === 1 ? "this step" : `these ${left.length} steps`} to mark it ready`}
      </Text>
      <View style={{ backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16, overflow: "hidden" }}>
        {left.map((k, i) => (
          <Row key={k} testID={`app-left-${k}`} first={i === 0} title={stepLabel(k)}
            lead={<Icon name={isComputerStep(k) ? "laptop" : "smartphone"} size={18} color={p.muted} />}
            chip={<Chip tone={isComputerStep(k) ? "neutral" : "brand"}>{isComputerStep(k) ? "On a computer" : "On the phone"}</Chip>}
            onPress={() => open(k)} />
        ))}
      </View>
    </View>
  );
}
