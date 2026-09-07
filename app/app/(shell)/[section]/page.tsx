import { notFound, redirect } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { menuItemById, grantedAndBuilt } from "@/lib/menu/definition";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ComingSoon } from "@/components/app/coming-soon";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

/**
 * Every menu destination that has no screen of its own yet.
 *
 * Twenty-four of the thirty items in the agent menu had no route. Next.js answered all of them with
 * its default 404, so a customer on a plan that grants, say, Quoting and Applications saw a sidebar
 * full of links where most led nowhere. The features were paid for and the product looked broken.
 *
 * This catches them. A static segment always wins over a dynamic one, so the six real screens are
 * untouched and this only ever runs for the rest.
 *
 * The three answers, in the order they are decided:
 *
 *   not in the menu at all   -> 404, and rightly so; it is not a page
 *   in the menu, not granted -> the existing gate notice (upgrade prompt, or outage message)
 *   granted but unbuilt      -> "on the way", which is the case that had no answer before
 *
 * Order matters. Checking the entitlement before the build status means a customer without the
 * plan is told about their plan rather than about our roadmap — they should not learn what we have
 * not finished building for a feature they do not have.
 */
export default async function AgentSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;

  const item = menuItemById(section);
  if (!item) notFound();

  // Built screens have their own route; reaching this file for one means the flag is wrong.
  if (item.built) notFound();

  // An item with no required feature is visible to everyone, so there is nothing to guard.
  if (item.required_feature) {
    const guard = await guardPage(item.required_feature);
    if (!guard.entitled) {
      return <FeatureGateNotice guard={guard} featureLabel={item.label} description={item.blurb} />;
    }
    if (item.required_roles && !item.required_roles.includes(guard.role)) {
      return <RoleGateNotice featureLabel={item.label} detail="Your tenant role does not include this workspace." />;
    }
    return <ComingSoon item={item} available={grantedAndBuilt(guard.entitlement.features, guard.role)} />;
  }

  // No required feature means nothing to gate on, so the entitlement is read only to work out
  // where else this agent can usefully go. Both such items are built today, so this is defensive
  // rather than reachable — but a wrong `built` flag should still land somewhere sensible.
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const entitlement = await getEntitlement(context.tenantId);

  if (item.required_roles && !item.required_roles.includes(context.role)) {
    return <RoleGateNotice featureLabel={item.label} detail="Your tenant role does not include this workspace." />;
  }

  return <ComingSoon item={item} available={grantedAndBuilt(entitlement.features, context.role)} />;
}
