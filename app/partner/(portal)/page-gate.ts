import "server-only";
import { redirect } from "next/navigation";

import { partnerMayOpen, resolvePartnerContext, type PartnerContext } from "@/lib/partnerAuth/requirePartner";
import type { PartnerPortalPage } from "@/lib/partnerAuth/portalAccess";

/**
 * The signed-in partner, for a page that belongs to `page`. Signed out goes to the login; a page the
 * partner's type or role does not get (lib/partnerAuth/portalAccess.ts) goes home — the same rule the
 * menu draws and the API routes enforce.
 */
export async function partnerPageContext(page: PartnerPortalPage): Promise<PartnerContext> {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  if (!(await partnerMayOpen(context, page))) redirect("/partner");
  return context;
}
