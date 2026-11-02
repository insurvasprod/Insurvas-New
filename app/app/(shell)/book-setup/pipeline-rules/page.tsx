import Link from "next/link";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RulesList } from "@/components/app/book/setup/rules-list";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { SetupTabs } from "@/components/app/book/setup/setup-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { Button, buttonVariants } from "@/components/ui/button";
import { PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRulesList } from "@/lib/pipelineRules/store";

/**
 * Book of business › Setup › Pipeline rules (owner 2026-11-02; docs/la4/SIMPLIFY-PROPOSAL.md §4, §7):
 * when something happens to a policy, move its card and add a note. No AI. Forecast first (owner decision
 * 3): a rule records what it would do until it is switched to live, rule by rule. Opening it writes nothing.
 */
export default async function SetupPipelineRulesPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pipeline rules" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Pipeline rules" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [view, board, carriers] = await Promise.all([loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices()]);
  const on = view.rules.filter((r) => r.enabled && r.mode !== "draft");
  const forecast = on.filter((r) => r.mode === "forecast");
  const live = on.filter((r) => r.mode === "live");
  const capped = view.lastRun && view.lastRun.cappedLive > 0 ? view.lastRun : null;
  const newRule = !view.available || readOnly
    ? <Button type="button" disabled title={readOnly ? "Book of business is read-only while the account is suspended." : PIPELINE_RULES_PENDING_MESSAGE}>New rule</Button>
    : <Link href="/app/book-setup/pipeline-rules/new" className={buttonVariants()}>New rule</Link>;

  return (
    <DataInPage step="setup" lead={<SetupTabs active="pipeline-rules" />} actions={newRule}>
      {!view.available ? (
        <Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE}>The rules can be written once the database update is in; nothing moves before then.</Callout>
      ) : (
        <>
          {readOnly && <Callout tone="warning" title="Book of business is read-only while the account is suspended." />}
          {capped && (
            <Callout tone="error" title={`${capped.moved + capped.cappedLive} moves in one run stopped at ${view.settings.capPerRun}.`}>
              Look before the rest move: open each live rule&apos;s page. The rest move in the next run.
            </Callout>
          )}
          {view.openHolds > 0 && (
            <Callout tone="warning" title={`${view.openHolds} ${view.openHolds === 1 ? "card is" : "cards are"} held: two rules disagree.`}>
              Nothing moves until a person picks. <Link href="/app/needs-you" className="font-semibold underline">Open Needs you</Link>
            </Callout>
          )}
          {forecast.length > 0 && (
            <Callout tone="warning" title={`${forecast.length} ${forecast.length === 1 ? "rule is" : "rules are"} in forecast.`}>
              They record what they would do, and move nothing until you switch each one to live.{" "}
              <Link href={`/app/book-setup/pipeline-rules/${forecast[0].id}?tab=forecast`} className="font-semibold underline">See the forecast</Link>
            </Callout>
          )}
          {view.rules.length > 0 && live.length === 0 && forecast.length === 0 && (
            <Callout tone="info" title="No rule is on, so no card moves." />
          )}
          {!view.settings.engineOn && <Callout tone="warning" title="Pipeline rules are switched off for this agency." />}
          <RulesList rules={view.rules} board={board} carriers={carriers} />
        </>
      )}
    </DataInPage>
  );
}
