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
  assert.match(read("components/app/lead-sources/pages.tsx"), /tabs=\{canInvoices && canReturns \? <ViewTabs label="Vendor bills"/);
  for (const board of BOARDS) assert.doesNotMatch(read(board), /<ViewTabs\b/, `${board}: its views are the page's title-line tabs`);
  // Each tab is its own address, so a link, a tile or the bell lands on it.
  for (const page of STEP_PAGES) assert.match(read(page), /href: "\/app\/|href: at\("|tabs=\{pnlTabs\(/, page);
  assert.match(read("lib/accounting/pnlLinks.ts"), /\{ key: "trend" as const, label: "Last six months", href: pnlHref\(q, "trend"\) \}/);
});

test("a record is a detail page, never a side panel or sheet", () => {
  for (const f of ALL) assert.doesNotMatch(read(f), /<Sheet\b|<DetailPanel\b|from "@\/components\/ui\/(sheet|detail-panel)"/, f);
  for (const f of DETAIL_PAGES) assert.ok(existsSync(join(process.cwd(), f)), f);
  // The detail header: a title, the status chip beside it, one line of facts.
  for (const f of ["app/app/(shell)/vendor-bills/[id]/page.tsx", "app/app/(shell)/producer-splits/[userId]/page.tsx", "app/app/(shell)/tax/payee/[type]/[id]/page.tsx", "app/app/(shell)/payouts/[id]/page.tsx"]) {
    const page = read(f);
    assert.match(page, /\n\s+title=\{/, f);
    assert.match(page, /\n\s+chip=\{</, f);
    assert.match(page, /\n\s+facts=\{facts\}/, f);
  }
  assert.match(read("components/app/lead-sources/pages.tsx"), /if \(canInvoices && open && UUID\.test\(open\)\) redirect\(`\/app\/vendor-bills\/\$\{open\}`\);/, "?open= (the P&L's links) lands on the invoice page");
});

test("pop-ups only confirm or upload: forms are pages, with a leave guard", () => {
  // The one dialog left with its own content is the bank import, an upload.
  const dialogs = BOARDS.flatMap((f) => [...read(f).matchAll(/<DialogContent\b/g)].map(() => f));
  assert.deepEqual(dialogs, ["components/app/accounting/bank-board.tsx"]);
  assert.match(read("components/app/accounting/bank-board.tsx"), /<DialogTitle>Import a bank export<\/DialogTitle>/);
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
  assert.match(read("components/app/accounting/pnl-board.tsx"), /\{taxMissing \? <Callout tone="warning"/, "missing W-9s, in the bell");
  assert.match(read("app/app/(shell)/vendor-bills/[id]/page.tsx"), /\{s\?\.flagged \? <Callout tone="warning"/, "beyond tolerance, in the bell; approving is still allowed");
});

test("explainer sentences are the title's (i), not lines over the table", () => {
  for (const page of [...STEP_PAGES, "components/app/lead-sources/pages.tsx"]) assert.match(read(page), /\binfo=/, page);
  assert.doesNotMatch(read("components/app/accounting/bank-board.tsx"), /Nothing is matched until a person confirms it\.<\/span>/);
  assert.doesNotMatch(read("components/app/accounting/producers-board.tsx"), /<p className="text-sm text-muted-foreground">Negative balances/);
  assert.doesNotMatch(read("components/app/accounting/pnl-board.tsx"), /\{ACQUISITION_CONSEQUENCE\} Under/);
});

test("figures are one strip whose tiles are the links", () => {
  for (const f of [...BOARDS.filter((b) => !b.includes("pnl")), "app/app/(shell)/my-balance/page.tsx", "app/app/(shell)/vendor-bills/[id]/page.tsx"]) {
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
  assert.equal([...tax.slice(tax.indexOf("actions={")).matchAll(/<Button\b/g)].length, 1, "Download XLSX, the rest in More");
  const invoice = read("components/app/accounting/invoices-board.tsx");
  const actions = invoice.slice(invoice.indexOf("export function InvoiceActions"), invoice.indexOf("type Filter"));
  const header = actions.slice(actions.indexOf("return (\n    <>"), actions.indexOf("<input ref={picker}"));
  // Edit and Approve while it can change; Mark paid once approved. Never more than two at a time.
  assert.equal([...header.matchAll(/<Button\b/g)].length, 3);
  assert.match(header, /\{editable \? <Button variant="outline" asChild>[\s\S]*\{editable \? <Button disabled=\{busy\}[\s\S]*\{inv\.status === "approved" \? <Button/);
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
  assert.match(read("app/app/(shell)/producer-splits/[userId]/page.tsx"), /href=\{policyHref\(e\.carrierId, e\.policyNumber, "commissions"\)\}/);
  // LA-7.8: a W-9 is uploaded and opened on the contractor's page; attaching ticks "W-9 on file".
  const store = read("lib/accounting/taxStore.ts");
  assert.match(store, /export async function attachW9\(tenantId: string, profileId: string, file: File\)/);
  assert.match(store, /\.update\(\{ w9_on_file: true \}\)\.eq\("tenant_id", tenantId\)\.eq\("id", profileId\)/);
  assert.match(store, /createSignedUrl\(file\.path, 60\)/, "opened through a 60-second link");
  assert.match(read("app/api/app/accounting/tax/w9/route.ts"), /requireFeatureRole\("tax_summaries", ROLES, \{ write: true \}\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /sourceFile: "app\/api\/app\/accounting\/tax\/w9\/route\.ts", featureKey: "tax_summaries", allowedRoles: \["owner", "bookkeeper"\]/);
  assert.match(read("app/app/(shell)/tax/payee/[type]/[id]/page.tsx"), /<W9Actions profileId=\{row\.profileId\}/);
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
  assert.match(frame, /open\.add\("producerPayouts"\); open\.add\("commissionSplits"\);/, "the agency's producer pay stays on the rail");
});
