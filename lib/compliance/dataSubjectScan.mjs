// LA-6.5 · which tables the migrations create that hold (or point at) a person's data. Shared by the
// completeness test (dataSubject.test.mjs). Plain module: node --test loads it directly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A column that identifies a person on its own. */
export const PERSON_COLUMN = /^(contact_id|lead_id|related_contact_id|application_id|phone|phone_digits|phone_number|primary_phone|client_phone_number|email|recipient_email|to_address|first_name|last_name|full_name|insured_name|complainant_name|customer_name|requester_name|dob|date_of_birth|address|address_line1|values|raw|raw_data|raw_payload|payload|card_payload|stored_copy|rating_inputs|evidence|name_on_account|name_on_card|ip)$/;
/** Tables whose rows ARE a person's: a link to one makes a table a person's too. */
export const PERSON_TABLES = ["agent_leads", "contacts", "tenant_applications", "tenant_application_cases", "tenant_uw_interviews", "tenant_verification_sessions", "verification_sessions", "tenant_call_attempts", "tenant_appointments", "complaint", "households"];

export function scanMigrations(root) {
  const dir = join(root, "supabase", "migrations");
  const found = new Map();
  const mark = (table, why) => {
    const t = table.toLowerCase();
    if (!found.has(t)) found.set(t, new Set());
    found.get(t).add(why);
  };
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\s*\)(?: partition by [^;]*)?;/gi)) {
      const [, table, body] = m;
      for (const line of body.split("\n")) {
        const col = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i.exec(line)?.[1]?.toLowerCase();
        if (col && !/^(constraint|primary|unique|check|foreign|exclude)$/.test(col) && PERSON_COLUMN.test(col)) mark(table, `column ${col}`);
        for (const ref of line.matchAll(/references\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) if (PERSON_TABLES.includes(ref[1].toLowerCase())) mark(table, `references ${ref[1]}`);
      }
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?);/gi)) {
      for (const add of m[2].matchAll(/add column (?:if not exists )?"?([a-z_][a-z0-9_]*)"?\s+([^,]*)/gi)) {
        if (PERSON_COLUMN.test(add[1].toLowerCase())) mark(m[1], `column ${add[1]}`);
        for (const ref of add[2].matchAll(/references\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) if (PERSON_TABLES.includes(ref[1].toLowerCase())) mark(m[1], `references ${ref[1]}`);
      }
    }
  }
  return found;
}
