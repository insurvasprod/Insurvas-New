import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await } from "@/components/app/reports/await";
import { CallbackBody, CallbackStrip, CallbackTabs, CallbacksUnavailable, callbackResultsHref, type CallbackTab } from "@/components/app/reports/callback-results-report";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { StreamSection } from "@/components/ui/stream-section";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadCallbackResults } from "@/lib/reports/callbackResults";
import { callbackResults } from "@/lib/reports/callbackResultsCore";
import { showHref, showOf } from "@/lib/reports/show";
import { sharedPeriod } from "@/lib/reports/views";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { defaultScorecardPeriod } from "@/lib/vendorScorecard/service";

const INFO = "Whether booked callbacks were kept, by the day each was due: kept (on a call or marked done), missed, cancelled, and still open. The keep rate is kept of kept and missed; under 5 decided callbacks the two counts show. A missed callback rebooked and then kept counts as kept, after a miss.";

/**
 * Reports › Callbacks kept (owner 2026-11-19: Basic has the callback calendar but no report on it). The calendar's
 * gate and roles (callback_calendar; owner, producer, assistant), the calendar's producer scope (AG-0.5). By person
 * only for a team: a solo agent (an individual plan with no other caller) has no one to compare with, and a producer
 * who is not a manager sees his own callbacks only through his scope. Frame first (§7a): the read starts here and the
 * strip and the view stream in under the title, the rail and the switch.
 */
export default async function CallbackResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("callback_calendar");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Callbacks kept" description="Callbacks booked, kept and missed, week by week." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Callbacks kept" detail="Owners, producers and assistants can review callbacks." />;

  const query = await searchParams;
  const period = sharedPeriod(query) ?? defaultScorecardPeriod();
  const show = showOf(query, "chart");
  const [scope, solo] = await Promise.all([scopeFor(guard.context), isSoloWorkspace(guard.context.tenantId).catch(() => false)]);
  // A team view: not solo, and someone who sees more than their own callbacks (the owner, or a scope of several).
  const team = !solo && (guard.role === "owner" || (scope !== null && scope.length > 1));
  const asked = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: CallbackTab = team && asked === "people" ? "people" : "weeks";
  const tableHref = showHref(callbackResultsHref(tab, period), "table");

  const read = loadCallbackResults(guard.context.tenantId, period, scope)
    .then((loaded) => ({ loaded, results: callbackResults(loaded.facts, period, loaded.names) }))
    .catch((cause) => {
      console.error("[callback results]", cause instanceof Error ? cause.message : cause);
      return null;
    });

  return (
    <ReportsPage view="callbacks" info={INFO} show="chart">
      <CallbackTabs tab={tab} period={period} show={show} team={team} />
      <StreamSection shape="strip">
        <Await read={read}>{(r) => (r?.loaded.available ? <CallbackStrip results={r.results} /> : null)}</Await>
      </StreamSection>
      <StreamSection shape="table">
        <Await read={read}>
          {(r) => (!r
            ? <CallbacksUnavailable period={period} title="Callbacks could not be read" hint="Try again in a moment." />
            : !r.loaded.available
              ? <CallbacksUnavailable period={period} title="This isn't set up yet" hint="The callback calendar's database update has not been applied." />
              : <CallbackBody results={r.results} tab={tab} show={show} period={period} tableHref={tableHref} />)}
        </Await>
      </StreamSection>
    </ReportsPage>
  );
}
