/**
 * Accounting › To do (round 7, owner 2026-11-10: mockups-r7/accounting.html 0·1). One list of everything in
 * Accounting that waits on a person, oldest first. Each row points at the page or dialog where that thing is
 * done; nothing is decided here. A plain module: the page, the counts route and the tests read it.
 */

export type TodoGroup = "bank" | "bills" | "expenses" | "payouts" | "tax";

export const TODO_GROUPS: { key: TodoGroup; label: string }[] = [
  { key: "bank", label: "Bank" },
  { key: "bills", label: "Bills" },
  { key: "expenses", label: "Expenses" },
  { key: "payouts", label: "Payouts" },
  { key: "tax", label: "Tax" },
];

/** The tones a To do chip takes (a subset of StatusChip's). */
export type TodoChipTone = "warning" | "danger" | "neutral";

export type TodoItem = {
  key: string;
  group: TodoGroup;
  /** "Bad math · Aflac" */
  what: string;
  /** The quiet second line: "Statement 1 Sep 2026 · 8 policies short". */
  detail: string;
  /** Where it is done: "Bank deposits › Payments". */
  where: string;
  amountCents: number | null;
  /** How the amount reads after the figure: "short", "paid". */
  amountWord?: string;
  /** red: money is wrong or missing. */
  tone?: "bad";
  /** ISO date the thing started waiting, or null (a 1099 has no start). */
  since: string | null;
  /** "due 15 Nov": a date that reads better than `since`. */
  sinceLabel?: string;
  /** The next step, in words: the Next step cell's tooltip. */
  next: string;
  /** The next step as a short verb, the cell itself: "Review", "Mark paid" (owner 2026-11-11: one line per row). */
  step: string;
  /** The row's one chip. `amount` puts the row's amount before the label ("$3,404.41 short"). */
  chip: { label: string; tone: TodoChipTone; amount?: boolean };
  /** false for a step that waits on someone else (a disputed bill): shown muted. */
  yours: boolean;
  href: string;
};

/** Oldest first; things with no date (1099 details) last; then by amount, largest first. */
export function orderTodo(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    if (a.since && b.since && a.since !== b.since) return a.since < b.since ? -1 : 1;
    if (a.since && !b.since) return -1;
    if (!a.since && b.since) return 1;
    return (b.amountCents ?? 0) - (a.amountCents ?? 0);
  });
}

/** Per group and in all: the counts on the title-line tabs and on the rail's To do badge. */
export function todoCounts(items: TodoItem[]): Record<TodoGroup | "all", number> {
  const out = { all: items.length, bank: 0, bills: 0, expenses: 0, payouts: 0, tax: 0 };
  for (const item of items) out[item.group] += 1;
  return out;
}

export function isTodoGroup(value: string | null | undefined): value is TodoGroup {
  return TODO_GROUPS.some((g) => g.key === value);
}

/** The amount at stake, for the table's foot (amounts are summed as positive figures). */
export function atStakeCents(items: TodoItem[]): number {
  return items.reduce((sum, item) => sum + Math.abs(item.amountCents ?? 0), 0);
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The rows a carrier payment adds: bad math (policies short) and missing money. */
export function paymentItems(rows: { id: string; carrierName: string; statementDate: string; statementLabel: string; verdict: string; shortCents: number; missingCents: number; shortPolicies: number; dueBy: string; dueByLabel: string }[]): TodoItem[] {
  const out: TodoItem[] = [];
  for (const r of rows) {
    if (r.verdict === "bad_math") {
      out.push({
        key: `pay-${r.id}`, group: "bank", what: `Bad math · ${r.carrierName}`, detail: `Statement ${r.statementLabel} · ${plural(r.shortPolicies, "policy", "policies")} short`,
        where: "Bank deposits › Payments", amountCents: r.shortCents, amountWord: "short", tone: "bad", since: r.statementDate,
        next: `Review ${plural(r.shortPolicies, "short policy", "short policies")}`, step: "Review", chip: { label: "short", tone: "danger", amount: true }, yours: true, href: `/app/bank/payments/${r.id}`,
      });
    } else if (r.verdict === "missing_money") {
      out.push({
        key: `pay-${r.id}`, group: "bank", what: `Missing money · ${r.carrierName}`, detail: `Statement ${r.statementLabel} · nothing landed by ${r.dueByLabel}`,
        where: "Bank deposits › Payments", amountCents: r.missingCents, tone: "bad", since: r.dueBy,
        next: `Ask ${r.carrierName} where it went`, step: "Ask carrier", chip: { label: "missing", tone: "danger", amount: true }, yours: true, href: `/app/bank/payments/${r.id}`,
      });
    }
  }
  return out;
}

/** Bank lines to match: a suggestion to confirm, or nothing that explains it. */
export function depositItems(rows: { id: string; postedOn: string; amountCents: number; descriptionRaw: string; status: string; suggestedFor: string | null }[]): TodoItem[] {
  return rows.map((r) => {
    const suggested = r.status === "suggested" || r.status === "partially_matched";
    return {
      key: `dep-${r.id}`, group: "bank" as const, what: suggested ? "Deposit to confirm" : "Deposit nothing explains",
      detail: suggested && r.suggestedFor ? `${r.descriptionRaw} · suggested for ${r.suggestedFor}` : r.descriptionRaw,
      where: "Bank deposits › Deposits", amountCents: r.amountCents, since: r.postedOn,
      next: suggested ? "Confirm the match" : "Match it, or mark it not carrier money", yours: true,
      step: suggested ? "Confirm" : "Match", chip: { label: suggested ? "Suggested" : "Not matched", tone: "warning" as const },
      href: `/app/bank?view=deposits&match=${encodeURIComponent(r.id)}`,
    };
  });
}

/** Vendor bills waiting: to finish, to approve, disputed (waiting on the vendor), approved and unpaid. */
export function billItems(rows: { id: string; sourceName: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; dueLabel: string | null; totalCents: number; status: string; flagged: boolean; differenceCents: number | null; periodLabel: string | null }[], money: (cents: number) => string): TodoItem[] {
  const out: TodoItem[] = [];
  for (const r of rows) {
    const base = { key: `bill-${r.id}`, group: "bills" as const, amountCents: r.totalCents, where: "Vendor bills", href: `/app/vendor-bills/${r.id}` };
    const differs = r.flagged && r.differenceCents ? ` · billed ${money(Math.abs(r.differenceCents))} ${r.differenceCents > 0 ? "more" : "less"} than you got` : "";
    const period = r.periodLabel ? ` · leads ${r.periodLabel}` : "";
    // A bill that differs from what you got says so in its chip (the one place colour goes).
    const differsChip = r.flagged && r.differenceCents ? { label: `${money(Math.abs(r.differenceCents))} ${r.differenceCents > 0 ? "over" : "under"}`, tone: "danger" as const } : null;
    if (r.status === "draft") out.push({ ...base, what: `Bill to finish · ${r.sourceName}`, detail: `${r.invoiceNumber}${period}`, since: r.invoiceDate, next: "Finish it", step: "Finish", chip: { label: "Draft", tone: "warning" }, yours: true });
    else if (r.status === "received") out.push({ ...base, what: `Bill to approve · ${r.sourceName}`, detail: `${r.invoiceNumber}${period}${differs}`, since: r.invoiceDate, next: "Check it, then approve", step: "Approve", chip: differsChip ?? { label: "To approve", tone: "warning" }, yours: true });
    else if (r.status === "disputed") out.push({ ...base, what: `Bill disputed · ${r.sourceName}`, detail: r.invoiceNumber, since: r.invoiceDate, next: "Close the dispute when they answer", step: "Open", chip: { label: "Disputed", tone: "neutral" }, yours: false });
    else if (r.status === "approved") out.push({ ...base, what: `Bill to pay · ${r.sourceName}`, detail: `${r.invoiceNumber}${differs}`, since: r.dueDate ?? r.invoiceDate, sinceLabel: r.dueLabel ? `due ${r.dueLabel}` : undefined, next: "Mark it paid", step: "Mark paid", chip: differsChip ?? { label: "To pay", tone: "warning" }, yours: true });
  }
  return out;
}

/** Monthly bills that came back and wait for an OK. */
export function expenseItems(rows: { id: string; name: string; bucketLabel: string; monthLabel: string; amountCents: number; incurredOn: string }[]): TodoItem[] {
  return rows.map((r) => ({
    key: `exp-${r.id}`, group: "expenses" as const, what: `Monthly bill to OK · ${r.name}`, detail: `${r.bucketLabel} · for ${r.monthLabel}`,
    where: "Expenses › To OK", amountCents: r.amountCents, since: r.incurredOn, next: "OK it", step: "OK it", chip: { label: "To OK", tone: "warning" as const }, yours: true, href: `/app/expenses/${r.id}`,
  }));
}

/** Partner payout drafts: one row for all of them (27 drafts are one job). */
export function payoutItems(drafts: { netCents: number; createdOn: string }[]): TodoItem[] {
  if (!drafts.length) return [];
  const oldest = drafts.reduce((min, d) => (d.createdOn < min ? d.createdOn : min), drafts[0].createdOn);
  return [{
    key: "payout-drafts", group: "payouts", what: "Partner payout runs to review", detail: plural(drafts.length, "draft", "drafts"),
    where: "Partner payouts", amountCents: drafts.reduce((s, d) => s + d.netCents, 0), since: oldest, next: "Review the drafts", step: "Review", chip: { label: plural(drafts.length, "draft", "drafts"), tone: "warning" }, yours: true,
    href: "/app/payouts?status=draft",
  }];
}

/** Payees over the 1099 threshold with something missing. */
export function taxItems(rows: { payeeType: string; payeeId: string; nameOnForm: string; missing: string[]; paidCents: number }[], year: number): TodoItem[] {
  return rows.filter((r) => r.missing.length > 0).map((r) => ({
    key: `tax-${r.payeeType}-${r.payeeId}`, group: "tax" as const, what: `1099 details · ${r.nameOnForm}`, detail: `${r.payeeType} · missing ${r.missing.join(", ")} · 1099 due January`,
    where: "Tax summaries", amountCents: r.paidCents, amountWord: "paid", since: null,
    next: r.missing.length === 1 && r.missing[0] === "W-9" ? "Add the W-9" : "Add the details",
    step: r.missing.length === 1 && r.missing[0] === "W-9" ? "Add W-9" : "Add details",
    chip: { label: r.missing.length === 1 ? `Missing ${r.missing[0]}` : `${r.missing.length} details missing`, tone: "warning" as const }, yours: true,
    href: `/app/tax/payee/${r.payeeType}/${r.payeeId}?year=${year}${r.missing.length === 1 && r.missing[0] === "W-9" ? "&tab=w9" : ""}`,
  }));
}
