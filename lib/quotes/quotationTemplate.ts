// A quotation template's fields (LA-3.4), in the template's own order: sections by sort_order, then
// each section's field refs as listed; fields no section lists follow by sort_order. The stored shape
// is LA-1.4's {fields, form_definition} (see lib/applications/templates.ts). Pure; dependency free.
//
// The catalogue (lib/applications/catalog.ts) passes this on as `quotationTemplate.fields`, so the
// Quote step renders exactly the published template's fields, in order.

export type QuotationField = { key: string; label: string; type: string; required: boolean; options: string[] };

type StoredField = { field_key?: unknown; label?: unknown; type?: unknown; is_required?: unknown; options?: unknown; sort_order?: unknown };
type StoredRef = { field_key?: unknown; is_required?: unknown };
type StoredDefinition = { fields?: unknown; form_definition?: { sections?: unknown } | null };

function optionText(o: unknown) {
  if (typeof o === "string") return o;
  if (o && typeof o === "object" && "value" in o) return String((o as { value: unknown }).value);
  if (o && typeof o === "object" && "label" in o) return String((o as { label: unknown }).label);
  return String(o);
}

export type QuotationTemplateRow = { id: string; version: number; tenant_id: string | null; carrier_id: string | null; product_code: string };

/**
 * The published quotation template a quote for one carrier is typed on (LA-3.4): the case's own
 * product line before Final Expense, then the carrier's own template before the general one, then the
 * agency's before the platform's, then the newest version. `carrierId: null` asks for the general
 * template. Rows for another carrier are never candidates.
 */
export function pickQuotationTemplate<T extends QuotationTemplateRow>(rows: T[], want: { productCode: string | null; carrierId: string | null; tenantId: string }): T | null {
  const product = want.productCode ?? "final_expense";
  const candidates = rows.filter((r) => (r.carrier_id === null || r.carrier_id === want.carrierId) && (r.product_code === product || r.product_code === "final_expense") && (r.tenant_id === null || r.tenant_id === want.tenantId));
  const score = (r: T) => [r.product_code === product ? 1 : 0, want.carrierId && r.carrier_id === want.carrierId ? 1 : 0, r.tenant_id ? 1 : 0, r.version] as const;
  return [...candidates].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3];
  })[0] ?? null;
}

/**
 * The rating inputs frozen on a saved quote (LA-3.5): what the form sent, with the facts the quote row
 * itself carries written over it, so the JSON always holds the face, tier, date of birth, age basis and
 * age the premium was typed against — even from a client that sent none.
 */
export function freezeRatingInputs(sent: Record<string, unknown> | null | undefined, facts: {
  faceAmountCents: number; tier: string; dob: string | null; ageBasis: "nearest" | "last"; ageUsed: number | null; termLength: number | null; healthClass: string | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(sent ?? {}) };
  out.face_amount = facts.faceAmountCents;
  out.tier = facts.tier;
  if (facts.dob) out.dob = facts.dob;
  out.age_basis = facts.ageBasis;
  out.age_used = facts.ageUsed;
  if (facts.termLength !== null) out.term_length = facts.termLength;
  if (facts.healthClass !== null) out.health_class = facts.healthClass;
  return out;
}

/** Inputs every quote carries whatever the template asks: the facts the quote row itself is priced on. */
const ALWAYS_KEPT = new Set(["face_amount", "tier", "dob", "age_basis", "age_used", "term_length", "health_class"]);

/**
 * The rating inputs a quote may store under its template (LA-3.4): the template's own fields plus the
 * facts above, nothing else. `missing` names each required field left empty, by its label — riders
 * are a list and count as answered even when none were added. Face, tier and date of birth are read
 * from the quote itself, which is where the form sends them.
 */
export function scopeRatingInputs(fields: QuotationField[], sent: Record<string, unknown> | null | undefined, facts: { faceAmountCents: number | null; tier: string | null; dob: string | null }): { inputs: Record<string, unknown>; missing: string[] } {
  const given = sent ?? {};
  const keys = new Set(fields.map((f) => f.key));
  const inputs = Object.fromEntries(Object.entries(given).filter(([k]) => keys.has(k) || ALWAYS_KEPT.has(k)));
  const valueOf = (key: string): unknown => key === "face_amount" ? facts.faceAmountCents ?? given.face_amount : key === "tier" ? facts.tier ?? given.tier : key === "dob" ? facts.dob ?? given.dob : given[key];
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const missing = fields.filter((f) => f.required && f.key !== "riders" && blank(valueOf(f.key))).map((f) => f.label);
  return { inputs, missing };
}

export function quotationFieldsOf(definition: unknown): QuotationField[] {
  const def = (definition && typeof definition === "object" ? definition : {}) as StoredDefinition;
  const fields = (Array.isArray(def.fields) ? def.fields : []) as StoredField[];
  const byKey = new Map(fields.filter((f) => typeof f.field_key === "string").map((f) => [f.field_key as string, f]));
  const sections = (Array.isArray(def.form_definition?.sections) ? def.form_definition.sections : []) as { sort_order?: unknown; fields?: unknown }[];
  const ordered = [...sections].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  const out: QuotationField[] = [];
  const seen = new Set<string>();
  const push = (f: StoredField, ref?: StoredRef) => {
    const key = f.field_key as string;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      label: typeof f.label === "string" && f.label.trim() ? f.label : key,
      type: typeof f.type === "string" ? f.type : "text",
      required: Boolean(ref?.is_required ?? f.is_required ?? false),
      options: Array.isArray(f.options) ? f.options.map(optionText) : [],
    });
  };
  for (const s of ordered) {
    for (const ref of (Array.isArray(s.fields) ? s.fields : []) as StoredRef[]) {
      const f = typeof ref.field_key === "string" ? byKey.get(ref.field_key) : undefined;
      if (f) push(f, ref);
    }
  }
  const rest = fields.filter((f) => typeof f.field_key === "string" && !seen.has(f.field_key as string)).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  for (const f of rest) push(f);
  return out;
}
