import { forbidden, redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationCenter } from "@/lib/configuration/sections";

/**
 * Shared shell for the hub and every section route.
 *
 * Deliberately thin. It used to render a "Recently changed" strip of ten audit cards and a second
 * vertical nav rail above and beside EVERY section — roughly a quarter of the viewport spent on
 * things you did not come to the page for, plus 250px of navigation duplicating the sidebar two
 * inches away. Both moved: the audit summary appears once, at the foot of the hub, and the section
 * switcher is a dropdown in each section's breadcrumb, which gives the content the full width.
 *
 * A future section is still a registry entry plus a route implementation; nothing here changes.
 */
export default async function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationCenter(admin.role)) forbidden();

  return <div className="mx-auto max-w-7xl">{children}</div>;
}
