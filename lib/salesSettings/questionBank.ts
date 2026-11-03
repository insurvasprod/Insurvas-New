// Settings › Underwriting questions · the question bank (owner pick C, 2026-10-28). Insurvas's recommended
// questions by topic; ticking one adds it (with its follow-ups) to the template being edited, unticking takes
// it out. Pure and client-safe: it only reads and returns a UwDraft, which saves the way every builder edit does.
//
// Keys are chosen so the answers keep working downstream: `height_in`, `weight_lb` and `tobacco` fill the
// application (lib/applications/prefill.ts INTERVIEW_FEEDS); the five persistency questions are the seeded ones
// and are always on.

import { PERSISTENCY_SEED, orderBySection, type UwDraft, type UwQuestion, type UwSection } from "./templateDefinition.ts";

export type BankTopic = { key: string; title: string; note: string; section: UwSection; questions: UwQuestion[] };

const q = (p: Partial<UwQuestion> & Pick<UwQuestion, "key" | "label" | "section">): UwQuestion => ({
  type: "boolean", options: [], help: null, required: true, persistency: false, knockout: null, showWhen: null, appliesTo: "all", ...p,
});
const ko = (note: string) => ({ when: "true" as const, note });
const after = (key: string) => ({ key, equals: "true" });

const HEALTH: UwSection = { key: "health", label: "Health" };
const MEDS: UwSection = { key: "medications", label: "Medications" };
const LIFE: UwSection = { key: "lifestyle", label: "Lifestyle" };
const COVER: UwSection = { key: "coverage", label: "Coverage" };

export const BANK_TOPICS: BankTopic[] = [
  {
    key: "persistency", title: "Keeps the policy on the books", section: { key: "before", label: "Before we start" },
    note: "Not underwriting. Asked on every call by agents who keep their business, so they are always on.",
    questions: PERSISTENCY_SEED.map((x) => ({ ...x, options: [...x.options] })),
  },
  {
    key: "knockouts", title: "Knockouts", section: HEALTH,
    note: "An answer that usually means a decline or a graded rating. The agent sees it the moment it is given.",
    questions: [
      q({ key: "oxygen", label: "Do you use oxygen, or have you in the last 2 years?", section: "health", knockout: ko("Most carriers decline, or offer guaranteed issue only.") }),
      q({ key: "dialysis", label: "Are you on kidney dialysis?", section: "health", knockout: ko("A decline at most carriers.") }),
      q({ key: "cancer_2y", label: "Any cancer in the last 2 years?", section: "health", knockout: ko("Usually graded or declined: ask the follow-ups.") }),
      q({ key: "cancer_2y_when", label: "When was it diagnosed?", section: "health", type: "date", showWhen: after("cancer_2y") }),
      q({ key: "cancer_2y_type", label: "What type of cancer?", section: "health", type: "text", showWhen: after("cancer_2y") }),
      q({ key: "cancer_2y_done", label: "Is the treatment finished?", section: "health", showWhen: after("cancer_2y") }),
      q({ key: "heart_stroke_2y", label: "Heart attack or stroke in the last 2 years?", section: "health", knockout: ko("Graded at most carriers.") }),
      q({ key: "dementia", label: "Alzheimer's or dementia?", section: "health", knockout: ko("A decline at most carriers.") }),
      q({ key: "terminal", label: "Has a doctor said you have less than 2 years to live?", section: "health", knockout: ko("A decline at every carrier.") }),
    ],
  },
  {
    key: "conditions", title: "Conditions", section: HEALTH,
    note: "Common health questions, each with the follow-ups a carrier will want.",
    questions: [
      q({ key: "diabetes", label: "Do you have diabetes?", section: "health" }),
      q({ key: "diabetes_insulin", label: "Do you use insulin?", section: "health", showWhen: after("diabetes") }),
      q({ key: "copd", label: "COPD or emphysema?", section: "health", knockout: ko("Graded at most carriers.") }),
      q({ key: "blood_pressure", label: "High blood pressure?", section: "health", required: false }),
      q({ key: "hospital_12m", label: "In hospital overnight in the last 12 months?", section: "health", required: false }),
      q({ key: "hospital_12m_why", label: "What for?", section: "health", type: "text", showWhen: after("hospital_12m") }),
    ],
  },
  {
    key: "medications", title: "Medications", section: MEDS,
    note: "Name, dose, since and what for: exactly the columns a carrier application asks for.",
    questions: [q({ key: "medications", label: "What medications do you take?", section: "medications", type: "medication_list" })],
  },
  {
    key: "lifestyle", title: "Lifestyle", section: LIFE,
    note: "These fill the application, so the agent does not ask twice.",
    questions: [
      q({ key: "tobacco", label: "Tobacco or nicotine in the last 12 months?", section: "lifestyle", help: "Changes the rate card." }),
      q({ key: "height_in", label: "Height (inches)", section: "lifestyle", type: "number" }),
      q({ key: "weight_lb", label: "Weight (pounds)", section: "lifestyle", type: "number" }),
    ],
  },
  {
    key: "coverage", title: "Coverage", section: COVER,
    note: "How much they want and what they can pay, before the quote.",
    questions: [
      q({ key: "coverage_wanted", label: "How much coverage do you want?", section: "coverage", type: "currency" }),
      q({ key: "monthly_budget", label: "What can you comfortably pay a month?", section: "coverage", type: "currency", required: false }),
    ],
  },
];

const ALL = BANK_TOPICS.flatMap((t) => t.questions.map((x) => ({ topic: t, q: x })));

/** A bank question and the follow-ups (and their follow-ups) that hang off it. */
function withFollowUps(key: string, pool: UwQuestion[]): UwQuestion[] {
  const out: UwQuestion[] = [];
  const walk = (k: string) => {
    for (const x of pool) if (x.showWhen?.key === k && !out.includes(x)) { out.push(x); walk(x.key); }
  };
  const root = pool.find((x) => x.key === key);
  if (root) { out.push(root); walk(key); }
  return out;
}

export const inDraft = (draft: UwDraft, key: string) => draft.questions.some((x) => x.key === key);

/**
 * Add a bank question to the draft, its follow-ups with it, in its topic's section (created if the template has
 * none). A key already in the template is left as it is: the agency may have reworded it.
 */
export function addFromBank(draft: UwDraft, key: string): UwDraft {
  const hit = ALL.find((x) => x.q.key === key);
  if (!hit) return draft;
  const adding = withFollowUps(key, hit.topic.questions).filter((x) => !inDraft(draft, x.key)).map((x) => ({ ...x, options: [...x.options] }));
  if (!adding.length) return draft;
  const sections = draft.sections.some((s) => s.key === hit.topic.section.key) ? draft.sections : [...draft.sections, { ...hit.topic.section }];
  return orderBySection({ sections, questions: [...draft.questions, ...adding] });
}

/** Take a question out, with every follow-up that hangs off it. The five persistency questions stay. */
export function removeFromBank(draft: UwDraft, key: string): UwDraft {
  const target = draft.questions.find((x) => x.key === key);
  if (!target || target.persistency) return draft;
  const gone = new Set(withFollowUps(key, draft.questions).map((x) => x.key));
  return { ...draft, questions: draft.questions.filter((x) => !gone.has(x.key)) };
}

/** A follow-up is shown under its parent in the bank, not ticked on its own. */
export const isBankFollowUp = (x: UwQuestion) => Boolean(x.showWhen);
