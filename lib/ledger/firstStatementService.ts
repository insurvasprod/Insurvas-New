import "server-only";

import { createHash } from "node:crypto";

import { getCarrierLibrary, resolveCommissionRate, saveAdvanceRule, saveCarrierRequirement, saveCommissionSchedule, saveTenantCarrier } from "@/lib/carriers/service";
import { refreshDiscrepancies } from "@/lib/discrepancies/service";
import { runDetection } from "@/lib/ingestion/discrepancyStore";
import { computeExpected, saveProductFamily } from "@/lib/ingestion/expectedCommissionStore";
import { refreshPolicyCurrent } from "@/lib/ingestion/policyCurrentStore";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { inForceOn } from "./compute";
import { extraColumns, matchProduct, productsNamed, readFirstStatement, type FirstLine, type FirstStatementFindings } from "./firstStatement";
import { REQUIRED_STATEMENT_FIELDS, type StatementFileKind, type StatementMapping } from "./statementConstants";
import { statementBytesMatch } from "./statementFile";
import { parseStatementCsv, readStatementHeaders, sanitizeStatementMapping, statementMappingProblem, suggestStatementMapping } from "./statementParse";
import {
  StatementError,
  csvOf,
  decideStatementLines,
  getSavedStatementMappings,
  getStatementDetail,
  importStatementFile,
  listPolicyRefs,
  previewStatement,
  rematchStatementLines,
} from "./statementService";

/**
 * Statement first (ledger-r1 board 3·A, owner pick 2026-11-19), the server side. Two calls, both on the file itself:
 *
 *   read     what the statement says (lib/ledger/firstStatement.ts): carrier, policies, period, rate, advance and the
 *            lines already wrong. Writes nothing.
 *   confirm  "Looks Right": the carrier switched on with a contract level, the rate and the advance rule for the
 *            product family, the policies the book lacks, the statement imported, its exact matches accepted, and the
 *            pay checks run, in that order, through the services each step already has (Settings › Carriers, the rate
 *            card, the hand-policy book, the statement import and review, Pay issues' Check Now).
 *
 * A PDF's lines are typed in by a person (LA-4.2), so a PDF has nothing to read here: the caller sends it to the
 * ordinary import. Everything is dated from the statement's first line (else the period's start), so the statement
 * itself is checked against what is saved; before the first row the first row applies anyway (compute.ts inForceOn).
 */

export type FirstStatementFile = { name: string; kind: StatementFileKind; bytes: Uint8Array };

const today = () => new Date().toISOString().slice(0, 10);
const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The file as lines: its CSV, the mapping (the carrier's remembered one when it fits, else guessed), and the extra columns. */
async function readFile(file: FirstStatementFile, saved: Record<string, StatementMapping>, carrierId: string | null) {
  if (file.kind === "pdf") throw new StatementError("A PDF's lines are typed in by hand, so it can't be read here. Use Import a Statement for a PDF, or drop the carrier's CSV or Excel file.", 400, "pdf_not_read");
  if (!statementBytesMatch(file.kind, file.bytes.subarray(0, 1024))) throw new StatementError(file.kind === "csv" ? "That file is not plain text, so it cannot be read as a CSV." : "That file is not the Excel workbook its name says it is.", 400, "unreadable_file");
  const { csv } = await csvOf(file.kind, file.bytes);
  const headers = readStatementHeaders(csv);
  if (!headers.length) throw new StatementError("The file has no header row.", 400, "unreadable_file");
  const fits = (mapping: StatementMapping | undefined) => {
    if (!mapping) return null;
    const clean = sanitizeStatementMapping(mapping, headers);
    return REQUIRED_STATEMENT_FIELDS.every((field) => clean[field]) ? clean : null;
  };
  const mapping = (carrierId ? fits(saved[carrierId]) : null) ?? suggestStatementMapping(headers);
  const problem = statementMappingProblem(mapping, headers);
  if (problem) throw new StatementError(`We couldn't find the policy number and amount columns in this file. Use Import a Statement to choose them. (${problem})`, 400, "no_columns");
  let parsed;
  try {
    parsed = parseStatementCsv(csv, mapping);
  } catch (error) {
    throw new StatementError(error instanceof Error ? error.message : "The file could not be read.", 400, "unreadable_file");
  }
  const extra = extraColumns(headers);
  const lines: FirstLine[] = parsed.lines.map((line) => ({
    lineNumber: line.lineNumber, policyNumber: line.policyNumber, insuredName: line.insuredName, amountCents: line.amountCents, kind: line.kind,
    lineDate: line.lineDate, premiumCents: line.premiumCents, rateBp: line.rateBp, error: line.error, product: extra.product ? line.raw[extra.product] ?? null : null,
  }));
  return { csv, headers, mapping, lines, extra, carrierColumn: extra.carrier ? parsed.lines.map((line) => line.raw[extra.carrier as string] ?? "") : [] };
}

export type FirstStatementRead = {
  findings: FirstStatementFindings;
  carriers: Array<{ id: string; name: string }>;
  products: Array<{ code: string; name: string }>;
  /** The product family preselected: the statement's own, else the first in the library. */
  productCode: string | null;
  /** This file was already imported for the guessed carrier and period. */
  duplicate: boolean;
};

/** Step 2: what the statement says. Reads only. */
export async function readFirstStatementFile(tenantId: string, file: FirstStatementFile): Promise<FirstStatementRead> {
  const [library, saved, book] = await Promise.all([getCarrierLibrary(tenantId), getSavedStatementMappings(tenantId), listPolicyRefs(tenantId)]);
  const layouts = Object.entries(saved).map(([carrierId, mapping]) => ({ carrierId, headers: Object.values(mapping).filter((header): header is string => Boolean(header)) }));
  // Read once to guess the carrier, then again with that carrier's remembered columns when it has some.
  let read = await readFile(file, {}, null);
  const guess = () => readFirstStatement({
    fileName: file.name, headers: read.headers, lines: read.lines, carriers: library.carriers, products: library.products,
    carrierColumn: read.carrierColumn, layouts, book: book.map((policy) => policy.policyNumber), today: today(),
  });
  let findings = guess();
  if (findings.carrier.carrierId && saved[findings.carrier.carrierId]) {
    read = await readFile(file, saved, findings.carrier.carrierId);
    const carrier = findings.carrier;
    findings = { ...guess(), carrier };
  }
  let duplicate = false;
  if (findings.carrier.carrierId) {
    const preview = await previewStatement(tenantId, {
      carrierId: findings.carrier.carrierId, periodStart: findings.period.start, periodEnd: findings.period.end, fileName: file.name,
      csvText: read.csv, mapping: read.mapping, fileSha256: sha256Of(file.bytes),
    }).catch(() => null);
    duplicate = Boolean(preview?.duplicate);
  }
  return {
    findings,
    carriers: library.carriers.map((carrier) => ({ id: carrier.id, name: carrier.name })),
    products: library.products.map((product) => ({ code: product.code, name: product.name })),
    productCode: findings.productCode ?? library.products[0]?.code ?? null,
    duplicate,
  };
}

export type FirstStatementChoices = {
  carrierId: string;
  periodStart: string;
  periodEnd: string;
  productCode: string;
  rateBp: number;
  /** Null: the carrier pays as earned, no advance rule is saved. */
  advance: { pctBp: number; months: number } | null;
};

/** What "Looks Right" wrote, for the audit and the answer. */
export type FirstStatementResult = {
  statementId: string;
  carrierName: string;
  levelSaved: { contractLevelBp: number; effectiveFrom: string } | null;
  rateSaved: boolean;
  advanceSaved: boolean;
  familiesMapped: string[];
  policiesAdded: number;
  lines: number;
  accepted: number;
  acceptedLines: Array<{ line_id: string; line_number: number; policy_id: string | null; proposed_policy_id: string | null }>;
  opened: number;
};

type Db = { from(table: string): { insert(rows: unknown[]): { select(columns: string): PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }> } } };

/** The policies the book lacks, as hand policies (tenant_policies), as Policies › Import writes them. */
async function addPolicies(tenantId: string, userId: string, rows: Array<Record<string, unknown>>): Promise<number> {
  const db = getSupabaseServiceClient() as unknown as Db;
  let added = 0;
  for (let at = 0; at < rows.length; at += 500) {
    let batch: Array<Record<string, unknown>> = rows.slice(at, at + 500).map((row) => ({ status: "active", ...row, tenant_id: tenantId, created_by: userId, source: "csv", renewal_date: null }));
    let result = await db.from("tenant_policies").insert(batch).select("id");
    if (result.error && isSchemaGap(result.error)) {
      // Before the status-date column (LA-4.7) a lapse keeps its status; the ledger falls back to the last edit.
      batch = batch.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "status_changed_at")));
      result = await db.from("tenant_policies").insert(batch).select("id");
    }
    if (!result.error) { added += result.data?.length ?? 0; continue; }
    if (result.error.code !== "23505") throw new Error(`Could not add the policies: ${result.error.message}`);
    // One of them arrived since the read: add the rest one at a time, leaving the one already there.
    for (const row of batch) {
      const one = await db.from("tenant_policies").insert([row]).select("id");
      if (!one.error) added += 1;
      else if (one.error.code !== "23505") throw new Error(`Could not add the policies: ${one.error.message}`);
    }
  }
  return added;
}

/** Step 3: "Looks Right". Every write goes through the service its own screen uses. */
export async function confirmFirstStatement(tenantId: string, userId: string, file: FirstStatementFile, choices: FirstStatementChoices): Promise<FirstStatementResult> {
  if (choices.periodEnd < choices.periodStart) throw new StatementError("The period ends before it starts.", 400, "invalid_period");
  const [library, saved, book] = await Promise.all([getCarrierLibrary(tenantId), getSavedStatementMappings(tenantId), listPolicyRefs(tenantId)]);
  const carrier = library.carriers.find((row) => row.id === choices.carrierId);
  if (!carrier) throw new StatementError("Choose the carrier from the list.", 400, "unknown_carrier");
  const product = library.products.find((row) => row.code === choices.productCode);
  if (!product) throw new StatementError("Choose the product these policies are.", 400, "unknown_product");

  const read = await readFile(file, saved, carrier.id);
  // Refuse a file already imported before anything is written.
  const preview = await previewStatement(tenantId, { carrierId: carrier.id, periodStart: choices.periodStart, periodEnd: choices.periodEnd, fileName: file.name, csvText: read.csv, mapping: read.mapping, fileSha256: sha256Of(file.bytes) });
  if (preview.duplicate) throw new StatementError("This file was already imported for this carrier and period, so nothing was written. Open Statements to see it.", 409, "duplicate_statement");

  const findings = readFirstStatement({ fileName: file.name, headers: read.headers, lines: read.lines, carriers: library.carriers, products: library.products, carrierColumn: read.carrierColumn, book: book.map((policy) => policy.policyNumber), today: today() });
  const dates = read.lines.filter((line) => !line.error && line.lineDate).map((line) => line.lineDate as string).sort();
  const from = dates[0] && dates[0] < choices.periodStart ? dates[0] : choices.periodStart;

  // 1 · The carrier on, with a contract level: the one in force, else 100%.
  try {
    await saveCarrierRequirement(tenantId, userId, { carrier_id: carrier.id, contracted: true });
  } catch {
    // Before the switch's migrations every contracted carrier reads as on; nothing to do.
  }
  const contract = inForceOn(library.tenantCarriers.filter((row) => row.carrier_id === carrier.id && row.is_active), from);
  let levelBp = contract?.contract_level_bp ?? 10_000;
  let levelSaved: FirstStatementResult["levelSaved"] = null;
  if (!contract) {
    const row = await saveTenantCarrier(tenantId, { carrier_id: carrier.id, contract_level_bp: 10_000, writing_number: "", effective_from: from });
    levelBp = row.contract_level_bp;
    levelSaved = { contractLevelBp: row.contract_level_bp, effectiveFrom: from };
  }

  // 2 · The rate and the advance rule for every product family the statement names (the one chosen when it names
  // none), only where the rate card says otherwise. One statement, one rate and one advance: the board's "Your rate".
  const named = productsNamed(read.lines, library.products);
  const families = [...new Set([...named, product.code])].map((code) => library.products.find((row) => row.code === code)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  let rateSaved = false;
  let advanceSaved = false;
  for (const family of families) {
    const rateNow = resolveCommissionRate(library.commissionSchedules, { carrierId: carrier.id, productCode: family.code, contractLevelBp: levelBp, policyYear: 1, asOf: from });
    if (!rateNow || rateNow.rate_bp !== choices.rateBp) {
      await saveCommissionSchedule(tenantId, { carrier_id: carrier.id, product_code: family.code, contract_level_bp: levelBp, policy_year: 1, rate_bp: choices.rateBp, effective_from: from });
      rateSaved = true;
    }
    if (choices.advance) {
      const ruleNow = inForceOn(library.advanceRules.filter((rule) => rule.carrier_id === carrier.id && rule.product_code === family.code), from);
      if (!ruleNow || ruleNow.advance_pct_bp !== choices.advance.pctBp || ruleNow.advance_months !== choices.advance.months) {
        // The advance comes back, in proportion, if the policy lapses inside the months it was paid for.
        await saveAdvanceRule(tenantId, { carrier_id: carrier.id, product_code: family.code, advance_months: choices.advance.months, advance_pct_bp: choices.advance.pctBp, clawback_months: choices.advance.months, clawback_type: "prorated", effective_from: from });
        advanceSaved = true;
      }
    }
  }
  // A Product column's codes map to the family, for the carrier's own files later.
  const familiesMapped: string[] = [];
  const known = (text: string) => library.products.some((row) => row.code.toLowerCase() === text.toLowerCase() || row.name.toLowerCase() === text.toLowerCase());
  for (const code of [...new Set(read.lines.map((line) => line.product?.trim() ?? "").filter((text) => text && !known(text)))].slice(0, 50)) {
    try {
      await saveProductFamily(tenantId, userId, { carrierId: carrier.id, carrierProductCode: code, productCode: product.code });
      familiesMapped.push(code);
    } catch {
      // Before the product-family migration a code stays unmapped; the hand policies carry the family by name.
    }
  }

  // 3 · The policies the book lacks, named as the ledger reads them: the carrier's and the family's names.
  // Each policy is the product its own Product cell names, else the one chosen; a policy the statement only charges
  // back lapsed on that day (its advance was paid before this statement).
  const familyName = (cell: string | null) => library.products.find((row) => row.code === matchProduct(cell, library.products))?.name ?? product.name;
  const policiesAdded = await addPolicies(tenantId, userId, findings.policies.map((policy) => ({
    policy_number: policy.policyNumber.slice(0, 120), insured_name: policy.insuredName.slice(0, 200), carrier: carrier.name, product: familyName(policy.product),
    effective_date: policy.effectiveDate, annual_premium_cents: policy.annualPremiumCents,
    ...(policy.lapsedOn ? { status: "lapsed", status_changed_at: `${policy.lapsedOn}T12:00:00Z` } : {}),
  })));

  // 4 · The statement, matched against the book as it now is; its exact matches accepted.
  const imported = await importStatementFile(tenantId, userId, { carrierId: carrier.id, periodStart: choices.periodStart, periodEnd: choices.periodEnd, fileName: file.name, kind: file.kind, bytes: file.bytes, mapping: read.mapping });
  await rematchStatementLines(tenantId, userId, { statementId: imported.statementId }).catch(() => null);
  const detail = await getStatementDetail(tenantId, imported.statementId);
  const exact = (detail.detail?.lines ?? []).filter((line) => line.match?.status === "proposed" && line.match.method === "exact");
  const decided = exact.length ? await decideStatementLines(tenantId, userId, imported.statementId, exact.map((line) => ({ line_id: line.id, action: "accept" as const }))) : null;

  // 5 · Expected figures for the carrier's files, then the pay checks (Pay issues' Check Now: files and statements).
  if (advanceSaved || familiesMapped.length) await refreshPolicyCurrent({ tenantId, carrierId: carrier.id }).catch(() => null);
  await computeExpected(tenantId, carrier.id).catch(() => null);
  const [files, statements] = await Promise.all([
    runDetection(tenantId).catch((error) => { console.error("[first-statement] carrier-file checks", error); return null; }),
    refreshDiscrepancies(tenantId).catch((error) => { console.error("[first-statement] statement checks", error); return null; }),
  ]);

  return {
    statementId: imported.statementId,
    carrierName: carrier.name,
    levelSaved,
    rateSaved,
    advanceSaved,
    familiesMapped,
    policiesAdded,
    lines: imported.lines,
    accepted: decided?.accepted ?? 0,
    acceptedLines: (decided?.lines ?? []).filter((line) => line.action === "accept"),
    opened: Number((files as { opened?: number } | null)?.opened ?? 0) + (statements?.opened ?? 0) + (statements?.reopened ?? 0),
  };
}
