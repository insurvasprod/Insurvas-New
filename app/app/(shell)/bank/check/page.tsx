import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BankError, listAccounts, paymentResults } from "@/lib/accounting/bankStore";
import { addDays, VERDICT_LABELS, VERDICT_TONES } from "@/lib/accounting/bankResultsCore";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { BankFileSide } from "@/components/app/accounting/bank-check";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/**
 * Bank deposits › Check a payment (owner's Accounting doc, step 1 "Gathering the clues"; round 1 board B1,
 * 2026-11-07). Both pieces of evidence on one page: the carrier's commission file (the Carrier files door,
 * read with the carrier's layout) and the bank statement (the bank import). Either can come alone; each
 * lands in its own place and Results puts them together.
 */
export default async function BankCheckPage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  let data: { accounts: Awaited<ReturnType<typeof listAccounts>>; carriers: Awaited<ReturnType<typeof fileCarrierChoices>>; recent: Awaited<ReturnType<typeof paymentResults>> } | null = null;
  let problem: string | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [accounts, carriers, recent] = await Promise.all([listAccounts(tenantId), fileCarrierChoices(tenantId), paymentResults(tenantId, { since: addDays(today, -30), today })]);
    data = { accounts, carriers, recent };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  if (!data) return <AccountingPage step="bank"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { accounts, carriers, recent } = data;
  {
    const card = "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-[var(--color-card)] p-5";
    return (
      <AccountingPage
        step="bank"
        title="Check a carrier payment"
        info="Drop the carrier's commission file and your bank statement. Insurvas links what the carrier said it paid to what landed, then checks every policy against your rate card. Either file can come on its own."
        facts={<>Bank deposits › Check a payment</>}
        actions={<><Button asChild variant="outline"><Link href="/app/bank">Cancel</Link></Button><Button asChild><Link href="/app/bank?view=results&period=30">See the results</Link></Button></>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card}>
            <div><p className="m-0 text-xs text-muted-foreground">Clue A · what the carrier says</p><h2 className="m-0 text-base font-semibold text-[var(--ink)]">Carrier commission file</h2></div>
            <p className="m-0 text-sm text-muted-foreground">CSV, Excel or PDF, read with the layout you set up for that carrier. Each policy line is kept, and the payment&apos;s total becomes the figure to look for in the bank.</p>
            <div>{readOnly ? <Button disabled title="Receiving files is paused while the account is read-only.">Upload the carrier file</Button> : <CarrierFileUploadButton carriers={carriers} label="Upload the carrier file" />}</div>
            {recent.rows.length ? (
              <div className="flex flex-col gap-1">
                <p className="m-0 text-xs font-medium text-muted-foreground">Carrier payments already in, last 30 days</p>
                <ul className="m-0 flex list-none flex-col p-0 text-sm">
                  {recent.rows.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
                      <Link className="min-w-0 truncate hover:underline" href={`/app/bank/payments/${r.id}`}>{r.carrierName} · {r.statementDate} · {formatCentsAsCurrency(r.paidCents)}</Link>
                      <StatusChip tone={VERDICT_TONES[r.verdict]}>{VERDICT_LABELS[r.verdict]}</StatusChip>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
          <section className={card}>
            <div><p className="m-0 text-xs text-muted-foreground">Clue B · what really landed</p><h2 className="m-0 text-base font-semibold text-[var(--ink)]">Bank statement</h2></div>
            <p className="m-0 text-sm text-muted-foreground">A CSV from your bank, any date range. Lines already here are skipped, and each deposit is matched to the carrier payment it settles.{recent.bankThrough ? ` Your bank lines reach ${recent.bankThrough}.` : ""}</p>
            <BankFileSide accounts={accounts} readOnly={readOnly} />
          </section>
        </div>
      </AccountingPage>
    );
  }
}
