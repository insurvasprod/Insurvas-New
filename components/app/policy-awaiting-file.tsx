import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { fileDay } from "@/lib/ingestion/constants";
import { AWAITING_FILE } from "@/lib/ingestion/policyBook";
import type { AwaitingSale } from "@/lib/ingestion/policyBookStore";

const dollars = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Module 4 · Door 1: the policy page for a sale recorded as issued that no carrier file has listed
 * yet. What the sale says (client, carrier, premium, face, the day it was issued), and nothing the
 * carrier has not told us — status, payments and commission arrive with its file.
 */
export function PolicyAwaitingFile({ sale }: { sale: AwaitingSale }) {
  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title={sale.clientName ?? `Policy ${sale.policyNumber}`}
        breadcrumbs={[{ label: "Book" }, { label: "Policies", href: "/app/policies" }, { label: sale.clientName ?? `Policy ${sale.policyNumber}` }]}
        description={[sale.carrierName, sale.product, `Policy #${sale.policyNumber}`].filter(Boolean).join(" · ")}
        actions={sale.leadId ? <Link href={`/app/leads/${sale.leadId}`} className="text-sm font-semibold underline">Open the lead</Link> : undefined}
      />
      <StatStrip label="Recorded sale">
        <StatTile label="Status" valueSize="text" value={AWAITING_FILE} reserveFootnote />
        <StatTile label="Issued" value={fileDay(sale.issuedOn)} footnote="as recorded on the sale" />
        <StatTile label="Premium" value={dollars(sale.monthlyCents)} footnote={sale.monthlyCents === null ? undefined : "a month, from the sale"} />
        <StatTile label="Face amount" value={dollars(sale.faceCents)} />
      </StatStrip>
      <EmptyState title="No carrier file has listed this policy yet" hint="Its status, payments and commission appear once it does." />
    </div>
  );
}
