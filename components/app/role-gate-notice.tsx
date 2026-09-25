import { UserLock } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getEntitlement } from "@/lib/entitlements/get";
import { allMenuItems } from "@/lib/menu/definition";
import { roleReach } from "@/lib/menu/roleReach";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";

/**
 * Shown when a page is closed to someone because of their ROLE rather than their plan (LA-0.2),
 * as p-gate-role draws it.
 *
 * The distinction matters, and the sibling component says why: an unentitled feature is something
 * the account could buy, so `FeatureGateNotice` offers an upgrade. A role gate is not for sale —
 * nothing this person does alone will open it, and pointing them at /pricing would be a lie.
 *
 * So: name the thing, say which role they are signed in as and that a role is the reason, name
 * **who** can change it and give a way to ask them, show what their role does reach, and always
 * leave a way out. It deliberately does not link to Settings → Team: the roles that land here
 * cannot open Settings either, and a link that gates a second time is worse than no link.
 *
 * Every fact is read here rather than passed in, so the twenty-seven pages that call this keep
 * their one-line call and still get the full notice.
 */
function withArticle(label: string) {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

async function agencyFacts(tenantId: string) {
  const db = getSupabaseServiceClient();
  const [tenant, owners] = await Promise.all([
    db.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string }>(),
    db.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("role", "owner").limit(1),
  ]);
  const ownerId = (owners.data?.[0] as { user_id?: string } | undefined)?.user_id;
  const owner = ownerId ? await db.from("users").select("email").eq("id", ownerId).maybeSingle<{ email: string }>() : null;
  return { agencyName: tenant.data?.name ?? null, ownerEmail: owner?.data?.email ?? null };
}

export async function RoleGateNotice({
  featureLabel,
  detail,
  eyebrow,
}: {
  featureLabel: string;
  detail: string;
  /** The menu section the closed page belongs to, when the caller knows it. */
  eyebrow?: string;
}) {
  const context = await resolveTenantContext();
  const role: TenantRole | null = context?.role ?? null;
  const menu = allMenuItems();
  const closed = menu.find((item) => item.label.toLowerCase() === featureLabel.toLowerCase());
  const [facts, entitlement] = context
    ? await Promise.all([agencyFacts(context.tenantId).catch(() => ({ agencyName: null, ownerEmail: null })), getEntitlement(context.tenantId).catch(() => null)])
    : [{ agencyName: null, ownerEmail: null }, null];
  // Only say the agency has it when the plan really grants it; otherwise say only who can help.
  const agencyHasIt = Boolean(closed?.required_feature && entitlement?.features.includes(closed.required_feature));
  const reach = role ? roleReach(menu, role, featureLabel) : null;
  const roleLabel = role ? TENANT_ROLE_LABELS[role].toLowerCase() : null;
  const otherLabel = reach ? TENANT_ROLE_LABELS[reach.otherRole as TenantRole] ?? reach.otherRole : null;
  const askHref = facts.ownerEmail
    ? `mailto:${facts.ownerEmail}?subject=${encodeURIComponent(`Access to ${featureLabel} in Insurvas`)}&body=${encodeURIComponent(`Hi,\n\nI'm signed in to Insurvas as ${roleLabel ? withArticle(roleLabel) : "a team member"}, and ${featureLabel} is closed to my role. Could you change my role if I should have it?\n`)}`
    : null;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader eyebrow={eyebrow} title={featureLabel} />

      <div className="flex min-h-0 flex-grow items-center justify-center">
        <div className="portal-gate-card">
          <div className="portal-gate-lead">
            <span className="portal-gate-icon is-info">
              <UserLock className="size-6" aria-hidden="true" />
            </span>
            <h2>Your role does not include {featureLabel}</h2>
            <p>
              {roleLabel && <>You are signed in as {withArticle(roleLabel).split(" ")[0]} <strong>{roleLabel}</strong>. </>}
              {detail}
            </p>
            <p>
              This is not a plan limit.{" "}
              {agencyHasIt && facts.agencyName
                ? `${facts.agencyName} has ${featureLabel}, and your owner can change your role if this is wrong.`
                : `Your ${facts.agencyName ? `owner at ${facts.agencyName}` : "account owner"} can change your role if this is wrong.`}
            </p>
            <div className="portal-gate-actions">
              <Button asChild>
                <Link href="/app/dashboard">Back to your dashboard</Link>
              </Button>
              {askHref && (
                <Button asChild variant="outline">
                  <a href={askHref}>Ask your owner</a>
                </Button>
              )}
            </div>
          </div>

          {reach && roleLabel && otherLabel && (
            <section className="portal-gate-reach" aria-labelledby="gate-reach-heading">
              <h2 id="gate-reach-heading">What {withArticle(roleLabel)} can reach</h2>
              <table>
                <thead><tr><th scope="col">Area</th><th scope="col">{TENANT_ROLE_LABELS[role!]}</th><th scope="col">{otherLabel}</th></tr></thead>
                <tbody>
                  {reach.rows.map((row) => (
                    <tr key={row.area} className={row.current ? "is-current" : undefined}>
                      <th scope="row">{row.area}</th>
                      <td>{row.viewer ? "Yes" : "No"}</td>
                      <td>{row.other ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
