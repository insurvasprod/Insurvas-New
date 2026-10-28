"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { SettingsCard, SettingsSectionHeader, SettingsStack, SettingsTableCard } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ViewTabs } from "@/components/ui/view-tabs";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
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

/** A form section: fields in a card, Save on the title's line (through the frame's action slot). */
function BusinessIdentitySample() {
  return (
    <SettingsStack>
      <SettingsSectionHeader actions={<><Button variant="outline" className="h-9" onClick={noop}>Discard</Button><Button className="h-9" onClick={noop}>Save changes</Button></>} />
      <SettingsCard title="Who the business is" sub="The name clients and partners see, and the legal details on your documents.">
        <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
          {[["Trading name", "Power Policies"], ["Legal name", "Unlimited Insurance LLC"], ["National Producer Number", "12312312"], ["Primary state", "Texas"]].map(([label, value]) => (
            <label key={label} className="block">
              <span className="text-label text-[var(--ink)]">{label}</span>
              <Input defaultValue={value} className="mt-1.5 h-9" />
            </label>
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Address and contact" sub="Printed on statements, welcome packs and letters.">
        <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
          {[["Street", "1200 Main St"], ["City", "Dallas"], ["Phone", "(214) 555-0148"], ["Email", "ops@powerpolicies.com"]].map(([label, value]) => (
            <label key={label} className="block">
              <span className="text-label text-[var(--ink)]">{label}</span>
              <Input defaultValue={value} className="mt-1.5 h-9" />
            </label>
          ))}
        </div>
      </SettingsCard>
    </SettingsStack>
  );
}

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

export function SettingsPreview({ role }: { role: TenantRole }) {
  return (
    <AgentSettingsTabs
      tabs={SETTINGS_SECTIONS}
      team={null}
      workspace={null}
      granted={ALL_FEATURES}
      role={role}
      renderPanel={(id) => (id === "business-identity" ? <BusinessIdentitySample /> : id === "carriers" ? <CarriersSample /> : <GenericSample />)}
    />
  );
}
