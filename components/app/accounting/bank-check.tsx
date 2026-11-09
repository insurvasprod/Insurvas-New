"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BankImportForm } from "@/components/app/accounting/bank-board";
import type { ColumnMap } from "@/lib/accounting/bankCore";

/** Check a payment, the bank half (round 1 board B1): the same import as the pop-up, laid out on the page. */
export function BankFileSide({ accounts, readOnly }: { accounts: { id: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap: ColumnMap | null }[]; readOnly: boolean }) {
  const router = useRouter();
  if (readOnly) return <p className="m-0 text-sm text-muted-foreground">Importing is paused while the account is read-only.</p>;
  if (!accounts.length) return <p className="m-0 text-sm text-muted-foreground">First add the account the carriers pay into: <Link className="underline" href="/app/bank?view=accounts&add=1">Add an account</Link>. Only a name and the last four digits are kept.</p>;
  return <BankImportForm accounts={accounts} onDone={() => router.refresh()} />;
}
