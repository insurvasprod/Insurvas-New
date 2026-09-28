"use client";

import { Bell, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { openAlertSettings } from "@/lib/agentAlerts/openAlertSettings";

/**
 * Settings › Alerts and Settings › Billing: neither is edited here. The tab's one line (its
 * description, set in AgentSettingsTabs) says where the thing lives, and the one button goes there.
 */
export function ManagedElsewhereSettings({ which }: { which: "alerts" | "billing" }) {
  return (
    <SettingsStack>
      <SettingsSectionHeader
        actions={
          which === "alerts" ? (
            <Button type="button" onClick={openAlertSettings}>
              <Bell aria-hidden="true" />
              Open alert preferences
            </Button>
          ) : (
            <Button asChild variant="outline">
              <a href="mailto:support@insurvas.com?subject=Billing">
                <Mail aria-hidden="true" />
                Contact support
              </a>
            </Button>
          )
        }
      />
    </SettingsStack>
  );
}
