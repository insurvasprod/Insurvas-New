// Disclosure rules (LA-3.10). Pure and client-safe: a rule is a list of {field, op, value} clauses,
// all of which must hold. No nesting, no OR — two rules instead — so the person configuring it can
// read it. Fields are canonical application keys (`addr.state`) or interview answers (`health.<key>`).

export type DisclosureClause = { field: string; op: "eq" | "neq" | "in" | "not_in" | "gt" | "lt"; value: unknown };
export type DisclosureRule = { disclosureId: string; clauses: DisclosureClause[] };
export type DisclosureScope = { states: string[]; carrierIds: string[] };

function norm(v: unknown): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function holds(actual: unknown, clause: DisclosureClause) {
  const a = norm(actual);
  const v = norm(clause.value);
  switch (clause.op) {
    case "eq": return a === v || (a !== undefined && a !== null && String(a) === String(v));
    case "neq": return !(a === v || String(a) === String(v));
    case "in": return Array.isArray(clause.value) && clause.value.map(String).includes(String(a));
    case "not_in": return Array.isArray(clause.value) && !clause.value.map(String).includes(String(a));
    case "gt": return Number(a) > Number(v);
    case "lt": return Number(a) < Number(v);
    default: return false;
  }
}

export type AttachedDisclosure = { disclosureId: string; status: "required" | "acknowledged" | "not_applicable"; code: string | null };

/**
 * What a refresh changes on one application (LA-3.10). `apply` is the live library ids that apply now;
 * `codeOf` names each live id's code. An acknowledged or not-applicable row is never removed, and its
 * CODE counts as settled: a later version of the same disclosure is not added beside it, so the
 * version recorded on an acknowledged application stays the one it was given. A still-required row
 * that no longer applies — including an older version whose code now points at a newer one — goes.
 */
export function disclosureChanges(input: { apply: Set<string>; current: AttachedDisclosure[]; codeOf: Map<string, string> }): { add: string[]; drop: string[] } {
  const have = new Set(input.current.map((r) => r.disclosureId));
  const settled = new Set(input.current.filter((r) => r.status !== "required" && r.code).map((r) => r.code as string));
  const add = [...input.apply].filter((id) => !have.has(id) && !settled.has(input.codeOf.get(id) ?? ""));
  const drop = input.current.filter((r) => r.status === "required" && !input.apply.has(r.disclosureId)).map((r) => r.disclosureId);
  return { add, drop };
}

/** The disclosures that apply, given the application's values and interview answers. */
export function applicableDisclosures(input: {
  rules: DisclosureRule[];
  scopes: Map<string, DisclosureScope>;
  values: Record<string, unknown>;
  answers: Record<string, unknown>;
  state: string | null;
  carrierId: string | null;
}): Set<string> {
  const lookup = (field: string) => (field.startsWith("health.") ? input.answers[field.slice(7)] : input.values[field]);
  const out = new Set<string>();
  for (const rule of input.rules) {
    const scope = input.scopes.get(rule.disclosureId);
    if (!scope) continue;
    if (scope.states.length && (!input.state || !scope.states.includes(input.state))) continue;
    if (scope.carrierIds.length && (!input.carrierId || !scope.carrierIds.includes(input.carrierId))) continue;
    if (rule.clauses.length && rule.clauses.every((c) => holds(lookup(c.field), c))) out.add(rule.disclosureId);
  }
  return out;
}
