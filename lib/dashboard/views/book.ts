/**
 * The dashboard's Book of business view (/app/dashboard?view=book, owner 2026-11-06): the book as the Policies
 * page reads it, the carrier files as Carrier sync reads them, and the decisions they left, each figure from the
 * read its own page makes and each linking to that page filtered to what was clicked.
 *
 * Two halves in one file. The top is pure shaping (no I/O, relative imports only), so
 * lib/dashboard/views/book.test.mjs runs it under node. `loadBookView` at the bottom is the server read: it
 * loads its stores with dynamic imports, each of which is `server-only`, so this module never reaches a client
 * bundle with a read in it, and node never resolves them while testing the shaping.
 *
 * Scope (AG-0.5): the book is read under the viewer's scope (loadBook, loadHandPolicies, loadIssuedAwaiting
 * narrow themselves). Carrier files, policy changes and the decision queues are agency-wide, as their own pages
 * are: they are read only when the reader may open those pages and the session is not narrowed to a producer's
 * book (Needs you and Policy matching refuse a narrow agency session; Carrier files is the owner's and the
 * bookkeeper's). A read that fails leaves its card out; nothing is ever guessed.
 */

import { firstOpenable } from "../roleHome.ts";
import { changeLabel, statusLabel, type BookRow } from "../../ingestion/policyBook.ts";
import { policyHref } from "../../ingestion/fileStages.ts";
import type { FileStage, WhereItIs } from "../../ingestion/fileStages.ts";
import type { DashViewProps } from "@/components/app/home/views/view-props";

// ─── shaping (pure) ──────────────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The last `count` calendar months up to and including `today`'s (yyyy-mm-dd), oldest first, as yyyy-mm. */
export function monthKeys(today: string, count = 12): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const index = year * 12 + month - back;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** A month's first and last day, as the Policies page's issued-from / issued-to filter takes them. */
export function monthRange(key: string): { from: string; to: string } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** "Nov 4": a day as the lists show it. */
export const shortDay = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

export type MonthPoint = { key: string; label: string; value: number };

/** Policies issued each month (by the issue date the Policies list filters on), every month present. */
export function issuedByMonth(rows: ReadonlyArray<Pick<BookRow, "issueDate">>, keys: readonly string[]): MonthPoint[] {
  const counts = new Map(keys.map((key) => [key, 0]));
  for (const row of rows) {
    const key = row.issueDate?.slice(0, 7);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((key) => ({ key, label: monthLabel(key), value: counts.get(key) ?? 0 }));
}

export type LapseChange = { carrierId: string; policyNumber: string; toDate: string };

/**
 * Policies a carrier file moved to Lapsed each month (policy_change, status_normalized → lapsed, by the file's
 * date), each policy once a month, and only the policies in `visible` (carrier|policy: the reader's book).
 */
export function lapsedByMonth(changes: readonly LapseChange[], keys: readonly string[], visible: ReadonlySet<string>): MonthPoint[] {
  const seen = new Map(keys.map((key) => [key, new Set<string>()]));
  for (const change of changes) {
    const policy = `${change.carrierId}|${change.policyNumber}`;
    const month = seen.get(change.toDate.slice(0, 7));
    if (month && visible.has(policy)) month.add(policy);
  }
  return keys.map((key) => ({ key, label: monthLabel(key), value: seen.get(key)?.size ?? 0 }));
}

const IN_FORCE = new Set(["active", "at_risk"]);
/** In force as the Policies list's "In force" chip counts it (policyMoney.isInForce). */
export const inForceRow = (row: Pick<BookRow, "status">) => IN_FORCE.has(row.status ?? "");

const annual = (rows: ReadonlyArray<Pick<BookRow, "annualCents">>) => rows.reduce((sum, row) => sum + (row.annualCents ?? 0), 0);

export type BookTotals = { all: number; inForce: number; annualCents: number; withoutPremium: number };

/** The book's head figures: policies in force and their annualised premium, and every policy listed. */
export function bookTotals(rows: ReadonlyArray<Pick<BookRow, "status" | "annualCents">>): BookTotals {
  const live = rows.filter(inForceRow);
  return { all: rows.length, inForce: live.length, annualCents: annual(live), withoutPremium: live.filter((row) => row.annualCents === null).length };
}

export type StandingRow = { key: string; label: string; count: number; annualCents: number; href: string };

/**
 * Where the book stands, one row per state the Policies list can open on its own: in force (its In force chip),
 * approved but unpaid and submitted (its status filter), recorded sales waiting for their carrier's file (its
 * source filter), lapsed; and charged back when the ledger was read (`chargedBack`: carrier|policy keys with a
 * net chargeback), which opens the ledger's chargeback lines. A pending state with nothing in it is left out.
 */
export function bookStanding(rows: readonly BookRow[], chargedBack: ReadonlySet<string> | null, ledgerHref: string | null): StandingRow[] {
  const sum = (key: string, label: string, pick: (row: BookRow) => boolean, href: string, always = false): StandingRow[] => {
    const hit = rows.filter(pick);
    return hit.length || always ? [{ key, label, count: hit.length, annualCents: annual(hit), href }] : [];
  };
  return [
    ...sum("inforce", "In force", inForceRow, "/app/policies?show=inforce", true),
    ...sum("approved", statusLabel("approved_unpaid"), (row) => row.status === "approved_unpaid", "/app/policies?status=approved_unpaid"),
    ...sum("submitted", statusLabel("submitted"), (row) => row.status === "submitted", "/app/policies?status=submitted"),
    ...sum("awaiting", "Waiting for the carrier's file", (row) => row.source === "issued", "/app/policies?source=issued"),
    ...sum("lapsed", statusLabel("lapsed"), (row) => row.status === "lapsed", "/app/policies?status=lapsed", true),
    ...(chargedBack && ledgerHref ? sum("chargedback", "Charged back", (row) => chargedBack.has(`${row.carrierId}|${row.policyNumber}`), `${ledgerHref}?type=chargeback`, true) : []),
  ];
}

export type ChargebackLine = { carrierId: string; policyNumber: string; entryType: string; correctsType: string | null; amountCents: number };

/**
 * The policies with money taken back: chargeback lines (and reversals of them, which net against them, as the
 * ledger nets them) summed per policy; a policy whose net is below zero was charged back.
 */
export function chargedBackPolicies(lines: readonly ChargebackLine[]): Set<string> {
  const net = new Map<string, number>();
  for (const line of lines) {
    if ((line.correctsType ?? line.entryType) !== "chargeback") continue;
    const key = `${line.carrierId}|${line.policyNumber}`;
    net.set(key, (net.get(key) ?? 0) + line.amountCents);
  }
  return new Set([...net.entries()].filter(([, cents]) => cents < 0).map(([key]) => key));
}

export type CarrierShare = { key: string; label: string; value: number; href: string };

/**
 * The policies in force by carrier: annualised premium (`money`) or how many, the biggest `top` named and the
 * rest as "Other carriers". Each opens the Policies list on that carrier, in force; "Other" opens all in force.
 */
export function carrierShares(rows: readonly BookRow[], money: boolean, top = 4): CarrierShare[] {
  const by = new Map<string, { label: string; value: number }>();
  for (const row of rows.filter(inForceRow)) {
    const entry = by.get(row.carrierId) ?? { label: row.carrierName || "Carrier not known", value: 0 };
    entry.value += money ? row.annualCents ?? 0 : 1;
    by.set(row.carrierId, entry);
  }
  const sorted = [...by.entries()].map(([id, entry]) => ({ id, ...entry })).filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const named = sorted.slice(0, top).map((entry) => ({ key: entry.id, label: entry.label, value: entry.value, href: `/app/policies?show=inforce&carrier=${encodeURIComponent(entry.id)}` }));
  const rest = sorted.slice(top).reduce((sum, entry) => sum + entry.value, 0);
  return rest > 0 ? [...named, { key: "other", label: "Other carriers", value: rest, href: "/app/policies?show=inforce" }] : named;
}

export type PolicyChangeLite = { id: string; carrierId: string; carrierName: string; policyNumber: string; fieldName: string; oldValue: string | null; newValue: string | null; toDate: string };

export type ChangeItem = { key: string; kind: "issued" | "lapsed" | "status" | "draft"; title: string; detail: string; when: string; href: string; /** The snapshot day (yyyy-mm-dd), for ordering beside other events. */ on?: string };

const PRE_ISSUE = new Set(["submitted", "approved_unpaid"]);

/**
 * What the carrier files changed lately, newest first: a policy issued (moved to Active from submitted or
 * approved), lapsed, any other status move, and a draft (paid-to) date moved back. A paid-to date moving forward
 * is a payment going through each month, not news, so it is left to the policy's own history. Each item opens
 * that policy's history; the client's name from the reader's book when it holds the policy.
 */
export function recentChanges(changes: readonly PolicyChangeLite[], clients: ReadonlyMap<string, string | null>, limit = 6): ChangeItem[] {
  const out: ChangeItem[] = [];
  for (const change of changes) {
    let kind: ChangeItem["kind"] | null = null;
    if (change.fieldName === "status_normalized") kind = change.newValue === "lapsed" ? "lapsed" : change.newValue === "active" && PRE_ISSUE.has(change.oldValue ?? "") ? "issued" : "status";
    else if (change.fieldName === "paid_to_date" && change.oldValue && change.newValue && change.newValue < change.oldValue) kind = "draft";
    if (!kind) continue;
    const client = clients.get(`${change.carrierId}|${change.policyNumber}`) ?? null;
    out.push({
      key: change.id,
      kind,
      title: client ?? `Policy ${change.policyNumber}`,
      detail: `${change.carrierName || "Carrier"} · ${kind === "issued" ? "Issued" : kind === "draft" ? "Draft date moved back" : changeLabel({ field: change.fieldName, oldValue: change.oldValue, newValue: change.newValue })}`,
      when: shortDay(change.toDate),
      on: change.toDate,
      href: policyHref(change.carrierId, change.policyNumber, "history"),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type FileLite = { id: string; carrierName: string | null; fileType: string | null; fileDate: string | null; originalFilename: string; status: string; receivedAt: string };

/** The files received in the last `days` days before `now` (ms), newest first, at most `limit`; replaced ones left out. */
export function filesThisWeek<T extends FileLite>(files: readonly T[], now: number, days = 7, limit = 6): T[] {
  const since = now - days * 86_400_000;
  return files.filter((file) => file.status !== "superseded" && Date.parse(file.receivedAt) >= since).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
}

const TYPE_WORDS: Record<string, string> = { policies: "Policy file", commissions: "Commission statement", new_business: "New business file" };
export const fileTypeWord = (type: string | null) => (type ? TYPE_WORDS[type] ?? "Carrier file" : "Carrier file");

/** The agency's calendar day (yyyy-mm-dd) at `now` in `zone`. */
export function dayIn(zone: string, now: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

// ─── the read (server) ───────────────────────────────────────────────────────────────────────────

export type BookNeed = { key: string; count: number; label: string; detail?: string; tone: "danger" | "warning"; href: string };

export type BookFile = FileLite & { href: string; stages: FileStage[] | null; where: WhereItIs | null; reading: boolean };

export type BookViewData = {
  /** Dollar figures may show (not a manager). */
  money: boolean;
  links: { policies: string | null; files: string | null; needsYou: string | null; changes: string | null };
  needs: BookNeed[];
  /** Null when the Policies page is closed to the reader, or its read failed. */
  book: null | {
    /** The rows behind every figure, as the Policies list shows them (the agency dashboard shapes its own from them). */
    rows: BookRow[];
    totals: BookTotals;
    standing: StandingRow[];
    shares: CarrierShare[];
    issued: MonthPoint[];
    /** Null when the policy changes could not be read. */
    lapsed: MonthPoint[] | null;
  };
  /** Null when Carrier files is closed to the reader (or the session is narrowed), or its read failed. */
  files: BookFile[] | null;
  /** Null when Recent changes is closed to the reader, or its read failed. */
  changes: ChangeItem[] | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const PAGE = 1000;

/** Every row of a query, a page at a time, up to `max`; null when a page fails. */
async function pages(build: () => Loose, max = 20_000): Promise<Loose[] | null> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return null;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const head = async (query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> => {
  const { count, error } = await query;
  return error ? null : count ?? 0;
};

const safe = <T>(promise: Promise<T>): Promise<T | null> => promise.catch((error) => {
  console.error("[dashboard:book]", error);
  return null;
});

export async function loadBookView(props: DashViewProps): Promise<BookViewData> {
  const [{ getSupabaseServiceClient }, bookStore, registry, outcomes, snapshots] = await Promise.all([
    import("@/lib/supabase/service"),
    import("@/lib/ingestion/policyBookStore"),
    import("@/lib/ingestion/registry"),
    import("@/lib/ingestion/fileOutcomeStore"),
    import("@/lib/ingestion/snapshotStore"),
  ]);
  const { context, available, scope, solo, zone, now, noMoney } = props;
  const { tenantId, userId, role } = context;
  const db = (): Loose => getSupabaseServiceClient();
  const open = (key: string) => firstOpenable([key], available, role, solo);
  const wide = scope === null;
  const keeper = role === "owner" || role === "bookkeeper";

  const policiesHref = open("book.policies");
  // Agency-wide pages: their own gates, and never for a session narrowed to a producer's book.
  const filesHref = wide ? open("book.carrier_files") : null;
  const needsHref = wide ? open("book.needs_you") : null;
  const rateHref = open("book.rate_card");
  const ledgerHref = open("book.ledger");
  // Recent changes (Policies › Recent changes) and Policy matching keep Carrier files' gates.
  const changesHref = policiesHref && filesHref ? "/app/policies?view=changes" : null;
  const matchingHref = filesHref ? "/app/policy-matching" : null;

  const viewer = { tenantId, userId, role, scope };
  const today = dayIn(zone, now);
  const keys = monthKeys(today, 12);
  const count = (table: string) => db().from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);

  const [bookRead, hand, issued, failedFiles, missingFiles, toPick, noCarrier, fileList, changeList, lapseRows, chargebackRows] = await Promise.all([
    policiesHref ? safe(bookStore.loadBook(viewer)) : null,
    policiesHref ? safe(bookStore.loadHandPolicies(viewer)) : null,
    policiesHref ? safe(bookStore.loadIssuedAwaiting(viewer)) : null,
    // As the Book of business rail counts them: failed, not replaced, not just waiting for a layout.
    filesHref ? safe(head(count("file_registry").eq("status", "failed").is("superseded_by_file_id", null).or("parse_block.is.null,parse_block.neq.no_layout_map"))) : null,
    filesHref ? safe(outcomes.loadMissingFiles(tenantId)) : null,
    matchingHref ? safe(head(count("policy_match_review").eq("status", "open"))) : null,
    // A sale no carrier has: the owner and bookkeepers every one, a producer those assigned to them.
    needsHref ? safe(head((keeper ? count("queue_item") : count("queue_item").eq("assigned_to_user_id", userId)).eq("status", "open").eq("queue_type", "no_policy"))) : null,
    filesHref ? safe(registry.listCarrierFiles(tenantId, 60)) : null,
    changesHref ? safe(snapshots.listPolicyChanges(tenantId, 300)) : null,
    policiesHref ? safe(pages(() => db().from("policy_change").select("carrier_id, policy_number, to_snapshot_date").eq("tenant_id", tenantId).eq("field_name", "status_normalized").eq("new_value", "lapsed").gte("to_snapshot_date", `${keys[0]}-01`).order("to_snapshot_date").order("id"))) : null,
    policiesHref && ledgerHref ? safe(pages(() => db().from("commission_entry").select("carrier_id, policy_number, entry_type, corrects_type, amount_cents").eq("tenant_id", tenantId).or("entry_type.eq.chargeback,corrects_type.eq.chargeback").order("id"))) : null,
  ]);

  // The book: exactly the rows the Policies list shows this reader.
  const rows: BookRow[] | null = bookRead && hand && issued ? [...(bookRead.available ? bookRead.rows : []), ...hand, ...issued] : null;
  const visible = new Set((rows ?? []).map((row) => `${row.carrierId}|${row.policyNumber}`));
  const chargedBack = chargebackRows ? chargedBackPolicies(chargebackRows.map((line: Loose) => ({ carrierId: line.carrier_id, policyNumber: line.policy_number, entryType: line.entry_type, correctsType: line.corrects_type ?? null, amountCents: Number(line.amount_cents) }))) : null;
  const book = rows ? {
    rows,
    totals: bookTotals(rows),
    standing: bookStanding(rows, chargedBack ? new Set([...chargedBack].filter((key) => visible.has(key))) : null, ledgerHref),
    shares: carrierShares(rows, !noMoney),
    issued: issuedByMonth(rows, keys),
    lapsed: lapseRows ? lapsedByMonth(lapseRows.map((row: Loose) => ({ carrierId: row.carrier_id, policyNumber: row.policy_number, toDate: String(row.to_snapshot_date) })), keys, visible) : null,
  } : null;

  // Needs you, most urgent first; a read that failed (null) is left out.
  const unpriced = bookRead && bookRead.available ? bookRead.unpriced?.policies ?? 0 : null;
  const needs: BookNeed[] = [
    ...(filesHref && failedFiles !== null ? [{ key: "failed", count: failedFiles, label: "Files that failed", detail: "nothing from them was posted", tone: "danger" as const, href: `${filesHref}?show=failed` }] : []),
    ...(needsHref && noCarrier !== null ? [{ key: "no-carrier", count: noCarrier, label: "Sales no carrier has", detail: "recorded as issued, in no carrier file", tone: "danger" as const, href: `${needsHref}?group=sales` }] : []),
    ...(filesHref && missingFiles?.available ? [{ key: "missing", count: missingFiles.missing.length, label: "Files missing", detail: "expected, not arrived", tone: "warning" as const, href: `${filesHref}?show=missing` }] : []),
    ...(matchingHref && toPick !== null ? [{ key: "pick-client", count: toPick, label: "Clients to pick", detail: "a policy matched more than one client", tone: "warning" as const, href: matchingHref }] : []),
    ...(rateHref && unpriced !== null ? [{ key: "no-rate", count: unpriced, label: "Policies with no rate", detail: "their commission can't be checked", tone: "warning" as const, href: rateHref }] : []),
  ];

  // The files of this week, each with its stages from the read the Files list makes.
  let files: BookFile[] | null = null;
  if (fileList?.available) {
    const week = filesThisWeek(fileList.files, now);
    const stages = week.length ? await safe(outcomes.listFileStages(tenantId, week)) : {};
    files = week.map((file) => ({
      id: file.id, carrierName: file.carrierName, fileType: file.fileType, fileDate: file.fileDate, originalFilename: file.originalFilename, status: file.status, receivedAt: file.receivedAt,
      href: `/app/carrier-files/file/${file.id}`,
      stages: stages?.[file.id]?.stages ?? null,
      where: stages?.[file.id]?.where ?? null,
      reading: file.status === "received" || file.status === "parsing",
    }));
  }

  const clients = new Map((rows ?? []).map((row) => [`${row.carrierId}|${row.policyNumber}`, row.clientName] as const));
  const changes = changeList?.available ? recentChanges(changeList.changes.map((change) => ({ id: change.id, carrierId: change.carrierId, carrierName: change.carrierName, policyNumber: change.policyNumber, fieldName: change.fieldName, oldValue: change.oldValue, newValue: change.newValue, toDate: String(change.toDate) })), clients) : null;

  return {
    money: !noMoney,
    links: { policies: policiesHref, files: filesHref, needsYou: needsHref, changes: changesHref },
    needs,
    book,
    files,
    changes,
  };
}
