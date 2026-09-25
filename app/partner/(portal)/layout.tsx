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
        {/* The board's context strip: who you are here on the left, what that means on the right. It
            replaces a card that repeated the organisation name in 20px above every page title. */}
        <div className="portal-context-strip" aria-label="Current workspace">
          <span>{context.partnerName} · {roleLabel}</span>
          <span className="portal-context-chips">
            <span className={`portal-status-chip ${isRestricted ? "is-warning" : "is-success"}`}><span aria-hidden="true" />{statusLabel}</span>
            {isRestricted && <span className="portal-status-chip is-warning">Submissions restricted</span>}
            <span className="portal-status-chip">Only your organization’s records are visible</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
        <PortalPageTransition>{children}</PortalPageTransition>
      </div>
      </main>
    </div>
  );
}
