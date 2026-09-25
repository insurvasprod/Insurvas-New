export type PolicyImportRow = {
  policy_number: string;
  insured_name: string;
  carrier: string;
  product: string;
  effective_date: string;
  annual_premium_cents: number;
  status: "active" | "pending" | "lapsed" | "cancelled";
  renewal_date: string | null;
};

export type PolicyCsvResult = {
  headers: string[];
  rows: PolicyImportRow[];
  errors: Array<{ row: number; message: string }>;
};

const aliases: Record<string, keyof PolicyImportRow> = {
  policynumber: "policy_number", policyid: "policy_number", number: "policy_number",
  insuredname: "insured_name", insured: "insured_name", customername: "insured_name",
  carrier: "carrier", company: "carrier", carriername: "carrier",
  product: "product", productline: "product", plan: "product",
  effectivedate: "effective_date", issuedate: "effective_date", startdate: "effective_date",
  annualpremium: "annual_premium_cents", premium: "annual_premium_cents", annualpremiumdollars: "annual_premium_cents",
  status: "status", renewaldate: "renewal_date", renewaldue: "renewal_date",
};

function key(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

export function parsePolicyCsv(text: string, maxRows = 1000): PolicyCsvResult {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) return { headers: [], rows: [], errors: [{ row: 1, message: "The CSV has an unclosed quoted value." }] };
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  const headers = rows[0] ?? [];
  const columns = headers.map((header) => aliases[key(header)] ?? null);
  const errors: PolicyCsvResult["errors"] = [];
  const required: Array<keyof PolicyImportRow> = ["policy_number", "insured_name", "carrier", "product", "effective_date", "annual_premium_cents"];
  for (const field of required) if (!columns.includes(field)) errors.push({ row: 1, message: `Missing required column: ${field.replaceAll("_", " ")}.` });
  const resultRows: PolicyImportRow[] = [];
  if (errors.length) return { headers, rows: resultRows, errors };
  for (let index = 1; index < rows.length && index <= maxRows; index += 1) {
    const source = rows[index];
    const get = (field: keyof PolicyImportRow) => source[columns.indexOf(field)]?.trim() ?? "";
    const premium = get("annual_premium_cents").replace(/[$,\s]/g, "");
    const dollars = Number(premium);
    const rawDate = get("effective_date");
    const effective = normalizeDate(rawDate);
    const renewal = get("renewal_date") ? normalizeDate(get("renewal_date")) : null;
    const status = (get("status") || "active").toLowerCase() as PolicyImportRow["status"];
    const missing = required.filter((field) => !get(field));
    if (missing.length) errors.push({ row: index + 1, message: `Missing ${missing.map((field) => field.replaceAll("_", " ")).join(", ")}.` });
    else if (!Number.isFinite(dollars) || dollars < 0) errors.push({ row: index + 1, message: "Annual premium must be a non-negative dollar amount." });
    else if (!effective) errors.push({ row: index + 1, message: "Effective date must be YYYY-MM-DD or MM/DD/YYYY." });
    else if (renewal === false) errors.push({ row: index + 1, message: "Renewal date must be YYYY-MM-DD or MM/DD/YYYY." });
    else if (!(["active", "pending", "lapsed", "cancelled"] as string[]).includes(status)) errors.push({ row: index + 1, message: "Status must be active, pending, lapsed, or cancelled." });
    else resultRows.push({ policy_number: get("policy_number"), insured_name: get("insured_name"), carrier: get("carrier"), product: get("product"), effective_date: effective, annual_premium_cents: Math.round(dollars * 100), status, renewal_date: renewal || null });
  }
  if (rows.length - 1 > maxRows) errors.push({ row: maxRows + 2, message: `Files are limited to ${maxRows.toLocaleString()} rows.` });
  return { headers, rows: resultRows, errors };
}

function normalizeDate(value: string): string | false {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function policyCsvTemplate() {
  return "policy_number,insured_name,carrier,product,effective_date,annual_premium,status,renewal_date\nPOL-1001,Alex Morgan,Summit Life,Term Life,2026-01-15,1200.00,active,2027-01-15\n";
}
