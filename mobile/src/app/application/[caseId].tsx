import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InterviewStep } from "@/components/applications/interview";
import { face, insuredName, isInterviewPart, partFlow, phoneStep, premium, resumeQuestion, STEPS, stepStates, type StepKey } from "@/components/applications/logic";
import { ComputerStep, PaymentStep, ReviewStep } from "@/components/applications/other-steps";
import { QuoteStep } from "@/components/applications/quote";
import { SignStep } from "@/components/applications/sign";
import type { StepProps } from "@/components/applications/step-props";
import { StepsSheet } from "@/components/applications/steps-sheet";
import { useCase } from "@/components/applications/use-case";
import { Empty, Failed, Header, Loading } from "@/components/ui";
import { firstName } from "@/lib/format";
import { usePalette } from "@/theme/use-palette";

/**
 * Boards E2 · E2b · E2c · E3 · E4 — one application, one step at a time (?step=, the board's ten:
 * Verify, Quote, Eligibility, Personal details, Health, Medications, Beneficiary, Payment, Review,
 * Sign; the web's own step names still open the step that holds them). With no step it opens where the
 * case stopped: the first step not finished. The phone fills the quote, the three interview steps, the
 * payment, review and sign; Verify, Personal details and Beneficiary open the exact step on the
 * computer. Quick quote's pick arrives as ?carrier=&tier=&face=. Everything is the case as GET
 * /api/app/applications/cases/:id sends it.
 */
export default function ApplicationScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { caseId, step, carrier, tier, face: pickFace } = useLocalSearchParams<{ caseId: string; step?: string; carrier?: string; tier?: string; face?: string }>();
  const h = useCase(caseId);
  const [sheet, setSheet] = useState(false);
  const c = h.caseView;
  const a = h.attempt;
  const leave = () => (router.canGoBack() ? router.back() : /* typed routes list it as /application/index */ router.replace("/application" as never));

  if (!c || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header title="Application" large={false} back="Back" onBack={leave} />
        {h.loading && !c ? <View testID="app-loading" style={{ paddingTop: 8 }}><Loading rows={4} /></View>
          : h.error && !c ? (h.errorCode?.status === 404 || h.errorCode?.status === 403
            ? <Empty icon="lock" title="This application isn’t yours to open" body="It may be with another producer now." />
            : <Failed what="this application" message={h.error} onRetry={h.reload} />)
          : <Empty icon="filePen" title="No application on this case yet" body="Start one from the lead." />}
      </View>
    );
  }

  const interview = h.interview;
  const current: StepKey = phoneStep(step, c, a, interview);
  const index = STEPS.findIndex((s) => s.key === current);
  const states = stepStates(c, a, interview, current);
  const goTo = (k: StepKey) => { setSheet(false); router.setParams({ step: k }); };
  const first = firstName(insuredName(a, c.clientName));
  const quote = a.quotes.find((q) => q.id === a.selectedQuoteId) ?? null;
  const faceCents = Number(pickFace);

  const props: StepProps = {
    caseView: c, attempt: a, interview, actions: h.actions,
    carrier: a.carrierName ?? a.productLabel ?? "No carrier yet", firstName: first,
    index, total: STEPS.length, leave, goTo,
    next: () => goTo(STEPS[Math.min(index + 1, STEPS.length - 1)].key),
    previous: () => (index === 0 ? leave() : goTo(STEPS[index - 1].key)),
    openSteps: () => setSheet(true),
    pick: carrier || tier || pickFace ? { carrierId: carrier ?? null, tier: tier ?? null, faceCents: Number.isFinite(faceCents) && faceCents > 0 ? faceCents : null } : undefined,
  };

  /** Each step's second line on the sheet (E2b): "Done", the quote, or "Now · 3 of 7" on the question in hand. */
  const metaFor = (k: StepKey, s: { state: string; done: boolean }) => {
    if (k === "quote" && quote) return `${face(quote.faceAmountCents)} · ${premium(quote.monthlyPremiumCents)}`;
    if (s.state === "now" && isInterviewPart(k) && interview && !s.done) {
      const flow = partFlow(interview.questions, interview.answers, k);
      if (flow.length) return `Now · ${resumeQuestion(flow, interview.answers, interview.medications.length) + 1} of ${flow.length}`;
    }
    return s.done ? "Done" : null;
  };

  // Keyed by step and attempt: a step's typed state never follows the agent to another one.
  const key = `${current}:${a.id}`;
  const body = isInterviewPart(current) ? <InterviewStep key={key} {...props} part={current} />
    : current === "quote" ? <QuoteStep key={key} {...props} />
    : current === "payment" ? <PaymentStep key={key} {...props} />
    : current === "review" ? <ReviewStep key={key} {...props} />
    : current === "submit" ? <SignStep key={key} {...props} />
    : <ComputerStep key={key} props={props} step={current} done={states[index].done} />;

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas }}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      <StepsSheet visible={sheet} title={[first, a.carrierName].filter(Boolean).join(" · ")} steps={states} metaFor={metaFor} onPick={goTo} onClose={() => setSheet(false)} />
    </View>
  );
}
