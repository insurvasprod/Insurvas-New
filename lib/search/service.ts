import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { allMenuItems } from "@/lib/menu/definition";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { searchSettings } from "@/lib/settings/registry";
import { matchActions, suggestedActions, type WorkspaceAction } from "@/lib/search/actions";
import type { TenantRole } from "@/lib/tenantAuth/roles";

/**
 * Workspace search.
 *
 * The product had thirty destinations in a sidebar and no way to reach a lead by name. This is
 * that: one query, answered from the things a person actually looks for, plus the pages
 * themselves so the sidebar stops being the only way to navigate.
 *
 * Two rules the shape of this file exists to keep:
 *
 *   · TENANT SCOPE IS NOT A FILTER. Every source below is constrained by `tenant_id` in the query
 *     itself. There is no "search everything then hide what you cannot see" path, because that is
 *     the version that leaks when one branch forgets.
 *
 *   · A BROKEN SOURCE IS AN EMPTY SOURCE. Each lookup is independently caught. If the campaigns
 *     table is unavailable, leads still answer — a search box that returns nothing because one of
 *     four queries failed is worse than one that returns three quarters of the truth.
 */

/** The tenant search's own groups, in the order they are shown. */
export type SearchGroup = "Actions" | "Leads" | "Policies" | "Lead lists" | "Partners" | "Pages" | "Settings";

/**
 * `group` is a display heading, not a discriminator — staff search by tenant and invoice, a partner
 * searches their own submissions, and each names its groups for the person reading them.
 */
export type SearchHit = {
  group: string;
  title: string;
  meta: string;
  href: string;
};

/**
 * Who may be offered each group: the feature and roles of the page a result opens, copied from that
 * page's own guard. A result is a door, and search must never offer one the person will find locked.
 */
const ACCESS = {
  leads: { feature: "book_of_business", roles: ["owner", "producer", "assistant"] },
  policies: { feature: "book_of_business", roles: ["owner", "producer", "bookkeeper"] },
  leadLists: { feature: "lead_import", roles: ["owner", "producer", "assistant"] },
  partners: { feature: "publisher_records", roles: ["owner", "bookkeeper"] },
} satisfies Record<string, { feature: string; roles: TenantRole[] }>;

/** Final expense is said "FE" on the floor, and the artboard's meta line says it the same way. */
const PRODUCT_SHORT: Record<string, string> = { final_expense: "FE" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

/** PostgREST `ilike` wants `*` rather than `%`, and a literal `*` in the needle would widen it. */
// `,` `(` `)` `"` and `\` are syntax inside PostgREST's .or() filter, so "Smith, John" used to break the
// whole clause and the panel said "Nothing matches". A space matches them just as well.
function pattern(term: string) {
  return `*${term.replace(/[*%,()"\\]/g, " ")}*`;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function leadName(values: Record<string, unknown>) {
  return (
    text(values.full_name) ||
    [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") ||
    text(values.name) ||
    "Unnamed lead"
  );
}

/**
 * Stage names for a page of leads. Read from `stage_id`, never `stage_key`: the text copy was
 * frozen at insert and says "new" on every row (lib/pipelines/stageStoredOnce.test.mjs). A lookup
 * that fails leaves the stage off the line rather than guessing it.
 */
export async function stageNames(tenantId: string, stageIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(stageIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  // Stages carry no tenant_id of their own; they are scoped through their pipeline, so the tenant
  // is enforced on the join rather than trusted from the ids.
  const { data, error } = await db()
    .from("tenant_pipeline_stages")
    .select("id, name, tenant_pipelines!inner(tenant_id)")
    .eq("tenant_pipelines.tenant_id", tenantId)
    .in("id", ids);
  if (error) return new Map();
  return new Map((data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
}

async function searchLeads(tenantId: string, term: string): Promise<SearchHit[]> {
  const like = pattern(term);
  const { data, error } = await db()
    .from("agent_leads")
    .select("id, values, product_line, stage_id, screening_outcome, updated_at")
    .eq("tenant_id", tenantId)
    .or([
      `values->>first_name.ilike.${like}`,
      `values->>last_name.ilike.${like}`,
      `values->>full_name.ilike.${like}`,
      `values->>phone.ilike.${like}`,
      `values->>phone_number.ilike.${like}`,
      `values->>email.ilike.${like}`,
    ].join(","))
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; values: Record<string, unknown> | null; product_line: string | null; stage_id: string | null; screening_outcome: string | null }[];
  const stages = await stageNames(tenantId, rows.map((row) => row.stage_id));
  return rows.map((row) => {
    const values = (row.values ?? {}) as Record<string, unknown>;
    const meta = [
      row.product_line ? PRODUCT_SHORT[row.product_line] ?? row.product_line.replace(/_/g, " ") : null,
      row.stage_id ? stages.get(row.stage_id) ?? null : null,
      text(values.state) || null,
      row.screening_outcome === "blocked" ? "screening blocked" : null,
    ].filter(Boolean).join(" · ");
    return { group: "Leads" as const, title: leadName(values), meta, href: `/app/leads/${row.id}` };
  });
}

/** By policy number or insured, which are the two things a person reads off a carrier email. */
async function searchPolicies(tenantId: string, term: string): Promise<SearchHit[]> {
  const like = pattern(term);
  const { data, error } = await db()
    .from("tenant_policies")
    .select("id, policy_number, insured_name, carrier, annual_premium_cents, status")
    .eq("tenant_id", tenantId)
    .or([`policy_number.ilike.${like}`, `insured_name.ilike.${like}`].join(","))
    .order("effective_date", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { policy_number: string; insured_name: string; carrier: string; annual_premium_cents: number; status: string }) => ({
    group: "Policies" as const,
    title: `${row.policy_number} · ${row.insured_name}`,
    // Monthly, because that is the figure the customer agreed to on the phone.
    meta: [row.carrier, `$${(Number(row.annual_premium_cents) / 1200).toFixed(2)}/mo`, row.status].join(" · "),
    // The book has no per-policy page; the list is where a policy is read and edited.
    href: "/app/policies",
  }));
}

/**
 * What arrived and how much of it has an owner — the lead-list screen's own two numbers, counted
 * the way it counts them. A count that fails leaves the list findable with less said about it.
 */
async function listProgress(tenantId: string, campaignId: string) {
  const [received, assigned] = await Promise.all([
    db().from("agent_leads").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("campaign_id", campaignId),
    db().from("agent_leads")
      .select("id, lead_queue!lead_queue_lead_id_fkey!inner(owner_user_id)", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("campaign_id", campaignId)
      .eq("lead_queue.tenant_id", tenantId)
      .not("lead_queue.owner_user_id", "is", null),
  ]);
  if (received.error || assigned.error) return null;
  return { received: Number(received.count ?? 0), assigned: Number(assigned.count ?? 0) };
}

async function searchLeadLists(tenantId: string, term: string): Promise<SearchHit[]> {
  const { data, error } = await db()
    .from("tenant_campaigns")
    .select("id, name, status, records_purchased")
    .eq("tenant_id", tenantId)
    .ilike("name", pattern(term))
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; name: string; status: string; records_purchased: number }[];
  const progress = await Promise.all(rows.map((row) => listProgress(tenantId, row.id).catch(() => null)));
  return rows.map((row, index) => {
    const counts = progress[index];
    const purchased = Number(row.records_purchased ?? 0);
    const meta = counts
      ? [
          // A list with no purchase recorded says what arrived, not "3 received of 0".
          purchased
            ? `${counts.received.toLocaleString()} received of ${purchased.toLocaleString()}`
            : `${counts.received.toLocaleString()} received`,
          counts.received ? `${Math.round((counts.assigned / counts.received) * 100)}% assigned` : "nothing assigned",
        ]
      : [`${purchased.toLocaleString()} purchased`, row.status];
    // The list itself, not the index it sits in.
    return { group: "Lead lists" as const, title: row.name, meta: meta.join(" · "), href: `/app/lead-lists/${row.id}` };
  });
}

async function searchPartners(tenantId: string, term: string): Promise<SearchHit[]> {
  const like = pattern(term);
  const { data, error } = await db()
    .from("partners")
    .select("id, name, partner_type, status, contact_email")
    .eq("tenant_id", tenantId)
    .or([`name.ilike.${like}`, `contact_name.ilike.${like}`, `contact_email.ilike.${like}`].join(","))
    .order("name", { ascending: true })
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string; name: string; partner_type: string; status: string; contact_email: string | null }) => ({
    group: "Partners" as const,
    title: row.name,
    meta: [row.partner_type, row.status, row.contact_email].filter(Boolean).join(" · "),
    href: `/app/publishers/${row.id}`,
  }));
}

/**
 * The destinations themselves. Filtered by what this person's plan and role actually grant, so
 * search never offers a door that is locked — the gate screens exist for URLs people type, not
 * for suggestions the product made itself.
 */
function searchPages(term: string, granted: Set<string>, role: TenantRole): SearchHit[] {
  const needle = term.toLowerCase();
  const pages: SearchHit[] = allMenuItems()
    .filter((item) => !item.required_feature || granted.has(item.required_feature))
    .filter((item) => !item.required_roles || item.required_roles.includes(role))
    .filter((item) => item.label.toLowerCase().includes(needle) || item.sectionLabel.toLowerCase().includes(needle))
    .map((item) => ({
      group: "Pages" as const,
      title: item.label,
      meta: item.blurb ?? item.sectionLabel,
      href: item.path,
    }));
  return pages.slice(0, 5);
}

/**
 * Settings (LA-8.1): every registered section and the individual settings inside them, each gated
 * by its own feature and role, so search never offers a setting that would answer 403. A setting
 * lands on its anchor, not the top of its page. A section that is also a menu page is offered once.
 */
function searchSettingsHits(term: string, granted: Set<string>, role: TenantRole, pages: readonly SearchHit[], hidden: readonly string[] = []): SearchHit[] {
  const taken = new Set(pages.map((hit) => hit.href));
  const sections = hidden.length ? SETTINGS_SECTIONS.filter((section) => !hidden.includes(section.id)) : SETTINGS_SECTIONS;
  return searchSettings(sections, granted, role, term)
    .filter((hit) => !taken.has(hit.href))
    .map((hit) => ({ group: "Settings" as const, title: hit.title, meta: hit.meta, href: hit.href }));
}

function can(access: { feature: string; roles: TenantRole[] }, granted: Set<string>, role: TenantRole) {
  return granted.has(access.feature) && access.roles.includes(role);
}

/**
 * Group order is fixed: something to do first (2026-10-09 — "book an appointment" should not sit
 * under three leads called Book), then what you were looking for, where you could go last.
 */
const ORDER: SearchGroup[] = ["Actions", "Leads", "Policies", "Lead lists", "Partners", "Pages", "Settings"];

const actionHit = (action: WorkspaceAction): SearchHit => ({ group: "Actions", title: action.title, meta: action.meta, href: action.href });

/** What the box offers before anything is typed: the everyday actions this person may take. */
export function suggestWorkspace(input: { role: TenantRole; grantedFeatures: Iterable<string> }): { hits: SearchHit[]; total: number; truncated: boolean } {
  const hits = suggestedActions(input.grantedFeatures, input.role).map(actionHit);
  return { hits, total: hits.length, truncated: false };
}

export async function searchWorkspace(input: {
  tenantId: string;
  role: TenantRole;
  grantedFeatures: Iterable<string>;
  /** Settings section ids the settings page hides for this agency's plan (planHiddenSettingsSections). */
  hiddenSettings?: readonly string[];
  query: string;
  limit?: number;
}): Promise<{ hits: SearchHit[]; total: number; truncated: boolean }> {
  const term = input.query.replace(/\s+/g, " ").trim();
  if (term.length < 2) return { hits: [], total: 0, truncated: false };

  const granted = new Set(input.grantedFeatures);
  const allowed = (access: { feature: string; roles: TenantRole[] }) => can(access, granted, input.role);
  const none = Promise.resolve([] as SearchHit[]);

  const settled = await Promise.allSettled([
    allowed(ACCESS.leads) ? searchLeads(input.tenantId, term) : none,
    allowed(ACCESS.policies) ? searchPolicies(input.tenantId, term) : none,
    allowed(ACCESS.leadLists) ? searchLeadLists(input.tenantId, term) : none,
    allowed(ACCESS.partners) ? searchPartners(input.tenantId, term) : none,
  ]);

  const found: SearchHit[] = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const pages = searchPages(term, granted, input.role);
  found.push(...pages, ...searchSettingsHits(term, granted, input.role, pages, input.hiddenSettings));
  found.push(...matchActions(term, granted, input.role).map(actionHit));

  const ranked = ORDER.flatMap((group) => found.filter((hit) => hit.group === group));
  const limit = Math.min(20, Math.max(1, input.limit ?? 7));
  return { hits: ranked.slice(0, limit), total: ranked.length, truncated: ranked.length > limit };
}
