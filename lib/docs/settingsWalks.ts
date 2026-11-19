import type { DocTaskStep } from "./tasks.ts";
import { WALKS as accountAgency } from "./settingsWalks/account-agency.ts";
import { WALKS as leadsIntegrations } from "./settingsWalks/leads-integrations.ts";
import { WALKS as moneyCompliance } from "./settingsWalks/money-compliance.ts";
import { WALKS as sellingRecords } from "./settingsWalks/selling-records.ts";

/**
 * Settings, walked through on the real screens (owner 2026-11-17: "the same as you have done for leads… with
 * screenshots… what you need to do, why you're doing it"). One walk per Settings page (by its lib/docs/settingsDocs.ts
 * slug): what you'll get done there, then its steps in screen order. Each step says what to do (`say`, with the
 * screen's own label) and why it matters (`detail`), and lights its control (`find`, read by
 * scripts/docs-task-shots.mjs --settings). `then: "open"` steps are clicked when photographed: they only open a tab,
 * sheet or menu, never save. The first step opens the page itself; `at` moves to another address.
 */
export type SettingsWalk = {
  /** One sentence: what you'll have done by the end. */
  outcome: string;
  /** Minutes it takes, roughly, the first time. */
  minutes: number;
  steps: DocTaskStep[];
};

export const SETTINGS_WALKS: Record<string, SettingsWalk> = { ...accountAgency, ...sellingRecords, ...leadsIntegrations, ...moneyCompliance };

export function settingsWalk(slug: string): SettingsWalk | undefined {
  return SETTINGS_WALKS[slug];
}
