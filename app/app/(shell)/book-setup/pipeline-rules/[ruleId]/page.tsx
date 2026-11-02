import Link from "next/link";
import { notFound } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { ForecastTable } from "@/components/app/book/setup/forecast-table";
import { PreviewTable } from "@/components/app/book/setup/preview-table";
import { RuleActions } from "@/components/app/book/setup/rule-actions";
import { RuleForm } from "@/components/app/book/setup/rule-form";
import { RuleTabs, type RuleTab } from "@/components/app/book/setup/rule-tabs";
import { ModeChip } from "@/components/app/book/setup/rules-list";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { VersionsTable } from "@/components/app/book/setup/versions-table";
import { Callout } from "@/components/app/settings/primitives";
import { isRecordUuid } from "@/lib/ingestion/path";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRule, previewRule } from "@/lib/pipelineRules/store";

const TABS: RuleTab[] = ["rule", "preview", "forecast", "versions"];

/**
 * Book of business › Setup › Pipeline rules › a rule (boards BobE7, BobE8; was a side sheet): its own page.
 * Rule (the form; a content change saves a new version) · Preview (today's data, nothing written) ·
 * Forecast (the last 7 days of would-moves, marked right or wrong) · Versions. Header: Duplicate, Turn
 * off, Switch to live (asks first; nothing replayed unless ticked).
 */
export default async function PipelineRulePage({ params, searchParams }: { params: Promise<{ ruleId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pipeline rules" description="Rates, carrier rules and pipeline rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Pipeline rules" detail="Setup is for the account owner and bookkeepers." />;
  const [{ ruleId }, { tab: asked }] = await Promise.all([params, searchParams]);
  if (!isRecordUuid(ruleId)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [view, board, carriers] = await Promise.all([loadRule(tenantId, ruleId), loadBoard(tenantId), loadCarrierChoices()]);
  if (!view.available) {
    return <DataInPage step="setup" title="Pipeline rule"><Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE} /></DataInPage>;
  }
  const rule = view.rule;
  if (!rule || !rule.current) notFound();
  const tab: RuleTab = TABS.includes(asked as RuleTab) ? (asked as RuleTab) : "rule";
  const v = rule.current;
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const right = view.forecast.filter((l) => l.checked === "right").length;
  const wrong = view.forecast.filter((l) => l.checked === "wrong");
  const preview = tab === "preview" ? await previewRule(tenantId, { ruleId }) : null;

  return (
    <DataInPage
      step="setup"
      title={rule.name}
      lead={
        <span className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <ModeChip mode={rule.mode} enabled={rule.enabled} />
          <span>{EVENT_LABELS[v.event].label} · {v.carrierIds.length ? v.carrierIds.map((id) => carrierName.get(id) ?? "a carrier").join(", ") : "Every carrier"} · version {rule.currentVersion}{rule.liveSince ? ` · live since ${rule.liveSince.slice(0, 10)}` : ""}</span>
        </span>
      }
      actions={<RuleActions ruleId={rule.id} name={rule.name} mode={rule.mode} enabled={rule.enabled} forecast={{ days: 7, wouldMoves: view.forecast.length, right, wrong: wrong.length }} readOnly={readOnly} />}
    >
      <RuleTabs active={tab} counts={{ forecast: view.forecast.length, versions: view.versions.length }} />
      {tab === "rule" && (
        <RuleForm
          key={v.id}
          ruleId={rule.id}
          readOnly={readOnly}
          board={board}
          carriers={carriers}
          initial={{ name: rule.name, event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate ?? "" }}
        />
      )}
      {tab === "preview" && preview && (preview.available ? (
        <>
          <PreviewTable lines={preview.lines} asOf={preview.asOf} title="Would move, or skipped and why" />
          {preview.carriersWithoutGrace.length > 0 && (v.event === "first_payment_missed" || v.event === "later_payment_missed") && (
            <Callout tone="warning" title={`${preview.carriersWithoutGrace.length} ${preview.carriersWithoutGrace.length === 1 ? "carrier has" : "carriers have"} policies behind but no grace set.`}>
              No missed payment is counted for them until a grace is set. <Link href="/app/book-setup/carrier-rules" className="font-semibold underline">Open Carrier rules</Link>
            </Callout>
          )}
        </>
      ) : <Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE} />)}
      {tab === "forecast" && (
        <>
          {rule.mode === "live" && <Callout tone="info" title="This rule is live: it moves cards. The forecast below is from before it went live." />}
          <ForecastTable lines={view.forecast} readOnly={readOnly} />
          {wrong.length > 0 && (
            <Callout tone="warning" title={`${wrong.length} marked wrong.`}>
              {wrong[0].checkedNote ? `${wrong[0].leadName ?? "A lead"}: ${wrong[0].checkedNote}. ` : ""}A different carrier grace or a narrower from-stage may fix it. <Link href="/app/book-setup/carrier-rules" className="font-semibold underline">Open Carrier rules</Link>
            </Callout>
          )}
        </>
      )}
      {tab === "versions" && <VersionsTable versions={view.versions} current={rule.currentVersion} board={board} carriers={carriers} />}
    </DataInPage>
  );
}
