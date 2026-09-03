import { redirect } from "next/navigation";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { PartnerLogoutButton } from "@/components/partner/partner-logout-button";

export default async function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  const roleLabel = context.role === "partner_admin" ? "Partner admin" : "Partner user";
  const statusLabel = { draft: "Draft", active: "Active", paused: "Paused", offboarded: "Offboarded" }[context.partnerStatus];
  const isRestricted = context.partnerStatus !== "active";
  return <div className="min-h-screen bg-[var(--color-page-bg)]"><header className="border-b bg-card shadow-sm"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent-ink)]">Insurvas partner portal</p><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><p className="truncate text-lg font-extrabold tracking-tight">{context.partnerName}</p><span className="text-sm text-muted-foreground">{roleLabel}</span>{isRestricted && <span className="rounded-full border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-warning)]">{statusLabel}</span>}</div></div><PartnerLogoutButton /></div></header><main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main></div>;
}
