// LA-1.4-3: per-product availability of the six application-form section groups — Personal,
// Medical, Insurance, Beneficiary, Banking, Signature. Client-safe: the settings editor, the
// partner form (and so the preview, which renders it) and server intake all use these functions.
//
// Platform templates have free-form sections, so a section belongs to a group by convention. Its
// section_key is tried first, then its label, both read as lowercase words; the first group whose
// pattern matches wins, in this order (the narrow groups before the broad ones):
//
//   beneficiary  beneficiar…                       "Beneficiary", "beneficiaries"
//   banking      bank, payment, billing, draft, ach, routing, account number
//                                                  "Banking", "Payment information", "Bank draft"
//   signature    signature, sign, esign, authoriz…, attest
//                                                  "Signature", "E-sign", "Authorization"
//   medical      medical, health, underwrit…, condition, medication, tobacco, lifestyle
//                                                  "Medical", "Health questions", "Underwriting"
//   insurance    insurance, coverage, policy, product, quote, plan, replacement, existing
//                                                  "Coverage", "Insurance", "Policy details"
//   personal     personal, applicant, insured, client, customer, contact, demographic, identity
//                                                  "Applicant", "Contact", "Personal information"
//
// A section matching none of them ("Additional information") is not governed and always shows.
// The partner form's consent step is not a section and is never switched off.

import {
  TEMPLATE_SECTION_GROUPS,
  isPhoneTemplateField,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateFormSection,
  type TemplateSectionAvailability,
  type TemplateSectionGroup,
} from "./constants.ts";

export const TEMPLATE_SECTION_GROUP_LABELS: Record<TemplateSectionGroup, string> = {
  personal: "Personal",
  medical: "Medical",
  insurance: "Insurance",
  beneficiary: "Beneficiary",
  banking: "Banking",
  signature: "Signature",
};

const GROUP_PATTERNS: Array<[TemplateSectionGroup, RegExp]> = [
  ["beneficiary", /(^|_)beneficiar/],
  ["banking", /(^|_)(bank|banking|payment|payments|billing|draft|ach|routing)(_|$)|account_number/],
  ["signature", /(^|_)(signature|signatures|sign|esign|e_sign|authoriz\w*|attest\w*)(_|$)/],
  ["medical", /(^|_)(medical|health|underwrit\w*|conditions?|medications?|tobacco|lifestyle)(_|$)/],
  ["insurance", /(^|_)(insurance|coverage|policy|policies|product|quote|plan|replacement|existing)(_|$)/],
  ["personal", /(^|_)(personal|applicant|insured|client|customer|contact|demographics?|identity)(_|$)/],
];

function words(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** The group a section belongs to by its key, then its label, or null when it is not governed. */
export function sectionGroup(section: Pick<TemplateFormSection, "section_key" | "label">): TemplateSectionGroup | null {
  for (const candidate of [words(section.section_key ?? ""), words(section.label ?? "")]) {
    if (!candidate) continue;
    for (const [group, pattern] of GROUP_PATTERNS) if (pattern.test(candidate)) return group;
  }
  return null;
}

/** All six groups with their current setting; a group the form does not mention is available. */
export function sectionAvailability(form: Pick<TemplateFormDefinition, "section_availability">): Record<TemplateSectionGroup, boolean> {
  const stored = form.section_availability ?? {};
  return Object.fromEntries(TEMPLATE_SECTION_GROUPS.map((group) => [group, stored[group] !== false])) as Record<TemplateSectionGroup, boolean>;
}

function holdsPhone(section: TemplateFormSection, fields: Map<string, TemplateField>) {
  return section.fields.some((item) => {
    const field = fields.get(item.field_key);
    return field ? isPhoneTemplateField(field) : ["phone", "phone_number"].includes(item.field_key);
  });
}

/**
 * The form a partner fills: the sections of switched-off groups removed. A section holding the phone
 * field always stays, because every submission is screened on that number.
 */
export function effectiveTemplateForm(form: TemplateFormDefinition, fields: TemplateField[]): TemplateFormDefinition {
  const availability = sectionAvailability(form);
  if (TEMPLATE_SECTION_GROUPS.every((group) => availability[group])) return form;
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  return {
    ...form,
    sections: form.sections.filter((section) => {
      const group = sectionGroup(section);
      return !group || availability[group] || holdsPhone(section, byKey);
    }),
  };
}

/**
 * Why this availability cannot be saved, or null. A group cannot be switched off when one of its
 * sections holds the phone field (the screening number) or a field "required on every form".
 */
export function sectionAvailabilityError(form: TemplateFormDefinition, fields: TemplateField[]): string | null {
  const stored = form.section_availability;
  if (stored === undefined) return null;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return "Section availability is invalid";
  for (const [key, value] of Object.entries(stored)) {
    if (!(TEMPLATE_SECTION_GROUPS as readonly string[]).includes(key) || typeof value !== "boolean") return "Section availability is invalid";
  }
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  const availability = sectionAvailability(form);
  for (const section of form.sections) {
    const group = sectionGroup(section);
    if (!group || availability[group]) continue;
    if (holdsPhone(section, byKey)) return `${TEMPLATE_SECTION_GROUP_LABELS[group]} cannot be switched off: “${section.label}” holds the phone number every submission is screened on`;
    const required = section.fields.map((item) => byKey.get(item.field_key)).find((field) => field?.is_required);
    if (required) return `${TEMPLATE_SECTION_GROUP_LABELS[group]} cannot be switched off: “${required.label}” in “${section.label}” is required on every form`;
  }
  return null;
}

/** The sections of this form each group governs, for the settings screen. */
export function sectionsByGroup(form: TemplateFormDefinition): Record<TemplateSectionGroup, TemplateFormSection[]> {
  const out = Object.fromEntries(TEMPLATE_SECTION_GROUPS.map((group) => [group, [] as TemplateFormSection[]])) as Record<TemplateSectionGroup, TemplateFormSection[]>;
  for (const section of form.sections) {
    const group = sectionGroup(section);
    if (group) out[group].push(section);
  }
  return out;
}

export type { TemplateSectionAvailability };
