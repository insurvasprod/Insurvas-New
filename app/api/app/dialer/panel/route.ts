import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDialerPanel } from "@/lib/dialerScripts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardLead } from "@/lib/agency/guards";
import { scopeFor } from "@/lib/agency/visibility";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/**
 * Board C7b "Not already a client": does anyone with this lead's phone, or its date of birth and last
 * name, hold a policy with this agency (contacts → policy_current)? A yes/no only, never the policy.
 * Every read is filtered to the tenant (the service client has no RLS predicate) and bounded.
 * `unknown` when the lead carries neither, or a read failed: the screen then says it was not checked.
 */
type ClientCheck = { status: "clear" | "client" | "unknown"; basis: "phone" | "date_of_birth" | "lead" | null };
function isoDay(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}
async function clientCheck(db: SupabaseClient, tenantId: string, leadId: string): Promise<ClientCheck> {
  try {
    const lead = await db.from("agent_leads").select("values, contact_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>();
    if (lead.error || !lead.data) return { status: "unknown", basis: null };
    const values = (lead.data.values && typeof lead.data.values === "object" ? lead.data.values : {}) as Row;
    const digits = text(values.phone ?? values.phone_number).replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    const day = isoDay(text(values.date_of_birth ?? values.dob));
    const last = text(values.last_name) || text(values.full_name).split(/\s+/).slice(1).join(" ");
    const own = text(lead.data.contact_id) || null;
    if (ten.length !== 10 && !day && !own) return { status: "unknown", basis: null };
    const [byPhone, byDay] = await Promise.all([
      ten.length === 10 ? db.from("contacts").select("id, primary_phone").eq("tenant_id", tenantId).is("merged_into_id", null).ilike("primary_phone", `%${ten.slice(-4)}`).limit(50) : null,
      day && last ? db.from("contacts").select("id").eq("tenant_id", tenantId).is("merged_into_id", null).eq("dob", day).ilike("last_name", last.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(20) : null,
    ]);
    if (byPhone?.error || byDay?.error) return { status: "unknown", basis: null };
    const phoneIds = ((byPhone?.data ?? []) as Row[]).filter((c) => { const d = text(c.primary_phone).replace(/\D/g, ""); return d.length >= 10 && d.slice(-10) === ten; }).map((c) => text(c.id));
    const dayIds = ((byDay?.data ?? []) as Row[]).map((c) => text(c.id));
    const ids = [...new Set([...(own ? [own] : []), ...phoneIds, ...dayIds].filter(Boolean))];
    if (!ids.length) return { status: "clear", basis: null };
    const held = await db.from("policy_current").select("contact_id").eq("tenant_id", tenantId).in("contact_id", ids).limit(1);
    if (held.error) return { status: "unknown", basis: null };
    const hit = text(((held.data ?? []) as Row[])[0]?.contact_id) || null;
    if (!hit) return { status: "clear", basis: null };
    return { status: "client", basis: phoneIds.includes(hit) ? "phone" : dayIds.includes(hit) ? "date_of_birth" : "lead" };
  } catch {
    return { status: "unknown", basis: null };
  }
}

/** Board C7c "outbound disclosure v4": the wording's place among this state and product's versions so far. */
async function disclosureVersion(db: SupabaseClient, disclosure: { configured?: boolean; state?: string | null; productCode?: string | null; effectiveFrom?: string | null }): Promise<number | null> {
  if (!disclosure.configured || !disclosure.state || !disclosure.productCode || !disclosure.effectiveFrom) return null;
  try {
    const result = await db.from("state_disclosures").select("id", { count: "exact", head: true }).eq("state", disclosure.state).eq("product_code", disclosure.productCode).lte("effective_from", disclosure.effectiveFrom);
    return result.error || !result.count ? null : result.count;
  } catch {
    return null;
  }
}

/**
 * Board C7d: the script as written (its placeholders, not this lead's filled-in words, so an edit saves
 * a template) and who published this version, when. Null for the built-in default script.
 */
async function scriptSource(db: SupabaseClient, tenantId: string, scriptId: string | null): Promise<{ sections: Record<string, string>; updatedBy: string | null; updatedAt: string | null } | null> {
  if (!scriptId) return null;
  try {
    const row = await db.from("tenant_scripts").select("sections, created_by, created_at").eq("tenant_id", tenantId).eq("id", scriptId).maybeSingle<Row>();
    if (row.error || !row.data) return null;
    const author = text(row.data.created_by) ? await db.from("users").select("name").eq("id", text(row.data.created_by)).maybeSingle<Row>() : null;
    const raw = (row.data.sections && typeof row.data.sections === "object" ? row.data.sections : {}) as Row;
    const sections = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return { sections, updatedBy: author && !author.error ? text(author.data?.name) || null : null, updatedAt: text(row.data.created_at) || null };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const leadId = request.nextUrl.searchParams.get("lead_id");
  if (!z.string().uuid().safeParse(leadId).success) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  // AG-0.5: in an agency the lead must be assigned to a producer in the session's scope (404 otherwise,
  // the unassigned pool included); the panel's call history then keeps only visible agents' attempts.
  // Null scope (solo, owner/admin): unchanged.
  const scope = await scopeFor(auth.context);
  const hidden = await guardLead(auth.context, leadId as string);
  if (hidden) return hidden;
  try {
    // Cost per lead is money: owners and producers see it, a setter does not (user decision 2026-09-25). Inside an
    // agency a producer (and a manager) does not either — lead costs are the agency's (AG-0.2: a producer "cannot …
    // lead costs"); scope is null for a solo tenant and for owner/admin, so they are unchanged.
    const includeCost = auth.context.role === "owner" || (auth.context.role === "producer" && scope === null);
    const db = getSupabaseServiceClient() as unknown as SupabaseClient;
    // The phone app's extras (boards C7, C7b, C7c, C7d) ride beside the panel, additively, and never fail it.
    const clientRead = clientCheck(db, auth.context.tenantId, leadId as string);
    const panel = await getDialerPanel({ tenantId: auth.context.tenantId, agentId: auth.context.userId, leadId: leadId as string, campaignId: request.nextUrl.searchParams.get("campaign_id"), productCode: request.nextUrl.searchParams.get("product_code"), includeCost, scope });
    const [client, version, source] = await Promise.all([
      clientRead,
      disclosureVersion(db, panel.disclosure),
      scriptSource(db, auth.context.tenantId, panel.script.id),
    ]);
    return NextResponse.json({ ...panel, client, disclosure: { ...panel.disclosure, version }, scriptSource: source }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load dialer guidance" }, { status: 400 });
  }
}
