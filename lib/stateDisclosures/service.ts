import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { STATE_CODES } from "@/lib/appointments/constants";
import type { DisclosureCoverage, StateDisclosure } from "./constants";

export type { DisclosureCoverage } from "./constants";

type Row = {
  id: string; state: string; product_code: string; required_text: string;
  effective_from: string; created_at: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

// `state_disclosures` carries no tenant_id — it is platform reference data that every tenant reads
// through an RLS policy of `using (true)`. Writes are service_role only, which is why publishing
// lives on the admin plane rather than in the agent app.
//
// The table is absent from the generated database types — it arrived in an outbound migration that
// postdates the last type generation — so the client is narrowed here to the shape this file uses.
// The dialer's reader in lib/dialerScripts/service.ts does the same thing for the same reason.
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  update(values: unknown): Query;
  upsert(values: unknown, options?: { onConflict?: string }): Query;
  delete(): Query;
  maybeSingle<T>(): Promise<Result<T>>;
  // Every list query in this file selects the same six columns, so awaiting a builder always
  // yields rows of that one shape. Saying so here, rather than casting `.data` at each call site,
  // keeps the casts from drifting apart from the select strings they are meant to describe.
  then(
    resolve: (value: Result<Row[]>) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
};
type Db = { from(table: string): Query };

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

function classify(rows: Row[]): StateDisclosure[] {
  const now = today();
  // The dialer serves, for each (state, product), the newest row whose effective_from has arrived.
  // Reproducing that rule here is the whole point of the status column: an admin needs to see the
  // row the dialer will actually read, not merely that some row exists.
  const liveIds = new Set<string>();
  const byPair = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.state}\u0000${row.product_code}`;
    const bucket = byPair.get(key);
    if (bucket) bucket.push(row);
    else byPair.set(key, [row]);
  }
  for (const bucket of byPair.values()) {
    const arrived = bucket
      .filter((row) => row.effective_from <= now)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
    if (arrived[0]) liveIds.add(arrived[0].id);
  }

  return rows.map((row) => {
    const live = liveIds.has(row.id);
    return {
      ...row,
      live,
      status: live ? "live" : row.effective_from > now ? "scheduled" : "superseded",
    };
  });
}

export async function listStateDisclosures(): Promise<StateDisclosure[]> {
  const { data, error } = await db()
    .from("state_disclosures")
    .select("id, state, product_code, required_text, effective_from, created_at")
    .order("product_code", { ascending: true })
    .order("state", { ascending: true })
    .order("effective_from", { ascending: false });
  if (error) throw new Error(`Could not load state disclosures: ${error.message}`);
  return classify(data ?? []);
}

// What the screen leads with. A list of rows answers "what have we published"; this answers the
// question an admin actually has, which is "where can my tenants dial today, and where can they
// not". Without it the screen can be full of rows while the whole west coast is still blocked.
export function coverage(disclosures: StateDisclosure[]): DisclosureCoverage[] {
  const byProduct = new Map<string, Set<string>>();
  for (const row of disclosures) {
    if (!row.live) continue;
    const bucket = byProduct.get(row.product_code);
    if (bucket) bucket.add(row.state);
    else byProduct.set(row.product_code, new Set([row.state]));
  }
  return [...byProduct.entries()]
    .map(([product_code, states]) => ({
      product_code,
      published: STATE_CODES.filter((code) => states.has(code)),
      missing: STATE_CODES.filter((code) => !states.has(code)),
    }))
    .sort((a, b) => a.product_code.localeCompare(b.product_code));
}

export async function publishStateDisclosure(input: {
  states: string[];
  product_code: string;
  required_text: string;
  effective_from: string;
}): Promise<StateDisclosure[]> {
  const rows = input.states.map((state) => ({
    state: state.toUpperCase(),
    product_code: input.product_code,
    required_text: input.required_text,
    effective_from: input.effective_from,
  }));

  // The table's unique key is (state, product_code, effective_from). Re-publishing the same day is
  // a correction to wording, not a second disclosure, so it updates in place rather than failing
  // with a constraint violation the admin cannot act on.
  const { data, error } = await db()
    .from("state_disclosures")
    .upsert(rows, { onConflict: "state,product_code,effective_from" })
    .select("id, state, product_code, required_text, effective_from, created_at");
  if (error) throw new Error(`Could not publish the disclosure: ${error.message}`);
  return classify(data ?? []);
}

export async function updateStateDisclosure(
  id: string,
  patch: { required_text?: string; effective_from?: string },
): Promise<StateDisclosure> {
  if (Object.keys(patch).length === 0) throw new Error("Nothing to change");
  const { data, error } = await db()
    .from("state_disclosures")
    .update(patch)
    .eq("id", id)
    .select("id, state, product_code, required_text, effective_from, created_at")
    .maybeSingle<Row>();
  if (error) throw new Error(`Could not update the disclosure: ${error.message}`);
  if (!data) throw new Error("That disclosure no longer exists");
  return classify([data])[0];
}

export async function deleteStateDisclosure(id: string): Promise<StateDisclosure> {
  // Read first so the audit entry can name what went, and so a delete of an already-gone row
  // reports that rather than reporting success.
  const existing = await db()
    .from("state_disclosures")
    .select("id, state, product_code, required_text, effective_from, created_at")
    .eq("id", id)
    .maybeSingle<Row>();
  if (existing.error) throw new Error(`Could not load the disclosure: ${existing.error.message}`);
  if (!existing.data) throw new Error("That disclosure no longer exists");

  const { error } = await db().from("state_disclosures").delete().eq("id", id);
  if (error) throw new Error(`Could not withdraw the disclosure: ${error.message}`);
  return classify([existing.data])[0];
}
