"use client";

import { Bell, CreditCard } from "lucide-react";

import {
  Callout,
  DashedCard,
  KeyValues,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  btn,
} from "@/components/app/settings/primitives";
import { openAlertSettings } from "@/lib/agentAlerts/openAlertSettings";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";

/**
 * Settings › Alerts and Settings › Billing.
 *
 * Neither is edited here, and both stay in the list anyway: people look for them here, and a tab
 * that vanishes sends them hunting. Each opens a page with the real answer — where the thing lives
 * and who changes it — instead of empty controls. The one it was opened for comes first.
 */
export function ManagedElsewhereSettings({ which, team, workspace }: { which: "alerts" | "billing"; team: TeamSnapshot; workspace: WorkspaceSnapshot }) {
  const alerts = (
    <SettingsGrid key="alerts">
      <DashedCard
        icon={<Bell className="size-4" aria-hidden />}
        title="Alert preferences live in the alert centre"
        action={
          <button type="button" className={btn("primary", "h-9")} onClick={openAlertSettings}>
            Open the alert centre
          </button>
        }
      >
        They are per person, not per workspace: yours are not a teammate&rsquo;s, and an owner setting them for everyone would be
        wrong. The bell in the top bar opens them.
      </DashedCard>
      <SettingsCard title="Why this tab still exists">
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          Because people look for it here. Removing the tab sends them hunting; leaving it with a real answer costs one screen and
          ends the search. The same is true of Billing.
        </p>
      </SettingsCard>
    </SettingsGrid>
  );

  const manual = workspace.billingMode === "manual";
  const seats = team.seats.max === null ? `${team.seats.used}, no limit` : `${team.seats.used} of ${team.seats.max}`;
  const billing = (
    <SettingsGrid key="billing">
      <DashedCard
        icon={<CreditCard className="size-4" aria-hidden />}
        title={manual ? "Billing is managed by your account administrator" : "Billing is not changed from this page"}
        action={
          <a className={btn("secondary", "h-9 no-underline")} href="mailto:support@insurvas.com?subject=Billing">
            {manual ? "Email your administrator" : "Email Insurvas support"}
          </a>
        }
      >
        {manual
          ? "This workspace is billed through Insurvas staff, so invoices, payment methods and plan changes are not editable from inside it."
          : "Plan changes, invoices and payment methods are handled by Insurvas rather than inside the workspace. Support can change them for you."}
      </DashedCard>
      <SettingsCard title="What you can still see">
        <KeyValues
          items={[
            { label: "Plan", value: workspace.planName ?? "—" },
            { label: "Seats", value: seats, tone: team.seats.max !== null && team.seats.used >= team.seats.max ? "warning" : undefined },
            { label: "Renews", value: workspace.renewsAt ? formatDate(workspace.renewsAt) : "—" },
            { label: "Billed to", value: workspace.billingMode === null ? "—" : manual ? "Insurvas staff" : "Automatic billing" },
          ]}
        />
      </SettingsCard>
    </SettingsGrid>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {which === "alerts" ? [alerts, billing] : [billing, alerts]}
      <Callout tone="info" title="A locked tab says why, and who to ask">
        Both tabs stay in the list with a lock instead of disappearing or greying out, and each opens this page with the answer. A
        tooltip is not an answer on a touch screen, and not an answer to a screen reader.
      </Callout>
    </SettingsStack>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
