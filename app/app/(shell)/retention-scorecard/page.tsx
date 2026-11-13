import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { loadScoreCases, monthly } from "@/lib/retention/cases/store";
import { caseScorecard } from "@/lib/retention/cases/scorecard";
import { caseTrend } from "@/lib/retention/cases/trend";
import { showOf } from "@/lib/reports/show";
import { CasePersonBoard, CaseScorecardBoard, scorecardHref, type ScorecardView } from "@/components/app/retention/case-scorecard-board";
import { RetentionPeriodSelect } from "@/components/app/retention/scorecard-period-select";
import { casesHref } from "@/components/app/retention/scorecard-tables";
import { loadScorecard, SCORECARD_PERIODS, type ScorecardPeriod } from "@/lib/retention/scorecardStore";
import { SCORECARD_PERIOD_LABELS } from "@/lib/retention/scorecard";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionScorecardBoard } from "@/components/app/retention/retention-scorecard-board";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { ViewSwitch } from "@/components/ui/view-switch";

const INFO = "What each person working Retention achieved on the ladder: cases open, saved (a carrier file proved it), lost and closed without a save, with the save rate per person and per step. Under 10 decided cases the counts are shown.";
const TRAIL = [{ label: "Retention" }, { label: "Scorecard" }];

/**
 * Retention › Scorecard (LA-5.8, Notion sprint; round 7, owner pick 0·A/5·A, 2026-11-10;
 * docs/la4/mockups-r7/retention.html). On the Retention rail, beside the work: the title alone with its (i), By person ·
 * By step on its line (`?view=`), and the period as the line's one control. Every count opens Cases filtered; a person's
 * row opens their page (`?rep=`, board 5·1): their name as the title, By step · Open · Saved · Lost, and ‹ › naming the
 * people either side. An owner sees everyone; a producer or a retention rep only their own card, and lands on it.
 * Holdout cases count against nobody. Before the ladder's tables exist, the LA-5.8 card in the same frame, with the same
 * Table · Chart switch in its actions (owner 2026-11-12: every Reports sub-page).
 */
export default async function RetentionScorecardPage({ searchParams }: { searchParams: Promise<{ period?: string; rep?: string; view?: string; tab?: string; show?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention scorecard" description="What each person working retention achieved, save rate by reason." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Retention scorecard" detail="Only owners, producers and retention reps have a retention scorecard." />;
  }
  const query = await searchParams;
  const { period: periodParam, rep: repParam, view: viewParam, tab } = query;
  // Reports round 7 (owner pick 0·A, 2026-11-11): Table · Chart on the title line, the chart by default.
  const show = showOf(query, "chart");
  const viewSwitch = <Suspense fallback={null}><ViewSwitch fallback="chart" /></Suspense>;
  const period: ScorecardPeriod = periodParam && periodParam in SCORECARD_PERIODS ? (periodParam as ScorecardPeriod) : "180";
  const isOwner = guard.role === "owner";
  const viewerId = guard.context.userId;
  const periodSelect = <RetentionPeriodSelect value={period} fallback="180" options={(Object.keys(SCORECARD_PERIODS) as ScorecardPeriod[]).map((p) => ({ value: p, label: SCORECARD_PERIOD_LABELS[p] }))} />;

  // 2026-11-05: on the ladder (cases from the carrier files) once its tables exist; until then the LA-5.8 card below.
  const ladder = await loadScoreCases({ tenantId: guard.context.tenantId, userId: viewerId, role: guard.role, scope: await scopeFor(guard.context) }, SCORECARD_PERIODS[period]);
  if (ladder) {
    const toLine = (c: (typeof ladder.cases)[number]) => ({ ownerId: c.ownerId, step: c.step, status: c.status, unreachable: c.unreachable, monthlyCents: monthly(c.premiumCents, c.premiumMode) });
    const card = caseScorecard(ladder.cases.map(toLine));
    const names = Object.fromEntries(ladder.names);
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - SCORECARD_PERIODS[period] * 86_400_000).toISOString().slice(0, 10);
    const trendOf = (cases: typeof ladder.cases) => caseTrend(cases.map((c) => ({ status: c.status, openedAt: c.openedAt, resolvedAt: c.resolvedAt })), since, today);
    // A producer or a rep has one card, their own, and lands on it (board 5·A).
    const rep = isOwner ? (repParam && repParam !== "nobody" ? repParam : null) : viewerId;

    if (rep) {
      const mine = caseScorecard(ladder.cases.filter((c) => c.ownerId === rep).map(toLine));
      const name = rep === viewerId && !names[rep] ? "You" : names[rep] ?? "Someone no longer here";
      const owner = rep === viewerId ? "me" : rep;
      // ‹ › walk the people in the By person table's order (the owner's only).
      const order = isOwner ? card.people.filter((l) => l.key !== "nobody").map((l) => l.key) : [];
      const at = order.indexOf(rep);
      const previous = at > 0 ? order[at - 1] : null;
      const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
      const tabs = (
        <ViewTabs
          label={`${name}'s cases`}
          value={"steps" as const}
          tabs={[
            { key: "steps" as const, label: "By step", href: scorecardHref({ period, rep: isOwner ? rep : null, show }) },
            { key: "open" as const, label: "Open", count: mine.total.open, href: casesHref({ owner }) },
            { key: "saved" as const, label: "Saved", count: mine.total.saved, href: casesHref({ step: "closed", owner }) },
            { key: "lost" as const, label: "Lost", count: mine.total.lost, href: casesHref({ step: "closed", owner }) },
          ]}
        />
      );
      const actions = (
        <span className="inline-flex flex-wrap items-center gap-2">
          {previous && <Link href={scorecardHref({ period, rep: previous, show })} className={buttonVariants({ variant: "outline" })} title={`Previous person: ${names[previous] ?? "Someone"}`}><ChevronLeft aria-hidden="true" />{names[previous] ?? "Someone"}</Link>}
          {next && <Link href={scorecardHref({ period, rep: next, show })} className={buttonVariants({ variant: "outline" })} title={`Next person: ${names[next] ?? "Someone"}`}>{names[next] ?? "Someone"}<ChevronRight aria-hidden="true" /></Link>}
          {viewSwitch}
          {periodSelect}
        </span>
      );
      return (
        <RetentionPage step="scorecard" title={name} info={INFO} tabs={tabs} actions={actions} breadcrumbs={isOwner ? retentionTrail("scorecard", name) : TRAIL}>
          <CasePersonBoard steps={mine.steps} total={mine.total} owner={owner} name={name} period={period} rep={isOwner ? rep : null} show={show} />
        </RetentionPage>
      );
    }

    const view: ScorecardView = viewParam === "steps" ? "steps" : "people";
    const tabs = (
      <ViewTabs
        label="Scorecard views"
        value={view}
        tabs={[
          { key: "people" as const, label: "By person", count: card.people.length, href: scorecardHref({ period, view: "people", show }) },
          { key: "steps" as const, label: "By step", count: card.steps.length, href: scorecardHref({ period, view: "steps", show }) },
        ]}
      />
    );
    return (
      <RetentionPage step="scorecard" title="Scorecard" info={INFO} tabs={tabs} actions={<span className="inline-flex flex-wrap items-center gap-2">{viewSwitch}{periodSelect}</span>} breadcrumbs={TRAIL}>
        <CaseScorecardBoard people={card.people} steps={card.steps} total={card.total} names={names} view={view} period={period} viewerId={viewerId} show={show} trend={trendOf(ladder.cases)} />
      </RetentionPage>
    );
  }

  const data = await loadScorecard({ tenantId: guard.context.tenantId, userId: viewerId, role: guard.role }, period);
  const fallbackInfo = "What each person working retention achieved. The save rate is shown per reason, never blended on its own; under 10 decided cases a reason shows the counts. Unreachable cases have their own column, and held-out policies count against nobody.";
  // The LA-5.8 card's two views (an owner with a team): Everyone · a person's save rate, as link tabs on the title line.
  const team = data.available && isOwner && data.cards.length > 1;
  const selected = data.available ? data.cards.find((c) => c.userId === (repParam ?? (isOwner ? data.cards[0]?.userId : viewerId))) ?? null : null;
  const shown = tab === "people" || tab === "reasons" ? tab : repParam ? "reasons" : "people";
  const tabHref = (key: "people" | "reasons") => {
    const q = new URLSearchParams();
    if (period !== "180") q.set("period", period);
    if (repParam) q.set("rep", repParam);
    q.set("tab", key);
    if (query.show) q.set("show", show);
    return `/app/retention-scorecard?${q}`;
  };
  const fallbackTabs = team ? (
    <ViewTabs
      label="Scorecard views"
      value={shown}
      tabs={[
        { key: "people" as const, label: "Everyone", count: data.available ? data.cards.length : null, href: tabHref("people") },
        { key: "reasons" as const, label: selected ? `${selected.name}'s save rate` : "Save rate by reason", href: tabHref("reasons") },
      ]}
    />
  ) : undefined;

  return (
    <RetentionPage step="scorecard" title="Scorecard" info={fallbackInfo} tabs={fallbackTabs} actions={data.available ? <span className="inline-flex flex-wrap items-center gap-2">{viewSwitch}</span> : undefined} breadcrumbs={TRAIL}>
      {data.available ? (
        <RetentionScorecardBoard data={data} period={period} selected={repParam ?? null} isOwner={isOwner} viewerId={viewerId} show={show} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint="The retention scorecard needs a database update (20261016200000)." />
        </TableCard>
      )}
    </RetentionPage>
  );
}
