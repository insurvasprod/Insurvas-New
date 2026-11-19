// One audit entry, read by a person (admin round 1, docs/design/admin-r1/monitoring.html screen 5): the before/after
// table, the other facts in words, the target's own admin page, the short time in the list, and the CSV export's
// rows. Read-side only — nothing here decides what an entry holds; audit() writes it as it always has.
// Client-safe, relative imports only, so the sheet, the export route and node:test (entryView.test.mjs) share it.

import { csvCell } from "../csv/cell.ts";
import type { AuditLogEntry } from "./logView.ts";

export type AuditChange = { field: string; before: string; after: string };
export type AuditFact = { field: string; value: string };

/** "is_active" / "betaTenants" / "sort-order" → "Is active" / "Beta tenants" / "Sort order". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return key;
  const fixed = words.replace(/\bids\b/g, "IDs").replace(/\bid\b/g, "ID").replace(/\bip\b/g, "IP").replace(/\burl\b/g, "URL").replace(/\btotp\b/g, "TOTP");
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

const MAX_VALUE = 240;

/** A stored value in words: "Yes", "—", "3 items", or compact JSON for anything structured. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US") : String(value);
  if (typeof value === "string") return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      const text = value.map((item) => formatAuditValue(item)).join(", ");
      return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
    }
  }
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ from, to }` or `{ before, after }`: one field's change as audit rows write it. */
function pairOf(value: unknown): { before: unknown; after: unknown } | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > 2) return null;
  if (keys.every((key) => key === "from" || key === "to") && ("from" in value || "to" in value)) return { before: value.from, after: value.to };
  if (keys.every((key) => key === "before" || key === "after") && ("before" in value || "after" in value)) return { before: value.before, after: value.after };
  return null;
}

/**
 * An entry's metadata as a before/after table plus the remaining facts. The shapes audit rows use today:
 *   - `before` and `after` objects side by side;
 *   - `changes: { field: { from, to } }` (or `{ before, after }`);
 *   - `changes: { field: newValue }` with `before: { field: oldValue }` (staff role changes);
 *   - a field written inline as `field: { before, after }` (carrier facts).
 * Anything else is listed key by key under "Details". Nothing is dropped: a key used for the table is not repeated.
 */
export function auditDiff(metadata: unknown): { changes: AuditChange[]; facts: AuditFact[] } {
  const changes: AuditChange[] = [];
  const facts: AuditFact[] = [];
  if (!isRecord(metadata)) {
    if (metadata !== null && metadata !== undefined && !(typeof metadata === "string" && !metadata)) facts.push({ field: "Details", value: formatAuditValue(metadata) });
    return { changes, facts };
  }

  const used = new Set<string>();
  const push = (field: string, before: unknown, after: unknown) => changes.push({ field: humanizeKey(field), before: formatAuditValue(before), after: formatAuditValue(after) });

  const before = isRecord(metadata.before) ? metadata.before : null;
  const after = isRecord(metadata.after) ? metadata.after : null;
  const changeMap = isRecord(metadata.changes) ? metadata.changes : null;

  if (changeMap) {
    used.add("changes");
    for (const [field, value] of Object.entries(changeMap)) {
      const pair = pairOf(value);
      if (pair) push(field, pair.before, pair.after);
      else push(field, before && field in before ? before[field] : undefined, value);
    }
    if (before && Object.keys(changeMap).every((field) => pairOf(changeMap[field]) || field in before)) {
      // Every before value was used beside its change; anything in `before` the changes did not name is a fact.
      used.add("before");
      for (const [field, value] of Object.entries(before)) if (!(field in changeMap)) facts.push({ field: `${humanizeKey(field)} (unchanged)`, value: formatAuditValue(value) });
    }
  } else if (before || after) {
    used.add("before");
    used.add("after");
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
    for (const field of fields) push(field, before?.[field], after?.[field]);
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (used.has(key)) continue;
    const pair = pairOf(value);
    if (pair && !["from", "to"].includes(key)) {
      push(key, pair.before, pair.after);
      continue;
    }
    facts.push({ field: humanizeKey(key), value: formatAuditValue(value) });
  }
  return { changes, facts };
}

/**
 * The admin page that holds an entry's target, when there is one. Pages that open a record by id link to it; the
 * rest open the list the record lives in. The caller still checks the role may open it (canOpenAdminHref).
 */
export function auditTargetHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetType) return null;
  const id = targetId ? encodeURIComponent(targetId) : null;
  switch (targetType) {
    case "tenant":
      return id ? `/admin/tenants/${id}` : "/admin/tenants";
    case "tenant_application":
      return "/admin/tenants";
    case "user":
      return id ? `/admin/users/${id}` : "/admin/users";
    case "admin_user":
      return "/admin/admins";
    case "invoice":
      return id ? `/admin/invoices/${id}` : "/admin/invoices";
    case "plan":
      return id ? `/admin/plans/${id}/edit` : "/admin/plans";
    case "subscription":
      return id ? `/admin/subscriptions?open=${id}` : "/admin/subscriptions";
    case "coupon":
      return id ? `/admin/coupons?coupon=${id}` : "/admin/coupons";
    case "credit_note":
      return "/admin/credit-notes";
    case "offer":
      return "/admin/offers";
    case "addon":
      return "/admin/addons";
    case "feature":
      return "/admin/features";
    case "product":
      return "/admin/products";
    case "template":
      return "/admin/templates";
    case "carrier":
      return "/admin/carriers";
    case "carrier_layout_map":
      return "/admin/layout-maps";
    case "carrier_status_map":
      return "/admin/status-maps";
    case "carrier_field_map":
      return "/admin/field-maps";
    case "compliance_vendor":
      return "/admin/compliance-sources";
    case "state_disclosure":
    case "state_disclosure_proposal":
      return "/admin/state-disclosures";
    case "legal_document":
    case "legal_document_draft":
      return "/admin/legal";
    case "announcement":
    case "maintenance":
    case "system":
      return "/admin/system";
    case "credit_pack":
    case "meter_pricing":
      return "/admin/credits-limits";
    case "webhook_event":
    case "payment_provider":
      return "/admin/payments";
    case "setting":
      return "/admin/advanced";
    case "login_lockout":
      return "/admin/monitoring/lockouts";
    case "cron_job":
      return "/admin/monitoring/jobs";
    default:
      return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The list's time, in UTC: "Today 10:42", "Yesterday 09:15", "14 Nov 10:42", or "14 Nov 2025" for another year. */
export function shortWhenUtc(iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = day(new Date(now));
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
  const diffDays = Math.round((today - day(at)) / 86_400_000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (at.getUTCFullYear() === new Date(now).getUTCFullYear()) return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${time}`;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** What the Target cell shows: a readable name, else the raw `type:id`. */
export function auditTargetText(entry: Pick<AuditLogEntry, "targetLabel" | "target_type" | "target_id">): string {
  if (entry.targetLabel) return entry.targetLabel;
  if (entry.target_type) return `${entry.target_type}:${entry.target_id ?? ""}`;
  return entry.target_id ?? "—";
}

export const AUDIT_CSV_HEADER = ["When (UTC)", "Timestamp", "Who", "Actor type", "Actor ID", "Action", "Action code", "Target", "Target type", "Target ID", "Reason", "IP", "User agent", "Metadata"] as const;

/** The export: one line per entry, every column the list and the sheet show, metadata as JSON. Shared csvCell guard. */
export function auditCsv(entries: readonly AuditLogEntry[]): string {
  const lines = [AUDIT_CSV_HEADER.map(csvCell).join(",")];
  for (const entry of entries) {
    let metadata = "";
    try {
      metadata = entry.metadata === null || entry.metadata === undefined ? "" : JSON.stringify(entry.metadata);
    } catch {
      metadata = String(entry.metadata);
    }
    lines.push(
      [
        entry.whenUtc,
        entry.ts,
        entry.actorDetail ?? entry.actorLabel,
        entry.actor_type,
        entry.actor_id,
        entry.actionLabel ?? entry.action,
        entry.action,
        entry.targetLabel,
        entry.target_type,
        entry.target_id,
        entry.reason,
        entry.ip,
        entry.user_agent,
        metadata,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
