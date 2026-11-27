import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceChips, Sheet } from "@/components/leads/sheets";
import { Button, Chip, F, Field, Group, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { StepFrame } from "./frame";
import { dateWords, dobDay, draftChoices, draftInputs, INCOME_LABEL, nextDraftDate, ordinal, pickableDates, todayKey } from "./logic";
import { ErrorLine, Question } from "./parts";
import type { StepProps } from "./step-props";
import type { DraftRecommendation, IncomeType } from "./types";

/** The income types the phone can schedule; a paycheck needs its frequency and a payday, set on the web. */
const PHONE_INCOME: IncomeType[] = ["ssa", "ssi", "ssa_ssi", "va", "pension", "none"];

/**
 * Board E3 · when the first draft comes out, as dates: the optimiser's days (POST
 * /api/app/draft-dates/recommend — a calculation, nothing saved) shown on the date each first comes
 * round, measured against the client's own deposits ("2 days after the deposit · usually clears"), the
 * deposit day itself offered as Risky, and any other date. The carrier drafts on that day of the month,
 * every month. A day other than the recommendation needs a reason: the server refuses it without one
 * and keeps the overrides. Saves with PUT …/draft-day. The income question shows only while the
 * payment does not say where the money comes from.
 */
export function DraftDate({ props, onBank }: { props: StepProps; onBank: () => void }) {
  const p = usePalette();
  const pay = props.attempt.payment;
  const today = todayKey();
  const [income, setIncome] = useState<IncomeType | null>(pay?.incomeType ?? null);
  const [dayText, setDayText] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [reason, setReason] = useState(pay?.draftOverrideReason ?? "");
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = income && income === pay?.incomeType ? pay.incomeInputs : {};
  const inputs = income ? draftInputs(income, stored, dobDay(props.attempt)) : {};
  // A day typed here (born on / pension paid on) wins over the stored one.
  if (income === "ssa" && dayText.birthDay) inputs.birthDay = Number(dayText.birthDay) || undefined;
  if (income === "pension" && dayText.pensionDay) inputs.pensionDay = Number(dayText.pensionDay) || undefined;
  const rec = useLoad<DraftRecommendation | null>(() => (income && income !== "payroll" ? props.actions.recommend(income, inputs) : Promise.resolve(null)), [income, inputs]);
  const r = rec.data && !rec.loading ? rec.data : null;
  const best = r && r.kind !== "not_applicable" ? r.recommended.day : null;
  const choices = draftChoices(r, today);
  const day = picked ?? pay?.draftDay ?? best;
  const date = day ? choices.find((c) => c.day === day)?.date ?? nextDraftDate(day, today) : null;
  // Only a real schedule recommends; the "income unknown" middle-of-month guess is not one to override.
  const needsReason = r?.kind === "recommended" && day !== null && day !== best;
  const first = props.firstName;

  async function save() {
    if (!income || day === null) return;
    if (needsReason && reason.trim().length < 3) { setError(`Say why the ${ordinal(day)} and not the ${ordinal(best ?? 0)}.`); return; }
    setBusy(true);
    setError(null);
    try {
      await props.actions.saveDraftDay({ day, incomeType: income, incomeInputs: inputs, overrideReason: needsReason ? reason.trim() : null });
      props.next();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const sub = r ? (r.kind === "not_applicable" ? r.why : r.kind === "recommended" ? `${r.schedule}. Drafts two days after a deposit clear most often.` : `${r.schedule}.`)
    : rec.error && income ? "The recommendation isn’t available, so pick the date yourself." : null;
  const bankLine = pay?.account?.hasValue ? [pay.bankName, pay.accountType, pay.account.masked].filter(Boolean).join(" · ") : null;
  const otherPicked = Boolean(day && !choices.some((c) => c.day === day));

  return (
    <StepFrame testID="app-draft" back={props.firstName} onBack={props.leave}
      line={{ left: `Payment · ${props.index + 1} of ${props.total}`, right: props.carrier, total: props.total, current: props.index }}
      bar={<Button write testID="app-draft-use" label={date ? `Use ${dateWords(date)}` : "Pick a date"} busy={busy} disabled={!income || day === null} onPress={() => void save()} />}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <Question bold>When should the first draft come out?</Question>
        {sub ? <Text testID="app-draft-why" style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted }}>{sub}</Text> : null}
      </View>

      {!pay?.incomeType || income !== pay.incomeType ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 10 }}>
          <Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{`Where does ${first}’s money come from?`}</Text>
          <ChoiceChips testID="app-draft-income" items={PHONE_INCOME.map((k) => ({ key: k, label: INCOME_LABEL[k] }))} value={income} onChange={(k) => { setIncome(k as IncomeType | null); setPicked(null); }} />
          {income === "ssa" && !dobDay(props.attempt) ? <Field label="Day of the month they were born" keyboardType="number-pad" value={dayText.birthDay ?? ""} onChangeText={(t) => setDayText((s) => ({ ...s, birthDay: t }))} /> : null}
          {income === "pension" ? <Field label="Day of the month the pension is paid" keyboardType="number-pad" value={dayText.pensionDay ?? String(pay?.incomeInputs.pensionDay ?? "")} onChangeText={(t) => setDayText((s) => ({ ...s, pensionDay: t }))} /> : null}
        </View>
      ) : null}

      {choices.length ? (
        <Group title="Best days">
          {choices.map((c, i) => (
            <Row key={c.day} testID={`app-draft-day-${c.day}`} first={i === 0} icon={day === c.day ? "calCheck" : "calendar"} iconTone={day === c.day ? undefined : "plain"}
              title={dateWords(c.date)} meta={c.meta} selected={day === c.day} chevron={false}
              chip={c.best ? <Chip tone="ok">Best</Chip> : c.risky ? <Chip tone="warn">Risky</Chip> : null} onPress={() => setPicked(c.day)} />
          ))}
        </Group>
      ) : null}
      {income ? (
        <Group title="Or">
          <Row first icon="calendar" iconTone="plain" title={otherPicked && date ? dateWords(date) : "Pick another date"} chevron
            selected={otherPicked && choices.length > 0} onPress={() => setOther(true)} testID="app-draft-other" />
        </Group>
      ) : null}

      <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 12 }}>
        {needsReason ? <Field testID="app-draft-reason" label={`Why the ${ordinal(day ?? 0)}?`} value={reason} onChangeText={setReason} hint="Kept with the application; the recommendation was the safest day." /> : null}
        {bankLine ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Bank: ${bankLine}. Change it`} onPress={onBank}>
            <View pointerEvents="none"><Field label="Bank" value={bankLine} editable={false} trailIcon="checkC" /></View>
          </Pressable>
        ) : null}
        {income === "payroll" ? <Button small kind="plain" label="Paid by paycheck? Set paydays on a computer" onPress={() => router.push({ pathname: "/computer", params: { path: `/app/applications/${props.caseView.caseId}?step=payment`, title: "Payday schedule", why: "A paycheck schedule needs how often and one recent payday." } })} /> : null}
        <ErrorLine text={error} testID="app-draft-error" />
      </View>

      <Sheet visible={other} title="Pick another date" onClose={() => setOther(false)}
        footer={<Button label={date ? `Use ${dateWords(date)}` : "Use this date"} onPress={() => setOther(false)} />}>
        <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted, marginBottom: 12 }}>The carrier drafts on this day of the month, every month. Carriers draft up to the 28th.</Text>
        <ChoiceChips testID="app-draft-dates" items={pickableDates(today).map((k) => ({ key: k, label: dateWords(k) }))} value={date}
          onChange={(k) => setPicked(k ? Number(k.slice(8, 10)) : null)} />
      </Sheet>
    </StepFrame>
  );
}
