import Link from "next/link";

import { InfoTip } from "@/components/ui/info-tip";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RulesList } from "@/components/app/book/setup/rules-list";
import { BUCKET_LABEL, bucketOf, RULES_HREF, isBucket, RULE_BUCKETS, type RuleBucket } from "@/components/app/book/setup/card-moves-shared";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
import { PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRule, loadRulesList } from "@/lib/pipelineRules/store";

/**
 * Carrier sync › Card moves (owner 2026-11-02; docs/la4/SIMPLIFY-PROPOSAL.md §4, §7): when something happens to a
 * policy, move its card and add a note. No AI. Forecast first (owner decision 3): a rule records what it would do until
 * it is switched to live, rule by rule. Opening it writes nothing.
 *
 * Round 7 (docs/la4/mockups-r7/carrier-sync-setup.html §2, direction A "By mode", owner 2026-11-10: "Build all four"):
 * the modes are the sub-page bar (?mode=), opening on Forecast while a rule waits for a check. The warning callout is
 * gone: its parts became counts where they belong — forecast → the Forecast tab and the "To check" column; held →
 * "1 held" on its rule; capped → a red count on Live and the line on its tab; engine off or read-only → New rule
 * disabled with the reason on hover; none on → the Live tab's empty state.
 */
export default async function SetupPipelineRulesPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Card moves" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Card moves" detail="Setup is for the account owner and bookkeepers." />;
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [{ mode: asked }, view, board, carriers] = await Promise.all([searchParams, loadRulesList(tenantId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);

  // "To check": a forecast rule's would-moves nobody has marked yet, read from the rule's own page loader.
  const forecastRules = view.rules.filter((r) => bucketOf(r) === "forecast" && r.last7.wouldMove > 0);
  const checks = await Promise.all(forecastRules.map((r) => loadRule(tenantId, r.id).then((one) => [r.id, one.forecast.filter((l) => !l.checked).length] as const).catch(() => [r.id, 0] as const)));
  const toCheck = Object.fromEntries(checks);
  const waiting = checks.some(([, n]) => n > 0);
  const bucket: RuleBucket = isBucket(asked) ? asked : waiting ? "forecast" : "all";

  const counts = Object.fromEntries(RULE_BUCKETS.map((b) => [b, b === "all" ? view.rules.length : view.rules.filter((r) => bucketOf(r) === b).length])) as Record<RuleBucket, number>;
  const capped = view.lastRun && view.lastRun.cappedLive > 0 ? view.settings.capPerRun : null;
  const tabs: Array<ViewTab<RuleBucket>> = RULE_BUCKETS.map((b) => ({
    key: b,
    label: BUCKET_LABEL[b],
    count: counts[b],
    tone: (b === "live" && capped !== null) || (b === "forecast" && waiting) ? "danger" : undefined,
    href: b === "all" ? `${RULES_HREF}?mode=all` : `${RULES_HREF}?mode=${b}`,
  }));

  const blocked = !view.available ? PIPELINE_RULES_PENDING_MESSAGE
    : readOnly ? "Book of business is read-only while the account is suspended."
    : !view.settings.engineOn ? "Card moves are switched off for this agency."
    : null;
  const newRule = blocked
    ? <Button type="button" disabled title={blocked}>New rule</Button>
    : <Link href={`${RULES_HREF}/new`} className={buttonVariants()}>New rule</Link>;

  return (
    <DataInPage step="pipeline-rules"
      chip={<InfoTip label="About card-move rules" side="right">What moves a lead&apos;s card when a carrier file says something happened to its policy: issued, paid, lapsed, charged back. A new rule starts in <b>Forecast</b>: it records what it would move and moves nothing. When its forecast looks right, open it and switch it to <b>Live</b>. Rules marked Forecast are the ones to check.</InfoTip>}
      tabs={view.available ? <ViewTabs label="Rules by mode" tabs={tabs} value={bucket} /> : undefined}
      actions={newRule}
    >
      {!view.available ? (
        <TableCard><EmptyState title="Card moves are not ready yet" hint={`${PIPELINE_RULES_PENDING_MESSAGE} Nothing moves before then.`} /></TableCard>
      ) : (
        <RulesList rules={view.rules} bucket={bucket} toCheck={toCheck} board={board} carriers={carriers} capped={capped} canCreate={!blocked} />
      )}
    </DataInPage>
  );
}
