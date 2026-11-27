import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";
import { guardWorkItem } from "@/lib/transferInbox/scope";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listLeadNotes } from "@/lib/leadNotes/service";
import { getLeadRecord } from "@/lib/leadWorkspace/record";
import { guardLead } from "@/lib/agency/guards";

const workItemSchema = z.string().uuid();

/**
 * Inbound step 2, Transfer check (owner 2026-10-28): what we already know about a caller before the
 * agent speaks to them — the lead's notes, how many times we have called them and how the last call
 * ended, and how many times they have been transferred in. Read-only, with Verification's gate: the
 * same people can open the call, and another producer's transfer answers 404 in an agency. Each part
 * is best-effort, so a missing one never stops the call.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = workItemSchema.safeParse(new URL(request.url).searchParams.get("work_item_id"));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer" }, { status: 400 });
  const hidden = await guardWorkItem(auth.context, parsed.data, await scopeFor(auth.context));
  if (hidden) return hidden;

  const tenantId = auth.context.tenantId;
  const db = getSupabaseServiceClient();
  const item = await db.from("lead_queue").select("lead_id, created_at").eq("tenant_id", tenantId).eq("id", parsed.data).maybeSingle();
  if (item.error || !item.data?.lead_id) return NextResponse.json({ error: "That transfer could not be found." }, { status: 404 });
  const leadId = item.data.lead_id as string;

  const [notes, record, transfers, consent, about] = await Promise.all([
    listLeadNotes(tenantId, leadId).catch(() => null),
    getLeadRecord(tenantId, leadId).catch(() => null),
    db.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("lead_id", leadId),
    // The newest consent certificate the lead-post ingest stored for this lead (the consent locker's rows).
    db.from("tenant_consent_artefacts").select("provider, capture_status, consent_timestamp, captured_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("captured_at", { ascending: false }).limit(1),
    aboutTheLead(tenantId, leadId).catch(() => null),
  ]);
  // The other lead with this phone, when screening said "maybe already a lead" (board C1b). Its details
  // are shown only when this session may see that lead (AG-0.5); otherwise only that one exists.
  const match = about?.phone10 ? await duplicateOf(tenantId, leadId, about.phone10).catch(() => undefined) : null;
  const duplicate = match && (await guardLead(auth.context, match.leadId)) ? { leadId: null, name: null, phone: null, lastContact: null } : match;
  const placed = record?.attempts.filter((attempt) => attempt.dialled) ?? null;
  const certificate = consent.error ? undefined : ((consent.data ?? [])[0] as { provider: string | null; capture_status: string | null; consent_timestamp: string | null; captured_at: string | null } | undefined) ?? null;
  return NextResponse.json({
    leadId,
    notes: notes?.filter((note) => note.body).slice(0, 20).map((note) => ({ id: note.id, body: note.body, author: note.author.name, createdAt: note.createdAt })) ?? null,
    calls: placed ? { count: placed.length, last: placed[0] ? { at: placed[0].at, outcome: placed[0].outcome, by: placed[0].by } : null } : null,
    transfers: transfers.error ? null : transfers.count ?? 0,
    // The phone app's caller profile ticks (C3): the consent proof on file, and the customer's zone with
    // the calling window the lead record already computes. Undefined/null when they could not be read.
    consent: certificate === undefined ? undefined : certificate ? { provider: certificate.provider, status: certificate.capture_status ?? "pending", consentAt: certificate.consent_timestamp, capturedAt: certificate.captured_at } : null,
    // Phone boards C1b / C3 (2026-11-26), additive: when the partner sent this caller (the transfer's
    // own time), the campaign it came through, the partner's own note on the lead, and the earlier lead
    // with the same phone (undefined: not readable; null: none).
    sentAt: (item.data as { created_at?: string | null }).created_at ?? null,
    campaign: about ? about.campaign : undefined,
    partnerNote: about ? about.note : undefined,
    duplicate,
    zones: record ? { customer: record.zones.customer, window: record.zones.window ? { start: record.zones.window.effective.start, end: record.zones.window.effective.end, noSunday: record.zones.window.noSunday, state: record.zones.window.state } : null } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

type Rows = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Chain = Rows & { eq(c: string, v: unknown): Chain; in(c: string, v: string[]): Chain; order(c: string, o: { ascending: boolean }): Chain; limit(n: number): Chain; maybeSingle(): Rows };
type Loose = { from(table: string): { select(columns: string): Chain }; rpc(fn: string, args: Record<string, unknown>): Rows };
const loose = () => getSupabaseServiceClient() as unknown as Loose;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
// The partner's own words: the first free-text value under a note-like key (the phone's partnerQuote).
const NOTE_KEY = /note|comment|remark|message|summary|reason/i;

/** The lead's phone (last ten digits), campaign name and the partner's note, from its stored values. */
async function aboutTheLead(tenantId: string, leadId: string) {
  const lead = await loose().from("agent_leads").select("values, campaign_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (lead.error || !lead.data) return null;
  const row = lead.data as { values?: Record<string, unknown> | null; campaign_id?: string | null };
  const values = row.values ?? {};
  const digits = (str(values.phone) || str(values.phone_number)).replace(/\D/g, "");
  let campaign: string | null = null;
  if (row.campaign_id) {
    const c = await loose().from("tenant_campaigns").select("name").eq("tenant_id", tenantId).eq("id", row.campaign_id).maybeSingle();
    campaign = c.error ? null : str((c.data as { name?: string } | null)?.name) || null;
  }
  const noteKey = Object.keys(values).find((k) => NOTE_KEY.test(k) && typeof values[k] === "string" && str(values[k]));
  return { phone10: digits.length >= 10 ? digits.slice(-10) : null, campaign, note: noteKey ? str(values[noteKey]) : null };
}

/**
 * The tenant's earliest lead with the same ten-digit phone (import_existing_lead_phones, the importer's
 * own lookup on agent_leads_tenant_phone10_idx), when it is another lead: its name and number, and the
 * last dial on it with who placed it.
 */
async function duplicateOf(tenantId: string, leadId: string, phone10: string) {
  const found = await loose().rpc("import_existing_lead_phones", { p_tenant_id: tenantId, p_phones: [phone10] });
  if (found.error) return undefined;
  const otherId = str(((found.data ?? {}) as Record<string, unknown>)[phone10]);
  if (!otherId || otherId === leadId) return null;
  const [other, attempt] = await Promise.all([
    loose().from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", otherId).maybeSingle(),
    loose().from("tenant_call_attempts").select("attempted_at, agent_id").eq("tenant_id", tenantId).eq("lead_id", otherId).order("attempted_at", { ascending: false }).limit(1),
  ]);
  const values = ((other.data as { values?: Record<string, unknown> | null } | null)?.values ?? {}) as Record<string, unknown>;
  const name = str(values.full_name) || str(values.name) || [str(values.first_name), str(values.last_name)].filter(Boolean).join(" ") || null;
  const last = ((attempt.data ?? []) as { attempted_at: string | null; agent_id: string | null }[])[0] ?? null;
  let by: string | null = null;
  if (last?.agent_id) {
    const user = await loose().from("users").select("name").eq("id", last.agent_id).maybeSingle();
    by = str((user.data as { name?: string } | null)?.name) || null;
  }
  return { leadId: otherId, name, phone: str(values.phone) || str(values.phone_number) || null, lastContact: last?.attempted_at ? { at: last.attempted_at, by } : null };
}
