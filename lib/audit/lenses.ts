// The audit log's lenses (admin round 1, docs/design/admin-r1/monitoring.html screen 5): All · Money · Staff & access ·
// Catalog, in the address as `?lens=`. Client-safe and relative-import only, so the table, the server read and node:test
// share one answer to "which actions does this lens hold".
//
// Matched by rule rather than listed, so an action added to lib/audit/actions.ts joins its lens the day it is added:
//   - Money is the Money actions tile's own rule (lib/audit/moneyActions.ts), so the lens and the tile count the same rows.
//   - Staff & access is staff accounts, sign-ins and lockouts, and every user's access (sessions, passwords, 2FA, status).
//   - Catalog is the Admin › Catalog families, the same prefixes lib/adminCatalog/audit.ts maps to its steps.

import { isMoneyAction } from "./moneyActions.ts";

export type AuditLens = "all" | "money" | "access" | "catalog";

export const AUDIT_LENSES: ReadonlyArray<{ key: AuditLens; label: string }> = [
  { key: "all", label: "All" },
  { key: "money", label: "Money" },
  { key: "access", label: "Staff & access" },
  { key: "catalog", label: "Catalog" },
];

const ACCESS_PREFIXES = ["admin.", "security.", "user."] as const;

/** lib/adminCatalog/audit.ts STEP_OF_PREFIX, as prefixes (that file is server-only). */
export const CATALOG_PREFIXES = [
  "plan.",
  "addon.",
  "feature.",
  "product.",
  "template.",
  "carrier.",
  "carrier_rule.",
  "carrier_settings.",
  "layout_map.",
  "layout_assignment.",
  "status_map.",
  "field_map.",
  "carrier_guidance.",
  "carrier_servicing_guide.",
] as const;

export function isAuditLens(value: string | null | undefined): value is AuditLens {
  return AUDIT_LENSES.some((lens) => lens.key === value);
}

/** Whether one action belongs to a lens. "all" holds everything. */
export function inAuditLens(lens: AuditLens, action: string): boolean {
  if (lens === "all") return true;
  if (lens === "money") return isMoneyAction(action);
  if (lens === "access") return ACCESS_PREFIXES.some((prefix) => action.startsWith(prefix));
  return CATALOG_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/** The known actions a lens holds, for the server's `action in (…)`; null for "all" (no filter). */
export function auditLensActions(lens: AuditLens, knownActions: readonly string[]): string[] | null {
  if (lens === "all") return null;
  return knownActions.filter((action) => inAuditLens(lens, action));
}
