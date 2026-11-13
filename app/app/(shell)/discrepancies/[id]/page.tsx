import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { IssueActions } from "@/components/app/commissions/pay-issues/decide-dialog";
import { PayIssueNeighbours } from "@/components/app/commissions/pay-issues/neighbours";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { COMMISSIONS_STEPS } from "@/lib/commissions/steps";
import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { loadPayIssues, payTimingWords, carrierPayFacts } from "@/lib/discrepancies/payIssues";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS } from "@/lib/ingestion/discrepancyEngine";
import { carrierPolicyHref } from "@/lib/ingestion/policyPage";
import { rowHref } from "@/lib/ingestion/trace";
import { statementDay } from "@/lib/ledger/statementConstants";
import { orderPayIssues, payIssueCarrierKey, payIssueGroupHref, payIssueHref, payIssueLetterHref, payIssueMoney as money, payIssueNeighbours, type PayIssue } from "@/lib/commissions/payIssueGroups";

/**
 * Commissions › Pay issues › an issue (round 7, owner pick 2·2, 2026-11-10). `/app/discrepancies/[id]` for a finding
 * from the carriers' own files; `?source=hand` for one from a statement imported by hand (its id is another
 * table's). The title is the client and the policy ("Carrier account · {carrier}" for a whole-account issue);
 * What's wrong · The lines · History beside it (`?tab=`); ‹ › name the issues either side in its group; "Decide"
 * opens the one Decide dialog (components/app/commissions/pay-issues/decide-dialog.tsx). The strip holds the
 * figures; nothing sits under the title. Reading only: a decision is the dialog's write.
 */
type Tab = "wrong" | "lines" | "history";
const HAND_WORD: Record<string, string> = { open: "Open", disputed: "In a letter", resolved: "Resolved", written_off: "Written off", cleared: "No longer applies" };
const CARRIER_WORD: Record<string, string> = { open: "Open", disputed: "In a letter", resolved: "Resolved", dismissed: "Dismissed", expired: "No longer applies" };

const nameOf = (i: Pick<PayIssue, "clientName" | "policyNumber" | "carrierName">) => i.clientName ?? (i.policyNumber ? `Policy ${i.policyNumber}` : `Carrier account · ${i.carrierName}`);

export default async function PayIssuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string; tab?: string }> }) {
  const [guard, { id }, query] = await Promise.all([guardPage("discrepancy_report"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pay issues" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Pay issues" detail="Pay issues are worked by the account owner or a bookkeeper." />;
  if (!isRecordUuid(id)) notFound();
  const source = query.source === "hand" ? "hand" : "carrier";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const read = await loadPayIssues(tenantId);
  const issue = read.issues.find((i) => i.id === id && i.source === source);
  if (!issue) notFound();
  const row = source === "carrier" ? read.carrierRows.find((r) => r.id === id) ?? null : null;
  const hand = source === "hand" ? read.handRows.find((r) => r.id === id) ?? null : null;
  const tab: Tab = query.tab === "lines" || query.tab === "history" ? query.tab : "wrong";

  // Its group, in the group page's order, on the same side of Open / Closed: the ‹ › walk it.
  const key = payIssueCarrierKey(issue);
  const closed = issue.status === "closed";
  const group = orderPayIssues(read.issues.filter((i) => i.type === issue.type && payIssueCarrierKey(i) === key && (i.status === "closed") === closed));
  const { previous, next } = payIssueNeighbours(group, (i) => i.id === issue.id && i.source === issue.source);
  const groupHref = payIssueGroupHref(key, issue.type, closed ? "closed" : issue.status === "letter" ? "letter" : undefined);
  const kindLabel = DISCREPANCY_LABELS[issue.type].label;
  const groupTitle = `${issue.carrierName} · ${kindLabel}`;
  const name = nameOf(issue);
  const title = issue.clientName && issue.policyNumber ? `${issue.clientName} · ${issue.policyNumber}` : name;

  const facts = row?.policyNumber ? read.facts.get(`${row.carrierId}|${row.policyNumber}`) : undefined;
  const payFacts = issue.carrierId ? await carrierPayFacts(tenantId, issue.carrierId) : null;
  const policyHref = hand ? `/app/policies/${hand.policyId}` : issue.carrierId && issue.policyNumber ? carrierPolicyHref(issue.carrierId, issue.policyNumber) : null;
  const rateHref = issue.carrierId ? `/app/book-setup?carrier=${issue.carrierId}` : "/app/book-setup";

  const lines = row ? row.reportedLines : [];
  const statements = hand ? hand.detail?.statementIds ?? [] : [];
  const history: Array<{ at: string; what: string; who: string | null; note: string | null; href?: string }> = row
    ? [
      { at: row.detectedAt, what: "Found", who: null, note: null },
      { at: row.lastSeenAt, what: "Last checked against the files", who: null, note: null },
      ...(row.disputeId ? [{ at: read.disputes.find((d) => d.id === row.disputeId)?.createdAt ?? row.lastSeenAt, what: "Put on a letter", who: null, note: null, href: payIssueLetterHref(row.disputeId) }] : []),
      ...(row.resolvedAt ? [{ at: row.resolvedAt, what: CARRIER_WORD[row.status] ?? "Closed", who: null, note: row.resolutionNote }] : []),
    ]
    : hand ? hand.history.map((h) => ({ at: h.at, what: h.from ? `${HAND_WORD[h.from]} → ${HAND_WORD[h.to]}` : `Found · ${HAND_WORD[h.to]}`, who: h.byName ?? (h.from ? "when a statement changed" : null), note: h.note }))
      : [];
  if (hand && !hand.history.length) history.push({ at: hand.firstSeenAt, what: "Found", who: null, note: null }, { at: hand.lastSeenAt, what: "Last checked", who: null, note: hand.note });
  history.sort((a, b) => b.at.localeCompare(a.at));

  const here = (t: Tab) => payIssueHref(issue, t === "wrong" ? undefined : t);
  const side = (i: PayIssue | null) => (i ? { name: nameOf(i), href: payIssueHref(i, tab === "wrong" ? undefined : tab) } : null);
  const rate = row?.expectedSource && row.expectedSource.rate_bp != null ? `rate card ${Number(row.expectedSource.rate_bp) / 100}%${row.expectedSource.schedule_version ? ` · eff. ${fileDay(String(row.expectedSource.schedule_version))}` : ""}` : null;
  const paidLines = row ? lines.length : hand ? hand.detail?.receivedLineIds?.length ?? 0 : 0;
  const statusWord = row ? (issue.status === "closed" ? issue.statusWord : issue.status === "letter" ? "In a letter" : "Open") : issue.statusWord;
  const causes = row && Array.isArray(row.evidence?.causes) ? (row.evidence.causes as string[]) : [];
  const explanation = row?.explanation ?? hand?.detail?.explanation ?? "";

  return (
    <CommissionsPage
      step="discrepancies"
      title={title}
      breadcrumbs={[
        { label: "Commissions", href: COMMISSIONS_STEPS[0].href },
        { label: "Pay issues", href: closed ? "/app/discrepancies?view=closed" : "/app/discrepancies" },
        { label: groupTitle, href: groupHref },
        { label: name },
      ]}
      tabs={<ViewTabs label={title} value={tab} tabs={[
        { key: "wrong", label: "What's wrong", href: here("wrong") },
        { key: "lines", label: "The lines", count: row ? lines.length : statements.length, href: here("lines") },
        { key: "history", label: "History", count: history.length, href: here("history") },
      ]} />}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          <PayIssueNeighbours previous={side(previous)} next={side(next)} noun="issue" />
          <IssueActions
            issue={issue}
            readOnly={readOnly}
            nextHref={next ? payIssueHref(next) : null}
            nextName={next ? nameOf(next) : null}
            listHref={groupHref}
            rateHref={rateHref}
            policyHref={policyHref}
          />
        </span>
      }
    >
      <StatStrip label={`${name} at a glance`}>
        <StatTile label="Issue" valueSize="text" value={kindLabel} footnote={<StatusChip tone={issue.owedToCarrierCents ? "danger" : "warning"}>{`${group.length.toLocaleString("en-US")} in this group ›`}</StatusChip>} href={groupHref} />
        <StatTile label="Expected" value={issue.unpriced ? "No rate" : money(issue.expectedCents)} footnote={issue.unpriced ? <StatusChip tone="warning">Add the rate to price it</StatusChip> : rate ?? (hand ? "from your contract level" : undefined)} href={issue.unpriced ? rateHref : undefined} />
        <StatTile label="Paid" value={money(issue.paidCents)} footnote={paidLines ? `${paidLines.toLocaleString("en-US")} ${paidLines === 1 ? "line" : "lines"} ›` : `no ${issue.carrierName} line yet`} href={paidLines ? here("lines") : undefined} />
        {issue.owedToCarrierCents > 0
          ? <StatTile label="Owed to the carrier" value={money(issue.owedToCarrierCents)} footnote={<><StatusChip tone="danger">Owed back</StatusChip>{row?.toleranceCents != null ? ` tolerance ${money(row.toleranceCents)}` : null}</>} />
          : <StatTile label="Owed to you" value={money(issue.owedToYouCents)} footnote={(() => { const tol = row?.toleranceCents != null ? `tolerance ${money(row.toleranceCents)}` : payFacts?.toleranceCents != null ? `tolerance ${money(payFacts.toleranceCents)}` : undefined; return issue.owedToYouCents ? <><StatusChip tone="warning">Waiting</StatusChip>{tol ? ` ${tol}` : null}</> : tol; })()} />}
        <StatTile label="Status" valueSize="text" value={statusWord} footnote={`found ${fileDay(issue.foundAt.slice(0, 10))}${row ? ` · checked ${fileDay(row.lastSeenAt.slice(0, 10))}` : ""}`} href={issue.status === "letter" && issue.disputeId ? payIssueLetterHref(issue.disputeId) : undefined} />
      </StatStrip>

      {tab === "lines" ? (
        <TableCard>
          {row ? (lines.length === 0 ? <EmptyState title={`No ${issue.carrierName} line yet`} hint="Nothing on the carrier's files was paid for this. The lines appear here when a file pays it." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Line</th><th className="text-right">Amount</th><th>From</th></tr></thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="whitespace-nowrap font-medium capitalize text-foreground">{line.type.replaceAll("_", " ")}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(line.amountCents)}</td>
                    <td className="whitespace-nowrap">{line.rowNumber ? <Link href={rowHref(line.fileId, line.rowNumber)} className="hover:underline">{line.fileName ?? "the file"}, row {line.rowNumber}</Link> : <span>{line.fileName ?? "the file"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )) : statements.length === 0 ? <EmptyState title="No statement line yet" hint="Nothing on the statements imported by hand was paid for this." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Statement</th><th className="text-right">Lines</th></tr></thead>
              <tbody>
                {statements.map((statementId, index) => (
                  <tr key={statementId}>
                    <td className="whitespace-nowrap font-medium text-foreground"><Link href={`/app/statements/${statementId}`} className="hover:underline">{issue.carrierName} statement {statements.length > 1 ? index + 1 : ""}</Link></td>
                    <td className="text-right tabular-nums">{index === 0 ? (hand?.detail?.receivedLineIds?.length ?? 0).toLocaleString("en-US") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : tab === "history" ? (
        <TableCard>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>When</th><th>What</th><th>Who</th><th>Note</th></tr></thead>
            <tbody>
              {history.map((h, index) => (
                <tr key={`${h.at}-${index}`}>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(h.at)}</td>
                  <td className="whitespace-nowrap font-medium text-foreground">{h.href ? <Link href={h.href} className="hover:underline">{h.what}</Link> : h.what}</td>
                  <td className="whitespace-nowrap">{h.who ?? "Insurvas"}</td>
                  <td>{h.note ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <div className="grid gap-4 lg:flex-1 lg:grid-cols-2">
          <section className={`${cardSurface} p-5`} aria-label="Why it's flagged">
            <h2 className="m-0 text-base font-semibold text-foreground">Why it&apos;s flagged</h2>
            <p className="m-0 mt-3 text-sm text-foreground">{explanation}</p>
            {hand && <p className="m-0 mt-2 text-sm text-muted-foreground">{DISCREPANCY_KIND_LABELS[hand.kind].meaning}</p>}
            {causes.length > 0 && <ul className="m-0 mt-2 list-disc pl-5 text-sm text-muted-foreground">{causes.map((c) => <li key={c}>{c}</li>)}</ul>}
            {payFacts && issue.type === "missing" && <p className="m-0 mt-3 text-sm text-muted-foreground">{payTimingWords(issue.carrierName, payFacts)}.{payFacts.lastFile ? <> Check <Link href={`/app/carrier-files/file/${payFacts.lastFile.id}`} className="text-[var(--accent-ink)] hover:underline">{issue.carrierName}&apos;s {fileDay(payFacts.lastFile.date)} file</Link> for the client&apos;s name, then put it on a letter.</> : null}</p>}
            {issue.unpriced && <p className="m-0 mt-3 text-sm text-muted-foreground">The rate card has no rate for this product: <Link href={rateHref} className="text-[var(--accent-ink)] hover:underline">add the rate</Link> and the amount owed is worked out.</p>}
          </section>
          <section className={`${cardSurface} p-5`} aria-label="The policy">
            <div className="flex items-center gap-3">
              <h2 className="m-0 text-base font-semibold text-foreground">{issue.policyNumber ? "The policy" : "The account"}</h2>
              {policyHref && <Link href={policyHref} className="ml-auto text-xs font-semibold text-[var(--accent-ink)] hover:underline">Open the policy ›</Link>}
            </div>
            <FactTable className="mt-3" rows={[
              ["Client", issue.clientName ?? (issue.policyNumber ? "Not known yet" : null)],
              ["Policy", issue.policyNumber],
              ["Carrier · product", [issue.carrierName, facts?.productCode].filter(Boolean).join(" · ")],
              ["Annual premium", facts?.annualPremiumCents != null ? money(facts.annualPremiumCents) : null],
              ["Issued", facts?.issuedOn ? fileDay(facts.issuedOn) : null],
              ["Written by", facts?.agentName || facts?.agentCode ? [facts?.agentName, facts?.agentCode ? `writing no. ${facts.agentCode}` : null].filter(Boolean).join(" · ") : null],
              ["Carrier says", facts?.status ? `${facts.status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())}${facts.asOf ? ` (${fileDay(facts.asOf)} file)` : ""}` : null],
              ["Period", hand?.periodStart && hand.periodEnd ? `${fileDay(hand.periodStart)} – ${fileDay(hand.periodEnd)}` : null],
              ["Source", issue.source === "hand" ? "A statement imported by hand" : "The carrier's own files"],
            ]} />
          </section>
        </div>
      )}
    </CommissionsPage>
  );
}
