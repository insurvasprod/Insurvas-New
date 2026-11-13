// Accounting foundation pass (2026-11-03, docs/accounting/FOUNDATION-PASS.md): the owner's rules for every
// Accounting step, held in the source so a later change cannot quietly undo them.
// Run with: node --experimental-strip-types --test lib/accounting/foundationPass.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const BOARDS = ["pnl-board", "bank-board", "invoices-board", "expenses-board", "payouts-board", "producers-board", "tax-board"].map((b) => `components/app/accounting/${b}.tsx`);
const STEP_PAGES = ["pnl", "bank", "expenses", "producer-splits", "my-balance", "tax"].map((r) => `app/app/(shell)/${r}/page.tsx`);
const DETAIL_PAGES = ["pnl/entries", "vendor-bills/[id]", "vendor-bills/new", "expenses/new", "producer-splits/[userId]", "tax/payee/[type]/[id]", "payouts/[id]"].map((r) => `app/app/(shell)/${r}/page.tsx`);
const ALL = [...BOARDS, ...STEP_PAGES, ...DETAIL_PAGES, "components/app/lead-sources/pages.tsx"];

test("tabs are the sub-page bar: each step passes them as the frame's tabs (UI-CONSISTENCY §8b), never a row in the step", () => {
  for (const page of STEP_PAGES) {
    assert.match(read(page), /\btabs=\{/, page);
    assert.match(read(page), /<ViewTabs label=/, page);
  }
  // Round 7 (2·A): where a bill stands is the bar (To approve · Disputed · To pay · Paid · All), then Returns.
  assert.match(read("components/app/lead-sources/pages.tsx"), /\? <ViewTabs label="Vendor bills" value=\{shown === "returns" \? "returns" : picked\.tab\}/);
  assert.match(read("lib/accounting/billTabs.ts"), /\{ key: "approve", label: "To approve" \},\n\s+\{ key: "disputed", label: "Disputed" \},\n\s+\{ key: "approved", label: "To pay" \},\n\s+\{ key: "paid", label: "Paid" \},\n\s+\{ key: "all", label: "All" \},/);
  for (const board of BOARDS) assert.doesNotMatch(read(board), /<ViewTabs\b/, `${board}: its views are the page's title-line tabs`);
  // Each tab is its own address, so a link, a tile or the bell lands on it.
  for (const page of STEP_PAGES) assert.match(read(page), /href: "\/app\/|href: at\("|tabs=\{pnlTabs\(/, page);
  assert.match(read("lib/accounting/pnlLinks.ts"), /\{ key: "trend" as const, label: "Last six months", href: pnlHref\(q, "trend"\) \}/);
});

test("a record is a detail page, never a side panel or sheet", () => {
  for (const f of ALL) assert.doesNotMatch(read(f), /<Sheet\b|<DetailPanel\b|from "@\/components\/ui\/(sheet|detail-panel)"/, f);
  for (const f of DETAIL_PAGES) assert.ok(existsSync(join(process.cwd(), f)), f);
  // Round 7, 9·1 (owner 2026-11-10): a partner invoice is a Commissions record; nothing under its title, its status
  // and facts are the strip.
  const invoice = read("app/app/(shell)/payouts/[id]/page.tsx");
  assert.match(invoice, /<CommissionsPage\n\s+step="partnerPayouts"\n\s+title=\{title\}/);
  assert.match(invoice, /<StatStrip label="This invoice">/);
  assert.doesNotMatch(invoice, /facts=|chip=/);
  // Round 7, 2·1 (owner 2026-11-10): a bill's title is the vendor and number alone; its status and facts are the
  // strip, and ‹ › name the neighbouring bills of the list it was opened from.
  const bill = read("app/app/(shell)/vendor-bills/[id]/page.tsx");
  assert.match(bill, /\n\s+title=\{`\$\{inv\.sourceName\} · \$\{inv\.invoiceNumber\}`\}/);
  assert.doesNotMatch(bill, /\n\s+(chip|facts)=\{/);
  assert.match(bill, /<RecordStepper noun="bill" previous=\{neighbour\(previous\)\} next=\{neighbour\(next\)\} \/>/);
  assert.match(bill, /<StatStrip label=/);
  // Round 7, 6·2 (owner 2026-11-10): a payee's title stands alone; the facts are its strip, its parts are tabs, and
  // ‹ › name the neighbouring payees of the list it was opened from.
  const payee = read("app/app/(shell)/tax/payee/[type]/[id]/page.tsx");
  assert.match(payee, /\n\s+title=\{row\.nameOnForm\}/);
  assert.doesNotMatch(payee, /\n\s+(chip|facts)=\{/);
  assert.match(payee, /\n\s+tabs=\{<ViewTabs /);
  assert.match(payee, /<RecordStepper noun="payee"/);
  assert.match(payee, /<StatStrip label=/);
  // Round 7, 4·1 (owner 2026-11-10, mockups-r7/accounting.html): a producer's title stands alone; the facts line
  // became the strip, and ‹ › name the neighbouring producers.
  const producer = read("app/app/(shell)/producer-splits/[userId]/page.tsx");
  assert.match(producer, /\n\s+title=\{person\.name\}/);
  assert.doesNotMatch(producer, /\n\s+(chip|facts)=\{/);
  assert.match(producer, /<RecordStepper previous=\{neighbour\(near\.previous\)\} next=\{neighbour\(near\.next\)\} noun="producer" \/>/);
  assert.match(producer, /<StatStrip label=/);
  // Round 7, 3·2: an expense has its own page now — the title alone, tabs, ‹ › naming the neighbours, the strip —
  // and `?open=` (the P&L's links) lands on it.
  const expense = read("app/app/(shell)/expenses/[id]/page.tsx");
  assert.match(expense, /<AccountingPage step="expenses" title=\{expenseTitle\(row, thisYear\)\} tabs=\{tabs\} stepper=\{stepper\} actions=\{actions\}>/);
  assert.match(expense, /<RecordStepper noun="expense"/);
  // Walk 2026-11-11: named neighbours took the title line's room and clipped the tabs; every record passes them as
  // the frame's `stepper` (their own slim line over the record), never in `actions`.
  for (const route of ["bank/payments/[id]", "vendor-bills/[id]", "expenses/[id]", "producer-splits/[userId]", "tax/payee/[type]/[id]", "pnl/entries"]) {
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, /stepper=\{/, route);
    assert.doesNotMatch(page, /actions=\{<>\s*<RecordStepper/, route);
  }
  assert.match(read("components/app/accounting/accounting-page.tsx"), /\{stepper \? <div data-record-stepper/);
  assert.match(expense, /<StatStrip label=/);
  assert.match(read("app/app/(shell)/expenses/page.tsx"), /if \(open && UUID\.test\(open\)\) redirect\(`\/app\/expenses\/\$\{open\}`\);/);
  assert.match(read("components/app/lead-sources/pages.tsx"), /if \(canInvoices && open && UUID\.test\(open\)\) redirect\(`\/app\/vendor-bills\/\$\{open\}`\);/, "?open= (the P&L's links) lands on the invoice page");
});

test("pop-ups only confirm or upload: forms are pages, with a leave guard", () => {
  // The one dialog left with its own content is the bank import, an upload.
  // Round 7, 4·3 (owner 2026-11-10): Producer splits' short edits are dialogs — the run (publish, mark paid,
  // void, stepping), Add a split and a split's read-only facts — with nothing decided inside a row.
  const dialogs = [...new Set(BOARDS.flatMap((f) => [...read(f).matchAll(/<DialogContent\b/g)].map(() => f)))];
  // Round 7, 6·3: a tax bucket row opens a md dialog instead of saving from a dropdown in the row.
  // Round 7, 2·4: Vendor bills' line, tax, Compare row, Lines row and From a monthly template are dialogs.
  assert.deepEqual(dialogs, ["components/app/accounting/bank-board.tsx", "components/app/accounting/invoices-board.tsx", "components/app/accounting/producers-board.tsx", "components/app/accounting/tax-board.tsx"]);
  assert.match(read("components/app/accounting/invoices-board.tsx"), /<DialogTitle>Enter a bill from a template<\/DialogTitle>/);
  assert.match(read("components/app/accounting/tax-board.tsx"), /<DialogContent size="md">/);
  assert.match(read("components/app/accounting/bank-board.tsx"), /<DialogTitle>Import a bank export<\/DialogTitle>/);
  // Round 7, 1·7: Bank deposits' Add an account (it was an inline row) and an account's rename are dialogs; its
  // Match dialog (1·6) lives in bank-match.tsx.
  assert.match(read("components/app/accounting/bank-board.tsx"), /<DialogTitle>Add an account<\/DialogTitle>/);
  assert.match(read("components/app/accounting/bank-match.tsx"), /<DialogContent size=\{"lg"\}>/);
  // Round 7, 3·4: an expense's OK (stepping) and its Details rows' edits are md dialogs, in expense-record.tsx.
  assert.equal([...read("components/app/accounting/expense-record.tsx").matchAll(/<DialogContent size="md">/g)].length, 2);
  // Every other step that asks for something is a ConfirmDialog with its fields.
  for (const f of ["expenses-board", "invoices-board", "producers-board", "payouts-board"]) assert.match(read(`components/app/accounting/${f}.tsx`), /<ConfirmDialog[\s\S]*?fields=\{/, f);
  const guarded = { "expenses-board": ["ExpenseForm"], "invoices-board": ["InvoiceForm", "FromTemplate"], "producers-board": ["AddSplitForm"], "tax-board": ["ProfileForm"] };
  for (const [board, forms] of Object.entries(guarded)) {
    const source = read(`components/app/accounting/${board}.tsx`);
    for (const form of forms) {
      const body = source.slice(source.indexOf(`function ${form}(`));
      assert.match(body.slice(0, body.indexOf("\n}\n")), /<LeaveGuard dirty=/, `${board} › ${form}`);
    }
  }
});

test("the confirm pop-up holds its fields plainly, and can wait for them", () => {
  const dialog = read("components/ui/confirm-dialog.tsx");
  assert.match(dialog, /\{fields && <div className="flex flex-col gap-3">\{fields\}<\/div>\}/, "no box around the fields");
  assert.match(dialog, /disabled=\{busy \|\| confirmDisabled\}/);
});

test("no notice on the page: warnings go to the bell, the tax notice stays as plain text", () => {
  for (const f of ALL) {
    const source = read(f);
    assert.doesNotMatch(source, /bg-\[var\(--(warning|error|success|info)-surface\)\]/, `${f}: a tinted notice`);
    assert.doesNotMatch(source, /<p role="alert" className="rounded/, f);
  }
  // Round 7 (5·A): the 1099 count is Tax's (its tab count and the bell); Profit & loss draws no card for it.
  assert.doesNotMatch(read("components/app/accounting/pnl-board.tsx"), /<Callout\b|taxMissing/, "missing W-9s are Tax's, not a card here");
  // Round 7, 2·1 / 2·5: beyond tolerance is the red count on Compare to our count and a confirm on Approve, never a card.
  assert.doesNotMatch(read("app/app/(shell)/vendor-bills/[id]/page.tsx"), /<Callout\b/);
  assert.match(read("components/app/accounting/invoices-board.tsx"), /title=\{`Approve \$\{inv\.invoiceNumber\} with a \$\{money\(gap\)\} difference\?`\}/);
});

test("explainer sentences are the title's (i), not lines over the table", () => {
  for (const page of [...STEP_PAGES, "components/app/lead-sources/pages.tsx"]) assert.match(read(page), /\binfo=/, page);
  assert.doesNotMatch(read("components/app/accounting/bank-board.tsx"), /Nothing is matched until a person confirms it\.<\/span>/);
  assert.doesNotMatch(read("components/app/accounting/producers-board.tsx"), /<p className="text-sm text-muted-foreground">Negative balances/);
  assert.doesNotMatch(read("components/app/accounting/pnl-board.tsx"), /\{ACQUISITION_CONSEQUENCE\} Under/);
});

test("figures are one strip whose tiles are the links", () => {
  // Bank deposits (round 7, board 1·B): the strip shows on Payments only, which bank-results.tsx draws.
  for (const f of [...BOARDS.filter((b) => !b.includes("pnl") && !b.includes("bank-board")), "components/app/accounting/bank-results.tsx", "app/app/(shell)/my-balance/page.tsx", "app/app/(shell)/vendor-bills/[id]/page.tsx"]) {
    const source = read(f);
    assert.equal([...source.matchAll(/<StatStrip\b/g)].length, 1, `${f}: one strip`);
    assert.match(source, /<StatTile [^\n]*href=/, `${f}: a tile is a link`);
  }
  assert.match(read("components/app/accounting/pnl-board.tsx"), /<StatTile label="Commission reported"[^\n]*href="\/app\/bank"/);
});

test("a header has at most two buttons and a More menu", () => {
  // The More menu is the shared one; nothing in Accounting builds its own dropdown of actions.
  for (const f of ALL) assert.doesNotMatch(read(f), /<DropdownMenuContent\b/, f);
  const tax = read("app/app/(shell)/tax/page.tsx");
  assert.match(tax, /<MoreMenu items=\{\[\n\s+\{ label: "Totals by category \(CSV\)"/);
  // Round 7 (6·A): "Add N missing details" and Download XLSX, the three CSVs in More.
  assert.equal([...tax.slice(tax.indexOf("actions={")).matchAll(/<Button\b/g)].length, 2, "Add N missing details and Download XLSX, the rest in More");
  const invoice = read("components/app/accounting/invoices-board.tsx");
  const actions = invoice.slice(invoice.indexOf("export function InvoiceActions"), invoice.indexOf("function useUpload"));
  const header = actions.slice(actions.indexOf("return (\n    <>"), actions.indexOf("<input ref={picker}"));
  // Round 7, 2·1: ⋯ (Edit among its items) and one primary by status — Finish, Approve, Mark paid, Close the dispute.
  assert.equal([...header.matchAll(/<Button\b/g)].length, 4);
  assert.match(header, /\{inv\.status === "draft" \? <Button asChild>[\s\S]*>Finish<[\s\S]*\{inv\.status === "received" \? <Button[\s\S]*>Approve<[\s\S]*\{inv\.status === "approved" \? <Button[\s\S]*>Mark paid<[\s\S]*\{inv\.status === "disputed" \? <Button[\s\S]*>Close the dispute</);
  assert.match(header, /editable && \{ label: "Edit", href: `\/app\/vendor-bills\/new\?edit=\$\{inv\.id\}` \}/);
});

test("lists come from TableCard with the shared pager, and nothing uses the old Sheet drill", () => {
  for (const f of [...BOARDS, ...DETAIL_PAGES.filter((p) => !p.includes("/new")), "app/app/(shell)/my-balance/page.tsx"]) assert.match(read(f), /<(Paged)?TableCard\b/, f);
  assert.ok(!existsSync(join(process.cwd(), "components/app/lead-sources/source-tabs.tsx")), "the in-step tab row is gone");
});

test("spec gaps closed 2026-11-03: agency-only splits, the policy link, the W-9 file, the trailing view, the bank reference", () => {
  // LA-7.5: a solo agent's plan never shows producer splits — not on the rail, not on any of the three pages.
  const frame = read("components/app/accounting/accounting-page.tsx");
  assert.match(frame, /const legacySplits = audience !== "individual" && audience !== "agency";/);
  assert.match(frame, /if \(legacySplits\) open\.add\("splits"\);/);
  assert.match(frame, /if \(producer && legacySplits\) open\.add\("splits"\);/);
  for (const f of ["producer-splits", "producer-splits/[userId]", "my-balance"]) assert.match(read(`app/app/(shell)/${f}/page.tsx`), /if \(audience === "individual"\) return <RoleGateNotice reason="solo"/, f);
  // LA-7.5: an entry opens the commission behind it — its policy's Commissions tab.
  assert.match(read("app/app/(shell)/producer-splits/[userId]/page.tsx"), /href: e\.policyNumber && e\.carrierId \? policyHref\(e\.carrierId, e\.policyNumber, "commissions"\) : null/);
  // LA-7.8: a W-9 is uploaded and opened on the contractor's page; attaching ticks "W-9 on file".
  const store = read("lib/accounting/taxStore.ts");
  assert.match(store, /export async function attachW9\(tenantId: string, profileId: string, file: File\)/);
  assert.match(store, /\.update\(\{ w9_on_file: true \}\)\.eq\("tenant_id", tenantId\)\.eq\("id", profileId\)/);
  assert.match(store, /createSignedUrl\(file\.path, 60\)/, "opened through a 60-second link");
  assert.match(read("app/api/app/accounting/tax/w9/route.ts"), /requireFeatureRole\("tax_summaries", ROLES, \{ write: true \}\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /sourceFile: "app\/api\/app\/accounting\/tax\/w9\/route\.ts", featureKey: "tax_summaries", allowedRoles: \["owner", "bookkeeper"\]/);
  // Round 7 (6·3): the W-9 is its own tab, a drop zone, rather than More › Attach the W-9.
  assert.match(read("app/app/(shell)/tax/payee/[type]/[id]/page.tsx"), /<W9Drop profileId=\{row\.profileId\}/);
  // LA-7.7: the trailing view of months old enough to have a cost per persisting policy, its own tab.
  assert.match(read("lib/accounting/pnlLinks.ts"), /\{ key: "cohorts" as const, label: "Persisting cost", href: pnlHref\(q, "cohorts"\) \}/);
  assert.match(read("lib/accounting/pnlStore.ts"), /export async function persistingCohorts\(tenantId: string, basis: Basis, count = 6\)/);
  assert.match(read("lib/accounting/pnlStore.ts"), /const newest = addMonths\(`\$\{book\.today\.slice\(0, 7\)\}-01`, -\(settings\.horizon \+ 1\)\);/, "only months whose horizon has passed");
  // LA-7.6: the bank's reference, read and shown with the deposit.
  assert.match(read("lib/accounting/bankStore.ts"), /description_raw, reference, match_status/);
  assert.match(read("components/app/accounting/bank-board.tsx"), /t\.reference \? `ref \$\{t\.reference\}` : null/);
  // An id that isn't the agency's is "not found", never a quiet success.
  assert.match(read("lib/accounting/bankStore.ts"), /if \(confirmed === 0\) throw new BankError\(/);
  assert.match(read("lib/accounting/bankStore.ts"), /throw new BankError\("That deposit isn't in this agency\.", 404\)/);
  assert.match(read("lib/accounting/invoiceStore.ts"), /throw new InvoiceError\("That template isn't in this agency\.", 404\)/);
  // LA-7.3 / 7.5: Mark paid asks for the reference.
  assert.match(read("components/app/accounting/expenses-board.tsx"), /reference: asking\.reference\.trim\(\) \|\| null/);
  assert.match(read("components/app/accounting/producers-board.tsx"), /reference: asking\.reference\.trim\(\) \|\| null/);
});

test("one producer pay (owner 2026-11-03, merge): on an agency the LA-7.5 screens hand over to AG-1.5/1.7's", () => {
  // The two never kept separate books (decision D5, one ledger): the merge is the screens.
  assert.match(read("app/app/(shell)/producer-splits/page.tsx"), /if \(audience === "agency"\) redirect\("\/app\/producer-payouts"\);/);
  assert.match(read("app/app/(shell)/producer-splits/[userId]/page.tsx"), /if \(audience === "agency"\) redirect\("\/app\/producer-payouts"\);/);
  assert.match(read("app/app/(shell)/my-balance/page.tsx"), /if \(audience === "agency"\) redirect\("\/app\/my-pay"\);/);
  const frame = read("components/app/accounting/accounting-page.tsx");
  // Round 7: Team payouts keeps a row on the Accounting rail that opens in Commissions; Commission splits left Accounting.
  assert.match(frame, /actAsPage\(producerPay, \["owner", "bookkeeper"\]\)\) open\.add\("producerPayouts"\);/, "the agency's producer pay stays on the rail");
});
