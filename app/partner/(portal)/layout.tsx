import { redirect } from "next/navigation";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { PartnerLogoutButton } from "@/components/partner/partner-logout-button";

export default async function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  return <div className="min-h-screen bg-[var(--color-page-bg)]"><header className="border-b bg-card"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6"><div><p className="text-sm font-semibold text-[var(--color-blue)]">Insurvas partner portal</p><p className="text-sm text-muted-foreground">{context.partnerName} · {context.role === "partner_admin" ? "Partner admin" : "Partner user"}</p></div><PartnerLogoutButton /></div></header><main className="px-4 py-6 sm:px-6 lg:py-8">{children}</main></div>;
}
