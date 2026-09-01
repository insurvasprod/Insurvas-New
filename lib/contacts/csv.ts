import type { ContactInput, ContactRow, FieldSchemaRow } from "./types";

export function parseCsv(text: string): string[][] {
  if (text.length > 5_000_000) throw new Error("CSV file is larger than 5 MB");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(cell); if (row.some((value) => value !== "")) rows.push(row); row = []; cell = ""; continue; }
    cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote");
  if (cell || row.length) { row.push(cell); if (row.some((value) => value !== "")) rows.push(row); }
  return rows;
}

export function parseContactCsv(text: string, schema: FieldSchemaRow[]): ContactInput[] {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error("CSV needs a header and at least one contact");
  const headers = rows[0].map((header) => header.trim().toLocaleLowerCase());
  const index = (name: string) => headers.indexOf(name);
  if (index("first_name") < 0 || index("last_name") < 0) throw new Error("CSV must include first_name and last_name columns");
  const allowed = new Set(schema.filter((field) => field.entity === "contact").map((field) => field.field_key));
  return rows.slice(1).map((values) => {
    const get = (name: string) => { const at = index(name); return at < 0 ? "" : values[at]?.trim() ?? ""; };
    const custom_fields: Record<string, unknown> = {};
    headers.forEach((header, at) => { if (header.startsWith("custom_") && allowed.has(header.slice(7)) && values[at] !== "") custom_fields[header.slice(7)] = values[at]; });
    const phones = get("phones").split("|").map((value) => value.trim()).filter(Boolean).map((value) => ({ phone: value, type: "other" as const, is_primary: value === get("primary_phone") }));
    const emails = get("emails").split("|").map((value) => value.trim()).filter(Boolean).map((value) => ({ email: value, is_primary: value === get("email") }));
    return { first_name: get("first_name"), last_name: get("last_name"), dob: get("dob") || null, primary_phone: get("primary_phone") || null, email: get("email") || null, state: get("state") || null, address_line1: get("address_line1") || null, city: get("city") || null, postal_code: get("postal_code") || null, custom_fields, phones, emails };
  });
}

function csvCell(value: unknown) { const text = Array.isArray(value) ? value.join("|") : value === null || value === undefined ? "" : String(value); const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; }

export function csvForContacts(schema: FieldSchemaRow[], contacts: ContactRow[]) {
  const fields = schema.filter((field) => field.entity === "contact").sort((a, b) => a.sort_order - b.sort_order);
  const headers = ["first_name", "last_name", "dob", "primary_phone", "email", "phones", "emails", "state", "address_line1", "city", "postal_code", ...fields.map((field) => `custom_${field.field_key}`)];
  const lines = [headers.map(csvCell).join(",")];
  for (const contact of contacts.filter((item) => !item.merged_into_id)) {
    const primaryEmail = contact.emails.find((item) => item.is_primary)?.email ?? contact.emails[0]?.email ?? "";
    lines.push([contact.first_name, contact.last_name, contact.dob, contact.primary_phone, primaryEmail, contact.phones.map((item) => item.phone), contact.emails.map((item) => item.email), contact.state, contact.address_line1, contact.city, contact.postal_code, ...fields.map((field) => contact.custom_fields[field.field_key])].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
