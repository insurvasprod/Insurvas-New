// Client-safe: no `server-only` import, because the settings screen is a client component and
// renders from these definitions. The reads and writes live in ./queries, which is server-only.
//
// THIS REGISTRY IS THE SOURCE OF TRUTH for which settings exist. The `settings` table only holds
// overrides — a key with no row is not an error, it is the coded default. That inversion is what
// makes the store safe to add to: shipping a new key needs no migration, and a database restored
// from before the key existed still boots.

export const SETTING_TYPES = ["number", "boolean", "text", "select"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export type SettingValue = number | boolean | string;

export type SettingDef = {
  key: string;
  type: SettingType;
  /** Heading on the settings screen. Also the `group` column. */
  group: string;
  label: string;
  /** Shown under the input. Say what the value does, not what it is. */
  help: string;
  default: SettingValue;
  /** `number` only. Inclusive. Enforced server-side, not just by the input. */
  min?: number;
  max?: number;
  /** `select` only. */
  options?: readonly string[];
  /** Rendered next to the input — "hours", "%", "cents". */
  unit?: string;
};

/**
 * Only keys with a real consumer in the code today.
 *
 * A setting nothing reads is worse than no setting: it looks like a control, changes nothing, and
 * the next person wires something to it to make it true. Every entry below is read somewhere —
 * grep the key before adding one.
 */
export const SETTING_DEFS = [
  {
    key: "users.invite_expiry_hours",
    type: "number",
    group: "Users",
    label: "Invitation link lifetime",
    help: "How long an invitation or password-reset link stays valid. Links already sent keep the lifetime they were issued with.",
    default: 72,
    min: 1,
    max: 720,
    unit: "hours",
  },
  {
    key: "billing.refund_approval_threshold_cents",
    type: "number",
    group: "Billing",
    label: "Refund approval threshold",
    help: "A refund above this amount needs a second admin to approve it. The requester can never approve their own, whatever their role.",
    default: 50_000,
    min: 0,
    max: 100_000_000,
    unit: "cents",
  },
  {
    key: "usage.warn_percent",
    type: "number",
    group: "Usage",
    label: "Usage warning threshold",
    help: "Where a meter starts showing as near its limit. Blocking still happens at 100%, and only for hard-capped meters.",
    default: 80,
    min: 1,
    max: 99,
    unit: "%",
  },
  {
    key: "agent_floor.wait_amber_seconds",
    type: "number",
    group: "Agent Floor",
    label: "Agent Floor amber wait threshold",
    help: "Waiting transfers use an amber treatment after this many seconds. Red must be set higher.",
    default: 120,
    min: 15,
    max: 86_400,
    unit: "seconds",
  },
  {
    key: "agent_floor.wait_red_seconds",
    type: "number",
    group: "Agent Floor",
    label: "Agent Floor red wait threshold",
    help: "Waiting transfers use a red treatment after this many seconds. If it is below amber, the floor keeps red after amber.",
    default: 300,
    min: 30,
    max: 86_400,
    unit: "seconds",
  },
  {
    key: "callbacks.reminder_lead_minutes",
    type: "number",
    group: "Callbacks",
    label: "Callback reminder lead time",
    help: "How many minutes before a callback the agent receives an in-app and email reminder.",
    default: 30,
    min: 5,
    max: 1440,
    unit: "minutes",
  },
  {
    key: "platform.default_currency",
    type: "select",
    group: "Platform",
    label: "Default currency",
    help: "Used where no currency is stored against a plan. USD only for now — multi-currency was declined in SA-00.",
    default: "USD",
    options: ["USD"],
  },
] as const satisfies readonly SettingDef[];

export type SettingKey = (typeof SETTING_DEFS)[number]["key"];

const BY_KEY = new Map<string, SettingDef>(SETTING_DEFS.map((d) => [d.key, d]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}

/** Definitions in display order: group, then the order declared above. */
export function settingGroups(): { group: string; defs: SettingDef[] }[] {
  const groups: { group: string; defs: SettingDef[] }[] = [];
  for (const def of SETTING_DEFS) {
    const existing = groups.find((g) => g.group === def.group);
    if (existing) existing.defs.push(def);
    else groups.push({ group: def.group, defs: [def] });
  }
  return groups;
}

/**
 * Coerces a stored or submitted value to the declared type, or returns null if it cannot.
 *
 * Shared by the API and the form so a value can never be accepted by one and rejected by the
 * other. Returning null rather than throwing lets the caller decide whether a bad value is a 400
 * (submitted) or a fall back to the default (stored, and something wrote nonsense).
 */
export function coerceSettingValue(def: SettingDef, raw: unknown): SettingValue | null {
  switch (def.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n)) return null;
      if (def.min !== undefined && n < def.min) return null;
      if (def.max !== undefined && n > def.max) return null;
      return n;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    }
    case "select": {
      if (typeof raw !== "string") return null;
      return def.options?.includes(raw) ? raw : null;
    }
    case "text": {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed.length > 0 && trimmed.length <= 500 ? trimmed : null;
    }
  }
}

/** Why a submitted value was refused, in words an admin can act on. */
export function settingRefusalReason(def: SettingDef, raw: unknown): string | null {
  if (coerceSettingValue(def, raw) !== null) return null;

  switch (def.type) {
    case "number": {
      const bounds =
        def.min !== undefined && def.max !== undefined
          ? ` between ${def.min.toLocaleString("en-US")} and ${def.max.toLocaleString("en-US")}`
          : "";
      return `Enter a number${bounds}.`;
    }
    case "boolean":
      return "Choose on or off.";
    case "select":
      return `Choose one of: ${def.options?.join(", ") ?? "—"}.`;
    case "text":
      return "Enter between 1 and 500 characters.";
  }
}
