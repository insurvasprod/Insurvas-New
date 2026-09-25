import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { resolveTenantSuspended } from "@/lib/tenantAuth/requireTenant";
import { TENANT_SUSPENDED_MESSAGE } from "@/lib/tenants/suspension";
import { AuthCard, AuthPage } from "@/components/app/auth-card";
import { LogoutButton } from "@/components/app/logout-button";

export const metadata: Metadata = { title: "Account suspended · Insurvas" };
export const dynamic = "force-dynamic";

/**
 * Where a person lands when their agency has been suspended by Insurvas staff (decision 4).
 *
 * OUTSIDE the (shell) group on purpose: the shell is what refuses them, so a screen inside it would
 * be refused too. Shows nothing from the workspace — not its name, not a count, not a menu — only
 * the sentence and a way to sign out, so another person can use this browser.
 */
export default async function TenantSuspendedPage() {
  // Anyone who is not in a suspended agency has no business here: back to where they belong.
  if (!(await resolveTenantSuspended())) redirect("/app/login");

  return (
    <AuthPage>
      <AuthCard width={640} eyebrow="Account suspended" title="You can't sign in right now" description={TENANT_SUSPENDED_MESSAGE}>
        <p className="mt-4 text-center text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
          Your data is kept as it was. Once the agency is reinstated, you can sign in again with the same email and password.
        </p>
        <div className="mt-6 flex justify-center">
          <LogoutButton
            variant="link"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-ink)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </AuthCard>
    </AuthPage>
  );
}
