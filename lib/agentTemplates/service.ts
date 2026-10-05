import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import { getEntitlement } from "@/lib/entitlements/get";
import {
  isKnownScreeningVersion,
  linkScreeningAuditToLead,
  linkScreeningAuditsToLeads,
  screenPartnerPhone,
  type ScreeningDecision,
} from "@/lib/compliance/screening";
import { assertOutboundLimit } from "@/lib/metering/outbound";
import { getUsPhone10Digits } from "@/lib/compliance/scrub";
import { linkLeadsToContacts } from "@/lib/contacts/leadLink";
import { fetchTemplateVersion } from "@/lib/templates/queries";
import {
  DEFAULT_TEMPLATE_FORM,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_STAGE_TYPES,
  isPhoneTemplateField,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateRow,
  type TemplateStage,
  type TemplateValidation,
} from "@/lib/templates/constants";
import { DERIVED_AGE_KEY, bankFormatError, withDerivedAge } from "@/lib/templates/formats";
import { effectiveTemplateForm, sectionAvailabilityError } from "@/lib/templates/sectionAvailability";
import {
  partnerTypeForLead,
  resolvePartnerEntryStage,
  resolveRuntimeStage,
  assertUuid,
} from "@/lib/pipelines/service";
import { isRequiredLeadImportField, parseLeadCsv, sanitizeImportMapping, US_STATE_CODES, type ImportDateOrder, type LeadImportRow } from "./csv";
import { commitLeadImport, ImportCommitRefusal, projectedUsableCostCents } from "./importCommit";
import { trustedFormCertificateId } from "@/lib/consent/capture";

const PRODUCT_CODE = "term_life";
// Each screening is ~10 sequential round trips; this bounds how many a CSV import runs at once.
const SCREENING_CONCURRENCY = 20;

/**
 * Promise.all with at most `limit` tasks in flight. Results keep input order, and the first
 * rejection rejects the whole call (no new tasks start after it), matching Promise.all.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

type LooseResult<T> = {
  data: T;
  error: { code?: string; message: string } | null;
};
type LooseQuery<T = unknown> = PromiseLike<LooseResult<T>> & {
  select(columns: string): LooseQuery<T>;
  eq(column: string, value: unknown): LooseQuery<T>;
  in(column: string, values: unknown[]): LooseQuery<T>;
  order(column: string, options?: { ascending?: boolean }): LooseQuery<T>;
  maybeSingle(): Promise<LooseResult<T | null>>;
  single(): Promise<LooseResult<T>>;
  insert(values: unknown): LooseQuery<T>;
  update(values: unknown): LooseQuery<T>;
  rpc?: never;
};
type LooseDb = {
  from(table: string): LooseQuery;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<LooseResult<unknown>>;
};
type ImportedLead = {
  id: string;
  values: Record<string, unknown>;
  product_line: string;
  pipeline_id: string;
  stage_id: string;
  created_at: string;
  updated_at: string;
};
type ProfileQuery = {
  select: (columns: string) => ProfileQuery;
  eq: (column: string, value: unknown) => ProfileQuery;
  is: (column: string, value: null) => ProfileQuery;
  maybeSingle: () => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export type AgentTemplate = {
  assignment: {
    id: string;
    template_id: string;
    template_version: number;
    definition_version: number;
    product_code: string;
  };
  tenant_template_id: string;
  template: TemplateRow & { definition_version: number };
  latest: { id: string; version: number; name: string } | null;
};
export type TemplateApplicationPreview = {
  fieldsToAdd: string[];
  stagesToAdd: string[];
  sectionsToAdd: string[];
  alreadyApplied: boolean;
};
type TenantCopy = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version: number;
  definition_version: number;
  product_code: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  fields: TemplateField[];
  stages: TemplateStage[];
  form_definition: TemplateFormDefinition;
};

const asFields = (value: unknown) =>
  Array.isArray(value) ? (value as TemplateField[]) : [];
const asStages = (value: unknown) =>
  Array.isArray(value) ? (value as TemplateStage[]) : [];
const asForm = (value: unknown): TemplateFormDefinition =>
  value &&
  typeof value === "object" &&
  Array.isArray((value as { sections?: unknown }).sections)
    ? (value as TemplateFormDefinition)
    : DEFAULT_TEMPLATE_FORM;

function mergeForm(
  current: TemplateFormDefinition,
  incoming: TemplateFormDefinition,
): TemplateFormDefinition {
  const sections = current.sections.map((section) => ({
    ...section,
    fields: [...section.fields],
  }));
  for (const incomingSection of incoming.sections) {
    const existing = sections.find(
      (section) => section.section_key === incomingSection.section_key,
    );
    if (!existing) {
      sections.push(incomingSection);
      continue;
    }
    for (const field of incomingSection.fields)
      if (!existing.fields.some((item) => item.field_key === field.field_key))
        existing.fields.push(field);
  }
  return {
    sections: sections.map((section, index) => ({
      ...section,
      sort_order: index,
    })),
  };
}

function mergeDefinitions(existing: TenantCopy | null, source: TemplateRow) {
  const fields = existing ? [...existing.fields] : [];
  for (const field of source.fields)
    if (!fields.some((item) => item.field_key === field.field_key))
      fields.push({ ...field, sort_order: fields.length });
  const stages = existing ? [...existing.stages] : [];
  for (const stage of source.stages)
    if (!stages.some((item) => item.stage_key === stage.stage_key))
      stages.push({ ...stage, sort_order: stages.length });
  return {
    fields: fields.map((item, index) => ({ ...item, sort_order: index })),
    stages: stages.map((item, index) => ({ ...item, sort_order: index })),
    form_definition: mergeForm(
      existing?.form_definition ?? { sections: [] },
      source.form_definition,
    ),
  };
}

function templateRow(
  copy: TenantCopy,
  productName: string,
): TemplateRow & { definition_version: number } {
  return {
    id: copy.id,
    name: copy.name,
    product_code: copy.product_code,
    product_name: productName,
    version: copy.template_version,
    definition_version: copy.definition_version,
    description: copy.description,
    is_active: true,
    created_by: copy.tenant_id,
    created_at: copy.created_at,
    updated_at: copy.updated_at,
    fields: copy.fields,
    stages: copy.stages,
    form_definition: copy.form_definition,
  };
}

async function loadCopy(
  tenantId: string,
  productCode?: string,
  id?: string,
  definitionVersion?: number,
): Promise<TenantCopy | null> {
  const supabase = getSupabaseServiceClient();
  let request = supabase
    .from("tenant_templates")
    .select(
      "id, tenant_id, template_id, template_version, definition_version, product_code, name, description, created_at, updated_at",
    )
    .eq("tenant_id", tenantId);
  if (id) request = request.eq("id", id);
  if (productCode) request = request.eq("product_code", productCode);
  const { data, error } = await request.maybeSingle();
  if (error)
    throw new Error(`Could not load tenant template: ${error.message}`);
  if (!data) return null;
  // The revision read needs only data.id and the version, so it shares the details round trip.
  const [fields, stages, form, revision] = await Promise.all([
    supabase
      .from("tenant_template_fields")
      .select(
        "tenant_template_id, field_key, label, type, is_required, options, sort_order",
      )
      .eq("tenant_template_id", data.id)
      .order("sort_order"),
    supabase
      .from("tenant_template_stages")
      .select(
        "tenant_template_id, stage_key, label, stage_type, color, sort_order",
      )
      .eq("tenant_template_id", data.id)
      .order("sort_order"),
    supabase
      .from("tenant_template_forms")
      .select("tenant_template_id, form_definition")
      .eq("tenant_template_id", data.id)
      .maybeSingle(),
    supabase
      .from("tenant_template_revisions")
      .select("revision, name, description, fields, stages, form_definition")
      .eq("tenant_template_id", data.id)
      .eq("revision", definitionVersion ?? data.definition_version ?? 1)
      .maybeSingle(),
  ]);
  if (fields.error || stages.error || form.error)
    throw new Error(
      `Could not load tenant template details: ${fields.error?.message ?? stages.error?.message ?? form.error?.message}`,
    );
  if (revision.error)
    throw new Error(
      `Could not load tenant template revision: ${revision.error.message}`,
    );
  return {
    ...data,
    definition_version: definitionVersion ?? data.definition_version ?? 1,
    created_at: data.created_at ?? new Date(0).toISOString(),
    updated_at: data.updated_at ?? new Date(0).toISOString(),
    fields: revision.data
      ? asFields(revision.data.fields)
      : asFields(fields.data),
    stages: revision.data
      ? asStages(revision.data.stages)
      : asStages(stages.data),
    form_definition: revision.data
      ? asForm(revision.data.form_definition)
      : asForm(form.data?.form_definition),
  };
}

async function productName(code: string) {
  const { data } = await getSupabaseServiceClient()
    .from("products")
    .select("name")
    .eq("code", code)
    .maybeSingle();
  return data?.name ?? code;
}
async function allowedProductCodes(tenantId: string) {
  const entitlement = await getEntitlement(tenantId);
  if (!entitlement.plan_code) return [];
  const supabase = getSupabaseServiceClient();
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("code", entitlement.plan_code)
    .eq("version", entitlement.plan_version ?? 1)
    .maybeSingle();
  if (!plan) return [];
  const { data, error } = await supabase
    .from("plan_product_access")
    .select("product_code")
    .eq("plan_id", plan.id);
  if (error) throw new Error(`Could not load product access: ${error.message}`);
  return (data ?? []).map((row) => row.product_code);
}
async function assertAllowedProduct(tenantId: string, productCode: string) {
  if (!(await allowedProductCodes(tenantId)).includes(productCode))
    throw new Error(`Your plan does not include the ${productCode} product`);
}

async function loadLatestTemplate(productCode = PRODUCT_CODE) {
  const { data, error } = await getSupabaseServiceClient()
    .from("templates")
    .select(
      "id, name, product_code, version, description, is_active, created_by, created_at, updated_at",
    )
    .eq("product_code", productCode)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Could not load active template: ${error.message}`);
  return data;
}
async function resolveSource(templateId: string, version: number) {
  const source = await fetchTemplateVersion(templateId, version);
  if (!source || !source.is_active)
    throw new Error("That template version is no longer available");
  return source;
}

export async function getAgentTemplateForProduct(
  tenantId: string,
  userId: string,
  productCode: string,
): Promise<AgentTemplate> {
  // loadCopy filters on product_code, so copy.product_code === productCode and the latest-template
  // and product-name reads need not wait for it. This path runs on every leads GET/POST/PATCH.
  const [loadedCopy, latest, name] = await Promise.all([
    loadCopy(tenantId, productCode),
    loadLatestTemplate(productCode),
    productName(productCode),
  ]);
  let copy = loadedCopy;
  if (!copy) {
    const source = latest;
    if (!source)
      throw new Error(`No active ${productCode} template is available`);
    await assertAllowedProduct(tenantId, source.product_code);
    await applyTemplate(tenantId, userId, source.id, source.version);
    copy = await loadCopy(tenantId, productCode);
    if (!copy) throw new Error("Could not resolve the tenant template copy");
  }
  return {
    tenant_template_id: copy.id,
    assignment: {
      id: copy.id,
      template_id: copy.template_id,
      template_version: copy.template_version,
      definition_version: copy.definition_version,
      product_code: copy.product_code,
    },
    template: templateRow(copy, name),
    latest:
      latest && latest.version > copy.template_version
        ? { id: latest.id, version: latest.version, name: latest.name }
        : null,
  };
}

export async function getAgentTemplate(
  tenantId: string,
  userId: string,
): Promise<AgentTemplate> {
  return getAgentTemplateForProduct(tenantId, userId, PRODUCT_CODE);
}

/** Partner intake must never create a tenant template as a side effect of a GET. */
export async function getTenantTemplateForProduct(
  tenantId: string,
  productCode: string,
) {
  const copy = await loadCopy(tenantId, productCode);
  if (!copy)
    throw new Error("No configured form is available for this product");
  return {
    tenant_template_id: copy.id,
    assignment: {
      id: copy.id,
      template_id: copy.template_id,
      template_version: copy.template_version,
      definition_version: copy.definition_version,
      product_code: copy.product_code,
    },
    template: templateRow(copy, await productName(copy.product_code)),
  };
}

export type ProfileChoice = {
  field_key: string;
  is_required?: boolean;
  sort_order?: number;
};

/**
 * Older profile revisions did not persist a separate verification checklist.
 * In that case the submitted profile fields are the fields the agent must
 * confirm. Keep this fallback at resolution time so immutable lead/profile
 * snapshots continue to work without a data rewrite.
 */
function resolveVerificationChoices(
  fields: unknown,
  verificationFields: unknown,
): ProfileChoice[] {
  const submissionChoices = Array.isArray(fields)
    ? (fields as ProfileChoice[])
    : [];
  const explicitChoices = Array.isArray(verificationFields)
    ? (verificationFields as ProfileChoice[])
    : [];
  return explicitChoices.length ? explicitChoices : submissionChoices;
}

/**
 * The form as a partner receives it (LA-1.4-3): sections of the section groups this product's form
 * switches off are removed, so the partner form, its preview, drafts and intake validation agree.
 */
function partnerFacing<T extends { template: TemplateRow }>(resolved: T): T {
  const form_definition = effectiveTemplateForm(resolved.template.form_definition, resolved.template.fields);
  return form_definition === resolved.template.form_definition ? resolved : { ...resolved, template: { ...resolved.template, form_definition } };
}

/** Apply a saved profile revision to an immutable tenant-template revision. */
export function composePartnerTemplate<
  T extends Awaited<ReturnType<typeof getTenantTemplateForProduct>>,
>(base: T, choices: ProfileChoice[], requirePhone = true) {
  const configured = new Map(
    choices
      .filter((choice) => typeof choice.field_key === "string")
      .map((choice, index) => [
        choice.field_key,
        { ...choice, sort_order: choice.sort_order ?? index },
      ]),
  );
  const fields = base.template.fields
    .filter((field) => configured.has(field.field_key))
    .map((field) => ({
      ...field,
      is_required: Boolean(configured.get(field.field_key)?.is_required),
    }))
    .sort(
      (a, b) =>
        (configured.get(a.field_key)?.sort_order ?? 0) -
        (configured.get(b.field_key)?.sort_order ?? 0),
    );
  if (requirePhone && !fields.some(isPhoneTemplateField))
    throw new Error("Partner submission setup is missing a phone field");
  const order = new Map(fields.map((field, index) => [field.field_key, index]));
  const fieldKeys = new Set(fields.map((field) => field.field_key));
  const configuredKeys = new Set(configured.keys());
  const presentKeys = new Set(
    base.template.form_definition.sections.flatMap((section) =>
      section.fields.map((field) => field.field_key),
    ),
  );
  const additionalFields = fields
    .filter(
      (field) =>
        configuredKeys.has(field.field_key) &&
        !presentKeys.has(field.field_key),
    )
    .map((field) => ({
      field_key: field.field_key,
      is_required: field.is_required,
      show_when: null,
    }));
  const form_definition = {
    ...base.template.form_definition,
    sections: [
      ...base.template.form_definition.sections
        .map((section) => ({
          ...section,
          fields: section.fields
            .filter((field) => fieldKeys.has(field.field_key))
            .sort(
              (a, b) =>
                (order.get(a.field_key) ?? 0) - (order.get(b.field_key) ?? 0),
            ),
        }))
        .filter((section) => section.fields.length > 0),
      ...(additionalFields.length
        ? [
            {
              section_key: "additional_information",
              label: "Additional information",
              fields: additionalFields,
              sort_order: base.template.form_definition.sections.length,
            },
          ]
        : []),
    ],
  };
  return partnerFacing({ ...base, template: { ...base.template, fields, form_definition } });
}

/** Load one immutable partner-profile revision for a saved lead or draft. */
export async function getPartnerTemplateForProductProfileRevision(
  tenantId: string,
  profileId: string,
  profileRevision: number,
  productCode: string,
) {
  const db = getSupabaseServiceClient() as unknown as {
    from: (table: string) => ProfileQuery;
  };
  const profile = await db
    .from("partner_submission_profiles")
    .select("id, tenant_id, partner_id, product_code, scope, current_revision")
    .eq("id", profileId)
    .eq("tenant_id", tenantId)
    .eq("product_code", productCode)
    .maybeSingle();
  if (profile.error)
    throw new Error(
      `Could not load partner submission profile: ${profile.error.message}`,
    );
  if (!profile.data)
    throw new Error("Saved partner submission profile was not found");
  const revision = await db
    .from("partner_submission_profile_revisions")
    .select("revision, fields, verification_fields, source_template_revision")
    .eq("profile_id", profileId)
    .eq("revision", profileRevision)
    .maybeSingle();
  if (revision.error)
    throw new Error(
      `Could not load partner submission profile revision: ${revision.error.message}`,
    );
  if (!revision.data)
    throw new Error("Saved partner submission profile revision was not found");
  const data = revision.data as {
    fields: unknown;
    verification_fields: unknown;
    source_template_revision: number;
  };
  const base = await getTenantTemplateForProductVersion(
    tenantId,
    productCode,
    data.source_template_revision,
  );
  const composed = composePartnerTemplate(
    base,
    Array.isArray(data.fields) ? (data.fields as ProfileChoice[]) : [],
  );
  return {
    ...composed,
    partner_submission_profile_id: profileId,
    profile_revision: profileRevision,
    profile_source: (profile.data as { scope: string }).scope,
    source_template_revision: data.source_template_revision,
    verification_fields: resolveVerificationChoices(
      data.fields,
      data.verification_fields,
    ),
  };
}

/** Resolve a partner user's composition server-side: user override, admin default, retained publisher default, then tenant template. */
export async function getPartnerTemplateForProduct(
  tenantId: string,
  partnerId: string,
  userId: string,
  productCode: string,
) {
  const db = getSupabaseServiceClient() as unknown as {
    from: (table: string) => ProfileQuery;
  };
  const membershipRow = (columns: string) =>
    db
      .from("partner_users")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("user_id", userId)
      .maybeSingle();
  // One read of the membership row, concurrent with the base template. 42703 means the
  // hierarchy column is not deployed yet: fall back to the membership-only read.
  const [base, membership] = await Promise.all([
    getTenantTemplateForProduct(tenantId, productCode),
    membershipRow("user_id, partner_admin_user_id").then((row) =>
      row.error?.code === "42703" ? membershipRow("user_id") : row,
    ),
  ]);
  if (membership.error)
    throw new Error(
      `Could not load partner membership: ${membership.error.message}`,
    );
  const parentAdminId =
    (membership.data as { partner_admin_user_id?: string | null } | null)
      ?.partner_admin_user_id ?? null;
  const profileFor = (
    subjectUserId: string,
    scope: "partner_admin" | "partner_user",
  ) =>
    db
      .from("partner_submission_profiles")
      .select("id, subject_user_id, scope, current_revision")
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("product_code", productCode)
      .eq("subject_user_id", subjectUserId)
      .eq("scope", scope)
      .maybeSingle();
  const userProfile = await profileFor(userId, "partner_user");
  // A pre-hierarchy publisher profile can still serve the portal while the additive migration
  // is awaiting deployment. It is intentionally read-only here; the new owner editor publishes
  // the per-admin/per-user revision model after the migration is in place.
  if (userProfile.error?.code === "42703") {
    const legacy = await db
      .from("partner_submission_profiles")
      .select("id, revision, fields, verification_fields")
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("product_code", productCode)
      .maybeSingle();
    if (legacy.error)
      throw new Error(
        `Could not load partner submission profile: ${legacy.error.message}`,
      );
    const old = legacy.data as {
      id: string;
      revision: number;
      fields: unknown;
      verification_fields: unknown;
    } | null;
    if (!old)
      return {
        ...partnerFacing(base),
        partner_submission_profile_id: null as string | null,
        profile_revision: null as number | null,
        profile_source: "tenant_template" as const,
        verification_fields: [] as unknown[],
      };
    const composed = composePartnerTemplate(
      base,
      Array.isArray(old.fields) ? (old.fields as ProfileChoice[]) : [],
    );
    return {
      ...composed,
      partner_submission_profile_id: old.id,
      profile_revision: old.revision,
      profile_source: "publisher" as const,
      source_template_revision: base.assignment.definition_version,
      verification_fields: resolveVerificationChoices(
        old.fields,
        old.verification_fields,
      ),
    };
  }
  const adminProfile =
    !userProfile.data && parentAdminId
      ? await profileFor(parentAdminId, "partner_admin")
      : null;
  const publisherProfile =
    !userProfile.data && !adminProfile?.data
      ? await db
          .from("partner_submission_profiles")
          .select("id, scope, current_revision")
          .eq("tenant_id", tenantId)
          .eq("partner_id", partnerId)
          .eq("product_code", productCode)
          .eq("scope", "publisher")
          .is("subject_user_id", null)
          .maybeSingle()
      : null;
  const profile = userProfile.data
    ? userProfile
    : adminProfile?.data
      ? adminProfile
      : (publisherProfile ?? userProfile);
  if (profile.error)
    throw new Error(
      `Could not load partner submission profile: ${profile.error.message}`,
    );
  const current = profile.data as {
    id: string;
    scope: "publisher" | "partner_admin" | "partner_user";
    current_revision: number;
  } | null;
  if (!current)
    return {
      ...partnerFacing(base),
      partner_submission_profile_id: null as string | null,
      profile_revision: null as number | null,
      profile_source: "tenant_template" as const,
      verification_fields: [] as unknown[],
    };
  const revision = await db
    .from("partner_submission_profile_revisions")
    .select("fields, verification_fields, source_template_revision")
    .eq("profile_id", current.id)
    .eq("revision", current.current_revision)
    .maybeSingle();
  if (revision.error)
    throw new Error(
      `Could not load partner submission profile revision: ${revision.error.message}`,
    );
  const data = revision.data as {
    fields: unknown;
    verification_fields: unknown;
    source_template_revision: number;
  } | null;
  if (!data)
    throw new Error("Partner submission profile has no current revision");
  const source =
    data.source_template_revision === base.assignment.definition_version
      ? base
      : await getTenantTemplateForProductVersion(
          tenantId,
          productCode,
          data.source_template_revision,
        );
  const composed = composePartnerTemplate(
    source,
    Array.isArray(data.fields) ? (data.fields as ProfileChoice[]) : [],
  );
  return {
    ...composed,
    partner_submission_profile_id: current.id,
    profile_revision: current.current_revision,
    profile_source: current.scope,
    source_template_revision: data.source_template_revision,
    verification_fields: resolveVerificationChoices(
      data.fields,
      data.verification_fields,
    ),
  };
}

export async function getTenantTemplateForProductVersion(
  tenantId: string,
  productCode: string,
  definitionVersion: number,
) {
  if (!Number.isInteger(definitionVersion) || definitionVersion < 1)
    throw new Error("Invalid form definition version");
  const copy = await loadCopy(
    tenantId,
    productCode,
    undefined,
    definitionVersion,
  );
  if (!copy)
    throw new Error("No configured form is available for this product");
  return {
    tenant_template_id: copy.id,
    assignment: {
      id: copy.id,
      template_id: copy.template_id,
      template_version: copy.template_version,
      definition_version: copy.definition_version,
      product_code: copy.product_code,
    },
    template: templateRow(copy, await productName(copy.product_code)),
  };
}

/**
 * One immutable tenant-form revision as the partner receives it: the partner routes resume a draft
 * on this. The agent's lead page and verification read the full revision above.
 */
export async function getPartnerTenantTemplateForProductVersion(
  tenantId: string,
  productCode: string,
  definitionVersion: number,
) {
  return partnerFacing(await getTenantTemplateForProductVersion(tenantId, productCode, definitionVersion));
}

export class TemplateProductError extends Error {}

/**
 * The form-templates settings screen. Each product the tenant's plan includes has its own copy;
 * `productCode` picks which one is `current` (default: the historical term-life form, so callers
 * that never passed a product see exactly what they saw before). `products` lists every product
 * the plan includes that has an active platform template — the ones a copy can exist for.
 */
export async function listAvailableTemplates(tenantId: string, userId: string, productCode?: string | null) {
  const allowed = await allowedProductCodes(tenantId);
  const supabase = getSupabaseServiceClient();
  const { data: sources, error } = allowed.length
    ? await supabase
        .from("templates")
        .select(
          "id, name, product_code, version, description, is_active, created_by, created_at, updated_at",
        )
        .eq("is_active", true)
        .in("product_code", allowed)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };
  if (error)
    throw new Error(`Could not load available templates: ${error.message}`);
  const productCodes = [...new Set((sources ?? []).map((source) => source.product_code))];
  const { data: productRows, error: productError } = productCodes.length
    ? await supabase.from("products").select("code, name").in("code", productCodes)
    : { data: [], error: null };
  if (productError)
    throw new Error(`Could not load products: ${productError.message}`);
  const names = new Map((productRows ?? []).map((row) => [row.code, row.name as string]));
  if (productCode && !productCodes.includes(productCode))
    throw new TemplateProductError("Your plan does not include a form for that product");
  // A plan without term life used to fail here; it now opens on the first product it does include.
  const fallback = productCodes.includes(PRODUCT_CODE) || productCodes.length === 0 ? PRODUCT_CODE : productCodes[0];
  const current = await getAgentTemplateForProduct(tenantId, userId, productCode || fallback);
  return {
    current,
    products: productCodes
      .map((code) => ({ code, name: names.get(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    templates: (sources ?? []).map((source) => ({
      id: source.id,
      name: source.name,
      product_code: source.product_code,
      version: source.version,
      description: source.description,
      product_name:
        source.product_code === current.template.product_code
          ? current.template.product_name
          : names.get(source.product_code) ?? source.product_code,
    })),
  };
}

export async function previewTemplateApplication(
  tenantId: string,
  templateId: string,
  version: number,
): Promise<TemplateApplicationPreview> {
  const source = await resolveSource(templateId, version);
  await assertAllowedProduct(tenantId, source.product_code);
  const existing = await loadCopy(tenantId, source.product_code);
  const merged = mergeDefinitions(existing, source);
  return {
    fieldsToAdd: merged.fields
      .filter(
        (field) =>
          !existing?.fields.some((item) => item.field_key === field.field_key),
      )
      .map((field) => field.label),
    stagesToAdd: merged.stages
      .filter(
        (stage) =>
          !existing?.stages.some((item) => item.stage_key === stage.stage_key),
      )
      .map((stage) => stage.label),
    sectionsToAdd: merged.form_definition.sections
      .filter(
        (section) =>
          !existing?.form_definition.sections.some(
            (item) => item.section_key === section.section_key,
          ),
      )
      .map((section) => section.label),
    alreadyApplied: Boolean(
      existing?.template_id === templateId &&
      existing.template_version === version,
    ),
  };
}

export async function applyTemplate(
  tenantId: string,
  userId: string,
  templateId: string,
  version: number,
) {
  const source = await resolveSource(templateId, version);
  await assertAllowedProduct(tenantId, source.product_code);
  const existing = await loadCopy(tenantId, source.product_code);
  const merged = mergeDefinitions(existing, source);
  const { data, error } = await getSupabaseServiceClient().rpc(
    "admin_apply_tenant_template",
    {
      p_tenant_id: tenantId,
      p_template_id: source.id,
      p_template_version: source.version,
      p_product_code: source.product_code,
      p_name: existing?.name ?? source.name,
      p_description: existing?.description ?? source.description,
      p_applied_by: userId,
      p_fields: merged.fields as unknown as Json,
      p_stages: merged.stages as unknown as Json,
      p_form_definition: merged.form_definition as unknown as Json,
    },
  );
  if (error || !data)
    throw new Error(error?.message ?? "Could not apply template");
  return {
    tenant_template_id: data,
    preview: await previewTemplateApplication(
      tenantId,
      source.id,
      source.version,
    ),
  };
}

export async function updateAgentTemplate(tenantId: string, userId: string) {
  const current = await getAgentTemplate(tenantId, userId);
  if (!current.latest) return current;
  await applyTemplate(
    tenantId,
    userId,
    current.latest.id,
    current.latest.version,
  );
  return getAgentTemplate(tenantId, userId);
}

function validateValidation(value: unknown): value is TemplateValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    ["min", "max", "min_length", "max_length", "age_min", "age_max"].includes(
      key,
    )
      ? typeof item === "number" && Number.isFinite(item)
      : key === "pattern"
        ? typeof item === "string" && item.length <= 200
        : false,
  );
}

function validateCopy(
  fields: TemplateField[],
  stages: TemplateStage[],
  form: TemplateFormDefinition,
) {
  const text = (value: unknown, label: string, max: number) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max
      ? null
      : `${label} must be between 1 and ${max} characters`;
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    !Array.isArray(stages) ||
    !stages.length ||
    !form ||
    !Array.isArray(form.sections) ||
    !form.sections.length
  )
    return "A template copy needs fields, pipeline stages and a form";
  const keys = new Set<string>();
  for (const field of fields) {
    if (
      !field ||
      !TEMPLATE_KEY_PATTERN.test(field.field_key) ||
      keys.has(field.field_key)
    )
      return "Field keys must be unique lowercase names";
    const labelError = text(field.label, "Field labels", 120);
    if (labelError) return labelError;
    if (!TEMPLATE_FIELD_TYPES.includes(field.type))
      return `Unsupported field type for ${field.label}`;
    if (
      !Array.isArray(field.options) ||
      field.options.some(
        (option) => typeof option !== "string" || option.trim().length > 120,
      )
    )
      return `Options for ${field.label} are invalid`;
    if (field.help_text && field.help_text.length > 500)
      return `Help text for ${field.label} is too long`;
    if (!validateValidation(field.validation ?? {}))
      return `Validation for ${field.label} is invalid`;
    keys.add(field.field_key);
  }
  const stageKeys = new Set<string>();
  for (const stage of stages) {
    if (
      !stage ||
      !TEMPLATE_KEY_PATTERN.test(stage.stage_key) ||
      stageKeys.has(stage.stage_key)
    )
      return "Stage keys must be unique lowercase names";
    const labelError = text(stage.label, "Stage labels", 120);
    if (labelError) return labelError;
    if (
      !TEMPLATE_STAGE_TYPES.includes(stage.stage_type) ||
      !/^#[0-9a-fA-F]{6}$/.test(stage.color)
    )
      return `Invalid stage ${stage.label}`;
    stageKeys.add(stage.stage_key);
  }
  for (const section of form.sections) {
    const labelError = text(section.label, "Form section labels", 120);
    if (labelError) return labelError;
    if (!Array.isArray(section.fields))
      return "Form sections must contain fields";
    for (const field of section.fields) {
      const condition = field.show_when ?? field.conditional_on ?? null;
      if (
        !field ||
        !TEMPLATE_KEY_PATTERN.test(field.field_key) ||
        !keys.has(field.field_key)
      )
        return "Form fields must reference a lead field";
      if (
        condition &&
        (!TEMPLATE_KEY_PATTERN.test(condition.field_key) ||
          typeof condition.equals !== "string" ||
          condition.equals.length > 120)
      )
        return "Form conditional rules are invalid";
    }
  }
  // LA-1.4-3: the six section-group switches, and never one that hides the phone or a field
  // required on every form.
  return sectionAvailabilityError(form, fields);
}

export async function updateTenantTemplateCopy(
  tenantId: string,
  id: string,
  input: {
    name: string;
    description: string | null;
    fields: TemplateField[];
    stages: TemplateStage[];
    form_definition: TemplateFormDefinition;
  },
) {
  const validation = validateCopy(
    input.fields,
    input.stages,
    input.form_definition,
  );
  if (validation) throw new Error(validation);
  if (!input.name.trim() || input.name.trim().length > 120)
    throw new Error("Template name must be between 1 and 120 characters");
  if (input.description && input.description.trim().length > 2000)
    throw new Error("Template description cannot exceed 2000 characters");
  const { data, error } = await getSupabaseServiceClient().rpc(
    "admin_update_tenant_template",
    {
      p_tenant_template_id: id,
      p_tenant_id: tenantId,
      p_name: input.name.trim(),
      p_description: input.description?.trim() || null,
      p_fields: input.fields as unknown as Json,
      p_stages: input.stages as unknown as Json,
      p_form_definition: input.form_definition as unknown as Json,
    },
  );
  // The bank field types need 20260925515000; until it is applied the type check refuses them.
  if (error && /tenant_template_fields_type_check/.test(error.message) && input.fields.some((field) => field.type === "bank_routing" || field.type === "bank_account"))
    throw new Error("Bank routing and account fields need a database update that has not been applied yet. Use another type for now.");
  if (error || !data)
    throw new Error(error?.message ?? "Could not save template copy");
  return loadCopy(tenantId, undefined, id);
}

export async function listAgentLeads(
  tenantId: string,
  template: AgentTemplate,
  search: string,
  filterField: string,
  filterValue: string,
  sortField: string,
  direction: "asc" | "desc",
) {
  const allowedFields = new Set(
    template.template.fields.map((field) => field.field_key),
  );
  const safeFilterField = allowedFields.has(filterField) ? filterField : "";
  const safeSortField = allowedFields.has(sortField) ? sortField : "";
  const { data, error } = await getSupabaseServiceClient()
    .from("agent_leads")
    .select(
      "id, product_line, pipeline_id, stage_id, values, created_by, screening_outcome, screening_warning, screening_checked_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("tenant_template_id", template.tenant_template_id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  const normalizedSearch = search.toLocaleLowerCase();
  const normalizedFilter = filterValue.toLocaleLowerCase();
  const leads = (data ?? [])
    .map((lead) => ({
      ...lead,
      values: (lead.values ?? {}) as Record<string, unknown>,
    }))
    .filter(
      (lead) =>
        !normalizedSearch ||
        Object.values(lead.values).some((value) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(normalizedSearch),
        ),
    )
    .filter(
      (lead) =>
        !safeFilterField ||
        !normalizedFilter ||
        String(lead.values[safeFilterField] ?? "")
          .toLocaleLowerCase()
          .includes(normalizedFilter),
    );
  if (safeSortField)
    leads.sort(
      (a, b) =>
        String(a.values[safeSortField] ?? "").localeCompare(
          String(b.values[safeSortField] ?? ""),
          undefined,
          { numeric: true },
        ) * (direction === "desc" ? -1 : 1),
    );
  const creatorIds = [...new Set(leads.map((lead) => lead.created_by).filter((id): id is string => Boolean(id)))];
  const creators = creatorIds.length
    ? await getSupabaseServiceClient().from("users").select("id, name").in("id", creatorIds)
    : { data: [], error: null };
  if (creators.error) throw new Error(`Could not load lead submitters: ${creators.error.message}`);
  const creatorNames = new Map((creators.data ?? []).map((creator) => [creator.id, creator.name]));
  return leads.map((lead) => ({
    ...lead,
    submitter_name: lead.created_by ? creatorNames.get(lead.created_by) ?? "Workspace" : "Workspace",
  }));
}

/**
 * Read-only identity search for the dialer. It never calls the serving RPC, claims a work item,
 * advances cadence, or writes an activity row. Dynamic-field workspace filtering remains on the
 * template-aware list path; this endpoint covers the identity fields used for return-call lookup.
 */
export async function searchAgentLeads(
  tenantId: string,
  template: AgentTemplate,
  search: string,
  limit = 40,
) {
  const normalized = search
    .replace(/[^a-zA-Z0-9@+ _-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 2)
    throw new Error("Enter at least two characters to search");
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const pattern = `*${normalized.replace(/[*]/g, " ")}*`;
  const { data, error } = await getSupabaseServiceClient()
    .from("agent_leads")
    .select(
      "id, product_line, pipeline_id, stage_id, values, screening_outcome, screening_warning, screening_checked_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("tenant_template_id", template.tenant_template_id)
    .or(
      [
        `values->>first_name.ilike.${pattern}`,
        `values->>last_name.ilike.${pattern}`,
        `values->>full_name.ilike.${pattern}`,
        `values->>phone.ilike.${pattern}`,
        `values->>phone_number.ilike.${pattern}`,
        `values->>email.ilike.${pattern}`,
      ].join(","),
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(`Could not search leads: ${error.message}`);
  return (data ?? []).map((lead) => ({
    ...lead,
    values: (lead.values ?? {}) as Record<string, unknown>,
  }));
}

export async function createAgentLead(
  tenantId: string,
  userId: string,
  template: AgentTemplate,
  values: unknown,
  stageKey?: string,
) {
  const normalized = normalizeFormValues(
    template.template.fields,
    template.template.form_definition,
    values,
  );
  if (normalized.error) throw new Error(normalized.error);
  let stage: { pipelineId: string; stage: { id: string } };
  if (stageKey && /^[0-9a-f-]{36}$/i.test(stageKey)) {
    assertUuid(stageKey, "stage id");
    const { data: runtimeStage } = await getSupabaseServiceClient()
      .from("tenant_pipeline_stages")
      .select("id, pipeline_id, is_archived")
      .eq("id", stageKey)
      .eq("is_archived", false)
      .maybeSingle();
    if (!runtimeStage) throw new Error("Choose a valid pipeline stage");
    const { data: pipeline } = await getSupabaseServiceClient()
      .from("tenant_pipelines")
      .select("id")
      .eq("id", runtimeStage.pipeline_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pipeline) throw new Error("Choose a valid pipeline stage");
    stage = { pipelineId: pipeline.id, stage: runtimeStage };
  } else
    stage = await resolveRuntimeStage(
      tenantId,
      stageKey ?? template.template.stages[0]?.stage_key ?? "new",
    );
  const { data, error } = await getSupabaseServiceClient()
    .from("agent_leads")
    .insert({
      tenant_id: tenantId,
      tenant_template_id: template.tenant_template_id,
      template_id: template.assignment.template_id,
      template_version: template.assignment.template_version,
      definition_version: template.assignment.definition_version,
      product_line: template.template.product_code,
      pipeline_id: stage.pipelineId,
      stage_id: stage.stage.id,
      values: normalized.values as Json,
      created_by: userId,
    })
    .select(
      "id, product_line, pipeline_id, stage_id, values, created_at, updated_at",
    )
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Could not create lead");
  return data;
}

type ImportedLeadResult = {
  rowNumber: number;
  lead: ImportedLead;
  created: boolean;
};

/**
 * Commits a vendor's list, and returns what landed alongside what was refused.
 *
 * Two buckets rather than one return value, because LA-2.2 criterion 4 asks the screen to show
 * "what will be imported, rejected and suppressed" — a caller that only learns the imported count
 * cannot tell a clean 4,820-row file from a 5,000-row file with 180 numbers Ray paid for and can
 * never dial. The second number is the one that funds the vendor credit claim in LA-2.19.
 */
export async function importAgentLeads(
  tenantId: string,
  userId: string,
  template: AgentTemplate,
  csv: string,
  stages: Array<{
    id: string;
    name: string;
    pipeline_id?: string;
    is_archived?: boolean;
  }>,
  campaignId?: string | null,
  columnMapping?: Record<string, string | null>,
  /** How slash dates are read. Omitted, they are refused as they always were. */
  dateOrder?: ImportDateOrder | null,
) {
  const rows = parseLeadCsv(
    csv,
    template.template.fields,
    stages,
    columnMapping
      ? sanitizeImportMapping(columnMapping, template.template.fields)
      : undefined,
    dateOrder,
  );
  const validationErrors = rows
    .map((row) => ({
      row,
      error: validateImportValues(template.template.fields, row.values),
    }))
    .find((item) => item.error);
  if (validationErrors?.error)
    throw new Error(
      `Row ${validationErrors.row.rowNumber}: ${validationErrors.error}`,
    );
  const stageById = new Map(
    stages
      .filter((stage) => !stage.is_archived)
      .map((stage) => [stage.id, stage]),
  );
  // A CSV import is a batch action: preflight the whole batch before writing a row. This makes an
  // exhausted scrub allowance fail the import rather than leaving a half-imported, possibly
  // dialable list behind.
  await assertOutboundLimit(tenantId, "monthly_leads_imported", rows.length);
  await assertOutboundLimit(tenantId, "dnc_scrub_lookups", rows.length);
  // Screen each distinct number once, a bounded number at a time. The decision depends only on the
  // tenant and the normalized digits (partner and user are fixed for the batch), and an unbounded
  // fan-out over 20k rows at ~10 round trips each swamped the pool. Duplicates in one file also
  // used to race each other on the screening-cache claim and could time out as `unavailable`.
  // Unparseable phones are screened per row so each keeps its own invalid_phone message.
  const screeningKeys = rows.map((row, index) => {
    try {
      return getUsPhone10Digits(row.values.phone ?? row.values.phone_number);
    } catch {
      return `row:${index}`;
    }
  });
  const distinctScreenings = new Map<string, number>();
  const screeningInputs: unknown[] = [];
  screeningKeys.forEach((key, index) => {
    if (distinctScreenings.has(key)) return;
    distinctScreenings.set(key, screeningInputs.length);
    screeningInputs.push(rows[index].values.phone ?? rows[index].values.phone_number);
  });
  const distinctDecisions = await mapWithConcurrency(
    screeningInputs,
    SCREENING_CONCURRENCY,
    (phone) =>
      screenPartnerPhone({
        tenantId,
        partnerId: null,
        userId,
        phone,
      }),
  );
  const screenings = screeningKeys.map(
    (key) => distinctDecisions[distinctScreenings.get(key)!],
  );

  // A scrub hit rejects the ROW. It used to reject the FILE.
  //
  // LA-2.2's whole purpose is that Ray drops a vendor's file in as it arrived, and its cost example
  // is 5,000 purchased with 180 rejected at scrub and 4,820 imported. Throwing on the first hit
  // made that outcome unreachable: one litigator in a 5,000-row list meant nothing imported and one
  // row number on screen. The only way through was to edit the file by hand — and hand-editing a
  // list to get past a compliance gate is how a suppressed number eventually gets dialed. Dropping
  // the row is both what the task asks for and the safer habit to build.
  //
  // An OUTAGE is different and still fails the whole file. LA-2.3 criterion 4 is "a vendor outage
  // blocks dialing rather than passing numbers through": `unavailable` means we do not know whether
  // this number is safe, and an unknown number must never become a dialable lead. `invalid_phone`
  // is a known answer — the number is not real — so it is a rejection, not an outage.
  const outage = screenings.findIndex(
    (decision) => decision.outcome === "unavailable",
  );
  if (outage >= 0)
    throw new Error(
      `Row ${rows[outage].rowNumber}: ${screenings[outage].message || "Screening could not be completed, so nothing was imported"}`,
    );

  // `internal_dq` is deliberately absent: it means the number matches a lead Ray already has, which
  // the duplicate pass below resolves by reusing that lead rather than by discarding the row. It is
  // not a row he cannot dial, so it is not a scrub rejection and never a vendor credit.
  const REJECTING_OUTCOMES = new Set(["dnc", "tcpa_litigator", "invalid_phone"]);
  const rejected: Array<{
    rowNumber: number;
    phoneDigits: string | null;
    outcome: string;
    detail: string;
  }> = [];
  const rejectedRow = new Set<number>();
  for (let index = 0; index < rows.length; index++) {
    const decision = screenings[index];
    if (!REJECTING_OUTCOMES.has(decision.outcome)) continue;
    rejectedRow.add(index);
    rejected.push({
      rowNumber: rows[index].rowNumber,
      phoneDigits: decision.phoneDigits,
      outcome:
        decision.outcome === "invalid_phone" ? "invalid" : decision.outcome,
      detail: decision.message || decision.outcome,
    });
  }

  // `(row, index)` rather than `rows.indexOf(row)`. The previous version called indexOf five times
  // per row inside the map, which is O(n²) on the file: tolerable at the old 2,000-row cap and
  // roughly two billion comparisons at the 20,000 rows criterion 6 asks for. It was also wrong in
  // principle — indexOf finds the FIRST structurally identical row, so two identical lines in a
  // vendor file would have been stamped with the same screening result.
  const inserts = (rows as LeadImportRow[]).map((row, index) => {
    const stage = stageById.get(row.stageId);
    if (!stage?.pipeline_id)
      throw new Error(`Row ${row.rowNumber}: choose a valid pipeline stage`);
    return {
      tenant_id: tenantId,
      tenant_template_id: template.tenant_template_id,
      template_id: template.assignment.template_id,
      template_version: template.assignment.template_version,
      definition_version: template.assignment.definition_version,
      product_line: template.template.product_code,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      // The age a date of birth implies is stored with every lead, imported ones too (LA-1.4-6).
      values: withDerivedAge(row.values, template.template.fields) as Json,
      ...(campaignId ? { campaign_id: campaignId } : {}),
      screening_result_id: screenings[index]?.resultId ?? null,
      screening_version: screenings[index]?.version ?? null,
      screening_outcome: screenings[index]?.outcome ?? null,
      screening_warning: screenings[index]?.warning?.message ?? null,
      screening_checked_at: screenings[index]?.checkedAt ?? null,
      created_by: userId,
      // LA-2.2-4 and LA-2.6-1: the corrected calling zone and the row's certificate, written in the
      // same transaction as the lead (20260925709610).
      dial_timezone: row.dialTimezone ?? null,
      consent: row.consent ?? null,
    };
  });
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const existing = (await db
    .from("agent_leads")
    .select(
      "id, values, product_line, pipeline_id, stage_id, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)) as LooseResult<ImportedLead[]>;
  if (existing.error)
    throw new Error(
      `Could not check existing imported people: ${existing.error.message}`,
    );
  const phoneMap = new Map<string, ImportedLead>();
  for (const lead of existing.data ?? []) {
    const raw = lead.values?.phone ?? lead.values?.phone_number;
    try {
      const digits = getUsPhone10Digits(raw);
      if (!phoneMap.has(digits)) phoneMap.set(digits, lead);
    } catch {
      /* leads without a usable phone cannot be identity-matched */
    }
  }
  // The rejection evidence (record_campaign_scrub_rejections) is written INSIDE the commit's
  // transaction now (LA-2.2-9, 20260925709610): it used to go first, as its own round trip, so a
  // file that failed on a later row left ledger rows for a list that never imported. See
  // commitLeadImport for the order before that migration — the leads first, the ledger only after.
  const ledger = campaignId
    ? rejected
        .filter((item): item is typeof item & { phoneDigits: string } => Boolean(item.phoneDigits))
        .map((item) => ({
          phone_digits: item.phoneDigits,
          outcome: item.outcome,
          detail: item.detail,
          source_key: `csv:${item.rowNumber}`,
        }))
    : [];

  let costCents = 0;
  if (campaignId) {
    // The cost stamped on each lead is the cost per USABLE record, not per purchased record.
    // LA-2.2: "Allocate over usable rows, not purchased rows, and record both." The campaign row
    // keeps the purchased basis; `tenant_campaign_costs` derives the usable basis from the ledger.
    // This file's own rejections land in the same transaction as its leads, so they are counted
    // into the divisor here rather than read back (projectedUsableCostCents).
    const campaign = (await db
      .from("tenant_campaign_costs")
      .select(
        "campaign_id, total_spend_cents, credits_received_cents, records_purchased, records_rejected, cost_per_record_cents, cost_per_usable_record_cents",
      )
      .eq("tenant_id", tenantId)
      .eq("campaign_id", campaignId)
      .maybeSingle()) as LooseResult<{
      campaign_id: string;
      total_spend_cents: number | null;
      credits_received_cents: number | null;
      records_purchased: number | null;
      records_rejected: number | null;
      cost_per_record_cents: number | null;
      cost_per_usable_record_cents: number | null;
    } | null>;
    // "Choose a valid campaign" is only true of the second case. When the READ itself fails —
    // `tenant_campaign_costs` not deployed, a permission problem — the campaign is fine and that
    // message sends the person hunting for a campaign fault that does not exist. Observed in the
    // browser pass: a valid, selected campaign returned "Choose a valid campaign" on commit.
    if (campaign.error)
      throw new Error(
        `Could not read the cost for this campaign, so nothing was imported: ${campaign.error.message}`,
      );
    if (!campaign.data) throw new Error("Choose a valid campaign");
    // Falling back to the purchased basis when the usable basis is null is correct rather than
    // lazy: null means every purchased row was rejected, and in that case there is no usable row
    // for this cost to be attached to anyway.
    costCents = projectedUsableCostCents(campaign.data, ledger.length);
  }
  const pending: Array<{
    rowNumber: number;
    matchedId: string | null;
    insert: Record<string, unknown>;
    created: boolean;
  }> = [];
  const rowRefs: Array<{
    rowNumber: number;
    pendingIndex: number;
    created: boolean;
  }> = [];
  const pendingPhone = new Map<string, number>();
  for (let index = 0; index < rows.length; index++) {
    // A rejected row is not committed and gets no `rowRefs` entry, so it cannot appear in the
    // returned import result. It exists only in the rejection ledger.
    if (rejectedRow.has(index)) continue;
    const row = rows[index];
    const rawPhone = row.values.phone ?? row.values.phone_number;
    let matched: ImportedLead | undefined;
    try {
      matched = phoneMap.get(getUsPhone10Digits(rawPhone));
    } catch {
      matched = undefined;
    }
    if (matched) {
      const pendingIndex =
        pending.push({
          rowNumber: row.rowNumber,
          matchedId: matched.id,
          // Only the certificate: this vendor's evidence for a person someone else sold first.
          insert: { consent: row.consent ?? null },
          created: false,
        }) - 1;
      rowRefs.push({ rowNumber: row.rowNumber, pendingIndex, created: false });
      continue;
    }
    let normalizedPhone: string | null = null;
    try {
      normalizedPhone = getUsPhone10Digits(rawPhone);
    } catch {
      /* phone-less templates cannot batch-dedupe */
    }
    if (normalizedPhone && pendingPhone.has(normalizedPhone)) {
      rowRefs.push({
        rowNumber: row.rowNumber,
        pendingIndex: pendingPhone.get(normalizedPhone)!,
        created: false,
      });
      continue;
    }
    const pendingIndex =
      pending.push({
        rowNumber: row.rowNumber,
        matchedId: null,
        insert: inserts[index],
        created: true,
      }) - 1;
    if (normalizedPhone) pendingPhone.set(normalizedPhone, pendingIndex);
    rowRefs.push({ rowNumber: row.rowNumber, pendingIndex, created: true });
  }
  // Every row was rejected at scrub. That is a real and complete outcome, not an error: the
  // rejections are recorded, the vendor claim is now provable, and there is nothing to commit. The
  // commit function rejects an empty batch by design, so it must not be called at all.
  // The ledger is still written, on its own: commitLeadImport with no items records it alone.
  const commit = async (items: Array<Record<string, unknown>>) => {
    try {
      return await commitLeadImport({ tenantId, userId, items, batchId: null, spend: null, campaignId: campaignId ?? null, rejections: ledger });
    } catch (error) {
      // No batch and no spend on this path, so the only refusal is a database one, already worded.
      throw error instanceof ImportCommitRefusal ? new Error(error.message) : error;
    }
  };
  if (pending.length === 0) {
    if (ledger.length > 0) await commit([]);
    return { imported: [] as ImportedLeadResult[], rejected };
  }

  // One transaction: the ledger, then the leads (import_agent_lead_batch inside
  // commit_reviewed_lead_import), their zones and certificates.
  const committed = await commit(
    pending.map((item) => ({
      lead_id: item.matchedId,
      ...(item.matchedId ? { consent: item.insert.consent ?? null } : item.insert),
      campaign_id: campaignId,
      cost_cents: costCents,
      source_key: `csv:${item.rowNumber}`,
    })),
  );
  const leadIds = committed.ids;
  if (committed.warning) console.error(`[import] direct import: ${committed.warning}`);

  // Mark the campaign scrubbed, because this import just scrubbed it.
  //
  // `campaigns_servable` requires `scrub_status = 'scrubbed'`, and `serve_next_lead` only admits an
  // attributed lead whose campaign appears there. Nothing in the product ever set that column, so
  // every freshly imported list was attributed and permanently undialable — and the gate was
  // refusing a list that had, in fact, passed. Every row above went through `screenPartnerPhone`,
  // the hits were dropped, and the survivors' rejections are already in the ledger. The scrub is
  // done; this records that it is.
  //
  // AFTER the commit, deliberately. A crash between the two leaves the leads imported and the
  // campaign unscrubbed, so they are not served until somebody marks it — visible and recoverable.
  // Marking first would leave a campaign advertising a scrub that never finished, which is the same
  // mistake in the direction that cannot be noticed.
  //
  // A failure here does not throw: the leads are committed, and reporting the whole import as
  // failed would be a lie that also loses the row ids. It is returned instead, so the caller can
  // say what actually happened rather than the screen implying the list is ready to dial.
  let scrubMarked = false;
  if (campaignId) {
    const marked = await db
      .from("tenant_campaigns")
      .update({ scrub_status: "scrubbed", scrubbed_at: new Date().toISOString(), scrub_error: null })
      .eq("tenant_id", tenantId)
      .eq("id", campaignId)
      .select("id");
    scrubMarked = !marked.error;
    if (marked.error)
      console.error(
        `[import] leads committed but campaign ${campaignId} could not be marked scrubbed; they will not be served until it is: ${marked.error.message}`,
      );
  }
  const loaded = (await db
    .from("agent_leads")
    .select(
      "id, product_line, pipeline_id, stage_id, values, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .in("id", leadIds)) as LooseResult<ImportedLead[]>;
  if (loaded.error)
    throw new Error(
      `Could not read committed import leads: ${loaded.error.message}`,
    );
  // Link each lead to the contact it confidently is (the contact auto-merge test). Best effort:
  // never throws, never creates a contact, and does nothing before migration 20260924326100.
  await linkLeadsToContacts(tenantId, loaded.data ?? []);
  const byId = new Map((loaded.data ?? []).map((lead) => [lead.id, lead]));
  const imported = rowRefs.map((ref) => {
    const item = pending[ref.pendingIndex];
    const lead = byId.get(leadIds[ref.pendingIndex]);
    if (!lead)
      throw new Error(
        `Row ${item.rowNumber}: committed lead could not be reloaded`,
      );
    return { rowNumber: ref.rowNumber, lead, created: ref.created };
  });
  // LA-2.3-9: each row's screening check is linked to the lead it became or was attached to. Best
  // effort: never throws, so the import that just committed is never reported as failed over it.
  const rowIndex = new Map(rows.map((row, index) => [row.rowNumber, index]));
  await linkScreeningAuditsToLeads(tenantId, imported.map((item) => ({ auditId: screenings[rowIndex.get(item.rowNumber) ?? -1]?.auditId, leadId: item.lead.id })));
  // `scrubMarked` travels with the result so a screen can distinguish "imported and dialable" from
  // "imported, but nothing will be served yet". Those look identical from a row count alone, and
  // the second one is the state that used to be permanent.
  return { imported, rejected, scrubMarked };
}
export async function updateAgentLead(
  tenantId: string,
  leadId: string,
  template: AgentTemplate,
  values: unknown,
  stageIdentifier: string,
) {
  const normalized = normalizeFormValues(
    template.template.fields,
    template.template.form_definition,
    values,
  );
  if (normalized.error) throw new Error(normalized.error);
  let pipelineId: string;
  let stageId: string;
  if (stageIdentifier && /^[0-9a-f-]{36}$/i.test(stageIdentifier)) {
    assertUuid(stageIdentifier, "stage id");
    const { data: stage } = await getSupabaseServiceClient()
      .from("tenant_pipeline_stages")
      .select("id, pipeline_id")
      .eq("id", stageIdentifier)
      .maybeSingle();
    if (!stage) throw new Error("Choose a valid pipeline stage");
    pipelineId = stage.pipeline_id;
    stageId = stage.id;
    const { data: pipeline } = await getSupabaseServiceClient()
      .from("tenant_pipelines")
      .select("id")
      .eq("id", pipelineId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pipeline) throw new Error("Choose a valid pipeline stage");
  } else {
    const stage = await resolveRuntimeStage(tenantId, stageIdentifier);
    pipelineId = stage.pipelineId;
    stageId = stage.stage.id;
  }
  const { data, error } = await getSupabaseServiceClient()
    .from("agent_leads")
    .update({
      values: normalized.values as Json,
      product_line: template.template.product_code,
      definition_version: template.assignment.definition_version,
      pipeline_id: pipelineId,
      stage_id: stageId,
    })
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .eq("tenant_template_id", template.tenant_template_id)
    .select(
      "id, product_line, pipeline_id, stage_id, values, created_at, updated_at",
    )
    .single();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  // Independent rows, so one round trip. Their errors used to be dropped, which let the lead's
  // stage drift from its work item and deal without anyone being told.
  const [queueUpdate, dealUpdate] = await Promise.all([
    getSupabaseServiceClient()
      .from("lead_queue")
      .update({ pipeline_id: pipelineId, stage_id: stageId })
      .eq("lead_id", leadId)
      .eq("tenant_id", tenantId),
    getSupabaseServiceClient()
      .from("deal_flow")
      .update({ pipeline_id: pipelineId, stage_id: stageId })
      .eq("lead_id", leadId)
      .eq("tenant_id", tenantId),
  ]);
  if (queueUpdate.error)
    throw new Error(`Could not update lead work item: ${queueUpdate.error.message}`);
  if (dealUpdate.error)
    throw new Error(`Could not update lead deal: ${dealUpdate.error.message}`);
  return data;
}

function ageInYears(value: string) {
  const birth = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate())
  )
    age--;
  return age;
}
function normalizeFormValues(
  fields: TemplateField[],
  form: TemplateFormDefinition | null,
  values: unknown,
): { values: Record<string, unknown>; error: string | null } {
  if (!values || typeof values !== "object" || Array.isArray(values))
    return { values: {}, error: "Lead values must be an object" };
  // `age` is derived from the date of birth and stored with the lead (LA-1.4-6). When the form has no
  // field of that name, a stored age sent back with an edit is not an unknown field: it is dropped
  // here and derived again below.
  const record = fields.some((field) => field.field_key === DERIVED_AGE_KEY)
    ? withDerivedAge(values as Record<string, unknown>, fields)
    : Object.fromEntries(Object.entries(values as Record<string, unknown>).filter(([key]) => key !== DERIVED_AGE_KEY));
  const formFields = form?.sections.flatMap((section) => section.fields) ?? [];
  const active = formFields.length
    ? formFields.filter((item) => {
        const condition = item.show_when ?? item.conditional_on;
        if (!condition) return true;
        const current = record[condition.field_key];
        return Array.isArray(current)
          ? current.includes(condition.equals)
          : String(current ?? "") === condition.equals;
      })
    : fields.map((field) => ({
        field_key: field.field_key,
        is_required: field.is_required,
        show_when: null,
      }));
  const activeKeys = new Set(active.map((item) => item.field_key));
  if (
    Object.keys(record).some(
      (key) =>
        !activeKeys.has(key) &&
        key !== DERIVED_AGE_KEY &&
        record[key] !== undefined &&
        record[key] !== null &&
        record[key] !== "",
    )
  )
    return { values: {}, error: "Lead contains a hidden or unknown field" };
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  const output: Record<string, unknown> = {};
  for (const item of active) {
    const field = fieldMap.get(item.field_key);
    if (!field)
      return { values: {}, error: "Form references an unknown field" };
    let value = record[field.field_key];
    if (field.type === "date" && value === "") value = null;
    if (field.type === "boolean" && value === "") value = null;
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if ((field.is_required || item.is_required) && empty)
      return { values: {}, error: `${field.label} is required` };
    if (empty) {
      if (value === null) output[field.field_key] = null;
      continue;
    }
    if (
      ["text", "long_text", "date", "phone", "email", "ssn", "bank_routing", "bank_account"].includes(
        field.type,
      ) &&
      typeof value !== "string"
    )
      return { values: {}, error: `${field.label} must be text` };
    // Routing (ABA checksum) and account formats, LA-1.4-6. Stored as the digits alone.
    if (field.type === "bank_routing" || field.type === "bank_account") {
      const formatError = bankFormatError(field, value as string);
      if (formatError) return { values: {}, error: formatError };
      value = (value as string).replace(/\D/g, "");
    }
    if (
      ["number", "currency"].includes(field.type) &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.type === "currency" && !Number.isInteger(value)))
    )
      return {
        values: {},
        error: `${field.label} must be a valid ${field.type === "currency" ? "integer-cent amount" : "number"}`,
      };
    if (field.type === "boolean") {
      if (value === "Yes") value = true;
      else if (value === "No") value = false;
      else if (typeof value !== "boolean")
        return { values: {}, error: `${field.label} must be Yes or No` };
    }
    if (
      field.type === "single_select" &&
      (typeof value !== "string" || !field.options.includes(value))
    )
      return {
        values: {},
        error: `${field.label} must use one of the listed options`,
      };
    if (
      field.type === "multi_select" &&
      (!Array.isArray(value) ||
        value.some(
          (item) => typeof item !== "string" || !field.options.includes(item),
        ))
    )
      return { values: {}, error: `${field.label} contains an invalid option` };
    if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value as string))
      return { values: {}, error: `${field.label} must be a valid date` };
    if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(value as string))
      return {
        values: {},
        error: `${field.label} must be a valid email address`,
      };
    if (
      field.type === "phone" &&
      (value as string).replace(/\D/g, "").length < 10
    )
      return {
        values: {},
        error: `${field.label} must include at least 10 digits`,
      };
    if (field.type === "ssn" && !/^\d{3}-?\d{2}-?\d{4}$/.test(value as string))
      return { values: {}, error: `${field.label} must be a valid SSN` };
    const validation = field.validation ?? {};
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? value.length
          : null;
    if (
      (numeric !== null &&
        validation.min !== undefined &&
        typeof value === "number" &&
        value < validation.min) ||
      (numeric !== null &&
        validation.max !== undefined &&
        typeof value === "number" &&
        value > validation.max)
    )
      return {
        values: {},
        error: `${field.label} is outside its allowed range`,
      };
    if (
      (typeof value === "string" &&
        validation.min_length !== undefined &&
        value.length < validation.min_length) ||
      (typeof value === "string" &&
        validation.max_length !== undefined &&
        value.length > validation.max_length)
    )
      return { values: {}, error: `${field.label} has an invalid length` };
    if (
      typeof value === "string" &&
      validation.pattern &&
      !new RegExp(validation.pattern).test(value)
    )
      return { values: {}, error: `${field.label} has an invalid format` };
    if (
      typeof value === "string" &&
      (validation.age_min !== undefined || validation.age_max !== undefined)
    ) {
      const age = ageInYears(value);
      if (
        (validation.age_min !== undefined && age < validation.age_min) ||
        (validation.age_max !== undefined && age > validation.age_max)
      )
        return {
          values: {},
          error: `${field.label} is outside the allowed age range`,
        };
    }
    output[field.field_key] = value;
  }
  return { values: withDerivedAge(output, fields), error: null };
}

export function validateValues(
  fields: TemplateField[],
  values: unknown,
  form?: TemplateFormDefinition | null,
) {
  return normalizeFormValues(fields, form ?? null, values).error;
}

/**
 * CSV imports intentionally have a smaller minimum than an interactive intake form. A purchased
 * list often arrives with the three identity fields; the rest can be completed during review and calls.
 * Keep the normal type/option/format checks, but do not make the form's application fields block
 * the import. Phone, first name, and last name remain mandatory because they are the minimum
 * identity data used for dedupe and follow-up. State and all other fields are optional at import.
 */
export function validateImportValues(
  fields: TemplateField[],
  values: unknown,
) {
  const phoneField = fields.find(isPhoneTemplateField);
  if (!phoneField) return "Import template must include a phone field";
  const missingTemplateFields = ["first_name", "last_name"].filter(
    (key) => !fields.some((field) => field.field_key === key),
  );
  if (missingTemplateFields.length)
    return `Import template is missing required fields: ${missingTemplateFields.join(", ")}`;
  const record = values && typeof values === "object" && !Array.isArray(values)
    ? values as Record<string, unknown>
    : null;
  for (const field of fields.filter(isRequiredLeadImportField)) {
    const value = record?.[field.field_key];
    if (value === undefined || value === null || value === "") return `${field.label} is required`;
  }

  // Passing no form definition validates against the complete field catalog while making every
  // non-phone field optional. The interactive form still uses validateValues and keeps its own
  // required/conditional rules.
  //
  // A state picker accepts every US state at import (LA-2.2-4: "TN must be accepted"). Where a
  // person lives is a fact about the row, not a choice from the form's list — a template limited
  // to the agency's licensed states refused a Tennessee row as "unreadable", when the review's own
  // "outside your licensed states" line is the place to say so.
  return validateValues(
    fields.map((field) => ({
      ...field,
      is_required: false,
      ...(field.field_key === "state" && field.type === "single_select"
        ? { options: [...new Set([...field.options, ...US_STATE_CODES])] }
        : {}),
    })),
    values,
    null,
  );
}

/** Validate one panel correction with the same rules used by partner intake and lead editing. */
export function validateSingleTemplateValue(
  field: TemplateField,
  value: unknown,
  required = field.is_required,
) {
  const result = normalizeFormValues(
    [{ ...field, is_required: required }],
    {
      sections: [
        {
          section_key: "verification",
          label: "Verification",
          fields: [
            {
              field_key: field.field_key,
              is_required: required,
              show_when: null,
            },
          ],
          sort_order: 0,
        },
      ],
    },
    { [field.field_key]: value },
  );
  return result.error;
}

export async function loadFormDraft(
  tenantId: string,
  userId: string,
  productCode: string,
  partnerId?: string | null,
) {
  let request = getSupabaseServiceClient()
    .from("form_drafts")
    .select(
      "id, tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, partner_submission_profile_id, partner_submission_profile_revision, carrier_id, carrier_state, partner_market_access_profile_id, partner_market_access_profile_revision, payload, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("product_code", productCode);
  request = partnerId
    ? request.eq("partner_id", partnerId)
    : request.is("partner_id", null);
  // A partner user can hold several drafts for one product (LA-1.6-5); without a draft id the
  // newest one is "the" draft, as it was when there could only be one.
  let { data, error } = await request
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error &&
    /partner_submission_profile_id|schema cache|column .* does not exist/i.test(
      error.message,
    )
  ) {
    let legacy = getSupabaseServiceClient()
      .from("form_drafts")
      .select(
        "id, tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, payload, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("product_code", productCode);
    legacy = partnerId
      ? legacy.eq("partner_id", partnerId)
      : legacy.is("partner_id", null);
    ({ data, error } = await legacy.maybeSingle());
  }
  if (error) throw new Error(`Could not load form draft: ${error.message}`);
  return data;
}

export async function saveFormDraft(
  tenantId: string,
  userId: string,
  productCode: string,
  template: {
    tenant_template_id: string;
    definition_version: number;
    partner_submission_profile_id?: string | null;
    profile_revision?: number | null;
  },
  payload: unknown,
  partnerId?: string | null,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Draft values must be an object");
  const rpc = partnerId ? "save_partner_form_draft" : "save_form_draft";
  const args = {
    p_tenant_id: tenantId,
    p_partner_id: partnerId ?? null,
    p_user_id: userId,
    p_product_code: productCode,
    p_tenant_template_id: template.tenant_template_id,
    p_definition_version: template.definition_version,
    p_profile_id: template.partner_submission_profile_id ?? null,
    p_profile_revision: template.profile_revision ?? null,
    p_payload: payload as Json,
  };
  let { data, error } = await getSupabaseServiceClient().rpc(
    rpc,
    partnerId
      ? args
      : {
          p_tenant_id: tenantId,
          p_partner_id: null,
          p_user_id: userId,
          p_product_code: productCode,
          p_tenant_template_id: template.tenant_template_id,
          p_definition_version: template.definition_version,
          p_payload: payload as Json,
        },
  );
  // Keep drafts usable while an environment is between application deploy and migration deploy.
  // Once the snapshot function exists, all partner drafts use the immutable profile columns.
  if (
    partnerId &&
    error &&
    /save_partner_form_draft|function|schema cache|not found/i.test(
      error.message,
    )
  ) {
    ({ data, error } = await getSupabaseServiceClient().rpc("save_form_draft", {
      p_tenant_id: tenantId,
      p_partner_id: partnerId,
      p_user_id: userId,
      p_product_code: productCode,
      p_tenant_template_id: template.tenant_template_id,
      p_definition_version: template.definition_version,
      p_payload: payload as Json,
    }));
  }
  if (error || !data)
    throw new Error(error?.message ?? "Could not save form draft");
  return data;
}

export async function deleteFormDraft(
  tenantId: string,
  userId: string,
  productCode: string,
  partnerId?: string | null,
) {
  let request = getSupabaseServiceClient()
    .from("form_drafts")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("product_code", productCode);
  request = partnerId
    ? request.eq("partner_id", partnerId)
    : request.is("partner_id", null);
  const { error } = await request;
  if (error) throw new Error(`Could not clear form draft: ${error.message}`);
}

/* ── LA-1.6-5: a partner user's list of started forms, each addressed by id ─────────────────────── */

const DRAFT_COLUMNS =
  "id, tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, partner_submission_profile_id, partner_submission_profile_revision, carrier_id, carrier_state, partner_market_access_profile_id, partner_market_access_profile_revision, payload, created_at, updated_at";

export type PartnerDraftSummary = {
  id: string;
  product_code: string;
  carrier_id: string | null;
  carrier_state: string | null;
  /** The customer's name as typed so far, or null. */
  label: string | null;
  /** The last four digits of the phone typed so far, or null. */
  phone_last4: string | null;
  answered: number;
  created_at: string;
  updated_at: string;
};

export function summarizePartnerDraft(row: {
  id: string;
  product_code: string;
  carrier_id?: string | null;
  carrier_state?: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}): PartnerDraftSummary {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const phone = textValue(payload, ["phone", "phone_number"])?.replace(/\D/g, "") ?? "";
  return {
    id: row.id,
    product_code: row.product_code,
    carrier_id: row.carrier_id ?? null,
    carrier_state: row.carrier_state ?? null,
    label: fullNameForDuplicate(payload),
    phone_last4: phone.length >= 4 ? phone.slice(-4) : null,
    answered: Object.values(payload).filter(
      (value) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0),
    ).length,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listPartnerFormDrafts(
  tenantId: string,
  userId: string,
  partnerId: string,
): Promise<PartnerDraftSummary[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("form_drafts")
    .select("id, product_code, carrier_id, carrier_state, payload, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("partner_id", partnerId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load drafts: ${error.message}`);
  return (data ?? []).map(summarizePartnerDraft);
}

export async function loadPartnerFormDraftById(
  tenantId: string,
  userId: string,
  partnerId: string,
  draftId: string,
) {
  const { data, error } = await getSupabaseServiceClient()
    .from("form_drafts")
    .select(DRAFT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("partner_id", partnerId)
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(`Could not load form draft: ${error.message}`);
  return data;
}

/**
 * Saves one partner draft by id (p_draft_id) or starts a new one (null). Before
 * 20260925510100 is applied the slot function does not exist, and this falls back to the one-draft-
 * per-product save, which is what the portal did before.
 */
export async function savePartnerFormDraftSlot(
  tenantId: string,
  userId: string,
  partnerId: string,
  productCode: string,
  template: {
    tenant_template_id: string;
    definition_version: number;
    partner_submission_profile_id?: string | null;
    profile_revision?: number | null;
  },
  payload: unknown,
  draftId: string | null,
): Promise<string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Draft values must be an object");
  const { data, error } = await getSupabaseServiceClient().rpc(
    "save_partner_form_draft_slot" as never,
    {
      p_tenant_id: tenantId,
      p_partner_id: partnerId,
      p_user_id: userId,
      p_product_code: productCode,
      p_tenant_template_id: template.tenant_template_id,
      p_definition_version: template.definition_version,
      p_profile_id: template.partner_submission_profile_id ?? null,
      p_profile_revision: template.profile_revision ?? null,
      p_payload: payload as Json,
      p_draft_id: draftId,
    } as never,
  );
  if (error && /save_partner_form_draft_slot|schema cache|Could not find the function/i.test(error.message))
    return saveFormDraft(tenantId, userId, productCode, template, payload, partnerId);
  if (error?.message.includes("form_draft_not_found")) throw new Error("form_draft_not_found");
  if (error?.message.includes("form_draft_limit_reached")) throw new Error("form_draft_limit_reached");
  if (error || !data) throw new Error(error?.message ?? "Could not save form draft");
  return data as unknown as string;
}

export async function deletePartnerFormDraftById(
  tenantId: string,
  userId: string,
  partnerId: string,
  draftId: string,
) {
  const { error } = await getSupabaseServiceClient()
    .from("form_drafts")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("partner_id", partnerId)
    .eq("id", draftId);
  if (error) throw new Error(`Could not clear form draft: ${error.message}`);
}

export type PartnerLeadDuplicate = { leadId: string; matchedOn: string[] };

export class PartnerDuplicateError extends Error {
  constructor(public readonly matches: PartnerLeadDuplicate[]) {
    super(
      "This person matches an existing lead. Confirm the details or provide a justification to continue.",
    );
    this.name = "PartnerDuplicateError";
  }
}

function textValue(values: Record<string, unknown>, keys: string[]) {
  return keys
    .map((key) => values[key])
    .find((value) => typeof value === "string" && value.trim()) as
    string | undefined;
}

function fullNameForDuplicate(values: Record<string, unknown>) {
  return (
    textValue(values, ["full_name", "name"]) ??
    ([textValue(values, ["first_name"]), textValue(values, ["last_name"])]
      .filter(Boolean)
      .join(" ") ||
      null)
  );
}

export async function findPartnerLeadDuplicates(
  tenantId: string,
  values: Record<string, unknown>,
  fields: TemplateField[],
): Promise<PartnerLeadDuplicate[]> {
  const phoneField = fields.find(isPhoneTemplateField);
  const ssnField =
    fields.find(
      (field) =>
        field.type === "ssn" && ["ssn", "ssn_number"].includes(field.field_key),
    ) ?? fields.find((field) => field.type === "ssn");
  let phoneDigits: string | null = null;
  if (
    phoneField &&
    values[phoneField.field_key] !== undefined &&
    values[phoneField.field_key] !== null &&
    values[phoneField.field_key] !== ""
  ) {
    try {
      phoneDigits = getUsPhone10Digits(values[phoneField.field_key]);
    } catch {
      phoneDigits = null;
    }
  }
  const ssnValue = ssnField ? values[ssnField.field_key] : null;
  const ssn = typeof ssnValue === "string" ? ssnValue.replace(/\D/g, "") : null;
  const name = fullNameForDuplicate(values);
  if (!phoneDigits && !ssn) return [];
  const { data, error } = await getSupabaseServiceClient().rpc(
    "find_partner_lead_duplicates",
    {
      p_tenant_id: tenantId,
      p_phone_digits: phoneDigits,
      p_full_name: name,
      p_ssn_digits: ssn,
    },
  );
  if (error)
    throw new Error(`Could not check existing leads: ${error.message}`);
  return (
    (data ?? []) as unknown as Array<{ lead_id: string; matched_on: unknown }>
  ).map((row) => ({
    leadId: row.lead_id,
    matchedOn: Array.isArray(row.matched_on)
      ? row.matched_on.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  }));
}

export async function createPartnerLead(
  tenantId: string,
  partnerId: string,
  userId: string | null,
  template: Awaited<ReturnType<typeof getTenantTemplateForProduct>> & {
    partner_submission_profile_id?: string | null;
    profile_revision?: number | null;
  },
  values: unknown,
  submissionId: string,
  screening: Pick<
    ScreeningDecision,
    "resultId" | "version" | "outcome" | "warning" | "checkedAt"
  > & { auditId?: string | null },
  options: {
    screeningWarningAcknowledged?: boolean;
    /** LA-1.5-4: a new lead over an internal DQ needs a 10–1000 character reason. */
    requireInternalDqReason?: boolean;
    duplicateOverrideJustification?: string | null;
    affiliateLinkId?: string | null;
    affiliateCampaign?: string | null;
    market?: {
      carrier_id: string;
      state: string;
      profile_id: string | null;
      revision: number | null;
    };
  } = {},
) {
  const normalized = normalizeFormValues(
    template.template.fields,
    template.template.form_definition,
    values,
  );
  if (normalized.error) throw new Error(normalized.error);
  // LA-1.5-10: a lead only stores a screening result from a version this build can read.
  if (!isKnownScreeningVersion(screening.version))
    throw new Error("unknown_screening_version");
  const supabase = getSupabaseServiceClient();
  const selected =
    "id, product_line, partner_id, submission_id, pipeline_id, stage_id, values, affiliate_link_id, affiliate_campaign, screening_outcome, screening_warning, screening_warning_acknowledged, screening_warning_acknowledged_at, duplicate_override_justification, duplicate_override_by, duplicate_override_at, screening_checked_at, created_at, updated_at";
  const loadExisting = () =>
    supabase
      .from("agent_leads")
      .select(selected)
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("submission_id", submissionId)
      .maybeSingle();
  const existing = await loadExisting();
  if (existing.error)
    throw new Error(
      `Could not check submission status: ${existing.error.message}`,
    );
  if (
    screening.warning?.code === "dnc" &&
    !options.screeningWarningAcknowledged
  )
    throw new Error("dnc_acknowledgement_required");
  const duplicates = await findPartnerLeadDuplicates(
    tenantId,
    normalized.values,
    template.template.fields,
  );
  const justification = options.duplicateOverrideJustification?.trim() || null;
  const externalDuplicates = duplicates.filter(
    (duplicate) => duplicate.leadId !== existing.data?.id,
  );
  if (
    externalDuplicates.length &&
    (!justification || justification.length < 10 || justification.length > 1000)
  ) {
    // A replay can arrive just after the first request has passed its initial lookup. Give the
    // unique submission key a bounded chance to resolve before presenting a duplicate challenge.
    if (!existing.data) {
      for (const delay of [25, 50, 100]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const racing = await loadExisting();
        if (racing.error)
          throw new Error(
            `Could not check submission status: ${racing.error.message}`,
          );
        if (racing.data) return { lead: racing.data, replayed: true as const };
      }
    }
    throw new PartnerDuplicateError(externalDuplicates);
  }
  // A replay's own lead makes its number look like an internal DQ. That is not a new match: the
  // replay neither asks for a reason nor rewrites the screening the first request stored.
  const replayOwnMatch =
    Boolean(existing.data) &&
    screening.outcome === "internal_dq" &&
    existing.data?.screening_outcome !== "internal_dq";
  if (
    options.requireInternalDqReason &&
    screening.outcome === "internal_dq" &&
    !existing.data &&
    (!justification || justification.length < 10 || justification.length > 1000)
  ) {
    for (const delay of [25, 50, 100]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const racing = await loadExisting();
      if (racing.error)
        throw new Error(
          `Could not check submission status: ${racing.error.message}`,
        );
      if (racing.data) return { lead: racing.data, replayed: true as const };
    }
    throw new Error("internal_dq_reason_required");
  }
  const partnerType = await partnerTypeForLead(tenantId, partnerId);
  // The partner-type pipeline's entry stage ("New Transfer" for a publisher), LA-1.9-4.
  const stage = await resolvePartnerEntryStage(tenantId, partnerType);
  const warningAcknowledged =
    screening.warning?.code === "dnc" &&
    Boolean(options.screeningWarningAcknowledged);
  const metadata = {
    values: normalized.values as Json,
    screening_result_id: screening.resultId,
    screening_version: screening.version,
    screening_outcome: screening.outcome,
    screening_warning: screening.warning?.message ?? null,
    screening_warning_acknowledged: warningAcknowledged,
    screening_warning_acknowledged_at: warningAcknowledged
      ? new Date().toISOString()
      : null,
    duplicate_override_justification: justification,
    duplicate_override_by: justification ? userId : null,
    duplicate_override_at: justification ? new Date().toISOString() : null,
    screening_checked_at: screening.checkedAt,
    ...(options.affiliateLinkId
      ? {
          affiliate_link_id: options.affiliateLinkId,
          affiliate_campaign: options.affiliateCampaign ?? null,
        }
      : {}),
  };
  const updateExisting = async (leadId: string) => {
    const replayMetadata = replayOwnMatch
      ? {
          values: metadata.values,
          ...(options.affiliateLinkId
            ? {
                affiliate_link_id: options.affiliateLinkId,
                affiliate_campaign: options.affiliateCampaign ?? null,
              }
            : {}),
        }
      : metadata;
    const updated = await supabase
      .from("agent_leads")
      .update(replayMetadata)
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("submission_id", submissionId)
      .select(selected)
      .single();
    if (updated.error || !updated.data)
      throw new Error(
        updated.error?.message ?? "Could not update the existing submission",
      );
    return updated.data;
  };
  // LA-2.3-9: the check ran before the lead existed, so its audit row is linked now. Best effort:
  // linkScreeningAuditToLead logs a failure and never throws, so the submit cannot fail on it.
  const linkAudit = (leadId: unknown) =>
    linkScreeningAuditToLead({ tenantId, auditId: screening.auditId, leadId: typeof leadId === "string" ? leadId : null });
  if (existing.data) {
    await linkAudit(existing.data.id);
    return {
      lead: await updateExisting(existing.data.id),
      replayed: true as const,
    };
  }
  const insertValues = {
    tenant_id: tenantId,
    tenant_template_id: template.tenant_template_id,
    template_id: template.assignment.template_id,
    template_version: template.assignment.template_version,
    definition_version: template.assignment.definition_version,
    product_line: template.template.product_code,
    partner_id: partnerId,
    submission_id: submissionId,
    pipeline_id: stage.pipelineId,
    stage_id: stage.stage.id,
    values: normalized.values as Json,
    created_by: userId,
    partner_submission_profile_id:
      template.partner_submission_profile_id ?? null,
    partner_submission_profile_revision: template.profile_revision ?? null,
    carrier_id: options.market?.carrier_id ?? null,
    carrier_state: options.market?.state ?? null,
    partner_market_access_profile_id: options.market?.profile_id ?? null,
    partner_market_access_profile_revision: options.market?.revision ?? null,
    screening_result_id: screening.resultId,
    screening_version: screening.version,
    screening_outcome: screening.outcome,
    screening_warning: screening.warning?.message ?? null,
    screening_warning_acknowledged: warningAcknowledged,
    screening_warning_acknowledged_at: warningAcknowledged
      ? new Date().toISOString()
      : null,
    duplicate_override_justification: justification,
    duplicate_override_by: justification ? userId : null,
    duplicate_override_at: justification ? new Date().toISOString() : null,
    screening_checked_at: screening.checkedAt,
    ...(options.affiliateLinkId
      ? {
          affiliate_link_id: options.affiliateLinkId,
          affiliate_campaign: options.affiliateCampaign ?? null,
        }
      : {}),
  };
  let { data, error } = await supabase
    .from("agent_leads")
    .insert(insertValues)
    .select(selected)
    .single();
  if (
    error &&
    /partner_submission_profile_id|schema cache|column .* does not exist/i.test(
      error.message,
    )
  ) {
    const legacyValues = Object.fromEntries(
      Object.entries(insertValues).filter(
        ([key]) =>
          ![
            "partner_submission_profile_id",
            "partner_submission_profile_revision",
            "carrier_id",
            "carrier_state",
            "partner_market_access_profile_id",
            "partner_market_access_profile_revision",
          ].includes(key),
      ),
    );
    ({ data, error } = await supabase
      .from("agent_leads")
      .insert(legacyValues as never)
      .select(selected)
      .single());
  }
  if (!error && data) {
    await linkAudit((data as { id?: unknown }).id);
    return { lead: data, replayed: false };
  }
  if (error?.code === "23505") {
    const existing = await supabase
      .from("agent_leads")
      .select(selected)
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (existing.error || !existing.data)
      throw new Error(
        existing.error?.message ?? "Could not resolve duplicate submission",
      );
    await linkAudit(existing.data.id);
    return { lead: await updateExisting(existing.data.id), replayed: true };
  }
  throw new Error(error?.message ?? "Could not submit lead");
}
/**
 * The consent evidence for one lead, as the export renders it.
 *
 * LA-2.6 criterion 6: "Certificates are included in a data export." The export carried the stage
 * and the template fields and nothing else, which meant the one artefact the task exists to produce
 * — the thing "a regulator or a plaintiff's lawyer asks for" — was the one thing you could not get
 * out of the system.
 */
export type LeadConsentExport = {
  provider: string | null;
  certificate_id: string | null;
  certificate_url: string | null;
  consent_timestamp: string | null;
  captured_at: string | null;
  claimed_at: string | null;
  capture_status: string | null;
  stored_ref: string | null;
};

/**
 * The most recent consent artefact for each of the given leads.
 *
 * Most recent, not all: a lead re-posted by two vendors can carry two certificates, and the export
 * has one row per lead. The newest capture is the one that describes the consent currently being
 * relied on, and the full history stays in `tenant_consent_artefacts` for anyone who needs it.
 */
export async function consentForLeads(
  tenantId: string,
  leadIds: string[],
): Promise<Map<string, LeadConsentExport>> {
  const byLead = new Map<string, LeadConsentExport>();
  if (leadIds.length === 0) return byLead;

  const db = getSupabaseServiceClient() as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: unknown): ConsentQuery;
      };
    };
  };
  type ConsentQuery = PromiseLike<LooseResult<Array<LeadConsentExport & { lead_id: string }> | null>> & {
    in(column: string, values: unknown[]): ConsentQuery;
    order(column: string, options?: { ascending?: boolean }): ConsentQuery;
    range(from: number, to: number): ConsentQuery;
  };
  // `stored_copy` is not read (it can be large); `claimed_at` says a copy was taken.
  const COLUMNS = "lead_id, provider, certificate_id, certificate_url, consent_timestamp, captured_at, claimed_at, capture_status, stored_ref";
  const keep = (rows: Array<LeadConsentExport & { lead_id: string }> | null, wanted: Set<string> | null) => {
    for (const row of rows ?? []) {
      // Ordered newest first, so the first row seen for a lead is the one to keep.
      // A posted TrustedForm certificate filed before its id was taken from the URL still exports one.
      if ((!wanted || wanted.has(row.lead_id)) && !byLead.has(row.lead_id)) byLead.set(row.lead_id, { ...row, certificate_id: row.certificate_id ?? trustedFormCertificateId(row.certificate_url) });
    }
  };
  // One retry for a dropped connection: a full export makes many reads, and one "fetch failed"
  // among them used to fail the whole export with a 500 (LA-2.6-6).
  const read = async (query: () => ConsentQuery) => {
    let result = await query();
    if (result.error && /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(result.error.message)) result = await query();
    // Reported, not swallowed. An export that silently omits the consent columns because a query
    // failed looks exactly like an export of leads that have no certificates — and the whole point
    // of this column is to tell those two apart.
    if (result.error) throw new Error(`Could not load consent certificates: ${result.error.message}`);
    return result.data;
  };

  // A few hundred leads: their ids, in chunks — the ids travel in the request URL, and a full
  // export of 1,000 made that URL too long for PostgREST. A lead's rows all fall in one chunk.
  const CHUNK = 150;
  if (leadIds.length <= CHUNK * 4) {
    for (let start = 0; start < leadIds.length; start += CHUNK) {
      const ids = leadIds.slice(start, start + CHUNK);
      keep(await read(() => db.from("tenant_consent_artefacts").select(COLUMNS).eq("tenant_id", tenantId).in("lead_id", ids).order("captured_at", { ascending: false })), null);
    }
    return byLead;
  }

  // A whole book: every certificate the tenant holds, a page at a time, kept for the exported leads.
  // Fewer reads than 15,000 ids in 100 chunks, and no id list in any URL.
  const wanted = new Set(leadIds);
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const page = await read(() =>
      db.from("tenant_consent_artefacts").select(COLUMNS).eq("tenant_id", tenantId)
        .order("captured_at", { ascending: false }).order("id", { ascending: true }).range(from, from + PAGE - 1),
    );
    keep(page, wanted);
    if (!page || page.length < PAGE) break;
  }
  return byLead;
}

/**
 * Every lead the book-of-business export covers, paged past PostgREST's row cap.
 *
 * LA-2.6-6: posted leads never reached the export — a lead posted by a vendor has no
 * `tenant_template_id`, and the export filtered on it, so the only leads that carry certificates
 * were the ones left out. A lead with no template copy is exported when it is this product's.
 * The same search, filter and sort as the leads list.
 */
export async function exportAgentLeads(
  tenantId: string,
  template: AgentTemplate,
  search: string,
  filterField: string,
  filterValue: string,
  sortField: string,
  direction: "asc" | "desc",
) {
  type ExportLead = { id: string; stage_id: string; values: Record<string, unknown> | null; created_at: string };
  type PageQuery = PromiseLike<LooseResult<ExportLead[] | null>> & {
    eq(column: string, value: unknown): PageQuery;
    or(filters: string): PageQuery;
    order(column: string, options?: { ascending?: boolean }): PageQuery;
    range(from: number, to: number): PageQuery;
  };
  const db = getSupabaseServiceClient() as unknown as { from(table: string): { select(columns: string): PageQuery } };
  const allowedFields = new Set(template.template.fields.map((field) => field.field_key));
  const safeFilterField = allowedFields.has(filterField) ? filterField : "";
  const safeSortField = allowedFields.has(sortField) ? sortField : "";
  const product = template.template.product_code.replace(/[^a-z0-9_]/gi, "");
  const PAGE = 1000;
  const leads: Array<ExportLead & { values: Record<string, unknown> }> = [];
  for (let from = 0; ; from += PAGE) {
    const page = await db
      .from("agent_leads")
      .select("id, stage_id, values, created_at")
      .eq("tenant_id", tenantId)
      .or(`tenant_template_id.eq.${template.tenant_template_id},and(tenant_template_id.is.null,product_line.eq.${product})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (page.error) throw new Error(`Could not load leads: ${page.error.message}`);
    for (const lead of page.data ?? []) leads.push({ ...lead, values: (lead.values ?? {}) as Record<string, unknown> });
    if (!page.data || page.data.length < PAGE) break;
  }
  const needle = search.toLocaleLowerCase();
  const filter = filterValue.toLocaleLowerCase();
  const matched = leads
    .filter((lead) => !needle || Object.values(lead.values).some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)))
    .filter((lead) => !safeFilterField || !filter || String(lead.values[safeFilterField] ?? "").toLocaleLowerCase().includes(filter));
  if (safeSortField)
    matched.sort((a, b) => String(a.values[safeSortField] ?? "").localeCompare(String(b.values[safeSortField] ?? ""), undefined, { numeric: true }) * (direction === "desc" ? -1 : 1));
  return matched;
}

export function csvForLeads(
  fields: TemplateField[],
  stages: Array<{ id: string; name: string }>,
  leads: Array<{ id?: string; stage_id: string; values: Record<string, unknown> }>,
  consentByLead?: Map<string, LeadConsentExport>,
) {
  const escape = (value: unknown) => {
    const text = Array.isArray(value)
      ? value.join("|")
      : value === null || value === undefined
        ? ""
        : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  // The consent columns are appended only when the caller supplied the evidence, so an export that
  // does not need them keeps its existing shape and any saved spreadsheet template still opens.
  const consentColumns: Array<[string, (value: LeadConsentExport | undefined) => unknown]> = [
    ["consent_provider", (value) => value?.provider ?? ""],
    ["consent_certificate_id", (value) => value?.certificate_id ?? ""],
    ["consent_certificate_url", (value) => value?.certificate_url ?? ""],
    ["consent_timestamp", (value) => value?.consent_timestamp ?? ""],
    ["consent_captured_at", (value) => value?.captured_at ?? ""],
    ["consent_claimed_at", (value) => value?.claimed_at ?? ""],
    // The status says whether the stored copy exists. LA-2.6: an unclaimed TrustedForm certificate
    // expires, so "we have a URL" and "we have the evidence" are different facts, and a row that
    // reported only the URL would look like proof it is not.
    ["consent_capture_status", (value) => value?.capture_status ?? (value ? "captured" : "none")],
    // A claim stores the copy in `stored_copy` (never read here) and stamps `claimed_at`.
    ["consent_stored_copy", (value) => (value?.stored_ref || value?.claimed_at || value?.capture_status === "claimed" ? "yes" : "no")],
  ];
  const withConsent = Boolean(consentByLead);

  return (
    [
      [
        "stage",
        ...fields.map((field) => field.field_key),
        ...(withConsent ? consentColumns.map(([header]) => header) : []),
      ]
        .map(escape)
        .join(","),
      ...leads.map((lead) => {
        const consent = lead.id ? consentByLead?.get(lead.id) : undefined;
        return [
          stages.find((stage) => stage.id === lead.stage_id)?.name ??
            "Unknown stage",
          ...fields.map((field) => lead.values[field.field_key]),
          ...(withConsent
            ? consentColumns.map(([, read]) => read(consent))
            : []),
        ]
          .map(escape)
          .join(",");
      }),
    ].join("\r\n") + "\r\n"
  );
}

export { PRODUCT_CODE };
