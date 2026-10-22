import { redirect } from "next/navigation";

import { OwnProfileForm } from "@/components/app/own-profile-form";
import { SecuritySettings } from "@/components/app/profile/security-settings";
import { SettingsHistory } from "@/components/app/settings/settings-history";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { ErrorState } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTrail } from "@/components/app/settings/settings-trail";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { readOwnProfile } from "@/lib/users/ownProfileService";

/**
 * Your profile — the account menu's first row: "Name, phone, licence numbers" — and, since LA-8.2,
 * sign-in and security: email, password, two-factor, sessions and the security log.
 *
 * The person's own record, not the agency's: the agency profile, its licences and its calling
 * rules stay in Settings, which the owner runs. Every role can open this page.
 */
export default async function OwnProfilePage({ searchParams }: { searchParams: Promise<{ two_factor?: string }> }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const [profile, timeZone, params] = await Promise.all([readOwnProfile(context).catch(() => null), getViewerTimezone(context.tenantId, context.userId), searchParams]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsTrail label="My profile" />
      <PageHeader title="Your profile" />
      {profile
        ? <OwnProfileForm initial={profile} />
        : <ErrorState detail="Your profile could not be loaded. Nothing has changed; reload the page to try again." />}
      {profile ? <SecuritySettings email={profile.email} timeZone={timeZone} promptTwoFactor={params.two_factor === "required"} /> : null}
      {/* LA-8.8: your own slice of the settings history — anyone may read what they changed. */}
      {profile ? <SettingsHistory mine /> : null}
    </div>
  );
}
