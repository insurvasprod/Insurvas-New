"use client";

import type { ReactNode } from "react";
import { AgentSettingsOverview } from "@/components/app/agent-settings-overview";
import { AppointmentVaultSettings } from "@/components/app/appointment-vault-settings";
import { CarrierLibrarySettings } from "@/components/app/carrier-library-settings";
import { DispositionSettings } from "@/components/app/disposition-settings";
import { PipelineSettings } from "@/components/app/pipeline-settings";
import { QueueSlaSettings } from "@/components/app/queue-sla-settings";
import { CalendarAvailabilitySettings } from "@/components/app/calendar-availability-settings";
import { CadenceSettings } from "@/components/app/cadence-settings";
import { CallingWindowSettingsPanel } from "@/components/app/calling-window-settings";
import { LeadPostKeysSettings } from "@/components/app/lead-post-keys-settings";
import { TeamSettings } from "@/components/app/team-settings";
import { TemplateSettings } from "@/components/app/template-settings";
import { ManagedElsewhereSettings } from "@/components/app/settings/managed-settings";
import {
  SalesAiAssistant, SalesCarriersSettings, SalesDisclosures, SalesExtension, SalesFieldMaps, SalesFieldSets,
  SalesPipelineSync, SalesQaPreferences, SalesQuotationTemplates, SalesUnderwritingTemplates, SalesWelcomePack,
} from "@/components/app/settings/sales";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";

/**
 * Which component draws each settings section (UX-4). Keyed by the section ids in
 * `lib/settings/sections.ts`, which owns the rail's order, labels and groups.
 *
 * Adding a section is one entry there and one entry here. `lib/settings/panels.test.mjs` fails
 * when a section has no panel (it would render "not available") or a panel has no section (it would
 * be unreachable — the defect the calendar and cadence editors once shipped with).
 */
export type SettingsPanelContext = { team: TeamSnapshot; workspace: WorkspaceSnapshot };

export const SETTINGS_PANELS: Record<string, (context: SettingsPanelContext) => ReactNode> = {
  "agency-profile": ({ team, workspace }) => <AgentSettingsOverview team={team} workspace={workspace} />,
  "carrier-library": () => <CarrierLibrarySettings />,
  "states-licences": () => <AppointmentVaultSettings inSettings />,
  "team-access": ({ team, workspace }) => <TeamSettings initial={team} workspace={workspace} />,
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
  alerts: () => <ManagedElsewhereSettings which="alerts" />,
  billing: () => <ManagedElsewhereSettings which="billing" />,
};
