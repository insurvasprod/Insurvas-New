import "server-only";

import { db, isMissingSchema, rows } from "@/lib/applications/db";
import { US_STATES } from "@/lib/appointments/constants";

/**
 * What the client comparison (LA-3.5 print view) needs beyond the case itself: the agency's name,
 * the signed-in agent's name, phone and licence number for the client's state, and each quote's
 * product code (whole life or term). Every read is tenant-scoped; anything missing is simply left
 * off the sheet rather than guessed.
 */
export type PrintContext = {
  agencyName: string | null;
  agent: { name: string | null; phone: string | null; licence: string | null } | null;
  productCodes: Record<string, string>;
};

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));

function formatPhone(raw: string | null | undefined) {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : raw;
}

/** A read that may fail (table not applied yet, no row): null, never an error on the client's sheet. */
async function maybe<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T | null> {
  try {
    const { data, error } = await query;
    if (error) {
      if (!isMissingSchema(error)) console.error("[quotes/print]", error.message);
      return null;
    }
    return (data as T) ?? null;
  } catch (error) {
    console.error("[quotes/print]", error);
    return null;
  }
}

export async function loadPrintContext(input: { tenantId: string; userId: string | null; clientState: string | null; quoteIds: string[] }): Promise<PrintContext> {
  const client = db();
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [profile, tenant, user, producer, quotes] = await Promise.all([
    maybe<{ legal_name: string | null; dba: string | null }>(client.from("agency_profiles").select("legal_name, dba").eq("tenant_id", input.tenantId).maybeSingle()),
    maybe<{ name: string | null }>(client.from("tenants").select("name").eq("id", input.tenantId).maybeSingle()),
    input.userId ? maybe<{ name: string | null; phone: string | null }>(client.from("users").select("name, phone").eq("id", input.userId).maybeSingle()) : Promise.resolve(null),
    input.userId ? maybe<{ state_licence_numbers: Record<string, unknown> | null }>(client.from("tenant_user_producer_profiles").select("state_licence_numbers").eq("tenant_id", input.tenantId).eq("user_id", input.userId).maybeSingle()) : Promise.resolve(null),
    maybe<unknown[]>(client.from("tenant_quotes").select("id, product_code").eq("tenant_id", input.tenantId).in("id", input.quoteIds.length ? input.quoteIds : none)),
  ]);

  const state = input.clientState?.toUpperCase() ?? null;
  const number = state ? producer?.state_licence_numbers?.[state] : null;
  const licence = state && typeof number === "string" && number.trim() ? `${STATE_NAME.get(state) ?? state} licence ${number.trim()}` : null;
  const name = user?.name?.trim() || null;
  const phone = formatPhone(user?.phone);

  return {
    agencyName: profile?.dba?.trim() || profile?.legal_name?.trim() || tenant?.name?.trim() || null,
    agent: name || phone ? { name, phone, licence } : null,
    productCodes: Object.fromEntries(rows<{ id: string; product_code: string }>(quotes).map((q) => [q.id, q.product_code])),
  };
}
