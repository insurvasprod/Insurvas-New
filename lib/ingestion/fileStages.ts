/**
 * Book of business, round 2 (owner 2026-11-02, docs/la4/BUILD-ROUND2.md) · the eight stages of a carrier
 * file, and what happened to each of its rows, derived from what the pipeline already records. Nothing
 * here is stored: the file list, a file's page and a row's page all read the same function, so the
 * strip a person sees on the list is the strip they see on the file.
 *
 *   1 Uploaded      a file_registry row exists (any of the three doors)
 *   2 Layout        the carrier and type are known and a layout map reads them (parse_block, carrier_id)
 *   3 Read          the rows are kept and read (status, row_count, error_detail; a PDF must balance)
 *   4 Status words  no row held for an unmapped carrier status (held_row_count)
 *   5 Linked        every policy has a client: the file's open policy_match_review rows (pick the client) and the
 *                   "policy with no sale" items it raised (queue_item no_deal_flow, tied to the file by carrier and
 *                   the file date the item carries), and the match step
 *   6 History       snapshots and the change log were written (the store step)
 *   7 Pipeline      the steps after linking finished for a policy file (pipeline_completed_at)
 *   8 Commissions   a commission file's lines posted (the reconcile step); lines still waiting on a person
 *
 * Each stage is done · needs you (with a count) · failed · not needed · not reached.
 *
 * Pure and client-safe: relative imports only, so lib/ingestion/fileStages.test.mjs loads it directly.
 */

import { csvCellMinimal } from "../csv/cell.ts";

export const FILE_STAGE_NAMES = ["Uploaded", "Layout", "Read", "Status words", "Linked", "History", "Pipeline", "Commissions"] as const;
export type FileStageName = (typeof FILE_STAGE_NAMES)[number];

export type StageState = "done" | "needs" | "failed" | "skipped" | "pending";

export const STAGE_STATE_LABELS: Record<StageState, string> = {
  done: "Done",
  needs: "Needs you",
  failed: "Failed",
  skipped: "Not needed",
  pending: "Not reached",
};

export type FileStage = {
  name: FileStageName;
  state: StageState;
  /** How many things wait on a person at this stage (needs only); null when the number isn't known. */
  count: number | null;
  /** One short line: why it is in this state. */
  note: string;
};

/** What the registry and the run already know about one file. */
export type FileStageFacts = {
  status: string;
  fileType: string | null;
  carrierKnown: boolean;
  /** parse_block = 'no_layout_map': the carrier and type are known, no layout reads them yet. */
  waitingForLayout: boolean;
  /** Rows were kept (raw_extracted_at set). */
  rowsKept: boolean;
  errorDetail: string | null;
  heldRows: number;
  /** Every step after reading finished (pipeline_completed_at). */
  completed: boolean;
  /** The step of the file's latest run that failed, when one did (pipeline_stage_run). */
  unfinishedStage: string | null;
  /** Open policy_match_review rows for this file: policies waiting for a person to pick the client. */
  openReviews: number;
  /** Open "policy with no sale" items this file raised (queue_item no_deal_flow, same carrier and file date). */
  noSaleItems?: number;
  /** Commission files only, when known: lines whose policy no file has yet, and open money findings. */
  commissionWaiting?: number | null;
};

const isPolicyFeed = (type: string | null) => type === "policies" || type === "new_business";

const stage = (name: FileStageName, state: StageState, note: string, count: number | null = null): FileStage => ({ name, state, count: state === "needs" ? count : null, note });

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What waits at Linked, in words: policies to pick a client for, and policies no sale has. */
export function linkedNote(reviews: number, noSale: number): string {
  const parts = [reviews ? `${plural(reviews, "policy", "policies")} to pick the client for` : "", noSale ? `${plural(noSale, "policy", "policies")} with no sale` : ""].filter(Boolean);
  return `Waiting for you: ${parts.join(", ")}`;
}

/** Which stage a failed file stopped at, from why it failed. */
export function failedAt(facts: Pick<FileStageFacts, "carrierKnown" | "waitingForLayout" | "errorDetail">): "Layout" | "Read" {
  if (!facts.carrierKnown || facts.waitingForLayout) return "Layout";
  if (/required column|layout/i.test(facts.errorDetail ?? "")) return "Layout";
  return "Read";
}

/** The eight stages of one file, in order. */
export function fileStages(facts: FileStageFacts): FileStage[] {
  const policyFeed = isPolicyFeed(facts.fileType);
  const commissions = facts.fileType === "commissions";
  const out: FileStage[] = [stage("Uploaded", "done", "Received and kept as it came")];
  const rest = (from: number, state: StageState, note: string) => {
    for (const name of FILE_STAGE_NAMES.slice(from)) out.push(stage(name, state, note));
    return out;
  };

  if (facts.status === "failed") {
    if (!facts.carrierKnown) {
      out.push(stage("Layout", "needs", "Who sent this? Say which carrier and type it is", 1));
      return rest(2, "pending", "Waits for the carrier to be known");
    }
    if (facts.waitingForLayout) {
      out.push(stage("Layout", "needs", "Waiting for Insurvas to set up this carrier's layout", 1));
      return rest(2, "pending", "Read once the layout exists");
    }
    if (failedAt(facts) === "Layout") {
      out.push(stage("Layout", "failed", facts.errorDetail ?? "The layout doesn't fit this file"));
      return rest(2, "pending", "Not reached: the layout stopped it");
    }
    out.push(stage("Layout", facts.rowsKept ? "done" : "pending", facts.rowsKept ? "The carrier and type are known" : "The file couldn't be opened"));
    out.push(stage("Read", "failed", facts.errorDetail ?? "The rows couldn't be read"));
    return rest(3, "pending", "Not reached: reading stopped it");
  }

  if (facts.status === "received" || facts.status === "parsing") {
    out.push(stage("Layout", facts.carrierKnown ? "done" : "pending", facts.carrierKnown ? "The carrier and type are known" : "Waiting"));
    out.push(stage("Read", "pending", facts.status === "parsing" ? "Reading now" : "Waiting to be read"));
    return rest(3, "pending", "Not reached yet");
  }

  // Read (status parsed, or superseded after it was read).
  out.push(stage("Layout", "done", "Read with the carrier's layout"));
  out.push(stage("Read", "done", "Every row read"));

  const failedStep = facts.unfinishedStage;
  const running = !facts.completed && !failedStep;

  // 4 · Status words
  if (facts.heldRows > 0) out.push(stage("Status words", "needs", `${facts.heldRows} ${facts.heldRows === 1 ? "row is" : "rows are"} held until Insurvas maps the carrier's word`, facts.heldRows));
  else if (commissions) out.push(stage("Status words", "skipped", "A commission file has no policy statuses"));
  else out.push(stage("Status words", "done", "Every carrier word is mapped"));

  if (policyFeed) {
    // 5 · Linked (the match step), 6 · History (the store step, which runs before it)
    const storeFailed = failedStep === "store" || failedStep === "parse";
    const matchFailed = failedStep === "match";
    if (storeFailed) out.push(stage("Linked", "pending", "Not reached: the history step stopped"));
    else if (matchFailed) out.push(stage("Linked", "failed", "Linking stopped. Read again finishes it"));
    else if (facts.openReviews + (facts.noSaleItems ?? 0) > 0) out.push(stage("Linked", "needs", linkedNote(facts.openReviews, facts.noSaleItems ?? 0), facts.openReviews + (facts.noSaleItems ?? 0)));
    else if (running) out.push(stage("Linked", "pending", "Linking now"));
    else out.push(stage("Linked", "done", "Every policy has a client"));

    if (storeFailed) out.push(stage("History", "failed", "The history step stopped. Read again finishes it"));
    else if (running && !facts.completed) out.push(stage("History", "pending", "Recording the changes now"));
    else out.push(stage("History", "done", "Every change recorded"));

    // 7 · Pipeline: the steps after linking (the issue sync, which moves cards).
    if (storeFailed || matchFailed) out.push(stage("Pipeline", "pending", "Not reached"));
    else if (failedStep === "reconcile") out.push(stage("Pipeline", "failed", "A later step stopped. Read again finishes it"));
    else if (!facts.completed) out.push(stage("Pipeline", "pending", "Moving cards now"));
    else out.push(stage("Pipeline", "done", "Cards moved where the carrier's data says"));

    out.push(stage("Commissions", "skipped", "A policy file carries no commission lines"));
    return out;
  }

  if (commissions) {
    out.push(stage("Linked", failedStep === "parse" ? "pending" : "done", "Each line belongs to its policy by carrier and number"));
    out.push(stage("History", "skipped", "A commission file changes no policy"));
    out.push(stage("Pipeline", "skipped", "No card moves from a commission file yet"));
    if (failedStep === "reconcile") out.push(stage("Commissions", "failed", "Posting the lines stopped. Read again finishes it"));
    else if (!facts.completed) out.push(stage("Commissions", "pending", "Posting the lines now"));
    else if ((facts.commissionWaiting ?? 0) > 0) out.push(stage("Commissions", "needs", `${facts.commissionWaiting} ${facts.commissionWaiting === 1 ? "line waits" : "lines wait"} on a policy or a person`, facts.commissionWaiting ?? null));
    else out.push(stage("Commissions", "done", "Lines posted and checked against what was expected"));
    return out;
  }

  // A file of a type nothing is derived from.
  return rest(4, "skipped", "Nothing is derived from this kind of file");
}

export type WhereItIs = { label: string; tone: "good" | "warning" | "danger" | "info" | "neutral" };

/**
 * The "where it is" chip: a failure first, then what waits on a person (the total, at the first stage
 * that waits), then the stage it is at, else Done. A file a corrected one replaced says so.
 */
export function whereItIs(stages: FileStage[], superseded = false): WhereItIs {
  if (superseded) return { label: "Replaced by a corrected file", tone: "neutral" };
  const failed = stages.find((s) => s.state === "failed");
  if (failed) return { label: `${failed.name} failed`, tone: "danger" };
  const needs = stages.filter((s) => s.state === "needs");
  if (needs.length) {
    const total = needs.reduce((sum, s) => sum + (s.count ?? 0), 0);
    const first = needs[0];
    if (first.name === "Layout" && /Insurvas/.test(first.note)) return { label: "Waiting for a layout", tone: "info" };
    if (first.name === "Layout") return { label: "Who sent this?", tone: "warning" };
    return { label: `${total || ""} need you · ${first.name}`.trim(), tone: "warning" };
  }
  const at = stages.find((s) => s.state === "pending");
  if (at) return { label: `At ${at.name}`, tone: "info" };
  return { label: "Done", tone: "good" };
}

/** A file's strip as the list shows it. */
export type FileStageView = { stages: FileStage[]; where: WhereItIs; needs: number };

/** How many things wait on a person across the stages. */
export const needsCount = (stages: FileStage[]): number => stages.reduce((sum, s) => sum + (s.state === "needs" ? s.count ?? 0 : 0), 0);

// ─── rows ────────────────────────────────────────────────────────────────────────────────────────

export const ROW_OUTCOMES = ["needs_you", "new", "changed", "no_change", "held", "commission", "not_read"] as const;
export type RowOutcome = (typeof ROW_OUTCOMES)[number];

export const ROW_OUTCOME_LABELS: Record<RowOutcome, string> = {
  needs_you: "Needs you",
  new: "New",
  changed: "Changed",
  no_change: "No change",
  held: "Held",
  commission: "Posted",
  not_read: "Not read",
};

export const ROW_OUTCOME_TONES: Record<RowOutcome, "warning" | "good" | "info" | "neutral" | "action"> = {
  needs_you: "warning",
  new: "good",
  changed: "info",
  no_change: "neutral",
  held: "warning",
  commission: "good",
  not_read: "neutral",
};

/** What one row of a file came to, from what it produced. A person's decision outranks everything else. */
export function rowOutcome(row: { policyNumber: string | null; commissionLines: number; waitsForPerson: boolean; isNew: boolean; changedFields: number; fileHasHeldRows: boolean }): RowOutcome {
  if (row.waitsForPerson) return "needs_you";
  if (row.policyNumber) {
    if (row.isNew) return "new";
    return row.changedFields > 0 ? "changed" : "no_change";
  }
  if (row.commissionLines > 0) return "commission";
  return row.fileHasHeldRows ? "held" : "not_read";
}

export const MATCH_METHOD_LABELS: Record<string, string> = {
  policy_number_exact: "By policy number",
  submission_record: "By submission number",
  ai_review: "Suggested, then confirmed",
  human: "Picked by a person",
  import: "From your existing book",
  no_match: "To a new client from the row",
};

/** "By policy number", or the method word as stored when it is new. */
export const linkMethodLabel = (method: string | null): string => (method ? MATCH_METHOD_LABELS[method] ?? method.replaceAll("_", " ") : "Not linked");

export const CHANGE_FIELD_LABELS: Record<string, string> = {
  status_normalized: "Status",
  carrier_status_raw: "Carrier's word",
  paid_to_date: "Paid to",
  premium_cents: "Premium",
  premium_mode: "Premium mode",
  payment_method: "Payment method",
  face_amount_cents: "Face amount",
  product_code: "Product",
  product_tier: "Product tier",
  termination_date: "Termination date",
  agent_identifier: "Agent code",
};

/** A changed value as a person reads it: cents as dollars, dates and statuses as words. */
export function changeValue(field: string, value: string | null): string {
  if (value === null || value === "") return "—";
  if (field.endsWith("_cents") && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (field === "status_normalized") return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (date) return new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return value;
}

/**
 * The policies the previous file of the same carrier and type had and this one doesn't. Watched, never
 * lapsed on their own (Module 4: a policy left out of one file is not a lapse).
 */
export function notInFile(previous: Iterable<string>, current: Iterable<string>): string[] {
  const here = new Set(current);
  return [...new Set(previous)].filter((policy) => !here.has(policy)).sort((a, b) => a.localeCompare(b));
}

/** One CSV line per row, through the product's one cell writer (formula-like text neutralised for spreadsheets). */
export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  return [header, ...rows].map((line) => line.map(csvCellMinimal).join(",")).join("\r\n") + "\r\n";
}

/** The policy page's address, with a tab. */
export const policyHref = (carrierId: string, policyNumber: string, tab?: "client" | "history" | "pipeline" | "commissions") =>
  `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}${tab ? `?tab=${tab}` : ""}`;
