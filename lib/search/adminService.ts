import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildAdminNav } from "@/lib/adminNav/build";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { planDisplayName } from "@/lib/plans/display";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { canViewTenants } from "@/lib/tenants/permissions";
import { canViewUsers } from "@/lib/users/permissions";
import type { SearchHit } from "./service";
import { invoiceMeta, membershipLabel, type Membership } from "./adminFormat";

/**
 * Staff search.
 *
 * Deliberately a different file from the tenant one. A member of staff searches across every
 * customer, which is exactly the thing the tenant search must never do — keeping the two apart
 * means neither can grow into the other by accident.
 *
 * Same rule about failure: a source that throws contributes nothing rather than taking the box down.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

function pattern(term: string) {
  return `*${term.replace(/[*%]/g, " ")}*`;
}

async function searchTenants(term: string): Promise<SearchHit[]> {
  const { data, error } = await db()
    .from("tenants")
    .select("id, name, status, plan_code")
    .ilike("name", pattern(term))
    .order("name")
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string; name: string; status: string; plan_code: string | null }) => ({
    group: "Tenants" as const,
    title: row.name,
    meta: [planDisplayName(row.plan_code), row.status.replace(/_/g, " ")].filter(Boolean).join(" · "),
    href: `/admin/tenants/${row.id}`,
  })) as SearchHit[];
}

async function searchUsers(term: string): Promise<SearchHit[]> {
  const like = pattern(term);
  const { data, error } = await db()
    .from("users")
    .select("id, name, email, status, tenant_users(role, tenants(name))")
    .or([`name.ilike.${like}`, `email.ilike.${like}`].join(","))
    .order("name")
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string; name: string | null; email: string | null; status: string; tenant_users: Membership[] | null }) => ({
    group: "Users" as const,
    title: row.name?.trim() || row.email || "Unnamed user",
    meta: [membershipLabel(row.tenant_users, row.email), row.status === "active" ? null : row.status].filter(Boolean).join(" · "),
    href: `/admin/users/${row.id}`,
  })) as SearchHit[];
}

async function searchInvoices(term: string): Promise<SearchHit[]> {
  const { data, error } = await db()
    .from("platform_invoices")
    .select("id, number, status, total_cents, currency, issued_at, paid_at")
    .ilike("number", pattern(term))
    .order("issued_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string; number: string | null; status: string; total_cents: number | null; currency: string | null; issued_at: string | null; paid_at: string | null }) => ({
    group: "Invoices" as const,
    title: row.number ?? "Invoice",
    meta: invoiceMeta(row),
    href: `/admin/invoices/${row.id}`,
  })) as SearchHit[];
}

/** The destinations this role may reach, so search never offers a locked door. */
function searchPages(term: string, role: AdminRole): SearchHit[] {
  const needle = term.toLowerCase();
  const out: SearchHit[] = [];
  for (const node of buildAdminNav(role)) {
    if (node.kind === "link") {
      if (node.label.toLowerCase().includes(needle)) out.push({ group: "Pages", title: node.label, meta: "Admin", href: node.href });
      continue;
    }
    const sectionMatches = node.label.toLowerCase().includes(needle);
    for (const item of node.links) {
      if (sectionMatches || item.label.toLowerCase().includes(needle)) {
        out.push({ group: "Pages", title: item.label, meta: node.label, href: item.href });
      }
    }
  }
  return out.slice(0, 5);
}

const ORDER = ["Tenants", "Users", "Invoices", "Pages"];

export async function searchAdmin(input: { role: AdminRole; query: string; limit?: number }) {
  const term = input.query.replace(/\s+/g, " ").trim();
  if (term.length < 2) return { hits: [], total: 0, truncated: false };

  // Each source is gated by the same permission as the screen it links to. Search is a way into
  // those screens, so it must not show a support agent an invoice or platform_config any customer.
  const none: Promise<SearchHit[]> = Promise.resolve([]);
  const settled = await Promise.allSettled([
    canViewTenants(input.role) ? searchTenants(term) : none,
    canViewUsers(input.role) ? searchUsers(term) : none,
    canViewInvoices(input.role) ? searchInvoices(term) : none,
  ]);
  const found: SearchHit[] = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  found.push(...searchPages(term, input.role));

  const ranked = ORDER.flatMap((group) => found.filter((hit) => hit.group === group));
  const limit = Math.min(20, Math.max(1, input.limit ?? 7));
  return { hits: ranked.slice(0, limit), total: ranked.length, truncated: ranked.length > limit };
}
