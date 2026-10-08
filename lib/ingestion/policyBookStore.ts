import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { ENTRY_LABELS, type EntryType } from "./commissionLedger";
import { loadPolicyMoney } from "./commissionLedgerStore";
import { loadPolicyExpected } from "./expectedCommissionStore";
import { fileHref, rowHref } from "./trace";
import { changeLabel, changeValue, fieldWord, mergeTimeline, readableDay, statusLabel, type BookRow, type RiskBand, type TimelineItem } from "./policyBook";

/**
 * LA-4.11 (Notion sprint) · the reads behind the policy list and the policy page, and the two writes
 * that are the agency's own (notes and lead source; saved filters). Everything carrier-sourced comes
 * from LA-4.7's policy_current and is never written here.
 *
 * A producer sees the policies credited to them (policy_current.agent_user_id); an owner and a
 * bookkeeper see the whole book.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class PolicyBookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PolicyBookError";
  }
}

export const POLICY_BOOK_PENDING_MESSAGE = "The policy list needs a database update (20261008160000).";
export const POLICY_NOTES_PENDING_MESSAGE = "Notes and saved filters need a database update (20261008210000).";

export type Viewer = { tenantId: string; userId: string; role: string };

const PAGE = 1000;
const CHUNK = 200;

/** Every row of a query, a page at a time (the API returns at most 1,000 at once). */
async function everyRow(build: () => Loose, max = 50_000): Promise<{ rows: Loose[]; error: Loose }> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

/** Rows whose id is in a long list, in parallel chunks (a URL holds only so many ids). */
async function byIds(table: string, columns: string, ids: string[], tenantId?: string): Promise<Loose[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let at = 0; at < unique.length; at += CHUNK) chunks.push(unique.slice(at, at + CHUNK));
  const results = await Promise.all(chunks.map((chunk) => {
    let query = db().from(table).select(columns).in("id", chunk);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    return query;
  }));
  return results.flatMap((result: Loose) => result.data ?? []);
}

const CURRENT_COLUMNS = "carrier_id, policy_number, contact_id, household_id, agent_user_id, agency_id, vendor_id, campaign_id, status_normalized, carrier_status_raw, premium_cents, premium_mode, annualised_premium_cents, face_amount_cents, product_code, product_tier, days_past_due, days_until_carrier_closes, risk_band, issued_on, issue_date, effective_date";

const fullName = (row: Loose) => [row?.first_name, row?.last_name].filter(Boolean).join(" ") || null;
const productOf = (row: Loose) => [row.product_code, row.product_tier].filter(Boolean).join(" · ") || null;

/** Names for the people, carriers and lead sources a set of policy rows points at. */
async function namesFor(tenantId: string, rows: Loose[]) {
  const [carriers, contacts, users, vendors, campaigns] = await Promise.all([
    db().from("carriers").select("id, name"),
    byIds("contacts", "id, first_name, last_name, provisional", rows.map((row) => row.contact_id), tenantId),
    byIds("users", "id, name, email", rows.map((row) => row.agent_user_id)),
    db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
    db().from("tenant_campaigns").select("id, name, vendor_id, effective_cost_per_record_cents").eq("tenant_id", tenantId),
  ]);
  return {
    carrier: new Map<string, string>((carriers.data ?? []).map((row: Loose) => [row.id, row.name])),
    contact: new Map<string, Loose>(contacts.map((row: Loose) => [row.id, row])),
    user: new Map<string, string>(users.map((row: Loose) => [row.id, row.name || row.email])),
    vendor: new Map<string, string>((vendors.data ?? []).map((row: Loose) => [row.id, row.name])),
    campaign: new Map<string, Loose>((campaigns.data ?? []).map((row: Loose) => [row.id, row])),
    vendors: (vendors.data ?? []) as Array<{ id: string; name: string }>,
    campaigns: (campaigns.data ?? []) as Array<{ id: string; name: string; vendor_id: string | null }>,
  };
}

/** "Apex Call Center · FE-Q3-Spanish": the vendor, then the campaign. */
function leadSourceName(names: Awaited<ReturnType<typeof namesFor>>, vendorId: string | null, campaignId: string | null): string | null {
  const campaign = campaignId ? names.campaign.get(campaignId) : null;
  const vendor = vendorId ? names.vendor.get(vendorId) : campaign?.vendor_id ? names.vendor.get(campaign.vendor_id) : null;
  return [vendor, campaign?.name].filter(Boolean).join(" · ") || null;
}

async function annotations(tenantId: string): Promise<{ available: boolean; byKey: Map<string, Loose> }> {
  const { rows, error } = await everyRow(() => db().from("policy_annotation").select("carrier_id, policy_number, notes, lead_vendor_id, lead_campaign_id").eq("tenant_id", tenantId).order("carrier_id").order("policy_number"));
  if (error) {
    if (isSchemaGap(error)) return { available: false, byKey: new Map() };
    throw new Error(`Could not load the policy notes: ${error.message}`);
  }
  return { available: true, byKey: new Map(rows.map((row) => [`${row.carrier_id}|${row.policy_number}`, row])) };
}

const HAND_STATUS: Record<string, string> = { active: "active", pending: "submitted", lapsed: "lapsed", cancelled: "lapsed" };

/**
 * The policies the agency entered or imported by hand (LA-0.7's tenant_policies), as rows of the
 * same list (2026-10-08 overlap merge: one Policies list, with a source filter, not two tabs). The
 * carrier is free text there; it is matched to the carrier library by name, so one carrier is one
 * filter choice. A producer sees the ones they recorded, as the carrier rows credited to them.
 */
export async function loadHandPolicies(viewer: Viewer): Promise<BookRow[]> {
  const read = await everyRow(() => {
    let query = db().from("tenant_policies").select("id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, source").eq("tenant_id", viewer.tenantId);
    if (viewer.role === "producer") query = query.eq("created_by", viewer.userId);
    return query.order("id");
  });
  if (read.error) {
    if (isSchemaGap(read.error)) return [];
    throw new Error(`Could not load the policies entered by hand: ${read.error.message}`);
  }
  const carriers = ((await db().from("carriers").select("id, name")).data ?? []) as Loose[];
  const byName = new Map<string, Loose>(carriers.map((c) => [String(c.name).trim().toLowerCase(), c]));
  return read.rows.map((p: Loose): BookRow => {
    const carrier = byName.get(String(p.carrier ?? "").trim().toLowerCase());
    return {
      carrierId: carrier?.id ?? `hand:${String(p.carrier ?? "").trim().toLowerCase()}`, carrierName: carrier?.name ?? p.carrier, policyNumber: p.policy_number,
      clientName: p.insured_name, contactId: null, provisional: false, product: p.product ?? null,
      premiumCents: p.annual_premium_cents, premiumMode: "annual", annualCents: p.annual_premium_cents, faceCents: null,
      status: HAND_STATUS[p.status] ?? null, statusRaw: p.status === "cancelled" ? "Cancelled" : null,
      daysPastDue: null, daysLeft: null, riskBand: "none", issueDate: p.effective_date ?? null,
      agentUserId: null, agentName: null, agency: null, leadSource: null,
      source: "hand", href: `/app/policies/${p.id}`,
    };
  });
}

export async function loadBook(viewer: Viewer) {
  const scoped = viewer.role === "producer";
  const read = await everyRow(() => {
    // Ordered along the primary key (tenant first), so each page is an index range, not a scan.
    let query = db().from("policy_current").select(CURRENT_COLUMNS).eq("tenant_id", viewer.tenantId);
    if (scoped) query = query.eq("agent_user_id", viewer.userId);
    return query.order("carrier_id").order("policy_number");
  });
  if (read.error) {
    if (isSchemaGap(read.error)) return { available: false as const };
    throw new Error(`Could not load the policies: ${read.error.message}`);
  }
  const [names, notes, filters, unpricedRead] = await Promise.all([
    namesFor(viewer.tenantId, read.rows), annotations(viewer.tenantId), savedFilters(viewer),
    // LA-4.13: policies whose pay trigger has occurred but which no rate can price.
    everyRow(() => db().from("expected_commission").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("confidence", "no_rate_card").order("carrier_id").order("policy_number")),
  ]);
  const rows: BookRow[] = read.rows.map((row: Loose): BookRow => {
    const contact = row.contact_id ? names.contact.get(row.contact_id) : null;
    const note = notes.byKey.get(`${row.carrier_id}|${row.policy_number}`);
    return {
      carrierId: row.carrier_id,
      carrierName: names.carrier.get(row.carrier_id) ?? "Carrier not known",
      policyNumber: row.policy_number,
      clientName: fullName(contact),
      contactId: row.contact_id,
      provisional: Boolean(contact?.provisional),
      product: productOf(row),
      premiumCents: row.premium_cents,
      premiumMode: row.premium_mode,
      annualCents: row.annualised_premium_cents,
      faceCents: row.face_amount_cents,
      status: row.status_normalized,
      statusRaw: row.carrier_status_raw,
      daysPastDue: row.days_past_due,
      daysLeft: row.days_until_carrier_closes,
      riskBand: (row.risk_band ?? "none") as RiskBand,
      issueDate: row.issued_on ?? row.issue_date ?? null,
      agentUserId: row.agent_user_id,
      agentName: row.agent_user_id ? names.user.get(row.agent_user_id) ?? null : null,
      agency: row.agency_id ?? null,
      leadSource: note && (note.lead_vendor_id || note.lead_campaign_id) ? leadSourceName(names, note.lead_vendor_id, note.lead_campaign_id) : leadSourceName(names, row.vendor_id, row.campaign_id),
    };
  });
  // The "add your rate" line: the carrier with the most unpriced monthly premium.
  const unpricedKeys = new Set(unpricedRead.error ? [] : unpricedRead.rows.map((r: Loose) => `${r.carrier_id}|${r.policy_number}`));
  const byCarrier = new Map<string, { carrierName: string; policies: number; monthlyCents: number }>();
  for (const row of rows) {
    if (!unpricedKeys.has(`${row.carrierId}|${row.policyNumber}`)) continue;
    const entry = byCarrier.get(row.carrierId) ?? { carrierName: row.carrierName, policies: 0, monthlyCents: 0 };
    entry.policies++;
    entry.monthlyCents += Math.floor((row.annualCents ?? 0) / 12);
    byCarrier.set(row.carrierId, entry);
  }
  const unpriced = [...byCarrier.values()].sort((a, b) => b.monthlyCents - a.monthlyCents);
  return { available: true as const, rows, scoped, savedFilters: filters.list, savedFiltersAvailable: filters.available, unpriced: unpriced.length ? { top: unpriced[0], carriers: unpriced.length, policies: unpriced.reduce((sum, u) => sum + u.policies, 0) } : null };
}

// ─── saved filters (each person's own) ─────────────────────────────────────────────────────────

async function savedFilters(viewer: Viewer): Promise<{ available: boolean; list: Array<{ id: string; name: string; query: string }> }> {
  const { data, error } = await db().from("policy_saved_filter").select("id, name, query").eq("tenant_id", viewer.tenantId).eq("user_id", viewer.userId).order("name");
  if (error) {
    if (isSchemaGap(error)) return { available: false, list: [] };
    throw new Error(`Could not load saved filters: ${error.message}`);
  }
  return { available: true, list: data ?? [] };
}

export async function saveFilter(viewer: Viewer, name: string, query: string): Promise<{ id: string }> {
  const { data, error } = await db().from("policy_saved_filter").upsert({ tenant_id: viewer.tenantId, user_id: viewer.userId, name: name.trim(), query }, { onConflict: "tenant_id,user_id,name" }).select("id").single();
  if (error) {
    if (isSchemaGap(error)) throw new PolicyBookError(POLICY_NOTES_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the filter: ${error.message}`);
  }
  return { id: data.id };
}

export async function deleteFilter(viewer: Viewer, id: string): Promise<void> {
  const { data, error } = await db().from("policy_saved_filter").delete().eq("tenant_id", viewer.tenantId).eq("user_id", viewer.userId).eq("id", id).select("id");
  if (error) {
    if (isSchemaGap(error)) throw new PolicyBookError(POLICY_NOTES_PENDING_MESSAGE, 503);
    throw new Error(`Could not remove the filter: ${error.message}`);
  }
  if (!data?.length) throw new PolicyBookError("That saved filter is not yours.", 404);
}

// ─── one policy ────────────────────────────────────────────────────────────────────────────────

async function currentRow(viewer: Viewer, carrierId: string, policyNumber: string): Promise<Loose | null> {
  let query = db().from("policy_current").select("*").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber);
  if (viewer.role === "producer") query = query.eq("agent_user_id", viewer.userId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new PolicyBookError(POLICY_BOOK_PENDING_MESSAGE, 503);
    throw new Error(`Could not load the policy: ${error.message}`);
  }
  return data;
}

/**
 * LA-4.20: where each current value comes from. Carrier fields are read from the policy's current
 * snapshot (its file and row); `changed*` names the file whose row last moved it. A computed field
 * says what it is computed from instead.
 */
export type SourceRef = { fileId: string; fileName: string | null; rowNumber: number | null; snapshotDate: string };
export type SourceField = { label: string; value: string; changedOn: string | null; fromFile: string | null; readFrom: SourceRef | null; changedIn: SourceRef | null; computed: string | null };

export async function loadPolicy(viewer: Viewer, carrierId: string, policyNumber: string) {
  const row = await currentRow(viewer, carrierId, policyNumber);
  if (!row) return null;
  const t = viewer.tenantId;
  const [names, snapshot, changes, events, note, application, contactPolicies, householdPolicies, ledger, expected] = await Promise.all([
    namesFor(t, [row]),
    db().from("policy_snapshot").select("id, file_id, raw_row_id, snapshot_date").eq("tenant_id", t).eq("id", row.snapshot_id).maybeSingle(),
    db().from("policy_change").select("field_name, old_value, new_value, to_snapshot_date, to_file_id, detected_at").eq("tenant_id", t).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("to_snapshot_date").order("detected_at").limit(500),
    db().from("policy_event").select("event_type, snapshot_date, file_id").eq("tenant_id", t).eq("carrier_id", carrierId).eq("policy_number", policyNumber).limit(50),
    db().from("policy_annotation").select("notes, lead_vendor_id, lead_campaign_id, updated_by, updated_at").eq("tenant_id", t).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle(),
    row.application_id ? db().from("tenant_applications").select("id, created_at, submitted_at, outcome, outcome_recorded_at, draft_day, insured_role, case_id").eq("tenant_id", t).eq("id", row.application_id).maybeSingle() : { data: null },
    row.contact_id ? db().from("policy_current").select("carrier_id, policy_number, status_normalized, annualised_premium_cents, product_code").eq("tenant_id", t).eq("contact_id", row.contact_id).limit(50) : { data: [] },
    row.household_id ? db().from("policy_current").select("carrier_id, policy_number, contact_id, status_normalized, annualised_premium_cents").eq("tenant_id", t).eq("household_id", row.household_id).limit(100) : { data: [] },
    // LA-4.12: every money line the carriers reported for this policy, and the unearned advance.
    loadPolicyMoney(t, carrierId, policyNumber, { monthsPaid: row.months_paid, productCode: row.product_code, asOf: row.as_of }),
    loadPolicyExpected(t, carrierId, policyNumber),
  ]);

  // The files behind the snapshot, the changes and the first sighting, for names and dates.
  const fileIds = [snapshot.data?.file_id, ...(changes.data ?? []).map((c: Loose) => c.to_file_id), ...(events.data ?? []).map((e: Loose) => e.file_id)].filter(Boolean);
  const files = new Map<string, Loose>((await byIds("file_registry", "id, original_filename, file_date, source, received_at", fileIds, t)).map((file: Loose) => [file.id, file]));
  const rawRow = snapshot.data?.raw_row_id
    ? (await db().from("raw_rows").select("row_number, payload").eq("tenant_id", t).eq("file_id", snapshot.data.file_id).eq("id", snapshot.data.raw_row_id).maybeSingle()).data
    : null;
  // LA-4.20: this policy's snapshot in each file, with its raw row, so a change names the row that made it.
  const ownSnapshots = ((await db().from("policy_snapshot").select("file_id, raw_row_id, snapshot_date").eq("tenant_id", t).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("snapshot_date").limit(500)).data ?? []) as Loose[];
  const rowNumbers = new Map<string, number>(((await byIds("raw_rows", "id, row_number", ownSnapshots.map((s) => s.raw_row_id), t)) as Loose[]).map((r) => [r.id, r.row_number]));
  const refIn = (fileId: string | null | undefined): SourceRef | null => {
    if (!fileId) return null;
    const s = ownSnapshots.find((x) => x.file_id === fileId);
    return { fileId, fileName: files.get(fileId)?.original_filename ?? null, rowNumber: s?.raw_row_id ? rowNumbers.get(s.raw_row_id) ?? null : null, snapshotDate: s?.snapshot_date ?? "" };
  };
  const submissions = row.application_id ? (await db().from("tenant_application_submissions").select("submitted_at, submitted_via, attempt_no").eq("tenant_id", t).eq("application_id", row.application_id).order("submitted_at")).data ?? [] : [];

  const householdContactIds = [...new Set((householdPolicies.data ?? []).map((p: Loose) => p.contact_id).filter(Boolean))] as string[];
  const householdPeople = new Map<string, Loose>((await byIds("contacts", "id, first_name, last_name", householdContactIds, t)).map((c: Loose) => [c.id, c]));
  const contact = row.contact_id ? names.contact.get(row.contact_id) ?? null : null;
  const fileName = (id: string | null | undefined) => (id ? files.get(id)?.original_filename ?? null : null);
  // The timeline names the line each item was read from, as a link to it.
  const sourceLink = (ref: SourceRef | null) => (ref ? { href: ref.rowNumber ? rowHref(ref.fileId, ref.rowNumber) : fileHref(ref.fileId), text: `${ref.fileName ?? "The file"}${ref.rowNumber ? `, row ${ref.rowNumber}` : ""}` } : null);

  // Timeline: the sale (LA-3), the carrier's milestones and every change between files. Commission
  // entries join it with LA-4.12's ledger.
  const items: Array<Omit<TimelineItem, "order">> = [];
  if (application.data?.created_at) items.push({ date: application.data.created_at, kind: "sale", label: "Application started" });
  for (const submission of submissions) if (submission.submitted_at) items.push({ date: submission.submitted_at, kind: "sale", label: submission.attempt_no > 1 ? `Application resubmitted (attempt ${submission.attempt_no})` : "Application submitted", detail: submission.submitted_via ?? null });
  if (application.data?.outcome && application.data.outcome_recorded_at) items.push({ date: application.data.outcome_recorded_at, kind: "sale", label: `Outcome recorded: ${String(application.data.outcome).replaceAll("_", " ")}` });
  const issued = row.issued_on ?? row.issue_date;
  if (issued) items.push({ date: issued, kind: "carrier", label: "Issued by the carrier" });
  if (row.effective_date) items.push({ date: row.effective_date, kind: "carrier", label: "Policy effective" });
  for (const event of events.data ?? []) if (event.event_type === "first_seen") items.push({ date: event.snapshot_date, kind: "carrier", label: "First seen in a carrier file", source: sourceLink(refIn(event.file_id)) });
  for (const change of changes.data ?? []) {
    if (change.field_name === "carrier_status_raw") continue; // shown with the status change it explains
    items.push({ date: change.to_snapshot_date, kind: "change", label: changeLabel({ field: change.field_name, oldValue: change.old_value, newValue: change.new_value }), detail: `${changeValue(change.field_name, change.old_value)} → ${changeValue(change.field_name, change.new_value)}`, source: sourceLink(refIn(change.to_file_id)) });
  }
  // The lapse date, unless a status change on file already says it.
  for (const entry of ledger.entries) {
    const word = entry.type === "reversal" && entry.correctsType ? `Reversal of ${ENTRY_LABELS[entry.correctsType as EntryType]?.label.toLowerCase() ?? entry.correctsType}` : ENTRY_LABELS[entry.type as EntryType]?.label ?? entry.type;
    const amount = `${entry.amountCents < 0 ? "−" : "+"}$${(Math.abs(entry.amountCents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    items.push({ date: entry.transactionDate ?? entry.statementDate ?? entry.createdAt, kind: "money", label: `${word} ${amount}`, detail: [entry.payeeLevel === "upline" ? "to the upline" : null, entry.reversalReason].filter(Boolean).join(" · ") || null, source: { href: rowHref(entry.fileId, entry.rowNumber), text: `${entry.fileName ?? "The file"}, row ${entry.rowNumber}` } });
  }
  if (row.lapsed_on && !(changes.data ?? []).some((c: Loose) => c.field_name === "status_normalized" && c.new_value === "lapsed")) items.push({ date: row.lapsed_on, kind: "carrier", label: "Lapsed" });

  // Source: each current value, and the file that last changed it (else the file it was first read from).
  const lastChange = new Map<string, Loose>();
  for (const change of changes.data ?? []) lastChange.set(change.field_name, change);
  const snapshotFile = snapshot.data ? files.get(snapshot.data.file_id) : null;
  const current: SourceRef | null = snapshot.data ? { fileId: snapshot.data.file_id, fileName: snapshotFile?.original_filename ?? null, rowNumber: rawRow?.row_number ?? null, snapshotDate: snapshot.data.snapshot_date } : null;
  const sourceOf = (field: string, label: string, value: string | null): SourceField => {
    const change = lastChange.get(field);
    return { label, value: value ?? "—", changedOn: change?.to_snapshot_date ?? null, fromFile: change ? fileName(change.to_file_id) : snapshotFile?.original_filename ?? null, readFrom: current, changedIn: change ? refIn(change.to_file_id) : null, computed: null };
  };
  const computedField = (label: string, value: string | null, from: string): SourceField => ({ label, value: value ?? "—", changedOn: null, fromFile: null, readFrom: null, changedIn: null, computed: from });
  const money = (cents: number | null) => (cents === null || cents === undefined ? null : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const day = (value: string | null) => (value ? readableDay(value) : null);
  const source: SourceField[] = [
    sourceOf("status_normalized", "Status", row.status_normalized ? `${statusLabel(row.status_normalized)} (carrier: ${row.carrier_status_raw ?? "—"})` : null),
    sourceOf("paid_to_date", "Paid-to date", day(row.paid_to_date)),
    sourceOf("premium_cents", "Premium", money(row.premium_cents)),
    sourceOf("premium_mode", "Premium mode", row.premium_mode),
    sourceOf("payment_method", "Payment method", row.payment_method),
    sourceOf("face_amount_cents", "Face amount", money(row.face_amount_cents)),
    sourceOf("product_code", "Product", row.product_code),
    sourceOf("product_tier", "Product tier", row.product_tier),
    sourceOf("termination_date", "Termination date", day(row.termination_date)),
    sourceOf("agent_identifier", "Writing agent (carrier's code)", row.agent_identifier),
    sourceOf("effective_date", "Effective date", day(row.effective_date)),
    sourceOf("issue_date", "Issue date", day(row.issue_date)),
    computedField("Months paid", row.months_paid === null ? null : String(row.months_paid), "the paid-to date and the effective date above"),
    computedField("Days past due", row.days_past_due === null ? null : String(row.days_past_due), `the paid-to date above, as of ${day(row.as_of) ?? "today"}`),
    computedField("Days until the carrier closes it", row.days_until_carrier_closes === null ? null : String(row.days_until_carrier_closes), row.retention_rule_id ? "the days past due and the carrier's window in Carrier rules" : "no carrier window is set in Carrier rules, so none"),
    computedField("Annualised premium", money(row.annualised_premium_cents), "the premium and premium mode above"),
  ];

  const leadVendor = note.data?.lead_vendor_id ?? null;
  const leadCampaign = note.data?.lead_campaign_id ?? null;
  const overridden = Boolean(leadVendor || leadCampaign);
  const campaign = (overridden ? leadCampaign : row.campaign_id) ? names.campaign.get((overridden ? leadCampaign : row.campaign_id) as string) : null;
  const householdInForce = (householdPolicies.data ?? []).filter((p: Loose) => p.status_normalized === "active" || p.status_normalized === "at_risk");
  const householdMonthly = householdInForce.reduce((sum: number, p: Loose) => sum + Number(p.annualised_premium_cents ?? 0), 0) / 12;

  return {
    policy: {
      carrierId: row.carrier_id,
      carrierName: names.carrier.get(row.carrier_id) ?? "Carrier not known",
      policyNumber: row.policy_number,
      status: row.status_normalized as string | null,
      statusRaw: row.carrier_status_raw as string | null,
      riskBand: (row.risk_band ?? "none") as RiskBand,
      product: productOf(row),
      premiumCents: row.premium_cents as number | null,
      premiumMode: row.premium_mode as string | null,
      annualCents: row.annualised_premium_cents as number | null,
      faceCents: row.face_amount_cents as number | null,
      paymentMethod: row.payment_method as string | null,
      paidTo: row.paid_to_date as string | null,
      effectiveDate: row.effective_date as string | null,
      issuedOn: issued as string | null,
      daysPastDue: row.days_past_due as number | null,
      daysLeft: row.days_until_carrier_closes as number | null,
      inClawbackWindow: row.in_clawback_window as boolean | null,
      monthsPaid: row.months_paid as number | null,
      draftDay: (application.data?.draft_day ?? null) as number | null,
      agentName: row.agent_user_id ? names.user.get(row.agent_user_id) ?? null : null,
      agentCode: row.agent_identifier as string | null,
      asOf: row.as_of as string | null,
      lastFileDate: row.last_snapshot_date as string | null,
      money: { advancedCents: row.total_advanced_cents, earnedCents: row.total_earned_cents, chargedBackCents: row.total_charged_back_cents, unearnedCents: row.unearned_advance_cents },
    },
    client: contact ? { id: contact.id as string, name: fullName(contact), provisional: Boolean(contact.provisional) } : null,
    lead: {
      name: leadSourceName(names, overridden ? leadVendor : row.vendor_id, overridden ? leadCampaign : row.campaign_id),
      costPerLeadCents: (campaign?.effective_cost_per_record_cents ?? null) as number | null,
      fromSale: !overridden && Boolean(row.vendor_id || row.campaign_id),
      vendorId: overridden ? leadVendor : null,
      campaignId: overridden ? leadCampaign : null,
    },
    notes: { available: !note.error || !isSchemaGap(note.error), text: (note.data?.notes ?? "") as string, updatedAt: (note.data?.updated_at ?? null) as string | null },
    choices: { vendors: names.vendors, campaigns: names.campaigns },
    timeline: mergeTimeline(items),
    source: { fields: source, file: snapshotFile ? { name: snapshotFile.original_filename as string, date: snapshotFile.file_date as string | null, rowNumber: (rawRow?.row_number ?? null) as number | null } : null, raw: (rawRow?.payload ?? null) as Record<string, unknown> | null },
    others: ((contactPolicies.data ?? []) as Loose[]).filter((p: Loose) => !(p.carrier_id === carrierId && p.policy_number === policyNumber)).map((p: Loose): { carrierId: string; carrierName: string; policyNumber: string; status: string | null; annualCents: number | null } => ({ carrierId: p.carrier_id, carrierName: names.carrier.get(p.carrier_id) ?? "Carrier not known", policyNumber: p.policy_number, status: p.status_normalized, annualCents: p.annualised_premium_cents })),
    household: householdContactIds.length > 1 ? { monthlyCents: Math.round(householdMonthly), people: householdContactIds.map((id) => fullName(householdPeople.get(id)) ?? "A client"), policies: householdInForce.length } : null,
    changedFields: [...lastChange.keys()].map(fieldWord),
    ledger,
    expected,
  };
}

// ─── the agency's own fields ───────────────────────────────────────────────────────────────────

export async function saveAnnotation(viewer: Viewer, input: { carrierId: string; policyNumber: string; notes: string | null; leadVendorId: string | null; leadCampaignId: string | null }) {
  const row = await currentRow(viewer, input.carrierId, input.policyNumber);
  if (!row) throw new PolicyBookError("That policy is not in your book.", 404);
  // A lead source must be the agency's own vendor and campaign, and the campaign the vendor's.
  if (input.leadVendorId || input.leadCampaignId) {
    const [vendor, campaign] = await Promise.all([
      input.leadVendorId ? db().from("tenant_lead_vendors").select("id").eq("tenant_id", viewer.tenantId).eq("id", input.leadVendorId).maybeSingle() : { data: true },
      input.leadCampaignId ? db().from("tenant_campaigns").select("id, vendor_id").eq("tenant_id", viewer.tenantId).eq("id", input.leadCampaignId).maybeSingle() : { data: true },
    ]);
    if (!vendor.data || !campaign.data) throw new PolicyBookError("Choose a lead vendor and campaign from your own list.", 400);
    if (input.leadVendorId && input.leadCampaignId && (campaign.data as Loose).vendor_id && (campaign.data as Loose).vendor_id !== input.leadVendorId) throw new PolicyBookError("That campaign belongs to a different vendor.", 400);
  }
  const { error } = await db().from("policy_annotation").upsert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber,
    notes: input.notes?.trim() || null, lead_vendor_id: input.leadVendorId, lead_campaign_id: input.leadCampaignId,
    updated_by: viewer.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,carrier_id,policy_number" });
  if (error) {
    if (isSchemaGap(error)) throw new PolicyBookError(POLICY_NOTES_PENDING_MESSAGE, 503);
    throw new Error(`Could not save: ${error.message}`);
  }
}
