"use client";

import type { ReactNode } from "react";
import { CarriersSettings } from "@/components/app/settings/carriers-settings";
import { DispositionSettings } from "@/components/app/disposition-settings";
import { PipelineSettings } from "@/components/app/pipeline-settings";
import { QueueSlaSettings } from "@/components/app/queue-sla-settings";
import { CalendarAvailabilitySettings } from "@/components/app/calendar-availability-settings";
import { CadenceSettings } from "@/components/app/cadence-settings";
import { CallingWindowSettingsPanel } from "@/components/app/calling-window-settings";
import { LeadPostKeysSettings } from "@/components/app/lead-post-keys-settings";
import { TeamSettings } from "@/components/app/team-settings";
import { TemplateSettings } from "@/components/app/template-settings";
import { BillingSettings } from "@/components/app/settings/billing-settings";
import { BusinessIdentitySettings } from "@/components/app/settings/business-identity";
import { NotificationPreferences } from "@/components/app/settings/notification-preferences";
import { IntegrationsSettings } from "@/components/app/settings/integrations";
import { SettingsHistory } from "@/components/app/settings/settings-history";
import {
  SalesAiAssistant, SalesCarriersSettings, SalesDisclosures, SalesExtension, SalesFieldMaps, SalesFieldSets,
  SalesPipelineSync, SalesQaPreferences, SalesQuotationTemplates, SalesUnderwritingTemplates, SalesWelcomePack,
} from "@/components/app/settings/sales";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";

/**
 * Which component draws each in-page settings section (UX-4). Keyed by the section ids in
 * `lib/settings/sections.ts`, which owns the rail's order, labels and groups.
 *
 * Adding an in-page section is one entry there and one entry here; a section that lives on its own
 * module's screen (`route`) is one entry there and none here. `lib/settings/panels.test.mjs` fails
 * when a section has no panel (it would render "not available") or a panel has no section (it would
 * be unreachable — the defect the calendar and cadence editors once shipped with).
 */
/**
 * The team and workspace snapshots are read for an owner only (LA-8.1 opened Settings to every role,
 * and only owner sections draw from them); a panel that needs one and is handed null draws nothing.
 */
export type SettingsPanelContext = { team: TeamSnapshot | null; workspace: WorkspaceSnapshot | null };

export const SETTINGS_PANELS: Record<string, (context: SettingsPanelContext) => ReactNode> = {
  "business-identity": ({ team, workspace }) => <BusinessIdentitySettings team={team} workspace={workspace} />,
  carriers: () => <CarriersSettings />,
  "team-access": ({ team, workspace }) => (team && workspace ? <TeamSettings initial={team} workspace={workspace} /> : null),
  calendar: () => <CalendarAvailabilitySettings />,
  cadence: () => <CadenceSettings />,
  "calling-windows": () => <CallingWindowSettingsPanel />,
  "queue-sla": () => <QueueSlaSettings />,
  "lead-posting": () => <LeadPostKeysSettings />,
  pipelines: () => <PipelineSettings />,
  dispositions: () => <DispositionSettings />,
  "form-templates": () => <TemplateSettings />,
  "sales-carriers": () => <SalesCarriersSettings />,
  "sales-underwriting": () => <SalesUnderwritingTemplates />,
  "sales-quotation": () => <SalesQuotationTemplates />,
  "sales-field-sets": () => <SalesFieldSets />,
  "sales-field-maps": () => <SalesFieldMaps />,
  "sales-disclosures": () => <SalesDisclosures />,
  "sales-preferences": () => <SalesQaPreferences />,
  "sales-welcome-pack": () => <SalesWelcomePack />,
  "sales-pipeline-sync": () => <SalesPipelineSync />,
  "sales-ai": () => <SalesAiAssistant />,
  "sales-extension": () => <SalesExtension />,
  alerts: () => <NotificationPreferences />,
  integrations: () => <IntegrationsSettings />,
  "settings-history": () => <SettingsHistory />,
  billing: () => <BillingSettings />,
};
