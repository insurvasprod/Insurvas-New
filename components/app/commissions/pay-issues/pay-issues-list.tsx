"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS, DISCREPANCY_TYPES } from "@/lib/ingestion/discrepancyEngine";
import { daysSince, groupPayIssues, payIssueCarrierKey, payIssueHref, payIssueMoney as money, type PayIssue } from "@/lib/commissions/payIssueGroups";

export type UncheckedCarrier = { carrierId: string; carrierName: string; inForce: number; missing: Array<"trigger" | "lag"> };

const RATE_CARD = "/app/book-setup";

/**
 * The one chip on a pay issue's row (owner 2026-11-11: one line per row, colour only in a chip). An open issue's chip
 * says its money (owed to you is waiting, owed to the carrier is wrong), so the amount columns and their colours went.
 */
export function payIssueState(issue: Pick<PayIssue, "status" | "statusWord" | "owedToYouCents" | "owedToCarrierCents" | "unpriced" | "withinLag">): { text: string; tone: StatusTone } {
  if (issue.status === "closed") return { text: issue.statusWord, tone: "neutral" };
  if (issue.status === "letter") return { text: issue.statusWord, tone: "warning" };
  if (issue.withinLag) return { text: "Within the lag", tone: "neutral" };
  if (issue.owedToCarrierCents > issue.owedToYouCents) return { text: `${money(issue.owedToCarrierCents)} owed back`, tone: "danger" };
  if (issue.owedToYouCents > 0) return { text: `${money(issue.owedToYouCents)} short`, tone: "warning" };
  if (issue.unpriced) return { text: "No rate", tone: "warning" };
  return { text: issue.statusWord, tone: "warning" };
}

/**
 * Pay issues › Open and Closed (round 7, 2·A). "By carrier and kind" (the default on Open) is one row per group, each
 * opening the group's page; "One by one" is the flat list, each row opening the issue's page. "Not checked" lists the
 * carriers missing commission is not checked for (no pay trigger or lag); "Imported by hand" narrows to statements
 * imported by hand. The rows hold no decisions: those are on the issue's and the group's pages.
 */
export function PayIssuesList({ issues, tab, unchecked, summary, initialSource, today, unavailable = false }: {
  issues: PayIssue[];
  tab: "open" | "closed";
  unchecked: UncheckedCarrier[];
  summary: { owedCents: number; unpriced: number; comingBackCents: number; heldCents: number } | null;
  initialSource: "" | "carrier" | "hand";
  today: string;
  /** Pay issues are not switched on for this account yet (no finding can be read). */
  unavailable?: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [mode, setMode] = useState<"groups" | "flat" | "unchecked">(tab === "open" ? "groups" : "flat");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [carrier, setCarrier] = useState("");
  const [source, setSource] = useState(initialSource);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const carriers = useMemo(() => [...new Map(issues.map((i) => [payIssueCarrierKey(i), i.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [issues]);
  const handCount = useMemo(() => issues.filter((i) => i.source === "hand").length, [issues]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => issues.filter((i) =>
    (!source || i.source === source) && (!type || i.type === type) && (!carrier || payIssueCarrierKey(i) === carrier) &&
    (!needle || `${i.policyNumber ?? ""} ${i.clientName ?? ""} ${i.carrierName}`.toLowerCase().includes(needle))), [issues, source, type, carrier, needle]);
  const groups = useMemo(() => groupPayIssues(visible), [visible]);
  const flat = useMemo(() => [...visible].sort((a, b) => b.owedToYouCents + b.owedToCarrierCents - (a.owedToYouCents + a.owedToCarrierCents) || a.foundAt.localeCompare(b.foundAt)), [visible]);
  const filterCount = (type ? 1 : 0) + (carrier ? 1 : 0) + (source ? 1 : 0);
  const filtered = Boolean(filterCount || needle);
  const clear = () => { setType(""); setCarrier(""); setSource(""); setQuery(""); };

  const owedLine = summary && summary.owedCents + summary.unpriced + summary.comingBackCents + summary.heldCents > 0 && (
    <span className="text-sm text-foreground">
      You appear to be owed <b className="font-semibold tabular-nums">{money(summary.owedCents)}</b>
      {summary.unpriced > 0 && <> · <Link href={RATE_CARD} className="font-semibold hover:underline">{summary.unpriced.toLocaleString("en-US")} without a rate</Link></>}
      {summary.comingBackCents > 0 && <> · {money(summary.comingBackCents)} coming back</>}
      {summary.heldCents > 0 && <> · {money(summary.heldCents)} held</>}
    </span>
  );

  const toolbar = (
    <DataToolbar actions={<>{filtered && <ClearFiltersButton onClick={clear} />}{owedLine}<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} /></>}>
      <ToolbarSearch value={query} onChange={setQuery} placeholder="Policy, client or carrier" />
      <span role="radiogroup" aria-label="Show" className="inline-flex flex-wrap gap-2">
        <ToggleChip role="radio" selected={mode === "groups"} count={groups.length} onClick={() => setMode("groups")}>By carrier and kind</ToggleChip>
        <ToggleChip role="radio" selected={mode === "flat"} count={visible.length} onClick={() => setMode("flat")}>One by one</ToggleChip>
      </span>
      {tab === "open" && unchecked.length > 0 && <ToggleChip selected={mode === "unchecked"} count={unchecked.length} countTone="warning" onClick={() => setMode(mode === "unchecked" ? "groups" : "unchecked")}>Not checked</ToggleChip>}
      {(handCount > 0 || source === "hand") && <ToggleChip selected={source === "hand"} count={handCount} onClick={() => setSource(source === "hand" ? "" : "hand")}>Imported by hand</ToggleChip>}
      <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={filterCount} controls="pay-issue-filters" />
    </DataToolbar>
  );
  const filters = (
    <FilterPanel id="pay-issue-filters" open={filtersOpen}>
      <FilterField label="Kind" htmlFor="issue-kind"><select id="issue-kind" className={toolbarControl} value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">Every kind</option>
        {DISCREPANCY_TYPES.map((t) => <option key={t} value={t}>{DISCREPANCY_LABELS[t].label}</option>)}
      </select></FilterField>
      <FilterField label="Carrier" htmlFor="issue-carrier"><select id="issue-carrier" className={toolbarControl} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
        <option value="">Every carrier</option>
        {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></FilterField>
      <FilterField label="Source" htmlFor="issue-source"><select id="issue-source" className={toolbarControl} value={source} onChange={(e) => setSource(e.target.value as "" | "carrier" | "hand")}>
        <option value="">Every source</option>
        <option value="carrier">From carrier files</option>
        <option value="hand">Statements imported by hand</option>
      </select></FilterField>
    </FilterPanel>
  );

  const empty = unavailable
    ? <EmptyState title="No pay issues to show yet" hint="Pay issues appear here once this account's carrier files and statements can be checked. Nothing is flagged as owed until then." />
    : issues.length === 0
    ? <EmptyState title={tab === "closed" ? "Nothing closed yet" : "No open pay issues"} hint={tab === "closed" ? "Settled, written-off and dismissed issues land here, with who decided them." : "Every finding is decided. New ones appear when the next files are read."} />
    : <NoMatches noun="pay issues" onClear={clear} />;

  if (mode === "unchecked") {
    return (
      <PagedTableCard key="unchecked" toolbar={toolbar} filters={filters} total={unchecked.length} noun={unchecked.length === 1 ? "carrier" : "carriers"} footer={<span className="text-sm text-muted-foreground">Missing commission is not checked for these carriers until their pay trigger and lag are set.</span>}>
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Carrier</th><th className="text-right">Policies in force</th><th>Not set</th><th>What to do</th></tr></thead>
          <PagedBody>
            {unchecked.map((gap) => {
              const href = `/app/book-setup/carrier-rules/${gap.carrierId}`;
              return (
                <tr key={gap.carrierId} className="cursor-pointer" onClick={() => router.push(href)}>
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{gap.carrierName}</Link></td>
                  <td className="text-right tabular-nums">{gap.inForce.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap">{gap.missing.length === 2 ? "Pay trigger and lag" : gap.missing[0] === "trigger" ? "Pay trigger" : "Payment lag"}</td>
                  <td className="whitespace-nowrap">Set timing ›</td>
                </tr>
              );
            })}
          </PagedBody>
        </table>
      </PagedTableCard>
    );
  }

  if (mode === "groups") {
    return (
      <PagedTableCard key="groups" toolbar={toolbar} filters={filters} total={groups.length} noun={groups.length === 1 ? "group" : "groups"} suffix={`${visible.length.toLocaleString("en-US")} ${visible.length === 1 ? "issue" : "issues"}, largest first`}
        footer={groups.length ? <span className="text-sm text-muted-foreground">{groups.length.toLocaleString("en-US")} {groups.length === 1 ? "group" : "groups"} · {visible.length.toLocaleString("en-US")} {visible.length === 1 ? "issue" : "issues"}, largest first</span> : undefined}>
        {groups.length === 0 ? empty : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Issue</th>
                <th className="text-right">How many</th>
                <th>Oldest</th>
                <th>Status</th>
                <th>Next step</th>
              </tr>
            </thead>
            <PagedBody>
              {groups.map((group) => {
                const href = tab === "closed" ? `${group.href}&tab=closed` : group.href;
                const age = daysSince(group.oldest, today);
                // One chip: a closed group says so; an open one says its money (the larger side), else that it has no rate.
                const chip: { text: string; tone: StatusTone } = tab === "closed" ? { text: "Closed", tone: "neutral" }
                  : group.owedToCarrierCents > group.owedToYouCents ? { text: `${money(group.owedToCarrierCents)} owed back`, tone: "danger" }
                    : group.owedToYouCents > 0 ? { text: `${money(group.owedToYouCents)} short`, tone: "warning" }
                      : group.unpriced > 0 ? { text: `${group.unpriced.toLocaleString("en-US")} without a rate`, tone: "warning" }
                        : { text: "To decide", tone: "warning" };
                const both = tab !== "closed" && group.owedToYouCents > 0 && group.owedToCarrierCents > 0;
                return (
                  <tr key={group.key} className="cursor-pointer" onClick={() => router.push(href)}>
                    <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{group.carrierName}</Link></td>
                    <td className="whitespace-nowrap">{DISCREPANCY_LABELS[group.type]?.label ?? group.type}</td>
                    <td className="text-right tabular-nums">{group.count.toLocaleString("en-US")}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={age !== null ? `${age.toLocaleString("en-US")} ${age === 1 ? "day" : "days"} ago` : undefined}>{fileDay(group.oldest)}</td>
                    <td><StatusChip tone={chip.tone} title={both ? `${money(group.owedToYouCents)} owed to you · ${money(group.owedToCarrierCents)} owed to the carrier` : undefined}>{chip.text}</StatusChip></td>
                    <td className="whitespace-nowrap">{tab === "closed" ? "Open" : group.next === "Add the rate first" ? "Add rate" : "Decide"} ›</td>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    );
  }

  return (
    <PagedTableCard key="flat" toolbar={toolbar} filters={filters} total={flat.length} noun={flat.length === 1 ? "issue" : "issues"} suffix="largest first"
      footer={flat.length ? <span className="text-sm text-muted-foreground">{flat.length.toLocaleString("en-US")} {flat.length === 1 ? "issue" : "issues"}, largest first</span> : undefined}>
      {flat.length === 0 ? empty : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Client</th>
              <th>Carrier</th>
              <th>Issue</th>
              <th>Found</th>
              <th>Status</th>
            </tr>
          </thead>
          <PagedBody>
            {flat.map((issue) => {
              const href = payIssueHref(issue);
              const chip = payIssueState(issue);
              return (
                <tr key={`${issue.source}:${issue.id}`} className="cursor-pointer" onClick={() => router.push(href)}>
                  <td className="whitespace-nowrap font-medium tabular-nums text-foreground"><Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{issue.policyNumber ?? "Whole account"}</Link></td>
                  <td className="whitespace-nowrap">{issue.clientName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">{issue.carrierName}</td>
                  <td className="whitespace-nowrap">{DISCREPANCY_LABELS[issue.type]?.label ?? issue.type}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(issue.foundAt.slice(0, 10))}</td>
                  <td><StatusChip tone={chip.tone}>{chip.text}</StatusChip></td>
                </tr>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
