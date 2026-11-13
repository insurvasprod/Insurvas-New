import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { GroupRows, type GroupRow } from "@/components/app/commissions/pay-issues/group-rows";
import { GroupLetterButton, type LetterCandidate } from "@/components/app/commissions/pay-issues/letter-dialog";
import { PayIssueNeighbours } from "@/components/app/commissions/pay-issues/neighbours";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { COMMISSIONS_STEPS } from "@/lib/commissions/steps";
import { carrierPayFacts, loadPayIssues, payTimingWords } from "@/lib/discrepancies/payIssues";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS, DISCREPANCY_TYPES, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { carrierPolicyHref } from "@/lib/ingestion/policyPage";
import { fileHref } from "@/lib/ingestion/trace";
import {
  LETTER_OUT_STATUSES, LETTER_SETTLED_STATUSES, PAY_ISSUE_USUALLY, groupPayIssues, orderPayIssues, payIssueCarrierKey, payIssueGroupHref, payIssueGroupPrimary, payIssueHref, payIssueMoney as money, payIssueNeighbours,
} from "@/lib/commissions/payIssueGroups";

/**
 * Commissions › Pay issues › a group (round 7, owner pick 2·1, 2026-11-10): one carrier and one kind of issue.
 * `/app/discrepancies/group?carrier=<carrier id, or name:… for one the library does not know>&kind=<type>`.
 *
 * The title is the group; Open · In a letter · Closed beside it (`?tab=`); ‹ › name the groups either side in the
 * list's order; the primary is the group's next step: "Draft a letter for N" for a kind that is argued, "Add the
 * rate" / "Fix the rate" when the rate card is what is wrong, none for a kind that is held. The strip says what is
 * owed, what usually settles it, how the carrier pays, its last file and the letters already sent to it. Each row
 * opens its issue. Reading only.
 */
type Tab = "open" | "letter" | "closed";

export default async function PayIssueGroupPage({ searchParams }: { searchParams: Promise<{ carrier?: string; kind?: string; tab?: string }> }) {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pay issues" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Pay issues" detail="Pay issues are worked by the account owner or a bookkeeper." />;

  const { carrier = "", kind = "", tab: asked } = await searchParams;
  if (!(DISCREPANCY_TYPES as readonly string[]).includes(kind) || !carrier) notFound();
  const type = kind as DiscrepancyType;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const read = await loadPayIssues(tenantId);
  const members = read.issues.filter((i) => i.type === type && payIssueCarrierKey(i) === carrier);
  if (!members.length) notFound();

  const carrierId = members.find((i) => i.carrierId)?.carrierId ?? null;
  const carrierName = members[0].carrierName;
  const label = DISCREPANCY_LABELS[type].label;
  const title = `${carrierName} · ${label}`;
  const by = (status: Tab) => orderPayIssues(members.filter((i) => i.status === status));
  const lists: Record<Tab, ReturnType<typeof by>> = { open: by("open"), letter: by("letter"), closed: by("closed") };
  const tab: Tab = asked === "letter" || asked === "closed" ? asked : "open";
  const working = [...lists.open, ...lists.letter];

  // ‹ › walk the groups in the list's order (Open's, or Closed's for a group with nothing left open).
  const pool = working.length ? read.issues.filter((i) => i.status !== "closed") : read.issues.filter((i) => i.status === "closed");
  const groups = groupPayIssues(pool);
  const { previous, next } = payIssueNeighbours(groups, (g) => g.carrierKey === carrier && g.type === type);
  const side = (g: (typeof groups)[number] | null) => (g ? { name: `${g.carrierName} · ${DISCREPANCY_LABELS[g.type].label}`, href: working.length ? g.href : payIssueGroupHref(g.carrierKey, g.type, "closed") } : null);

  const [facts] = await Promise.all([carrierId ? carrierPayFacts(tenantId, carrierId) : Promise.resolve(null)]);
  const letters = carrierId ? read.disputes.filter((d) => d.carrierId === carrierId) : [];
  const out = letters.filter((d) => LETTER_OUT_STATUSES.has(d.status)).length;
  const settled = letters.filter((d) => LETTER_SETTLED_STATUSES.has(d.status)).length;
  const owedToYou = working.reduce((s, i) => s + i.owedToYouCents, 0);
  const owedToCarrier = working.reduce((s, i) => s + i.owedToCarrierCents, 0);
  const unpriced = working.filter((i) => i.unpriced).length;
  const rateHref = carrierId ? `/app/book-setup?carrier=${carrierId}` : "/app/book-setup";

  const handPolicy = new Map(read.handRows.map((h) => [h.id, h.policyId]));
  const rows: GroupRow[] = lists[tab].map((issue) => ({
    ...issue,
    href: payIssueHref(issue),
    policyHref: issue.source === "hand" ? (handPolicy.get(issue.id) ? `/app/policies/${handPolicy.get(issue.id)}` : null) : issue.carrierId && issue.policyNumber ? carrierPolicyHref(issue.carrierId, issue.policyNumber) : null,
  }));

  const candidate = (i: (typeof members)[number]): LetterCandidate => ({ id: i.id, policyNumber: i.policyNumber, clientName: i.clientName, owedCents: i.owedToYouCents, withinLag: i.withinLag, unpriced: i.unpriced });
  const carrierItems = lists.open.filter((i) => i.source === "carrier" && i.disputable).map(candidate);
  const handItems = lists.open.filter((i) => i.source === "hand" && i.disputable).map(candidate);
  const letterable = carrierItems.length + handItems.length;
  const primary = payIssueGroupPrimary(type, unpriced);
  const letterButton = (variant: "default" | "outline") => (
    <GroupLetterButton carrierId={carrierId} carrierName={carrierName} carrierItems={carrierItems} handItems={handItems} readOnly={readOnly} variant={variant}
      label={`Draft a letter for ${letterable.toLocaleString("en-US")}`} />
  );
  const here = (t: Tab) => payIssueGroupHref(carrier, type, t === "open" ? undefined : t);

  return (
    <CommissionsPage
      step="discrepancies"
      title={title}
      breadcrumbs={[
        { label: "Commissions", href: COMMISSIONS_STEPS[0].href },
        { label: "Pay issues", href: "/app/discrepancies" },
        { label: working.length ? "Open" : "Closed", href: working.length ? "/app/discrepancies" : "/app/discrepancies?view=closed" },
        { label: title },
      ]}
      tabs={<ViewTabs label={title} value={tab} tabs={[
        { key: "open", label: "Open", count: lists.open.length, href: here("open") },
        { key: "letter", label: "In a letter", count: lists.letter.length, href: here("letter") },
        { key: "closed", label: "Closed", count: lists.closed.length, href: here("closed") },
      ]} />}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          <PayIssueNeighbours previous={side(previous)} next={side(next)} noun="group" />
          {primary === "letter" && letterable > 0 && letterButton("default")}
          {(primary === "add_rate" || primary === "fix_rate") && (
            <span title={readOnly ? "Paused while the account is read-only." : undefined}>
              <Button asChild type="button"><Link href={rateHref}>{primary === "add_rate" ? "Add the rate" : "Fix the rate"}</Link></Button>
            </span>
          )}
          {primary === "add_rate" && carrierItems.some((i) => !i.unpriced) && letterButton("outline")}
          <MoreMenu label="More" items={[
            carrierId && { label: `Open the ${carrierName} files`, href: "/app/carrier-files" },
            { label: `Open the ${carrierName} statements`, href: "/app/statements" },
            carrierId && { label: "Carrier terms", href: `/app/book-setup/carrier-rules/${carrierId}` },
          ]} />
        </span>
      }
    >
      <StatStrip label={`${title} at a glance`}>
        {owedToYou > 0 || owedToCarrier === 0
          ? <StatTile label="Owed to you" value={money(owedToYou)} footnote={<>{owedToYou ? <StatusChip tone="warning">{`${working.length.toLocaleString("en-US")} ${working.length === 1 ? "policy" : "policies"}`}</StatusChip> : `${working.length.toLocaleString("en-US")} ${working.length === 1 ? "policy" : "policies"}`}{unpriced ? ` · ${unpriced.toLocaleString("en-US")} without a rate` : ""}</>} href={unpriced ? rateHref : undefined} />
          : <StatTile label="Owed to the carrier" value={money(owedToCarrier)} footnote={<StatusChip tone="danger">{`${working.length.toLocaleString("en-US")} ${working.length === 1 ? "policy" : "policies"}`}</StatusChip>} />}
        <StatTile label="Usually" valueSize="text" value={PAY_ISSUE_USUALLY[type].split(":")[0].replace(/^./, (c) => c.toUpperCase())} footnote={PAY_ISSUE_USUALLY[type].split(":").slice(1).join(":").trim() || undefined} />
        <StatTile label="Pay timing" valueSize="text" value={facts ? payTimingWords(carrierName, facts) : "Not known"} footnote={carrierId ? "Carrier terms ›" : "a carrier Insurvas does not know"} href={carrierId ? `/app/book-setup/carrier-rules/${carrierId}` : undefined} />
        <StatTile label={`Last ${carrierName} file`} valueSize="text" value={facts?.lastFile ? fileDay(facts.lastFile.date) : "None yet"} footnote={facts?.lastFile ? "Open the file ›" : "no commission file read"} href={facts?.lastFile ? fileHref(facts.lastFile.id) : undefined} />
        <StatTile label={`Letters to ${carrierName}`} valueSize="text" value={letters.length ? `${out.toLocaleString("en-US")} out · ${settled.toLocaleString("en-US")} settled` : "None yet"} footnote={letters.length ? "Dispute record ›" : "draft one from this group"} href={letters.length && carrierId ? `/app/discrepancies?view=${out ? "letters" : "settled"}&carrier=${carrierId}` : undefined} />
      </StatStrip>
      <GroupRows
        key={tab}
        rows={rows}
        today={read.today}
        emptyTitle={tab === "open" ? "Nothing open in this group" : tab === "letter" ? "None in a letter" : "Nothing closed yet"}
        emptyHint={tab === "open" ? `Every ${label.toLowerCase()} issue at ${carrierName} is in a letter or closed.` : tab === "letter" ? `Draft a letter from Open; its issues are listed here until ${carrierName} answers.` : `Settled, written-off and dismissed issues land here, with who decided them.`}
      />
    </CommissionsPage>
  );
}
