import { redirect } from "next/navigation";

import { PartnerSidebar, PartnerSidebarFooter } from "@/components/partner/partner-sidebar";
import { PartnerTopBar } from "@/components/partner/partner-top-bar";
import { PortalPageTransition } from "@/components/portal/portal-page-transition";
import { getPartnerSession, resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { partnerRoleLabel } from "@/lib/partnerAuth/roles";
import { readPartnerTopBarIdentity } from "@/lib/partnerAuth/topBarIdentity";

export default async function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  // The signed-in person's name and email are started from the signed session alongside the
  // membership check, so the account menu costs no extra round trip. Nothing renders unless the
  // context resolves.
  const session = await getPartnerSession();
  const [context, identity] = await Promise.all([
    resolvePartnerContext(),
    session ? readPartnerTopBarIdentity(session.sub) : null,
  ]);
  if (!context) redirect("/partner/login");
  const person = context.userId === session?.sub && identity ? identity : await readPartnerTopBarIdentity(context.userId);

  const roleLabel = partnerRoleLabel(context.role);
  const statusLabel = { draft: "Draft", active: "Active", paused: "Paused", offboarded: "Offboarded" }[context.partnerStatus];
  const isRestricted = context.partnerStatus !== "active";

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar
        role={context.role}
        partnerStatus={context.partnerStatus}
        partnerName={context.partnerName}
        footer={<PartnerSidebarFooter />}
      />
      {/* overflow-x-clip, not hidden — `hidden` turns <main> into a scroll container and the sticky
          top bar scrolls away with the page. See the agent shell. */}
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <PartnerTopBar
          user={{
            name: person.name,
            email: person.email,
            roleLabel,
            workspaceName: context.partnerName,
          }}
        />
        {/* No context strip (removed 2026-09-28, as in the agent shell): the organisation and role
            are in the account menu. The one thing it said that a partner must act on — submissions
            are restricted while the organisation is not active — stays, as a banner, only then. */}
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
        {isRestricted && (
          <div role="status" className="mb-4 rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
            Your organization is {statusLabel.toLowerCase()}, so submissions are restricted.
          </div>
        )}
        <PortalPageTransition>{children}</PortalPageTransition>
      </div>
      </main>
    </div>
  );
}
