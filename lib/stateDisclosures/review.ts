import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { DisclosureProposal, DisclosureProposalStatus } from "./constants";

// The review queue in front of `state_disclosures` (migration 20260925507000). Proposals are never
// read by the dialer; only approve_state_disclosure_proposal() writes the table the dialer reads,
// and it does so in one transaction with the approval.
//
// Everything here must work before that migration is applied: reads report `available: false`
// instead of throwing, and writes throw ReviewUnavailableError, which routes turn into a 503.

type DbError = { message: string; code?: string };
type Result<T> = { data: T | null; error: DbError | null };
type Query = {
  select(columns: string): Query;
  insert(values: unknown): Query;
  update(values: unknown): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle<T>(): Promise<Result<T>>;
  then(resolve: (value: Result<Row[]>) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<Row>>;
};
type Row = Record<string, unknown>;

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

const COLUMNS =
  "id, product_code, states, required_text, effective_from, note, source, status, proposed_by, proposed_at, reviewed_by, reviewed_at, review_note, published_ids, self_approval_attestation";

const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

export function isMissingSchema(error: DbError | null | undefined): boolean {
  return Boolean(error && error.code && MISSING_SCHEMA.has(error.code));
}

export class ReviewUnavailableError extends Error {
  constructor() {
    super("The review workflow needs database migration 20260925507000.");
  }
}

/** A refusal the admin can act on (400/409), as opposed to a failure. */
export class ReviewRefusedError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const nullable = (value: unknown) => (typeof value === "string" && value ? value : null);

function mapRow(row: Row, names: Map<string, string>): DisclosureProposal {
  const proposedBy = nullable(row.proposed_by);
  const reviewedBy = nullable(row.reviewed_by);
  return {
    id: text(row.id),
    product_code: text(row.product_code),
    states: Array.isArray(row.states) ? row.states.map(text) : [],
    required_text: text(row.required_text),
    effective_from: text(row.effective_from),
    note: nullable(row.note),
    source: row.source === "import" ? "import" : "editor",
    status: (["pending", "approved", "rejected", "cancelled"].includes(text(row.status)) ? text(row.status) : "pending") as DisclosureProposalStatus,
    proposed_by: proposedBy,
    proposed_by_name: proposedBy ? names.get(proposedBy) ?? null : null,
    proposed_at: text(row.proposed_at),
    reviewed_by: reviewedBy,
    reviewed_by_name: reviewedBy ? names.get(reviewedBy) ?? null : null,
    reviewed_at: nullable(row.reviewed_at),
    review_note: nullable(row.review_note),
    published_ids: Array.isArray(row.published_ids) ? row.published_ids.map(text) : [],
    self_approval_attestation: nullable(row.self_approval_attestation),
  };
}

/**
 * Whether this admin may approve their own proposals: only when no OTHER active super_admin or
 * platform_config admin exists (state_disclosure_self_approval_allowed). The server decides; the
 * screen only shows the attestation field when this says so. False whenever it cannot be read.
 */
export async function selfApprovalAllowed(adminId: string): Promise<boolean> {
  const { data, error } = await db().rpc("state_disclosure_self_approval_allowed", { p_admin: adminId });
  if (error) return false;
  return (data as unknown) === true;
}

async function adminNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data, error } = await db().from("admin_users").select("id, name, email").in("id", unique);
  if (error || !data) return new Map();
  return new Map(data.map((row) => [text(row.id), text(row.name) || text(row.email)]));
}

async function withNames(rows: Row[]): Promise<DisclosureProposal[]> {
  const names = await adminNames(rows.flatMap((row) => [nullable(row.proposed_by), nullable(row.reviewed_by)]));
  return rows.map((row) => mapRow(row, names));
}

export type ProposalList = { available: boolean; pending: DisclosureProposal[]; recent: DisclosureProposal[] };

export type ProposalListFor = ProposalList & { selfApprovalAllowed: boolean };

/** The list plus the server's answer to "may this admin approve their own proposals?". */
export async function listProposalsFor(adminId: string, recentLimit = 20): Promise<ProposalListFor> {
  const list = await listProposals(recentLimit);
  return { ...list, selfApprovalAllowed: list.available ? await selfApprovalAllowed(adminId) : false };
}

/** Every pending proposal, plus the most recent decisions (the review trail shown on the page). */
export async function listProposals(recentLimit = 20): Promise<ProposalList> {
  const [pending, recent] = await Promise.all([
    db().from("state_disclosure_proposals").select(COLUMNS).eq("status", "pending").order("proposed_at", { ascending: true }).limit(500),
    db().from("state_disclosure_proposals").select(COLUMNS).in("status", ["approved", "rejected", "cancelled"]).order("reviewed_at", { ascending: false }).limit(recentLimit),
  ]);
  if (isMissingSchema(pending.error) || isMissingSchema(recent.error)) return { available: false, pending: [], recent: [] };
  if (pending.error) throw new Error(`Could not load proposals: ${pending.error.message}`);
  if (recent.error) throw new Error(`Could not load proposals: ${recent.error.message}`);
  const all = await withNames([...(pending.data ?? []), ...(recent.data ?? [])]);
  const pendingCount = (pending.data ?? []).length;
  return { available: true, pending: all.slice(0, pendingCount), recent: all.slice(pendingCount) };
}

export type ProposalInput = {
  product_code: string;
  states: string[];
  required_text: string;
  effective_from: string;
  note?: string;
};

export async function createProposals(
  inputs: ProposalInput[],
  proposedBy: string,
  source: "editor" | "import",
): Promise<DisclosureProposal[]> {
  const rows = inputs.map((input) => ({
    product_code: input.product_code,
    states: [...new Set(input.states.map((state) => state.toUpperCase()))].sort(),
    required_text: input.required_text,
    effective_from: input.effective_from,
    note: input.note ? input.note : null,
    source,
    proposed_by: proposedBy,
  }));
  const { data, error } = await db().from("state_disclosure_proposals").insert(rows).select(COLUMNS);
  if (isMissingSchema(error)) throw new ReviewUnavailableError();
  if (error) throw new Error(`Could not submit the proposal: ${error.message}`);
  return withNames(data ?? []);
}

async function loadProposal(id: string): Promise<Row> {
  const { data, error } = await db().from("state_disclosure_proposals").select(COLUMNS).eq("id", id).maybeSingle<Row>();
  if (isMissingSchema(error)) throw new ReviewUnavailableError();
  if (error) throw new Error(`Could not load the proposal: ${error.message}`);
  if (!data) throw new ReviewRefusedError("That proposal no longer exists.", 404);
  return data;
}

// The approval function's refusals, in words an admin can act on.
function approvalRefusal(message: string): ReviewRefusedError | null {
  if (message.includes("PROPOSAL_NOT_FOUND")) return new ReviewRefusedError("That proposal no longer exists.", 404);
  if (message.includes("PROPOSAL_NOT_PENDING")) return new ReviewRefusedError("Someone has already decided this proposal. Reload to see the outcome.");
  if (message.includes("REVIEWER_IS_PROPOSER")) return new ReviewRefusedError("You proposed this wording, so another admin has to approve it.", 403);
  if (message.includes("ATTESTATION_REQUIRED")) {
    return new ReviewRefusedError("Approving your own proposal needs a written attestation of 10 to 500 characters.", 400);
  }
  if (message.includes("REVIEWER_NOT_ACTIVE")) return new ReviewRefusedError("Your admin account is not active.", 403);
  if (message.includes("EFFECTIVE_DATE_NOT_IN_FUTURE")) {
    return new ReviewRefusedError("Its effective date is no longer in the future. Reject it and ask for a new proposal with a later date.");
  }
  if (message.includes("PLACEHOLDER_TEXT")) return new ReviewRefusedError("The wording still carries the placeholder marker, so it cannot be approved.", 400);
  const conflict = /VERSION_EXISTS:([A-Z,]+)/.exec(message);
  if (conflict) {
    return new ReviewRefusedError(
      `A version already takes effect on that date for ${conflict[1].split(",").join(", ")}. Reject this and propose a different date.`,
    );
  }
  if (message.includes("duplicate key")) return new ReviewRefusedError("A version already takes effect on that date for one of these states.");
  return null;
}

export type ReviewOutcome = { proposal: DisclosureProposal; previousStatus: DisclosureProposalStatus; selfApproved: boolean };

export async function reviewProposal(
  id: string,
  action: "approve" | "reject" | "cancel",
  reviewer: string,
  note: string | undefined,
  attestation?: string,
): Promise<ReviewOutcome> {
  const existing = await loadProposal(id);
  if (existing.status !== "pending") throw new ReviewRefusedError("Someone has already decided this proposal. Reload to see the outcome.");

  if (action === "approve") {
    const own = text(existing.proposed_by) === reviewer;
    // The database is the authority on both rules; checking here only gives a clearer answer.
    if (own && !(await selfApprovalAllowed(reviewer))) {
      throw new ReviewRefusedError("You proposed this wording, so another admin has to approve it.", 403);
    }
    if (own && !attestation) {
      throw new ReviewRefusedError("Approving your own proposal needs a written attestation of 10 to 500 characters.", 400);
    }
    const { data, error } = await db().rpc("approve_state_disclosure_proposal", {
      p_proposal_id: id,
      p_reviewer: reviewer,
      p_review_note: note ?? null,
      p_attestation: own ? attestation ?? null : null,
    });
    if (isMissingSchema(error)) throw new ReviewUnavailableError();
    if (error) throw approvalRefusal(error.message) ?? new Error(`Could not approve the proposal: ${error.message}`);
    const [proposal] = await withNames([data ?? existing]);
    return { proposal, previousStatus: "pending", selfApproved: own };
  }

  // Only the proposer withdraws their own proposal; rejecting is the reviewer's word for the same.
  if (action === "cancel" && text(existing.proposed_by) !== reviewer) {
    throw new ReviewRefusedError("Only the admin who proposed it can withdraw it. Reject it instead.", 403);
  }
  if (action === "reject" && text(existing.proposed_by) === reviewer) {
    throw new ReviewRefusedError("Withdraw your own proposal instead of rejecting it.", 400);
  }

  const { data, error } = await db()
    .from("state_disclosure_proposals")
    .update({
      status: action === "cancel" ? "cancelled" : "rejected",
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      review_note: note ? note : null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle<Row>();
  if (isMissingSchema(error)) throw new ReviewUnavailableError();
  if (error) throw new Error(`Could not update the proposal: ${error.message}`);
  if (!data) throw new ReviewRefusedError("Someone has already decided this proposal. Reload to see the outcome.");
  const [proposal] = await withNames([data]);
  return { proposal, previousStatus: "pending", selfApproved: false };
}

/** Tenants that are active today: every one of them reads these rows before an outbound call. */
export async function countActiveTenants(): Promise<number | null> {
  const client = getSupabaseServiceClient();
  const { count, error } = await client.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active");
  return error ? null : count ?? 0;
}
