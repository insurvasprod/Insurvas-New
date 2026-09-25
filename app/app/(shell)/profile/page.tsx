import { redirect } from "next/navigation";

import { OwnProfileForm } from "@/components/app/own-profile-form";
import { ErrorState } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { readOwnProfile } from "@/lib/users/ownProfileService";

/**
 * Your profile — the account menu's first row: "Name, phone, licence numbers".
 *
 * The person's own record, not the agency's: the agency profile, its licences and its calling
 * rules stay in Settings, which the owner runs. Every role can open this page.
 */
export default async function OwnProfilePage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const profile = await readOwnProfile(context).catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Your account"
        title="Your profile"
        description="How you appear to your team and partners in this workspace, and the producer numbers you sell under."
      />
      {profile
        ? <OwnProfileForm initial={profile} />
        : <ErrorState detail="Your profile could not be loaded. Nothing has changed; reload the page to try again." />}
    </div>
  );
}
