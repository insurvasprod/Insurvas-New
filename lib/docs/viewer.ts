import "server-only";

import { redirect } from "next/navigation";

import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { guideHref, type SetupChecklistStep } from "@/lib/dashboard/checklist";
import { guideMovesFor } from "@/lib/dashboard/guideMoves";
import { loadViewerSetup } from "@/lib/dashboard/setupViewer";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * What Docs needs about the reader: which setup steps are theirs ("Do it in Insurvas"), which are done, how far
 * Ready to sell is, and their Insurvas pages for search (each opening its step's guide).
 */
export async function loadDocsViewer(): Promise<{
  steps: Map<string, SetupChecklistStep & { href: string }>;
  done: Set<string>;
  ready: { done: number; total: number };
  insurvas: { title: string; href: string; meta: string }[];
}> {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const [entitlement, switches] = await Promise.all([getEntitlement(context.tenantId), loadFeatureSwitches()]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const viewer = await loadViewerSetup(context, available, entitlement.limits.max_seats).catch(() => null);
  const list = viewer?.checklist.steps ?? [];
  const required = list.filter((step) => !step.optional);
  return {
    steps: new Map(list.map((step) => [step.key, { ...step, href: guideHref(step) }])),
    done: new Set(list.filter((step) => step.complete).map((step) => step.key)),
    ready: { done: required.filter((step) => step.complete).length, total: required.length },
    insurvas: list.map((step) => ({ title: step.label, href: guideHref(step), meta: `Guide me · ${guideMovesFor(step).length} moves` })),
  };
}
