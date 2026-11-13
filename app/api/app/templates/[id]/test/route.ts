import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { validateValues } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";
import { pruneHiddenTemplateValues, templateFormFieldVisible } from "@/lib/templates/visibility";
import { effectiveTemplateForm } from "@/lib/templates/sectionAvailability";
import { checkFieldValue } from "@/lib/templates/fieldRules";
import { splitFieldRules } from "@/lib/templates/fieldRulesStore";
import { formForSave } from "@/lib/templates/logic";

/**
 * Test submission (board A6), the part that works without the test-lead flag: the draft's answers go
 * through the same checks a sent form meets (validateValues, the server's own), with format-2 logic
 * and rules applied first. Nothing is written and nobody is told. Making a tagged test lead waits on
 * agent_leads.is_test (20261112200000) and an intake path that sets it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { fields?: TemplateField[]; form_definition?: TemplateFormDefinition; values?: Record<string, unknown> } | null;
  if (!body || !Array.isArray(body.fields) || !body.form_definition || !Array.isArray(body.form_definition.sections) || !body.values || typeof body.values !== "object") return NextResponse.json({ error: "Fill in the form first" }, { status: 400 });
  const { id } = await params;
  const { data: copy } = await getSupabaseServiceClient().from("tenant_templates").select("id").eq("tenant_id", auth.context.tenantId).eq("id", id).maybeSingle<{ id: string }>();
  if (!copy) return NextResponse.json({ error: "That form is not yours, or no longer exists." }, { status: 404 });

  const form = effectiveTemplateForm(formForSave(body.form_definition), body.fields);
  const values = pruneHiddenTemplateValues(form, body.values);
  // Format-2 rules first, in the words a partner reads.
  const byKey = new Map(body.fields.map((field) => [field.field_key, field]));
  const problems: Array<{ field_key: string; message: string }> = [];
  for (const section of form.sections) for (const placed of section.fields) {
    const field = byKey.get(placed.field_key);
    if (!field || !templateFormFieldVisible(placed, values)) continue;
    const empty = values[placed.field_key] === undefined || values[placed.field_key] === "" || values[placed.field_key] === null || (Array.isArray(values[placed.field_key]) && (values[placed.field_key] as unknown[]).length === 0);
    if (empty && (field.is_required || placed.is_required)) { problems.push({ field_key: field.field_key, message: `${field.label} is required` }); continue; }
    const check = checkFieldValue(field, values[placed.field_key]);
    if (!check.ok) problems.push({ field_key: field.field_key, message: check.message });
  }
  // Then the server's own intake check, on the fields as they would be saved. Only questions shown
  // under format-2 logic are passed to it: intake reads only format-1 conditions.
  const split = splitFieldRules(body.fields, form);
  const shownForm: TemplateFormDefinition = { ...split.form, sections: split.form.sections.map((section) => ({ ...section, fields: section.fields.filter((placed) => templateFormFieldVisible(placed, values)).map((placed) => ({ ...placed, logic: undefined, page_skip: undefined })) })) };
  const intake = problems.length ? null : validateValues(split.fields, values, shownForm);
  return NextResponse.json({ ok: problems.length === 0 && !intake, problems, intake, values });
}
