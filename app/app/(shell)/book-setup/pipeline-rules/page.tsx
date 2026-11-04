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
  const [view, board, carriers] = await Promise.all([loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);
  const on = view.rules.filter((r) => r.enabled && r.mode !== "draft");
  const forecast = on.filter((r) => r.mode === "forecast");
  const live = on.filter((r) => r.mode === "live");
  const capped = view.lastRun && view.lastRun.cappedLive > 0 ? view.lastRun : null;
  const newRule = !view.available || readOnly
    ? <Button type="button" disabled title={readOnly ? "Book of business is read-only while the account is suspended." : PIPELINE_RULES_PENDING_MESSAGE}>New rule</Button>
    : <Link href="/app/book-setup/pipeline-rules/new" className={buttonVariants()}>New rule</Link>;

  // Round 3 (docs/la4/POLISH-ROUND3.md): what used to be up to five stacked callouts, as one summary line,
  // most urgent first — capped, held, switched off, read-only, in forecast, none on — each part a link
  // where there is a page to open.
  const rulePage = (id: string, tab?: string) => `/app/book-setup/pipeline-rules/${id}${tab ? `?tab=${tab}` : ""}`;
  const parts: Array<{ key: string; text: string; href?: string }> = [
    ...(capped ? [{ key: "capped", text: `${capped.moved + capped.cappedLive} moves in one run stopped at ${view.settings.capPerRun}: look before the rest move`, href: live[0] ? rulePage(live[0].id) : undefined }] : []),
    ...(view.openHolds > 0 ? [{ key: "held", text: `${view.openHolds} ${view.openHolds === 1 ? "card" : "cards"} held: two rules disagree`, href: "/app/needs-you?view=agency" }] : []),
    ...(!view.settings.engineOn ? [{ key: "off", text: "Pipeline rules are switched off for this agency" }] : []),
    ...(readOnly ? [{ key: "read-only", text: "Read-only while the account is suspended" }] : []),
    ...(forecast.length > 0 ? [{ key: "forecast", text: `${forecast.length} ${forecast.length === 1 ? "rule" : "rules"} in forecast, moving nothing until switched to live`, href: rulePage(forecast[0].id, "forecast") }] : []),
    ...(view.rules.length > 0 && live.length === 0 && forecast.length === 0 ? [{ key: "none-on", text: "No rule is on, so no card moves", href: rulePage(view.rules[0].id) }] : []),
  ];
  const summary = parts.length > 0 && (
    <Callout
      tone={capped ? "error" : "warning"}
      title={parts.map((part, index) => (
        <span key={part.key}>
          {index > 0 && " · "}
          {part.href ? <Link href={part.href} className="underline underline-offset-2">{part.text}</Link> : part.text}
        </span>
      ))}
    />
  );

  return (
    <DataInPage step="setup" lead={<SetupTabs active="pipeline-rules" tenantId={tenantId} />} actions={newRule}>
      {!view.available ? (
        <Callout tone="warning" title={`${PIPELINE_RULES_PENDING_MESSAGE} Nothing moves before then.`} />
      ) : (
        <>
          {summary}
          <RulesList rules={view.rules} board={board} carriers={carriers} />
        </>
      )}
    </DataInPage>
  );
}
