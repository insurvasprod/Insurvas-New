import { CONDITION_TYPES, type AssignmentRule, type ConditionType, type MatchType, type PreviewRow, type RuleCondition, type RuleStrategy } from "@/lib/assignment/constants";

export const splitList = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
export const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** One extra AND-condition on a rule, as the editor holds it. */
export type ConditionDraft = {
  key: string;
  type: ConditionType;
  listText: string;
  campaignIds: string[];
  licensedOnly: boolean;
};

export type RuleDraft = {
  key: string;
  id?: string;
  matchType: MatchType;
  seconds: string;
  listText: string;
  campaignIds: string[];
  licensedOnly: boolean;
  assigneeIds: string[];
  strategy: RuleStrategy;
  conditions: ConditionDraft[];
};

export type PreviewState = { rows: PreviewRow[] | null; pending: boolean; loading: boolean; error: string | null };

export function listOf(values: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = values[key];
    if (Array.isArray(value) && value.length) return value.map((item) => String(item));
  }
  return [];
}

export function draftFromRule(rule: AssignmentRule): RuleDraft {
  const values = rule.match_values ?? {};
  const listText = rule.match_type === "language" ? listOf(values, "languages", "values").join(", ")
    : rule.match_type === "product" ? listOf(values, "products", "product_codes", "values").join(", ")
    : rule.match_type === "state" ? listOf(values, "states", "values").join(", ")
    : "";
  return {
    key: rule.id,
    id: rule.id,
    matchType: rule.match_type,
    seconds: typeof values.seconds === "number" ? String(values.seconds) : "60",
    listText,
    campaignIds: rule.match_type === "campaign" ? listOf(values, "campaign_ids", "values") : [],
    licensedOnly: values.licensed_only === true,
    assigneeIds: rule.assignee_ids ?? [],
    strategy: rule.strategy === "least_loaded" ? "least_loaded" : "round_robin",
    conditions: (rule.conditions ?? []).filter((condition) => CONDITION_TYPES.includes(condition.match_type)).map((condition, index) => conditionDraftFrom(condition, `${rule.id}-c${index}`)),
  };
}

export function conditionDraftFrom(condition: RuleCondition, key: string): ConditionDraft {
  const values = condition.match_values ?? {};
  return {
    key,
    type: condition.match_type,
    listText: condition.match_type === "language" ? listOf(values, "languages", "values").join(", ")
      : condition.match_type === "product" ? listOf(values, "products", "product_codes", "values").join(", ")
      : condition.match_type === "state" ? listOf(values, "states", "values").join(", ")
      : "",
    campaignIds: condition.match_type === "campaign" ? listOf(values, "campaign_ids", "values") : [],
    licensedOnly: values.licensed_only === true,
  };
}

export function conditionValuesOf(condition: ConditionDraft): RuleCondition {
  switch (condition.type) {
    case "language": return { match_type: "language", match_values: { languages: splitList(condition.listText).map((value) => value.toLowerCase()) } };
    case "product": return { match_type: "product", match_values: condition.licensedOnly ? { products: splitList(condition.listText).map((value) => value.toLowerCase()), licensed_only: true } : { products: splitList(condition.listText).map((value) => value.toLowerCase()) } };
    case "state": return { match_type: "state", match_values: { states: splitList(condition.listText).map((value) => value.toUpperCase()) } };
    default: return { match_type: "campaign", match_values: { campaign_ids: condition.campaignIds } };
  }
}

export function conditionProblem(condition: ConditionDraft): string | null {
  switch (condition.type) {
    case "language": return splitList(condition.listText).length ? null : "Add at least one language to the extra condition.";
    case "product": return splitList(condition.listText).length ? null : "Add at least one product code to the extra condition.";
    case "state": {
      const states = splitList(condition.listText);
      if (!states.length) return "Add at least one state to the extra condition.";
      return states.every((state) => /^[A-Za-z]{2}$/.test(state)) ? null : "Use two-letter state codes in the extra condition, such as TX, NM.";
    }
    default: return condition.campaignIds.length ? null : "Pick at least one campaign for the extra condition.";
  }
}

/** A fallback matches every lead, so it is kept after every other rule (the database does the same). */
export function pinFallbacks(drafts: RuleDraft[]) {
  return [...drafts.filter((draft) => draft.matchType !== "fallback"), ...drafts.filter((draft) => draft.matchType === "fallback")];
}

export function matchValuesOf(draft: RuleDraft): Record<string, unknown> {
  switch (draft.matchType) {
    case "realtime": return { seconds: Number(draft.seconds) };
    case "language": return { languages: splitList(draft.listText).map((value) => value.toLowerCase()) };
    case "product": return draft.licensedOnly ? { products: splitList(draft.listText).map((value) => value.toLowerCase()), licensed_only: true } : { products: splitList(draft.listText).map((value) => value.toLowerCase()) };
    case "state": return { states: splitList(draft.listText).map((value) => value.toUpperCase()) };
    case "campaign": return { campaign_ids: draft.campaignIds };
    default: return {};
  }
}

export function draftProblem(draft: RuleDraft): string | null {
  const own = ownProblem(draft);
  if (own) return own;
  if (draft.matchType === "fallback") return null;
  for (const condition of draft.conditions) {
    const problem = conditionProblem(condition);
    if (problem) return problem;
  }
  return null;
}

export function ownProblem(draft: RuleDraft): string | null {
  switch (draft.matchType) {
    case "realtime": {
      const seconds = Number(draft.seconds);
      return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? null : "Enter a number of seconds from 1 to 86,400.";
    }
    case "language": return splitList(draft.listText).length ? null : "Add at least one language.";
    case "product": return splitList(draft.listText).length ? null : "Add at least one product code.";
    case "state": {
      const states = splitList(draft.listText);
      if (!states.length) return "Add at least one state.";
      return states.every((state) => /^[A-Za-z]{2}$/.test(state)) ? null : "Use two-letter state codes, such as TX, NM.";
    }
    case "campaign": return draft.campaignIds.length ? null : "Pick at least one campaign.";
    default: return null;
  }
}

export async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

export async function fetchPreview(): Promise<PreviewState> {
  try {
    const response = await fetch("/api/app/assignments?view=preview", { cache: "no-store" });
    const body = await readJson(response);
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not preview routing");
    return { rows: Array.isArray(body?.rows) ? body.rows as PreviewRow[] : null, pending: body?.pending === true, loading: false, error: null };
  } catch (error) {
    return { rows: null, pending: false, loading: false, error: error instanceof Error ? error.message : "Could not preview routing" };
  }
}

export const conditionsOf = (draft: RuleDraft): RuleCondition[] => (draft.matchType === "fallback" ? [] : draft.conditions.map(conditionValuesOf));
export const serialise = (drafts: RuleDraft[]) => JSON.stringify(drafts.map((draft) => ({ id: draft.id ?? null, type: draft.matchType, values: matchValuesOf(draft), assignees: draft.assigneeIds, strategy: draft.strategy, conditions: conditionsOf(draft) })));
export const titleCase = (value: string) => value.replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
