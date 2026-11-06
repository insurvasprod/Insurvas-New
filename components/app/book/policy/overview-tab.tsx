import type { ReactNode } from "react";
import Link from "next/link";

import { InfoTip } from "@/components/ui/info-tip";
import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { RISK_LABELS, statusLabel } from "@/lib/ingestion/policyBook";
import type { loadPolicy, SourceField } from "@/lib/ingestion/policyBookStore";
import { riskFootnote } from "@/lib/ingestion/policyCurrent";
import { carrierPolicyHref, nextDateThatMatters } from "@/lib/ingestion/policyPage";
import { fileHref, rowHref } from "@/lib/ingestion/trace";

export type PolicyView = NonNullable<Awaited<ReturnType<typeof loadPolicy>>>;

const MODE: Record<string, string> = { monthly: "/mo", quarterly: "/qtr", semiannual: "/6 mo", annual: "/yr" };
const METHOD: Record<string, string> = { bank_draft: "Bank draft", direct_express: "Direct Express", card: "Card", direct_bill: "Direct bill (mailed)" };
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const LINK = "font-medium text-[var(--accent-ink)] hover:underline";
/** A date is a figure with digits; wrapped, so the strip shows it as written instead of counting up to it. */
const asIs = (text: string) => <>{text}</>;
const STATUS_TONE: Record<string, MeterTone> = { active: "good", at_risk: "danger", approved_unpaid: "warning", lapsed: "danger", cancelled: "danger", terminated: "danger", declined: "danger", not_taken: "danger" };
const RISK_TONE: Record<string, MeterTone | undefined> = { none: undefined, watch: "warning", at_risk: "warning", critical: "danger" };

/** Where a value was read, in words: the per-value (i) that replaced "Where each value comes from" (round 6). */
function provenance(field: SourceField | undefined): string | null {
  if (!field) return null;
  if (field.computed) return `Worked out from ${field.computed}.`;
  const read = field.readFrom ? `Read from ${field.readFrom.fileName ?? "the carrier's file"}${field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""} (file of ${fileDay(field.readFrom.snapshotDate)}).` : "Not in the carrier's latest row.";
  const changed = field.changedOn ? ` Last changed ${fileDay(field.changedOn)}${field.fromFile ? ` in ${field.fromFile}` : ""}.` : field.readFrom ? " Unchanged since the policy first arrived." : "";
  return `${read}${changed}`;
}

/** The same, with the hops the old table had: the row it was read from and the row that last changed it, as links. */
function provenanceLinks(field: SourceField | undefined): ReactNode {
  const said = provenance(field);
  if (!field || !said) return null;
  const read = field.readFrom;
  const changed = field.changedIn;
  return (
    <span className="flex flex-col gap-1.5">
      <span>{said}</span>
      {field.readFrom && <Link href={field.readFrom.rowNumber ? rowHref(field.readFrom.fileId, field.readFrom.rowNumber) : fileHref(field.readFrom.fileId)} className={LINK}>Open {field.readFrom.rowNumber ? `row ${field.readFrom.rowNumber}` : "the file"} ›</Link>}
      {changed && (changed.fileId !== read?.fileId || changed.rowNumber !== read?.rowNumber) && <Link href={changed.rowNumber ? rowHref(changed.fileId, changed.rowNumber) : fileHref(changed.fileId)} className={LINK}>Open the row that changed it ›</Link>}
    </span>
  );
}

/**
 * Policy › Overview (round 6, owner 2026-11-06: "I just don't think this matches the design"): the mockups' strip of
 * five figures (status, paid to, risk, premium, the next date), then two cards side by side — the policy's own facts,
 * each value's source behind its (i), and the carrier's row exactly as sent, always open (it was a collapsed
 * "Where each value comes from" under the card) — and the client's other policies when there are any.
 * docs/la4/mockups-r6/policy-page.html board 1.
 */
export function PolicyOverviewTab({ view, provisional = false }: { view: PolicyView; provisional?: boolean }) {
  const { policy, client, lead, source, others, household } = view;
  const next = nextDateThatMatters(policy);
  const field = (label: string) => source.fields.find((f) => f.label === label);
  const behind = policy.daysPastDue ?? 0;
  const monthly = policy.annualCents === null ? null : Math.round(policy.annualCents / 12);
  const mode = policy.premiumMode ? MODE[policy.premiumMode] ?? ` ${policy.premiumMode}` : "";

  const rows: Array<{ label: string; value: ReactNode; from?: string }> = [
    { label: "Issued", value: fileDay(policy.issuedOn), from: "Issue date" },
    { label: "Effective", value: fileDay(policy.effectiveDate), from: "Effective date" },
    { label: "Face amount", value: dollars(policy.faceCents), from: "Face amount" },
    { label: "Paid by", value: policy.paymentMethod ? METHOD[policy.paymentMethod] ?? policy.paymentMethod : "—", from: "Payment method" },
    { label: "Draft day", value: policy.draftDay ? String(policy.draftDay) : "—" },
    {
      label: "Writing agent",
      value: policy.agentName ?? (policy.agentCode ? <><span className="font-mono text-xs">{policy.agentCode}</span> · <Link href="/app/book-setup/agent-codes" className={LINK}>Map the code</Link></> : "—"),
      from: "Writing agent (carrier's code)",
    },
    { label: "Came from", value: `${lead.name ?? "Lead source not known"}${lead.costPerLeadCents !== null ? ` · ${dollars(lead.costPerLeadCents)} a lead` : ""}` },
    {
      label: "Client",
      value: client?.name
        ? <span className="inline-flex min-w-0 items-center gap-2">{client.name}{provisional && <><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--warning-ink)]" title="This client was built from the carrier's file"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--warning)]" />Provisional</span><Link href="/app/duplicates" className={LINK}>Check the client</Link></>}</span>
        : <Link href={carrierPolicyHref(policy.carrierId, policy.policyNumber, "client")} className={LINK}>No client linked</Link>,
    },
  ];

  return (
    <>
      <StatStrip label="This policy">
        <StatTile label="Status" labelTitle={provenance(field("Status")) ?? undefined} value={asIs(statusLabel(policy.status))} valueTone={policy.status ? STATUS_TONE[policy.status] : undefined} footnote={policy.statusRaw ? `carrier says “${policy.statusRaw}”` : "no status in the file"} />
        <StatTile label="Paid to" labelTitle={provenance(field("Paid-to date")) ?? undefined} value={asIs(fileDay(policy.paidTo))} valueTone={behind > 0 ? "danger" : undefined} footnote={[behind > 0 ? `${behind.toLocaleString("en-US")} days behind` : "up to date", policy.monthsPaid !== null ? `${policy.monthsPaid} ${policy.monthsPaid === 1 ? "month" : "months"} paid` : null].filter(Boolean).join(" · ")} />
        <StatTile label="Risk" value={asIs(RISK_LABELS[policy.riskBand])} valueTone={RISK_TONE[policy.riskBand]} footnote={riskFootnote(policy) || "nothing past due"} />
        <StatTile label="Premium" labelTitle={provenance(field("Premium")) ?? undefined} value={asIs(policy.premiumCents !== null ? dollars(policy.premiumCents) : monthly !== null ? dollars(monthly) : "—")} unit={policy.premiumCents !== null ? mode : monthly !== null ? "/mo" : undefined} footnote={policy.faceCents !== null ? `face ${dollars(policy.faceCents).replace(/\.00$/, "")}` : "face not in the file"} />
        <StatTile label={next?.label ?? "Next date"} value={asIs(next ? fileDay(next.date) : "None")} valueTone={next ? "warning" : undefined} footnote={next?.detail ?? (behind > 0 ? "nothing is due while it's behind" : "nothing due")} />
      </StatStrip>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-stretch gap-4 min-[1100px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <TableCard title="Policy" description={source.file ? `From ${source.file.name}${source.file.date ? ` · file of ${fileDay(source.file.date)}` : ""}` : undefined}>
          <dl className="m-0 border-t border-border">
            {rows.map((row) => {
              const said = row.from ? provenanceLinks(field(row.from)) : null;
              return (
                <div key={row.label} className="grid min-h-[2.75rem] grid-cols-[132px_minmax(0,1fr)_20px] items-center gap-x-3 border-b border-border px-4 py-1.5 text-sm last:border-b-0">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="m-0 min-w-0 truncate text-foreground">{row.value}</dd>
                  <span>{said ? <InfoTip label={`Where ${row.label.toLowerCase()} comes from`} side="left">{said}</InfoTip> : null}</span>
                </div>
              );
            })}
          </dl>
        </TableCard>

        <TableCard
          title="As the carrier sent it"
          description={source.raw ? `${Object.keys(source.raw).length} columns${source.file?.rowNumber ? ` · row ${source.file.rowNumber}` : ""}` : undefined}
          action={source.file?.rowNumber && field("Status")?.readFrom ? <Link href={rowHref(field("Status")!.readFrom!.fileId, source.file.rowNumber)} className={LINK}>Open the row ›</Link> : field("Status")?.readFrom ? <Link href={fileHref(field("Status")!.readFrom!.fileId)} className={LINK}>Open the file ›</Link> : undefined}
        >
          {source.raw ? (
            <dl className="m-0 max-h-[420px] overflow-y-auto border-t border-border">
              {Object.entries(source.raw).map(([column, value]) => (
                <div key={column} className="grid min-h-[2.75rem] grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-3 border-b border-border px-4 py-1.5 last:border-b-0">
                  <dt className="truncate font-mono text-xs text-muted-foreground" title={column}>{column}</dt>
                  <dd className="m-0 truncate font-mono text-xs text-foreground" title={String(value ?? "")}>{String(value ?? "") || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="m-0 border-t border-border px-4 py-4 text-sm text-muted-foreground">The carrier&rsquo;s row isn&rsquo;t kept for this policy: it arrived before rows were stored, or it was entered by hand.</p>
          )}
        </TableCard>
      </div>

      {(others.length > 0 || household) && (
        <TableCard
          title={others.length ? `${client?.name ?? "This client"} has ${others.length + 1} policies` : "Household"}
          action={household ? <span className="text-sm text-muted-foreground" title={`Household: ${household.people.join(", ")}`}>Household <span className="font-semibold tabular-nums text-foreground">{dollars(household.monthlyCents)}</span> a month · {household.policies} policies</span> : undefined}
        >
          {others.length > 0 && (
            <ul className="m-0 list-none border-t border-border p-0 text-sm">
              {others.map((other) => (
                <li key={`${other.carrierId}|${other.policyNumber}`} className="flex min-h-[2.75rem] items-center justify-between gap-3 border-b border-border px-4 last:border-b-0">
                  <Link href={carrierPolicyHref(other.carrierId, other.policyNumber)} className="min-w-0 truncate hover:underline">{other.carrierName} · <span className="font-mono text-xs">{other.policyNumber}</span></Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(other.status)}{other.annualCents !== null ? ` · ${dollars(Math.round(other.annualCents / 12))}/mo` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </TableCard>
      )}
    </>
  );
}
