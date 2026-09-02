import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  SETTING_DEFS,
  coerceSettingValue,
  settingDef,
  type SettingDef,
  type SettingKey,
  type SettingValue,
} from "./constants";

export type SettingRow = {
  def: SettingDef;
  /** The live value — the stored override, or the coded default when there is no row. */
  value: SettingValue;
  /** False when this is the coded default rather than a stored row. */
  isOverridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

/**
 * In-memory cache of the stored overrides, invalidated on write.
 *
 * The TTL is not belt-and-braces — it is the only thing bounding staleness on a second instance.
 * Invalidation reaches the process that handled the write; on serverless every other running
 * instance keeps its copy until the TTL expires. Thirty seconds is short enough that nobody
 * notices and long enough that this is still a cache. See docs/backlog.md.
 */
const CACHE_TTL_MS = 30_000;

let cache: { at: number; values: Map<string, unknown> } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

type StoredRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };

async function loadStored(): Promise<Map<string, StoredRow>> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("settings").select("key, value, updated_at, updated_by");

  if (error) {
    // A settings table that cannot be read must not take the platform down — every key has a
    // coded default and the app is correct without any of them. Loud in the log, quiet to the user.
    console.error("[settings] could not load overrides, falling back to coded defaults", error);
    return new Map();
  }

  return new Map((data ?? []).map((row) => [row.key, row as StoredRow]));
}

async function currentValues(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;

  const stored = await loadStored();
  const values = new Map<string, unknown>();
  for (const [key, row] of stored) values.set(key, row.value);

  cache = { at: Date.now(), values };
  return values;
}

/**
 * The live value for one key.
 *
 * Never throws and never returns undefined: an unknown key, an unreadable table or a stored value
 * that no longer coerces all fall back to the coded default. A settings store that can break the
 * caller is worse than no settings store.
 */
export async function getSetting<T extends SettingValue = SettingValue>(key: SettingKey): Promise<T> {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  const values = await currentValues();
  if (!values.has(key)) return def.default as T;

  const coerced = coerceSettingValue(def, values.get(key));
  if (coerced === null) {
    console.error(`[settings] stored value for ${key} is invalid; using the coded default`);
    return def.default as T;
  }
  return coerced as T;
}

/** Every setting with its live value — what the admin screen renders from. */
export async function getAllSettings(): Promise<SettingRow[]> {
  const stored = await loadStored();

  return SETTING_DEFS.map((def) => {
    const row = stored.get(def.key);
    const coerced = row ? coerceSettingValue(def, row.value) : null;

    const value = coerced ?? def.default;

    return {
      def,
      value,
      // "Overridden" means somebody changed this from the coded default — not merely that a row
      // exists. The migration seeds rows AT the defaults, so keying off row existence would badge
      // every setting as overridden on day one and the badge would mean nothing.
      isOverridden: value !== def.default,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    };
  });
}

/**
 * Writes one override and returns what actually changed, or null if the value was already that.
 *
 * The caller audits the change — this function deliberately does not, so that a write and its
 * audit row cannot be separated by a future refactor that calls this from somewhere new.
 */
export async function setSetting(
  key: SettingKey,
  value: SettingValue,
  adminId: string,
): Promise<{ from: SettingValue; to: SettingValue } | null> {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  const before = await getSetting(key);
  if (before === value) return null;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("settings").upsert(
    {
      key,
      value: value as never,
      type: def.type,
      label: def.label,
      group: def.group,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (error) throw new Error(`Could not save ${key}: ${error.message}`);

  invalidateSettingsCache();
  return { from: before, to: value };
}

// ---------------------------------------------------------------------------
// Typed accessors.
//
// Callers use these rather than getSetting('...') with a bare string, so a renamed key is a
// compile error rather than a silent fall back to the default.
// ---------------------------------------------------------------------------

export function inviteExpiryHours(): Promise<number> {
  return getSetting<number>("users.invite_expiry_hours");
}

export function refundApprovalThresholdCents(): Promise<number> {
  return getSetting<number>("billing.refund_approval_threshold_cents");
}

/** The stored value is a percentage; callers compare against a ratio. */
export async function meterWarnThreshold(): Promise<number> {
  return (await getSetting<number>("usage.warn_percent")) / 100;
}

export function defaultCurrency(): Promise<string> {
  return getSetting<string>("platform.default_currency");
}

export async function agentFloorWaitThresholds(): Promise<{ amberSeconds: number; redSeconds: number }> {
  const [amber, red] = await Promise.all([
    getSetting<number>("agent_floor.wait_amber_seconds"),
    getSetting<number>("agent_floor.wait_red_seconds"),
  ]);
  return {
    amberSeconds: Math.min(amber, red - 1),
    redSeconds: Math.max(red, amber + 1),
  };
}

export function callbackReminderLeadMinutes(): Promise<number> {
  return getSetting<number>("callbacks.reminder_lead_minutes");
}
