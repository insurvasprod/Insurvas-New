import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { LetterActions } from "@/components/app/commissions/pay-issues/letter-actions";
import { PayIssueNeighbours } from "@/components/app/commissions/pay-issues/neighbours";
import { cardSurface } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { COMMISSIONS_STEPS } from "@/lib/commissions/steps";
import { loadPayIssues } from "@/lib/discrepancies/payIssues";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS } from "@/lib/ingestion/discrepancyEngine";
import { statementDay } from "@/lib/ledger/statementConstants";
import {
  LETTER_SETTLED_STATUSES, LETTER_STATUS_WORD, disputeRecord, orderLetters, payIssueHref, payIssueLetterHref, payIssueMoney as money, payIssueNeighbours,
} from "@/lib/commissions/payIssueGroups";

/**
 * Commissions › Pay issues › a letter (round 7, owner pick 2·4, 2026-11-10): `/app/discrepancies/letters/[id]`.
 * The title is the letter; The letter · Items · History beside it (`?tab=`); ‹ › name the letters either side on the
 * same list (Letters out or Settled, by carrier); the primary follows the state: Mark sent for a saved letter,
 * Record the outcome for a sent one, none once settled. The letter shows exactly as drafted: a sent letter never
 * changes. Items link to each pay issue; History is drafted · sent · acknowledged · outcome. Reading only.
 */
type Tab = "letter" | "items" | "history";
const VIA: Record<string, string> = { email: "By email", portal: "Through the carrier's portal", post: "By post" };

export default async function DisputeLetterRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [guard, { id }, query] = await Promise.all([guardPage("discrepancy_report"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pay issues" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Pay issues" detail="Dispute letters are worked by the account owner or a bookkeeper." />;
  if (!isRecordUuid(id)) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  const read = await loadPayIssues(guard.context.tenantId);
  const letter = read.disputes.find((d) => d.id === id);
  if (!letter) notFound();
  const tab: Tab = query.tab === "items" || query.tab === "history" ? query.tab : "letter";

  const settled = LETTER_SETTLED_STATUSES.has(letter.status);
  const list = orderLetters(read.disputes.filter((d) => LETTER_SETTLED_STATUSES.has(d.status) === settled));
  const nameOf = (d: { carrierName: string; createdAt: string }) => `${d.carrierName} · ${fileDay(d.createdAt.slice(0, 10))}`;
  const { previous, next } = payIssueNeighbours(list, (d) => d.id === letter.id);
  const here = (t: Tab) => `${payIssueLetterHref(letter.id)}${t === "letter" ? "" : `?tab=${t}`}`;
  const side = (d: (typeof list)[number] | null) => (d ? { name: nameOf(d), href: `${payIssueLetterHref(d.id)}${tab === "letter" ? "" : `?tab=${tab}`}` } : null);
  const dateWords = fileDay(letter.createdAt.slice(0, 10));
  const title = `Letter to ${letter.carrierName} · ${dateWords}`;
  const listLabel = settled ? "Settled" : "Letters out";
  const listHref = settled ? "/app/discrepancies?view=settled" : "/app/discrepancies?view=letters";

  const wanted = new Set(letter.discrepancyIds);
  const items = read.issues.filter((i) => i.source === "carrier" && wanted.has(i.id));
  const record = disputeRecord(read.disputes.filter((d) => d.carrierId === letter.carrierId))[0];
  const history: Array<{ at: string | null; what: string; note: string | null }> = [
    { at: letter.createdAt, what: "Drafted and saved", note: letter.recipient ? `To ${letter.recipient.split("\n")[0]}` : null },
    ...(letter.sentAt ? [{ at: letter.sentAt, what: `Sent ${(VIA[letter.sentVia ?? ""] ?? "").toLowerCase()}`.trim(), note: null }] : []),
    ...(letter.status === "acknowledged" ? [{ at: null, what: "The carrier acknowledged it", note: null }] : []),
    ...(settled ? [{ at: letter.resolvedAt, what: LETTER_STATUS_WORD[letter.status] ?? letter.status, note: [letter.outcomeCents !== null ? `${money(letter.outcomeCents)} credited` : null, letter.notes].filter(Boolean).join(" · ") || null }] : []),
  ];

  return (
    <CommissionsPage
      step="discrepancies"
      title={title}
      breadcrumbs={[
        { label: "Commissions", href: COMMISSIONS_STEPS[0].href },
        { label: "Pay issues", href: "/app/discrepancies" },
        { label: listLabel, href: listHref },
        { label: nameOf(letter) },
      ]}
      tabs={<ViewTabs label={title} value={tab} tabs={[
        { key: "letter", label: "The letter", href: here("letter") },
        { key: "items", label: "Items", count: letter.discrepancyIds.length, href: here("items") },
        { key: "history", label: "History", count: history.length, href: here("history") },
      ]} />}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          <PayIssueNeighbours previous={side(previous)} next={side(next)} noun="letter" />
          <LetterActions
            letter={{ id: letter.id, status: letter.status, carrierName: letter.carrierName, dateWords, claimedWords: money(letter.totalCents) }}
            readOnly={readOnly}
            statementsHref="/app/statements"
          />
        </span>
      }
    >
      <StatStrip label={`${title} at a glance`}>
        <StatTile label="Claimed" value={money(letter.totalCents)} footnote={`${letter.discrepancyIds.length.toLocaleString("en-US")} ${letter.discrepancyIds.length === 1 ? "item" : "items"} ›`} href={here("items")} />
        <StatTile label="Sent" valueSize="text" value={letter.sentVia ? VIA[letter.sentVia] ?? letter.sentVia : "Not yet"} footnote={letter.sentAt ? fileDay(letter.sentAt.slice(0, 10)) : letter.status === "draft" ? <StatusChip tone="warning">Send it, then mark it sent</StatusChip> : "send it, then mark it sent"} />
        <StatTile label="Outcome" valueSize="text" value={settled ? LETTER_STATUS_WORD[letter.status] : letter.status === "draft" ? "Not sent" : "Waiting on the carrier"} footnote={letter.status === "rejected" ? <StatusChip tone="danger">{letter.resolvedAt ? `Recorded ${fileDay(letter.resolvedAt.slice(0, 10))}` : "Rejected"}</StatusChip> : letter.resolvedAt ? `recorded ${fileDay(letter.resolvedAt.slice(0, 10))}` : undefined} />
        <StatTile label="Credited" value={letter.outcomeCents !== null ? money(letter.outcomeCents) : "—"} footnote={letter.outcomeCents !== null ? "arrives on the next statement" : undefined} />
        <StatTile label={`${letter.carrierName} record`} valueSize="text" value={record ? `${record.won} of ${record.settled}` : "None settled yet"} footnote={record ? `credited ${money(record.creditedCents)} of ${money(record.claimedCents)} claimed` : undefined} href={record ? `/app/discrepancies?view=settled&carrier=${letter.carrierId}` : undefined} />
      </StatStrip>

      {tab === "items" ? (
        <TableCard>
          {items.length === 0 ? <EmptyState title="These items are no longer listed" hint="The issues on this letter have been settled or no longer apply; the letter keeps them as it was drafted." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Policy</th><th>Client</th><th>Issue</th><th className="text-right">Owed to you</th><th>Status</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap font-medium tabular-nums text-foreground"><Link href={payIssueHref(item)} className="hover:underline">{item.policyNumber ?? "Whole account"}</Link></td>
                    <td className="whitespace-nowrap">{item.clientName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap">{DISCREPANCY_LABELS[item.type].label}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{item.owedToYouCents ? money(item.owedToYouCents) : <span className="text-muted-foreground">—</span>}</td>
                    <td><StatusChip tone={item.status === "closed" ? "neutral" : "warning"}>{item.statusWord}</StatusChip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : tab === "history" ? (
        <TableCard>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>When</th><th>What</th><th>Note</th></tr></thead>
            <tbody>
              {history.map((h, index) => (
                <tr key={`${h.what}-${index}`}>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{h.at ? statementDay(h.at) : "—"}</td>
                  <td className="whitespace-nowrap font-medium text-foreground">{h.what}</td>
                  <td>{h.note ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <section className={`${cardSurface} p-5 lg:flex-1`} aria-label="The letter">
          <pre className="m-0 max-w-[820px] overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">{letter.letterBody}</pre>
          {letter.notes && <p className="m-0 mt-4 text-sm text-muted-foreground">Notes: {letter.notes}</p>}
        </section>
      )}
    </CommissionsPage>
  );
}
