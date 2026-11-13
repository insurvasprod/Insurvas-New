import { notFound, redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { ScorecardRecord } from "@/components/app/agency/scorecards-board";
import { producerScores } from "@/lib/agency/scorecardStore";
import { scopeFor } from "@/lib/agency/visibility";
import { asShown, byIssued, dayMonth, defaultPeriod, recordHref, SCORECARDS_HREF, teamFigures } from "@/lib/agency/scorecardView";
import { showOf } from "@/lib/reports/show";
import { sharedPeriod } from "@/lib/reports/views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reports round 7 · a producer's scorecard (owner pick 5·4, 2026-11-11; docs/la4/mockups-r7/reports.html#s5-rec): the
 * title is the person, Scorecard · Policies on the title line, ‹ › in the table's order (issued, most first). Holds
 * what left the table — submitted, month 13, the two lead costs — against the team.
 *
 * AG-0.5: a producer opens only his own id (his own is "My scorecard", so he is sent there); a manager only his
 * reports'; anyone else's id is a 404, never a 403, so a record outside the scope is not confirmed to exist.
 */
export default async function ProducerScorecardPage({ params, searchParams }: { params: Promise<{ producerUserId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("producer_scorecards");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer scorecards" description="Who is profitable, not just busy." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producer scorecards" detail="Producers see their own scorecard; the owner, admins, managers and the bookkeeper see the team's." />;
  const [{ producerUserId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(producerUserId)) notFound();
  const scoped = guard.role === "producer" && guard.context.memberRole !== "manager";
  const period = sharedPeriod(query) ?? defaultPeriod();
  if (scoped && producerUserId !== guard.context.userId) notFound();
  if (scoped) redirect(`${SCORECARDS_HREF}?from=${period.from}&to=${period.to}`);
  const scope = await scopeFor(guard.context);
  if (scope !== null && !scope.includes(producerUserId)) notFound();

  const data = await producerScores(guard.context, period, undefined, { scope });
  const ordered = byIssued(asShown(data.rows));
  const at = ordered.findIndex((r) => r.producerUserId === producerUserId);
  if (!data.available || at < 0) notFound();
  const row = ordered[at];
  const before = at > 0 ? ordered[at - 1] : null;
  const after = at < ordered.length - 1 ? ordered[at + 1] : null;

  return (
    <ReportsPage
      view="producers"
      title={row.name}
      show="chart"
      info="One producer's scorecard: what they placed, what came back, and the figures the team table leaves out (what they submitted through Insurvas, month 13 and lead cost per issued and per persisting policy), set against the team."
      facts={`Producer · ${dayMonth(period.from)} – ${dayMonth(period.to)} · ${row.submitted} submitted through Insurvas · ${row.issued} issued in the carriers' files`}
    >
      <ScorecardRecord
        row={row}
        team={teamFigures(ordered, data.minSample)}
        period={period}
        show={showOf(query, "chart")}
        previous={before ? { href: recordHref(before.producerUserId, period), label: before.name } : null}
        next={after ? { href: recordHref(after.producerUserId, period), label: after.name } : null}
        mine={false}
      />
    </ReportsPage>
  );
}
