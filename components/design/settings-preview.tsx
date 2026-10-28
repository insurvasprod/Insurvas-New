"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { SettingsCard, SettingsSectionHeader, SettingsStack, SettingsTableCard } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { PREVIEW_SECTIONS, PREVIEW_TEAM, PREVIEW_WORKSPACE, type PreviewState } from "@/lib/settings/preview/fixtures";
import { setPreviewState } from "@/components/design/preview-fetch";
import type { TenantRole } from "@/lib/tenantAuth/roles";

/** Every feature a Settings section can ask for, so the preview shows the whole menu for an owner. */
const ALL_FEATURES = ["applications", "appointment_vault", "book_of_business", "chargeback_radar", "lead_import", "outbound_dialing", "profit_and_loss", "tcpa_checker"];

const CARRIERS = [
  { name: "Mutual of Omaha", level: "110%", states: "AL, GA, TX", status: "Ready to sell" },
  { name: "Aetna / CVS", level: "100%", states: "AL, DE", status: "Ready to sell" },
  { name: "Americo", level: "115%", states: "50 states", status: "Ready to sell" },
  { name: "Foresters", level: "—", states: "None yet", status: "Needs states" },
];

/** Sample buttons do nothing: the preview shows where they sit, not what they save. */
const noop = () => undefined;

/** A table section: local tabs, then the list, "Add carrier" on the title's line. */
function CarriersSample() {
  const [tab, setTab] = useState<"carriers" | "states">("carriers");
  return (
    <SettingsStack>
      <SettingsSectionHeader actions={<Button className="h-9" onClick={noop}><Plus aria-hidden="true" />Add carrier</Button>} />
      <ViewTabs label="Carriers" tabs={[{ key: "carriers", label: "Your carriers", count: 4 }, { key: "states", label: "States", count: 10 }]} value={tab} onChange={setTab} />
      <SettingsTableCard title="Your carriers">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {["Carrier", "Contract level", "Appointed states", "Status"].map((head) => <th key={head} className="px-4 py-2.5 font-medium">{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {CARRIERS.map((row) => (
              <tr key={row.name} className="border-t border-border">
                <td className="px-4 py-3 font-semibold text-foreground">{row.name}</td>
                <td className="px-4 py-3 tabular-nums">{row.level}</td>
                <td className="px-4 py-3">{row.states}</td>
                <td className="px-4 py-3">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsTableCard>
    </SettingsStack>
  );
}

function GenericSample() {
  return (
    <SettingsStack>
      <SettingsSectionHeader />
      <SettingsCard title="Sample card" sub="This section's real content renders here on :3000.">
        <p className="m-0 text-sm text-muted-foreground">The frame, header, breadcrumb and menu are the real components.</p>
      </SettingsCard>
    </SettingsStack>
  );
}

/**
 * `routeSection`: a section with its own route (Accounting…), drawn in the frame with a sample board.
 * `state`: what the preview's API answers (loaded, empty, error) or a read-only account (R1).
 */
export function SettingsPreview({ role, routeSection, state = "loaded" }: { role: TenantRole; routeSection?: string; state?: PreviewState }) {
  // Before the panels mount: they fetch in their first effect.
  setPreviewState(state);
  return (
    <AgentSettingsTabs
      routeSection={routeSection}
      readOnly={state === "readonly"}
      tabs={SETTINGS_SECTIONS}
      // Team & access is handed its data by the server; the preview hands it a sample.
      team={role === "owner" ? PREVIEW_TEAM : null}
      workspace={role === "owner" ? PREVIEW_WORKSPACE : null}
      granted={ALL_FEATURES}
      role={role}
      // Sections with fixtures render their real panel; the rest keep a sample.
      renderPanel={(id) => (PREVIEW_SECTIONS.has(id) ? undefined : id === "carriers" ? <CarriersSample /> : <GenericSample />)}
    >
      {routeSection ? <SettingsCard title="Sample board" sub="The module's own board renders here on :3000, inside the same frame." /> : null}
    </AgentSettingsTabs>
  );
}
