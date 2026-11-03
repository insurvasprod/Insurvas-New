import Link from "next/link";

import { cardSurface } from "@/components/ui/card";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { RISK_LABELS, statusLabel } from "@/lib/ingestion/policyBook";
import type { loadPolicy } from "@/lib/ingestion/policyBookStore";
import { riskFootnote } from "@/lib/ingestion/policyCurrent";
import { carrierPolicyHref, nextDateThatMatters } from "@/lib/ingestion/policyPage";
import { fileHref, rowHref } from "@/lib/ingestion/trace";

import { FactGrid } from "./policy-head";

export type PolicyView = NonNullable<Awaited<ReturnType<typeof loadPolicy>>>;

const MODE: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semiannual: "every 6 months", annual: "a year" };
const METHOD: Record<string, string> = { bank_draft: "Bank draft", direct_express: "Direct Express", card: "Card", direct_bill: "Direct bill (mailed)" };
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Policy › Overview: today's facts, the risk and the next date that matters, where each value was read from,
 * the client's other policies and the lead source. The notices it used to open with (a client built from the
 * file, the linked application, no client yet) are chips and links on the page header's facts line (round 3).
 */
export function PolicyOverviewTab({ view }: { view: PolicyView }) {
  const { policy, client, lead, source, others, household } = view;
  const next = nextDateThatMatters(policy);

  return (
    <>
      <TableCard title="Today">
        <FactGrid items={[
          ["Status", `${statusLabel(policy.status)}${policy.statusRaw ? ` · carrier says “${policy.statusRaw}”` : ""}`],
          ["Risk", `${RISK_LABELS[policy.riskBand]}${riskFootnote(policy) ? ` · ${riskFootnote(policy)}` : ""}`],
          [next?.label ?? "Next date that matters", next ? `${fileDay(next.date)} · ${next.detail}` : "None"],
          ["Premium", `${dollars(policy.premiumCents)}${policy.premiumMode ? ` ${MODE[policy.premiumMode] ?? policy.premiumMode}` : ""}`],
          ["Face amount", dollars(policy.faceCents)],
          ["Paid to", `${fileDay(policy.paidTo)}${policy.lastFileDate ? ` · per the file of ${fileDay(policy.lastFileDate)}` : ""}`],
          ["Issued", fileDay(policy.issuedOn)],
          ["Effective", fileDay(policy.effectiveDate)],
          ["Payment method", policy.paymentMethod ? METHOD[policy.paymentMethod] ?? policy.paymentMethod : "—"],
          ["Draft day", policy.draftDay ? String(policy.draftDay) : "—"],
          ["Months paid", policy.monthsPaid === null ? "—" : String(policy.monthsPaid)],
          ["Agent", policy.agentName ?? (policy.agentCode ? <>Code {policy.agentCode}, <Link href="/app/policy-matching?tab=agents" className="text-[var(--accent-ink)] hover:underline">not mapped</Link></> : "—")],
          ["Lead source", `${lead.name ?? "Not known"}${lead.costPerLeadCents !== null ? ` · ${dollars(lead.costPerLeadCents)} a lead` : ""}`],
        ]} />
      </TableCard>

      {(others.length > 0 || household) && (
        <PagedTableCard total={others.length} noun="policies" title={others.length ? `${client?.name ?? "This client"} has ${others.length + 1} policies` : "Household"}>
          <PagedBody as="ul" className="m-0 list-none px-4 py-3 text-sm">
            {others.map((other) => (
              <li key={`${other.carrierId}|${other.policyNumber}`} className="flex items-baseline justify-between gap-3 py-1">
                <Link href={carrierPolicyHref(other.carrierId, other.policyNumber)} className="min-w-0 truncate hover:underline">{other.carrierName} · <span className="font-mono text-xs">{other.policyNumber}</span></Link>
                <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(other.status)}{other.annualCents !== null ? ` · ${dollars(Math.round(other.annualCents / 12))}/mo` : ""}</span>
              </li>
            ))}
          </PagedBody>
          {household && (
            <div className="border-t border-border px-4 py-3 text-sm">
              <span className="block text-xs text-muted-foreground">Household ({household.people.join(", ")})</span>
              <span className="font-semibold tabular-nums text-foreground">{dollars(household.monthlyCents)} a month</span>
              <span className="text-xs text-muted-foreground"> across {household.policies} policies in force or at risk</span>
            </div>
          )}
        </PagedTableCard>
      )}

      {/* LA-4.20: where each current value was read from, and the row exactly as the carrier sent it. */}
      <details className={cardSurface}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">Where each value comes from{source.file ? ` · ${source.file.name}${source.file.rowNumber ? `, row ${source.file.rowNumber}` : ""}` : ""}</summary>
        <div className="border-t border-border">
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Field</th><th>Value now</th><th>Read from</th><th>Last changed</th></tr></thead>
            <tbody>
              {source.fields.map((field) => (
                <tr key={field.label}>
                  <td className="text-muted-foreground">{field.label}</td>
                  <td className="text-foreground">{field.value}</td>
                  <td className="max-w-[300px] text-xs">
                    {field.computed ? <span className="text-muted-foreground">Computed from {field.computed}</span>
                      : field.readFrom ? <Link href={field.readFrom.rowNumber ? rowHref(field.readFrom.fileId, field.readFrom.rowNumber) : fileHref(field.readFrom.fileId)} className="block truncate hover:underline" title={`Snapshot of ${fileDay(field.readFrom.snapshotDate)} · ${field.readFrom.fileName ?? "file"}${field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""}`}>{field.readFrom.fileName ?? "The file"}{field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""}</Link>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="max-w-[260px] text-xs tabular-nums">
                    {field.changedIn ? <Link href={field.changedIn.rowNumber ? rowHref(field.changedIn.fileId, field.changedIn.rowNumber) : fileHref(field.changedIn.fileId)} className="block truncate hover:underline" title={field.changedIn.fileName ?? undefined}>{fileDay(field.changedOn)} · {field.changedIn.fileName ?? "file"}{field.changedIn.rowNumber ? `, row ${field.changedIn.rowNumber}` : ""}</Link>
                      : <span className="text-muted-foreground">{field.computed ? "—" : "never"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {source.raw && (
            <div className="border-t border-border px-4 py-3">
              <p className="m-0 mb-2 text-xs text-muted-foreground">The row exactly as the carrier sent it{source.file?.date ? ` (file of ${fileDay(source.file.date)})` : ""}:</p>
              <dl className="m-0 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                {Object.entries(source.raw).map(([column, value]) => (
                  <div key={column} className="flex min-w-0 gap-2"><dt className="shrink-0 font-mono text-muted-foreground">{column}</dt><dd className="m-0 truncate font-mono text-foreground" title={String(value ?? "")}>{String(value ?? "")}</dd></div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </details>
    </>
  );
}
