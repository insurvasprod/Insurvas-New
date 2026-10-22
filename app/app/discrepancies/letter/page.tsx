import type { Metadata } from "next";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DisputeLetterPrint, DisputeLetterRecipient } from "@/components/app/dispute-letter-actions";
import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { getDisputeLetter, letterBody } from "@/lib/discrepancies/letter";
import { BusinessIdentityMissingError } from "@/lib/agencyProfile/identity";
import { BUSINESS_FIELD_ANCHORS } from "@/lib/agencyProfile/requirements";
import Link from "next/link";
import { statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

export const metadata: Metadata = { title: "Commission dispute" };

/**
 * /app/discrepancies/letter?carrier=…&ids=… · LA-4.5: a dispute letter to one carrier's commissions
 * department, listing the selected discrepancies with the arithmetic for each and the total.
 *
 * OUTSIDE the (shell) group, like the client quote sheet, so it prints as a letter with no sidebar.
 * Opening it changes nothing. Print records the letter in the audit log (once per print, through
 * POST /api/app/discrepancies/letter) and, for an account that can make decisions, can mark the
 * letter's open findings disputed. Download PDF builds the same letter with pdf-lib. Owner and
 * bookkeeper, as the Discrepancies page; a read-only account reads, prints and downloads.
 *
 * Everything here comes from getDisputeLetter (lib/discrepancies/letter.ts), which the PDF also
 * uses: the rows are `letterItems` (this workspace's findings, for this one carrier, that still
 * apply) and the total is the sum of those rows.
 */
export default async function DisputeLetterPage({ searchParams }: { searchParams: Promise<{ carrier?: string; ids?: string }> }) {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Discrepancies" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Discrepancies" detail="Dispute letters are prepared by the account owner or a bookkeeper." />;

  const { carrier = "", ids = "" } = await searchParams;
  let letter: Awaited<ReturnType<typeof getDisputeLetter>>;
  try {
    letter = await getDisputeLetter(guard.context.tenantId, guard.context.userId, carrier, ids.split(",").map((id) => id.trim()));
  } catch (error) {
    if (!(error instanceof BusinessIdentityMissingError)) throw error;
    // LA-8.3: the field and the document, both named, and a way straight to the field.
    return (
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-16 text-center text-sm">
        <p className="m-0">{error.message}</p>
        <Link className="font-semibold underline" href={`/app/settings#business-identity/${BUSINESS_FIELD_ANCHORS[error.missing[0]]}`}>Open Business identity</Link>
      </main>
    );
  }

  if (!letter) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-muted-foreground">
        Choose one carrier&rsquo;s discrepancies on the Discrepancies page, then open the letter again.
      </main>
    );
  }

  const canMarkDisputed = guard.entitlement.access !== "read_only";
  const { items } = letter;

  return (
    // Printed black on white whatever the screen theme: a letter is paper.
    <main data-print-paper className="mx-auto flex max-w-3xl flex-col gap-6 bg-card px-8 py-10 text-sm leading-relaxed text-foreground print:max-w-none print:bg-white print:px-0 print:py-0 print:text-black print:[&_*]:border-black/30 print:[&_.text-muted-foreground]:text-black">
      <DisputeLetterPrint carrierId={letter.carrierId} ids={items.map((item) => item.id)} openIds={items.filter((item) => item.status === "open").map((item) => item.id)} canMarkDisputed={canMarkDisputed} />

      <header className="flex flex-col gap-1">
        <p className="m-0 font-semibold">{letter.agencyName}</p>
        {letter.agencyAddress && <p className="m-0 whitespace-pre-line text-muted-foreground">{letter.agencyAddress}</p>}
        {letter.npn && <p className="m-0 text-muted-foreground">NPN {letter.npn}</p>}
        <p className="m-0 mt-4 text-muted-foreground">{statementDay(letter.today)}</p>
        <div className="mt-4"><DisputeLetterRecipient carrierId={letter.carrierId} carrierName={letter.carrierName} savedAddress={letter.savedRecipient} canSave={canMarkDisputed && letter.contactsAvailable} /></div>
      </header>

      <section className="flex flex-col gap-3">
        <p className="m-0 font-semibold">Re: Commission discrepancies{letter.writingNumber ? ` · writing number ${letter.writingNumber}` : ""}</p>
        <p className="m-0">To the Commissions Department,</p>
        <p className="m-0">{letterBody(letter)}</p>
      </section>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-3">Policy</th>
            <th className="py-2 pr-3">Insured</th>
            <th className="py-2 pr-3">Problem</th>
            <th className="py-2 pr-3">Period</th>
            <th className="py-2 pr-3 text-right">Expected</th>
            <th className="py-2 pr-3 text-right">Paid</th>
            <th className="py-2 text-right">Owed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border align-top">
              <td className="py-2 pr-3 font-semibold tabular-nums">{item.policyNumber}</td>
              <td className="py-2 pr-3">{item.insuredName}</td>
              <td className="py-2 pr-3">{DISCREPANCY_KIND_LABELS[item.kind].label}<span className="block text-xs text-muted-foreground">{item.detail?.explanation}</span></td>
              <td className="py-2 pr-3 tabular-nums">{item.periodStart && item.periodEnd ? statementPeriod(item.periodStart, item.periodEnd) : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{statementMoney(item.detail?.expectedCents ?? 0)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{statementMoney(item.detail?.receivedCents ?? 0)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{statementMoney(item.owedCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="py-2 pr-3 text-right font-semibold">Total owed</td>
            <td className="py-2 text-right font-semibold tabular-nums">{statementMoney(letter.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <section className="flex flex-col gap-1">
        <p className="m-0">Thank you,</p>
        <p className="m-0 mt-6 font-semibold">{letter.signer.name ?? letter.agencyName}</p>
        <p className="m-0 text-muted-foreground">{[letter.agencyName, letter.signer.phone, letter.signer.email].filter(Boolean).join(" · ")}</p>
      </section>
    </main>
  );
}
