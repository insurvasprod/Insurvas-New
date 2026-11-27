import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { isoToUsDate, maskUsDate, usDateToIso } from "@/components/leads/logic";
import { Button, Empty, Field, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { usePalette } from "@/theme/use-palette";

import { enqueue, flushQueue, readQueue } from "./answer-queue";
import { StepFrame } from "./frame";
import { isAnswered, isKnockedOut, NO_MEDICATIONS, numberRangeError, partFlow, pruneHidden, resumeQuestion, stepLabel, type InterviewPart } from "./logic";
import { AnswerCard, ButtonRow, ErrorLine, MiniLine, Question } from "./parts";
import type { StepProps } from "./step-props";
import type { Answers, AnswerValue, InterviewQuestion, InterviewView } from "./types";

const TYPED = new Set<InterviewQuestion["type"]>(["text", "long_text", "number", "date"]);
/** Number questions that are money (income, coverage, net worth…): drawn with a $ and saved without commas. */
const MONEY_KEY = /income|salary|amount|coverage|face|premium|worth|asset|debt|mortgage|budget/i;
const said = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const offline = (e: unknown) => e instanceof ApiError && e.status === 0;

/**
 * Board E2 · one interview step (Eligibility, Health or Medications), one question per screen with big
 * answers. Each answer saves the moment it is given (PUT …/interview, the web's autosave); with no
 * signal it waits on the phone and is sent with the next save that gets through. A follow-up the
 * answer closes takes its answer with it. A dropped call resumes on the first question still
 * unanswered. Medications' last Next marks the whole interview complete (POST …/interview); the server
 * says what is still missing.
 */
export function InterviewStep(props: StepProps & { part: InterviewPart }) {
  const { interview, actions } = props;
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!interview) {
    const open = async () => {
      setOpening(true);
      setError(null);
      try { await actions.startInterview(); } catch (e) { setError(said(e, "The interview could not be opened.")); } finally { setOpening(false); }
    };
    return (
      <StepFrame back={props.firstName} onBack={props.leave} onSteps={props.openSteps}
        line={{ left: stepLabel(props.part), right: `Step ${props.index + 1} of ${props.total} · ${props.carrier}`, total: props.total, current: props.index, onOpen: props.openSteps }}>
        <Empty icon="listCheck" title="The interview isn’t open yet" body="Open it to ask the questions one at a time." action={<Button testID="app-open-interview" label="Open the interview" busy={opening} onPress={() => void open()} />} />
        <View style={{ paddingHorizontal: 16 }}><ErrorLine text={error} /></View>
      </StepFrame>
    );
  }
  // Keyed by the interview, so a re-read after Finish starts from what the server holds.
  return <Questions key={`${interview.id}:${props.part}`} {...props} interview={interview} />;
}

function Questions(props: StepProps & { part: InterviewPart; interview: InterviewView }) {
  const p = usePalette();
  const { interview, actions, caseView, part } = props;
  const meds = interview.medications.length;
  const [answers, setAnswers] = useState<Answers>(interview.answers);
  const [index, setIndex] = useState(() => resumeQuestion(partFlow(interview.questions, interview.answers, part), interview.answers, meds));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const caseId = caseView.caseId;
  const alive = useRef(true);
  const save = useRef(actions.saveAnswers);
  useEffect(() => { save.current = actions.saveAnswers; });

  // Answers still on the phone from a dropped signal: shown at once, sent as soon as a save gets through.
  useEffect(() => {
    alive.current = true;
    void readQueue(caseId).then((queued) => {
      if (!alive.current || !queued.length) return;
      setAnswers((now) => {
        let next = { ...now };
        for (const q of queued) next = pruneHidden(interview.questions, { ...next, [q.key]: { ...next[q.key], value: q.value } }).answers;
        return next;
      });
      void flushQueue(caseId, (q) => save.current([{ key: q.key, value: q.value }], q.hidden)).then((left) => { if (alive.current && left) setSaving("queued"); });
    });
    return () => { alive.current = false; };
  }, [caseId, interview.questions]);

  const flow = partFlow(interview.questions, answers, part);
  const at = Math.min(index, Math.max(0, flow.length - 1));
  const q = flow[at];
  const value = q ? answers[q.key]?.value : undefined;
  const last = at >= flow.length - 1;
  const finishes = part === "medications";

  async function answer(question: InterviewQuestion, next: AnswerValue) {
    const pruned = pruneHidden(interview.questions, { ...answers, [question.key]: { ...answers[question.key], value: next } });
    setAnswers(pruned.answers);
    setSaving("saving");
    setError(null);
    try {
      // What waited for a signal goes first, so the server sees the answers in the order given.
      const left = await flushQueue(caseId, (x) => actions.saveAnswers([{ key: x.key, value: x.value }], x.hidden));
      if (left) throw new ApiError(0, {});
      await actions.saveAnswers([{ key: question.key, value: next }], pruned.hidden);
      setSaving("saved");
    } catch (e) {
      if (offline(e)) {
        await enqueue(caseId, { key: question.key, value: next, hidden: pruned.hidden });
        setSaving("queued");
        return;
      }
      // A refusal: what was given stays on screen; the next answer or Next tries again.
      setSaving("idle");
      setError(said(e, "Not saved. Check your signal, then answer again."));
    }
  }

  /** A typed answer is saved when the agent moves on, as a number or a date where the question asks for one. */
  async function saveTyped(question: InterviewQuestion): Promise<boolean> {
    const raw = typed[question.key];
    if (raw === undefined) return true;
    // Money is typed with commas and a $ if the agent likes; dates the US way (the field adds the slashes).
    const clean = question.type === "number" ? raw.replace(/[$,\s]/g, "") : raw.trim();
    if (question.type === "number" && clean && !Number.isFinite(Number(clean))) { setError("Type a number."); return false; }
    const outOfRange = question.type === "number" && clean ? numberRangeError(question.key, Number(clean)) : null;
    if (outOfRange) { setError(outOfRange); return false; }
    const iso = question.type === "date" && clean ? usDateToIso(clean) : null;
    if (question.type === "date" && clean && !iso) { setError("Type the date as MM/DD/YYYY."); return false; }
    const next: AnswerValue = !clean ? null : question.type === "number" ? Number(clean) : question.type === "date" ? iso : clean;
    if (String(next ?? "") === String(answers[question.key]?.value ?? "")) return true;
    await answer(question, next);
    return true;
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const left = await flushQueue(caseId, (x) => actions.saveAnswers([{ key: x.key, value: x.value }], x.hidden));
      if (left) { setError("Some answers are still on this phone. Finish the interview when you’re back online."); return; }
      await actions.completeInterview();
      props.next();
    } catch (e) {
      setError(said(e, "The interview could not be finished."));
    } finally {
      setFinishing(false);
    }
  }

  async function goNext() {
    if (q && TYPED.has(q.type) && !(await saveTyped(q))) return;
    if (q && !last) { setIndex(at + 1); setSaving("idle"); return; }
    if (finishes) { await finish(); return; }
    props.next();
  }

  async function goBack() {
    if (q && TYPED.has(q.type)) await saveTyped(q);
    if (at === 0) props.previous();
    else { setIndex(at - 1); setSaving("idle"); }
  }

  const required = Boolean(q?.required) && !isAnswered(q, TYPED.has(q.type) ? (typed[q.key] ?? value) : value, meds);
  // Board E2: "Health · 3 of 7 ˅" on the left (the step and the question in it), "Step 5 of 10 · American Amicable" on the right.
  const line = { left: q ? `${stepLabel(part)} · ${at + 1} of ${flow.length}` : stepLabel(part), right: `Step ${props.index + 1} of ${props.total} · ${props.carrier}`, total: props.total, current: props.index, onOpen: props.openSteps };
  const nextLabel = !q || last ? (finishes ? "Finish interview" : "Next") : "Next question";

  return (
    <StepFrame testID={`app-interview-${part}`} back={props.firstName} onBack={props.leave} onSteps={props.openSteps} line={line}
      bar={(
        <ButtonRow>
          <View style={{ flex: 1 }}><Button testID="app-q-back" label="Back" kind="outline" onPress={() => void goBack()} /></View>
          <View style={{ flex: 1 }}><Button testID="app-q-next" label={nextLabel} busy={finishing} disabled={required} onPress={() => void goNext()} /></View>
        </ButtonRow>
      )}>
      {!q ? (
        <Empty icon="listCheck" title={`No ${stepLabel(part).toLowerCase()} questions`}
          body={finishes ? "Finish the interview to go on." : "This interview’s template asks none here. Go on to the next step."} />
      ) : (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 16 }}>
          <MiniLine>Read it exactly as written</MiniLine>
          <Question>{q.label}</Question>
          <View style={{ gap: 10, marginTop: 6 }}>
            <Answer q={q} value={value} medicationCount={meds} typed={typed[q.key]} caseId={caseId}
              onPick={(v) => void answer(q, v)} onType={(t) => setTyped((s) => ({ ...s, [q.key]: t }))} />
          </View>
          {isKnockedOut(q, value) && q.knockout ? <MiniLine icon="triangle" color={p.bad} testID="app-q-knockout">{q.knockout.note}</MiniLine> : null}
          {q.help ? <MiniLine icon="help">{q.help}</MiniLine> : null}
          {saving === "saved" ? <MiniLine icon="check" testID="app-q-saved">Saved · a dropped call resumes here</MiniLine>
            : saving === "queued" ? <MiniLine icon="clock" testID="app-q-queued">Saved on this phone · sends when you’re back online</MiniLine>
            : saving === "saving" ? <MiniLine icon="clock">Saving…</MiniLine> : null}
          <ErrorLine text={error} testID="app-q-error" />
        </View>
      )}
      {!q ? <View style={{ paddingHorizontal: 16 }}><ErrorLine text={error} testID="app-q-error" /></View> : null}
    </StepFrame>
  );
}

/** The answers a question takes: Yes / No, its options, several options, a typed value, or the medicines. */
function Answer({ q, value, medicationCount, typed, caseId, onPick, onType }: {
  q: InterviewQuestion; value: AnswerValue | undefined; medicationCount: number; typed: string | undefined; caseId: string;
  onPick: (v: AnswerValue) => void; onType: (t: string) => void;
}) {
  const bad = (v: AnswerValue) => (isKnockedOut(q, v) ? "bad" as const : undefined);
  switch (q.type) {
    case "boolean":
      return <>{[true, false].map((v) => <AnswerCard key={String(v)} testID={`app-a-${v ? "yes" : "no"}`} label={v ? "Yes" : "No"} selected={value === v} tone={bad(v)} onPress={() => onPick(v)} />)}</>;
    case "single_select":
      return <>{(q.options ?? []).map((o) => <AnswerCard key={o} label={o} selected={value === o} tone={bad(o)} onPress={() => onPick(o)} />)}</>;
    case "multi_select": {
      const picked = Array.isArray(value) ? value : [];
      return <>{(q.options ?? []).map((o) => <AnswerCard key={o} multi label={o} selected={picked.includes(o)} onPress={() => onPick(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])} />)}</>;
    }
    case "medication_list":
      return (
        <>
          {medicationCount > 0
            ? <MiniLine icon="checkC">{`${medicationCount} medicine${medicationCount === 1 ? "" : "s"} listed`}</MiniLine>
            : <AnswerCard label="Takes no medicines" selected={value === NO_MEDICATIONS} onPress={() => onPick(value === NO_MEDICATIONS ? null : NO_MEDICATIONS)} />}
          {/* The medicine list (name, dose, what it's for) is a table; it is filled on the web. */}
          <View style={{ alignItems: "flex-start", paddingTop: 4 }}>
            <TextLink center={false} label="List the medicines on a computer" onPress={() => router.push({ pathname: "/computer", params: { path: `/app/applications/${caseId}?step=interview`, title: "The medicine list", why: "Each medicine has a dose, a start date and what it is for." } })} />
          </View>
        </>
      );
    default: {
      const date = q.type === "date";
      const shown = typed ?? (value === null || value === undefined ? "" : date ? isoToUsDate(value) : String(value));
      const height = q.type === "number" && /height/.test(q.key);
      // A money question reads as money: a $ before the figure and "Amount" rather than "Answer".
      const money = q.type === "number" && MONEY_KEY.test(q.key);
      return (
        <Field testID="app-a-typed" label={date ? "Date" : height ? "Height in inches" : money ? "Amount" : "Answer"} value={shown}
          onChangeText={(t) => onType(date ? maskUsDate(t) : t)} leadIcon={money ? "dollar" : undefined} maxLength={date ? 10 : undefined}
          placeholder={date ? "MM/DD/YYYY" : undefined} keyboardType={q.type === "number" ? "decimal-pad" : date ? "number-pad" : "default"}
          multiline={q.type === "long_text"} />
      );
    }
  }
}
