import { csvCell } from "../csv/cell.ts";

/**
 * LA-8.8 (Notion sprint, Module 8 — Settings) · the settings audit log's shared shapes. No
 * `server-only`: the history screen, the "last changed" line and the CSV builder all use these.
 */

export const SETTINGS_CHANGE_TYPES = ["create", "update", "delete", "reset_to_default"] as const;
export type SettingsChangeType = (typeof SETTINGS_CHANGE_TYPES)[number];

export const CHANGE_TYPE_LABEL: Record<SettingsChangeType, string> = {
  create: "Set",
  update: "Changed",
  delete: "Removed",
  reset_to_default: "Back to default",
};

/**
 * The hubs that write the log, by the section key they write — LA-8.1's registry id where the hub
 * has a section. Retention (LA-5.11) has no settings screen yet, so its rows have nowhere to link.
 */
export const AUDITED_SECTIONS: ReadonlyArray<{ key: string; label: string; module: string }> = [
  { key: "accounting", label: "Accounting", module: "LA-7.9" },
  { key: "compliance", label: "Compliance", module: "LA-6.8" },
  { key: "retention", label: "Retention", module: "LA-5.11" },
  { key: "sales-preferences", label: "Sales: quote & QA rules", module: "LA-3.17" },
  { key: "sales-carriers", label: "Sales: carriers and products", module: "LA-3.17" },
  { key: "carrier-rules", label: "Carrier rules", module: "LA-4.17" },
  // Recorded by their routes through lib/settingsAudit/record.ts (owner decision 2026-10-15).
  { key: "business-identity", label: "Business identity", module: "LA-8.3" },
  { key: "team-access", label: "Team & access", module: "LA-8.6" },
  { key: "billing", label: "Plan & billing", module: "LA-8.5" },
  { key: "integrations", label: "API keys & webhooks", module: "LA-8.7" },
  { key: "calling-windows", label: "Calling windows", module: "LA-2.4" },
  { key: "pipelines", label: "Pipelines", module: "LA-1.20" },
  { key: "dispositions", label: "Dispositions", module: "LA-2.9" },
  { key: "sales-pipeline-sync", label: "Application stages", module: "LA-3.23" },
];

export type SettingsAuditEntry = {
  id: string;
  sectionKey: string;
  settingKey: string;
  settingLabel: string;
  oldValue: string | null;
  newValue: string | null;
  changeType: SettingsChangeType;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  occurredAt: string;
  source: "ui" | "api" | "system" | "migration";
  reason: string | null;
};

export type SettingsAuditFilter = {
  section?: string | null;
  actor?: string | null;
  changeType?: SettingsChangeType | null;
  from?: string | null;
  to?: string | null;
};

export const sectionLabel = (key: string) => AUDITED_SECTIONS.find((s) => s.key === key)?.label ?? key;

/** "50 → 75", "(none) → overhead". */
export function changeLine(entry: Pick<SettingsAuditEntry, "oldValue" | "newValue">): string {
  return `${entry.oldValue ?? "(none)"} → ${entry.newValue ?? "(none)"}`;
}

/** "Umar Masood (owner)"; a backfilled row says the role was not recorded. */
export function actorLine(entry: Pick<SettingsAuditEntry, "actorName" | "actorRole" | "source">): string {
  const who = entry.actorName ?? (entry.source === "system" ? "Insurvas" : "Someone no longer on the team");
  return entry.actorRole ? `${who} (${entry.actorRole})` : who;
}

/** The CSV of exactly the rows given — the filtered set the screen shows. Cells go through the shared, formula-guarded csvCell. */
export function settingsAuditCsv(entries: readonly SettingsAuditEntry[]): string {
  const head = ["When (UTC)", "Section", "Setting", "From", "To", "Change", "Changed by", "Role then", "Source", "Reason"];
  const lines = entries.map((e) => [e.occurredAt, sectionLabel(e.sectionKey), e.settingLabel, e.oldValue, e.newValue, CHANGE_TYPE_LABEL[e.changeType], e.actorName, e.actorRole, e.source, e.reason].map(csvCell).join(","));
  return [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
