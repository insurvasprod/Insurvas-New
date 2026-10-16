import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { resolveRuntimeStage } from "@/lib/pipelines/service";

import { isDue, leadNote, type Category, type ReasonSource, type WinbackBand } from "./winback";

/**
 * LA-5.7 (Notion sprint) · win-back, server side.
 *
 *   sync    sync_winback_candidates (the database) opens and classifies candidates — and puts a
 *           `never` client's number on the internal do-not-call list, or flags a death for a claim.
 *   release at each candidate's eligible_from, a NEW lead in the agency's "Win-back" lead list (the
 *           client's old sold lead keeps its original list and vendor, so LA-2's cost reports stay
 *           true), linked to the contact, as a nurture lead tagged source = winback, with the history
 *           as a note. Then the list goes back through the scrub gate (LA-2.3): nothing dials until it
 *           is scrubbed, and the dialer's calling-window and do-not-call checks apply as for any lead.
 *
 * The database refuses to release a `never` candidate or one still cooling off, whatever asks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;

export const WINBACK_PENDING_MESSAGE = "Win-back needs a database update (20261014500000).";

export class WinbackError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WinbackError";
  }
}

export type Viewer = { tenantId: string; userId: string; role: string };

async function everyRow(build: () => Loose, max = 50_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const inChunks = async (ids: string[], read: (part: string[]) => Loose) => {
  const out: Loose[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await read(ids.slice(i, i + CHUNK));
    if (r.error) throw r.error;
    out.push(...(r.data ?? []));
  }
  return out;
};
const phoneDigits = (raw: string | null | undefined) => {
  const d = (raw ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? d : null;
};

export async function runWinbackSync(tenantId: string) {
  const { data, error } = await db().rpc("sync_winback_candidates", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error) || error.code === "PGRST202") return null;
    throw new Error(`Could not check the lapsed clients: ${error.message}`);
  }
  return data as { opened: number; reclassified: number; never: number; claims: number };
}

/** The user a released lead's note is written as: whoever is releasing, else the agency's owner. */
async function noteAuthor(tenantId: string, userId: string | null): Promise<string | null> {
  if (userId) return userId;
  const { data } = await db().from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).eq("role", "owner").order("accepted_at", { ascending: true }).limit(1);
  return (data?.[0]?.user_id as string | undefined) ?? null;
}

/**
 * Release every candidate whose cooling-off has ended. Each one becomes a nurture lead in the
 * Win-back list, or records why it could not (no client linked, no phone, no state, on a do-not-call
 * list, no form for the product). After any release the list is sent back through the scrub gate.
 */
/** The claim a release run puts on a candidate while it creates the lead (see releaseDueWinbacks). */
const RELEASING = "Releasing since ";

export async function releaseDueWinbacks(tenantId: string, userId: string | null): Promise<{ released: number; blocked: number } | null> {
  const today = new Date().toISOString().slice(0, 10);
  let due: Loose[];
  try {
    due = (await everyRow(() => db().from("winback_candidate").select("*").eq("tenant_id", tenantId).is("released_to_nurture_at", null).neq("winback_band", "never").lte("eligible_from", today).order("eligible_from").order("id")))
      .filter((c) => isDue({ band: c.winback_band, eligibleFrom: c.eligible_from, releasedAt: c.released_to_nurture_at, blockedReason: c.release_blocked_reason }, today));
  } catch (error) {
    if (isSchemaGap(error as Loose)) return null;
    throw error;
  }
  if (!due.length) return { released: 0, blocked: 0 };

  const listId = await db().rpc("ensure_winback_list", { p_tenant_id: tenantId });
  if (listId.error) throw new Error(`Could not open the Win-back lead list: ${listId.error.message}`);
  const campaignId = listId.data as string;
  const contacts = await inChunks([...new Set(due.map((c) => c.contact_id).filter(Boolean))] as string[], (part) => db().from("contacts").select("id, first_name, last_name, primary_phone, state, dob").eq("tenant_id", tenantId).in("id", part));
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const [carriers, templates, author] = await Promise.all([
    db().from("carriers").select("id, name"),
    db().from("tenant_templates").select("product_code").eq("tenant_id", tenantId).order("created_at").limit(20),
    noteAuthor(tenantId, userId),
  ]);
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const fallbackProduct = ((templates.data ?? []) as Loose[])[0]?.product_code as string | undefined;
  const stage = await resolveRuntimeStage(tenantId, "new", "marketing").catch(() => null);

  let released = 0;
  let blocked = 0;
  const block = async (id: string, reason: string) => {
    blocked++;
    await db().from("winback_candidate").update({ release_blocked_reason: reason.slice(0, 300) }).eq("tenant_id", tenantId).eq("id", id);
  };
  for (const c of due) {
    // Claim it first, so two runs at once (a file stage and a page open) never both create a lead: the
    // second one's conditional update finds the claim and moves on. A claim older than ten minutes is a
    // run that died, and is taken over.
    const claimedAt = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const claim = await db().from("winback_candidate").update({ release_blocked_reason: `${RELEASING}${claimedAt}` })
      .eq("tenant_id", tenantId).eq("id", c.id).is("released_to_nurture_at", null)
      .or(`release_blocked_reason.is.null,release_blocked_reason.not.like."${RELEASING}*",release_blocked_reason.lt."${RELEASING}${staleBefore}"`)
      .select("id");
    if (claim.error) { console.error("[winback] the release could not be claimed", claim.error); continue; }
    if (!claim.data?.length) continue;
    const contact = c.contact_id ? contactOf.get(c.contact_id) : null;
    if (!contact) { await block(c.id, "No client is linked to this policy."); continue; }
    const phone = phoneDigits(contact.primary_phone);
    if (!phone) { await block(c.id, "The client has no phone number on file."); continue; }
    const state = typeof contact.state === "string" && /^[A-Za-z]{2}$/.test(contact.state.trim()) ? contact.state.trim().toUpperCase() : null;
    if (!state) { await block(c.id, "The client has no state on file, so the calling window can't be checked."); continue; }
    const suppressed = await db().rpc("is_phone_suppressed", { p_tenant_id: tenantId, p_phone: phone });
    if (suppressed.error) { await block(c.id, "The do-not-call check could not run; try again."); continue; }
    if (((suppressed.data ?? []) as Loose[]).some((r) => r.suppressed)) { await block(c.id, "The number is on a do-not-call list."); continue; }
    if (!stage) { await block(c.id, "No default pipeline is set up for new leads."); continue; }
    // The product of the client's old lead, else the agency's first configured form.
    const old = await db().from("agent_leads").select("product_line").eq("tenant_id", tenantId).eq("contact_id", c.contact_id).order("created_at", { ascending: false }).limit(1);
    const product = (old.data?.[0]?.product_line as string | undefined) ?? fallbackProduct;
    const template = product ? await getTenantTemplateForProduct(tenantId, product).catch(() => null) : null;
    if (!template || !product) { await block(c.id, "No lead form is set up for this product."); continue; }

    const lead = await db().from("agent_leads").insert({
      tenant_id: tenantId, tenant_template_id: template.tenant_template_id, template_id: template.assignment.template_id,
      template_version: template.assignment.template_version, definition_version: template.assignment.definition_version,
      product_line: product, pipeline_id: stage.pipelineId, stage_id: stage.stage.id, campaign_id: campaignId, contact_id: c.contact_id,
      lead_state: "nurture", next_dial_after: new Date().toISOString(), created_by: author,
      values: {
        first_name: contact.first_name ?? null, last_name: contact.last_name ?? null, full_name: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null,
        phone, state, dob: contact.dob ?? null,
      },
    }).select("id").single();
    if (lead.error || !lead.data) { await block(c.id, `The lead could not be created: ${lead.error?.message ?? "unknown error"}`); continue; }
    const leadId = lead.data.id as string;
    const queue = await db().from("lead_queue").insert({ tenant_id: tenantId, lead_id: leadId, product_line: product, pipeline_id: stage.pipelineId, stage_id: stage.stage.id, status: "unclaimed", tier: 100 });
    if (queue.error) console.error("[winback] the queue row could not be created", queue.error);
    const source = await db().from("tenant_lead_sources").insert({ tenant_id: tenantId, lead_id: leadId, campaign_id: campaignId, source_type: "winback", cost_cents: 0, source_key: `winback:${c.id}` });
    if (source.error) console.error("[winback] the source tag could not be written", source.error);
    if (author) {
      const note = await db().from("lead_notes").insert({
        tenant_id: tenantId, lead_id: leadId, author_user_id: author, visibility: "internal", idempotency_key: `winback:${c.id}`,
        body: leadNote({ carrierName: carrierName.get(c.carrier_id) ?? "the carrier", policyNumber: c.source_policy_number, premiumCents: c.premium_cents === null ? null : Number(c.premium_cents), faceCents: c.face_amount_cents === null ? null : Number(c.face_amount_cents), monthsPaid: c.months_paid, lapsedOn: c.lapsed_on, category: c.lapse_reason_category, detail: c.reason_detail, inferred: c.reason_inferred, band: c.winback_band }),
      });
      if (note.error) console.error("[winback] the history note could not be written", note.error);
    }
    const mark = await db().from("winback_candidate").update({ released_to_nurture_at: new Date().toISOString(), released_lead_id: leadId, campaign_id: campaignId, release_blocked_reason: null }).eq("tenant_id", tenantId).eq("id", c.id).eq("release_blocked_reason", `${RELEASING}${claimedAt}`);
    if (mark.error) { console.error("[winback] the release could not be recorded", mark.error); continue; }
    released++;
  }
  if (released > 0) {
    // Back through the scrub gate: the list stops serving until it is scrubbed again (LA-2.3).
    const rescrub = await db().rpc("request_campaign_rescrub", { p_tenant_id: tenantId, p_campaign_id: campaignId });
    if (rescrub.error) console.error("[winback] the list could not be sent back for scrubbing", rescrub.error);
  }
  return { released, blocked };
}

export type WinbackRow = {
  id: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  lapsedOn: string;
  monthsPaid: number | null;
  premiumCents: number | null;
  faceCents: number | null;
  category: Category;
  source: ReasonSource;
  inferred: boolean;
  detail: string | null;
  band: WinbackBand;
  eligibleFrom: string | null;
  releasedAt: string | null;
  leadId: string | null;
  blockedReason: string | null;
};

export type ClaimRow = { id: string; carrierName: string; policyNumber: string; clientName: string | null; reason: string; createdAt: string };

export type Winback = {
  available: true;
  today: string;
  rows: WinbackRow[];
  claims: ClaimRow[];
  listId: string | null;
  listScrub: string | null;
  lastRun: { released: number; blocked: number } | null;
};

export async function loadWinback(viewer: Viewer, options: { release: boolean } = { release: true }): Promise<Winback | { available: false }> {
  let lastRun: { released: number; blocked: number } | null = null;
  try {
    await runWinbackSync(viewer.tenantId);
    // Released on the agency's behalf (its first owner is the lead's creator), never as whoever opened
    // the page; and a read-only plan only looks.
    if (options.release) lastRun = await releaseDueWinbacks(viewer.tenantId, null);
  } catch (error) {
    console.error("[winback] the sync or release could not run", error);
  }
  let rows: Loose[];
  let claims: Loose[];
  try {
    [rows, claims] = await Promise.all([
      everyRow(() => db().from("winback_candidate").select("*").eq("tenant_id", viewer.tenantId).order("created_at", { ascending: false }).order("id")),
      everyRow(() => db().from("household_claim_followup").select("id, carrier_id, policy_number, contact_id, reason, created_at").eq("tenant_id", viewer.tenantId).is("resolved_at", null).order("created_at").order("id")),
    ]);
  } catch (error) {
    if (isSchemaGap(error as Loose)) return { available: false };
    throw error;
  }
  if (viewer.role === "producer") {
    const numbers = [...new Set([...rows.map((r) => r.source_policy_number), ...claims.map((c) => c.policy_number)])];
    const mine = new Set((await inChunks(numbers, (part) => db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("agent_user_id", viewer.userId).in("policy_number", part))).map((p: Loose) => `${p.carrier_id}|${p.policy_number}`));
    rows = rows.filter((r) => mine.has(`${r.carrier_id}|${r.source_policy_number}`));
    claims = claims.filter((c) => mine.has(`${c.carrier_id}|${c.policy_number}`));
  }
  const contactIds = [...new Set([...rows.map((r) => r.contact_id), ...claims.map((c) => c.contact_id)].filter(Boolean))] as string[];
  const [contacts, carriers, settings] = await Promise.all([
    inChunks(contactIds, (part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", viewer.tenantId).in("id", part)),
    db().from("carriers").select("id, name"),
    db().from("retention_settings").select("winback_campaign_id").eq("tenant_id", viewer.tenantId).maybeSingle(),
  ]);
  const listId = (settings.data as Loose)?.winback_campaign_id ?? null;
  const list = listId ? await db().from("tenant_campaigns").select("scrub_status").eq("tenant_id", viewer.tenantId).eq("id", listId).maybeSingle() : { data: null };
  const nameOf = new Map<string, string>(contacts.map((c: Loose) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ")]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  return {
    available: true,
    today: new Date().toISOString().slice(0, 10),
    lastRun,
    listId,
    listScrub: (list.data as Loose)?.scrub_status ?? null,
    rows: rows.map((r) => ({
      id: r.id, carrierId: r.carrier_id, carrierName: carrierName.get(r.carrier_id) ?? "Carrier not known", policyNumber: r.source_policy_number,
      clientName: r.contact_id ? nameOf.get(r.contact_id) || null : null, lapsedOn: r.lapsed_on, monthsPaid: r.months_paid,
      premiumCents: r.premium_cents === null ? null : Number(r.premium_cents), faceCents: r.face_amount_cents === null ? null : Number(r.face_amount_cents),
      category: r.lapse_reason_category, source: r.reason_source, inferred: r.reason_inferred, detail: r.reason_detail, band: r.winback_band,
      eligibleFrom: r.eligible_from, releasedAt: r.released_to_nurture_at, leadId: r.released_lead_id, blockedReason: r.release_blocked_reason?.startsWith(RELEASING) ? null : r.release_blocked_reason,
    })),
    claims: claims.map((c) => ({ id: c.id, carrierName: carrierName.get(c.carrier_id) ?? "Carrier not known", policyNumber: c.policy_number, clientName: c.contact_id ? nameOf.get(c.contact_id) || null : null, reason: c.reason, createdAt: c.created_at })),
  };
}

/** Someone has handled a possible claim (the family has been helped, or it was not a death). */
export async function resolveClaim(viewer: Viewer, id: string, note: string | null) {
  const { data, error } = await db().from("household_claim_followup").select("id, carrier_id, policy_number, resolved_at").eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new WinbackError(WINBACK_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  if (!data) throw new WinbackError("That follow-up isn't here.", 404);
  if (data.resolved_at) throw new WinbackError("That follow-up is already handled.", 409);
  if (viewer.role === "producer") {
    const p = await db().from("policy_current").select("agent_user_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", data.carrier_id).eq("policy_number", data.policy_number).maybeSingle();
    if (p.data?.agent_user_id !== viewer.userId) throw new WinbackError("That follow-up isn't in your book.", 404);
  }
  const update = await db().from("household_claim_followup").update({ resolved_at: new Date().toISOString(), resolved_by: viewer.userId, note: note?.trim() || null }).eq("tenant_id", viewer.tenantId).eq("id", id).is("resolved_at", null);
  if (update.error) throw new Error(`Could not mark it handled: ${update.error.message}`);
}
