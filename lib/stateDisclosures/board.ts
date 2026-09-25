// The Disclosures board's model (p-adm-state-disclosures). Plain module: the server page and the
// client board both use it, and it has no database access.
//
// The table is a coverage matrix — one row per (state, product) pair for every product in scope —
// rather than a list of published rows, because the question the page answers is "what will the
// dialer read for a lead in this state and product line", and a pair with no row is the answer
// that matters most: the dialer refuses that call.

// Relative .ts imports so node's test runner can load this module directly.
import { STATE_CODES, US_STATES } from "../appointments/constants.ts";
import { isPlaceholderDisclosure, type DisclosureProposal, type StateDisclosure } from "./constants.ts";

export type ScopeProduct = { code: string; name: string; inCatalog: boolean };

export type CoverageRow = {
  key: string;
  state: string;
  stateName: string;
  productCode: string;
  productName: string;
  /** The row the dialer serves today, or null when it refuses the call. */
  live: StateDisclosure | null;
  /** Future-dated versions, soonest first. */
  scheduled: StateDisclosure[];
  /** Every stored version for the pair, newest effective date first. */
  versions: StateDisclosure[];
  placeholder: boolean;
  /** Pending proposals that include this pair. */
  pending: DisclosureProposal[];
};

export const STATE_NAME: Record<string, string> = Object.fromEntries(US_STATES.map(([code, name]) => [code, name]));

export function sentenceCaseCode(code: string): string {
  const spaced = code.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The products the page measures coverage against: every active product in the platform catalog
 * (/admin/products), plus any product code that has disclosure rows but is not in the catalog, so
 * nothing published is ever hidden.
 */
export function productScope(catalog: { code: string; name: string }[], disclosures: StateDisclosure[]): ScopeProduct[] {
  const scope: ScopeProduct[] = catalog.map((product) => ({ code: product.code, name: product.name, inCatalog: true }));
  const seen = new Set(scope.map((product) => product.code));
  for (const row of disclosures) {
    if (seen.has(row.product_code)) continue;
    seen.add(row.product_code);
    scope.push({ code: row.product_code, name: sentenceCaseCode(row.product_code), inCatalog: false });
  }
  return scope;
}

export function buildCoverageRows(
  disclosures: StateDisclosure[],
  scope: ScopeProduct[],
  pending: DisclosureProposal[],
): CoverageRow[] {
  const byPair = new Map<string, StateDisclosure[]>();
  for (const row of disclosures) {
    const key = `${row.state}|${row.product_code}`;
    const bucket = byPair.get(key);
    if (bucket) bucket.push(row);
    else byPair.set(key, [row]);
  }
  const rows: CoverageRow[] = [];
  const states = [...STATE_CODES].sort((a, b) => (STATE_NAME[a] ?? a).localeCompare(STATE_NAME[b] ?? b));
  for (const state of states) {
    for (const product of scope) {
      const key = `${state}|${product.code}`;
      const versions = [...(byPair.get(key) ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      const live = versions.find((row) => row.live) ?? null;
      const scheduled = versions.filter((row) => row.status === "scheduled").reverse();
      rows.push({
        key,
        state,
        stateName: STATE_NAME[state] ?? state,
        productCode: product.code,
        productName: product.name,
        live,
        scheduled,
        versions,
        placeholder: live ? isPlaceholderDisclosure(live.required_text) : false,
        pending: pending.filter((proposal) => proposal.product_code === product.code && proposal.states.includes(state)),
      });
    }
  }
  return rows;
}

export type BoardSummary = {
  /** States in which every product in scope has wording in force. */
  statesCovered: number;
  /** Pairs with wording in force. */
  combinationsLive: number;
  /** Pairs with no wording in force: the dialer refuses these calls. */
  uncovered: number;
  /** Pairs whose wording in force is the seeded placeholder. */
  placeholders: number;
  /** Products with wording in force in at least one state. */
  productsLive: number;
  products: number;
};

export function summarize(rows: CoverageRow[], products: number): BoardSummary {
  const statesMissing = new Set<string>();
  const statesSeen = new Set<string>();
  const productsLive = new Set<string>();
  let combinationsLive = 0;
  let placeholders = 0;
  for (const row of rows) {
    statesSeen.add(row.state);
    if (row.live) {
      combinationsLive += 1;
      productsLive.add(row.productCode);
      if (row.placeholder) placeholders += 1;
    } else {
      statesMissing.add(row.state);
    }
  }
  return {
    statesCovered: products === 0 ? 0 : [...statesSeen].filter((state) => !statesMissing.has(state)).length,
    combinationsLive,
    uncovered: rows.length - combinationsLive,
    placeholders,
    productsLive: productsLive.size,
    products,
  };
}

/** First day of the current calendar quarter, UTC, as YYYY-MM-DD. */
export function quarterStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Jan 2026" from a YYYY-MM-DD date. A calendar date, so no time zone is involved. */
export function formatEffectiveDate(date: string | null | undefined): string {
  if (!date) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

/** The wording's first line that is not the placeholder marker, for the one-line table preview. */
export function wordingPreview(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const body = isPlaceholderDisclosure(text) ? lines.slice(1) : lines;
  return body.join(" ");
}

// ── CSV pack ─────────────────────────────────────────────────────────────────────────────────

export const PACK_COLUMNS = ["state", "product_code", "effective_from", "required_text"] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The export. Its first four columns are exactly what "Import a pack" reads, so an export can be
 * edited and brought back as proposals. A pair with nothing in force exports with empty wording,
 * which the importer skips rather than refuses.
 */
export function coverageCsv(rows: CoverageRow[]): string {
  const header = [...PACK_COLUMNS, "state_name", "product_name", "status", "placeholder"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.state,
        row.productCode,
        row.live?.effective_from ?? "",
        row.live?.required_text ?? "",
        row.stateName,
        row.productName,
        row.live ? "in_force" : "not_covered",
        row.placeholder ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** RFC 4180: quoted fields, doubled quotes, CR/LF line ends, newlines inside quotes, a BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

export type PackProposal = { product_code: string; states: string[]; effective_from: string; required_text: string };
export type PackIssue = { line: number; message: string };
export type ParsedPack = {
  proposals: PackProposal[];
  errors: PackIssue[];
  /** Data rows read, excluding the header. */
  rows: number;
  /** Rows with no wording (an export's uncovered pairs), left out on purpose. */
  skipped: number;
};

const PRODUCT_CODE = /^[a-z0-9_]{1,80}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a pack into proposals: one per distinct (product, effective date, wording), carrying every
 * state that shares it — the way disclosure wording is usually adopted. Any bad row makes the pack
 * unusable (the caller shows the errors and imports nothing), so a half-imported pack cannot
 * happen.
 */
export function parsePack(text: string, earliest: string): ParsedPack {
  const table = parseCsv(text);
  const errors: PackIssue[] = [];
  if (table.length === 0) return { proposals: [], errors: [{ line: 1, message: "The file is empty." }], rows: 0, skipped: 0 };

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const index = Object.fromEntries(PACK_COLUMNS.map((column) => [column, header.indexOf(column)])) as Record<(typeof PACK_COLUMNS)[number], number>;
  const missing = PACK_COLUMNS.filter((column) => index[column] < 0);
  if (missing.length) {
    return {
      proposals: [],
      errors: [{ line: 1, message: `The header row is missing ${missing.join(", ")}. Expected columns: ${PACK_COLUMNS.join(", ")}.` }],
      rows: table.length - 1,
      skipped: 0,
    };
  }

  const groups = new Map<string, PackProposal>();
  const seenPairs = new Map<string, number>();
  let skipped = 0;
  const validStates = new Set<string>(STATE_CODES);

  table.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const state = (cells[index.state] ?? "").trim().toUpperCase();
    const product = (cells[index.product_code] ?? "").trim();
    const date = (cells[index.effective_from] ?? "").trim();
    const wording = (cells[index.required_text] ?? "").trim();

    if (!wording) {
      skipped += 1;
      return;
    }
    if (!validStates.has(state)) return void errors.push({ line, message: `"${state || "(blank)"}" is not a US state code.` });
    if (!PRODUCT_CODE.test(product)) return void errors.push({ line, message: `Product code "${product || "(blank)"}" must be lower case letters, digits and underscores.` });
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return void errors.push({ line, message: `Effective date "${date || "(blank)"}" must be a real date in YYYY-MM-DD form.` });
    if (date < earliest) return void errors.push({ line, message: `Effective date ${date} is not in the future; the earliest is ${earliest}.` });
    if (wording.length > 8000) return void errors.push({ line, message: "The wording is longer than 8,000 characters." });
    if (isPlaceholderDisclosure(wording)) return void errors.push({ line, message: "The wording still carries the placeholder marker." });

    const pair = `${state}|${product}|${date}`;
    const earlier = seenPairs.get(pair);
    if (earlier) return void errors.push({ line, message: `${state} / ${product} / ${date} already appears on line ${earlier}.` });
    seenPairs.set(pair, line);

    const key = `${product}\u0000${date}\u0000${wording}`;
    const group = groups.get(key);
    if (group) group.states.push(state);
    else groups.set(key, { product_code: product, states: [state], effective_from: date, required_text: wording });
  });

  return { proposals: errors.length ? [] : [...groups.values()], errors, rows: table.length - 1, skipped };
}
