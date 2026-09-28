"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { notify } from "@/lib/notify";

import { Callout, Field, Pill, btn, control } from "@/components/app/settings/primitives";
import { LoginProtectionPanel } from "@/components/admin/login-protection-panel";
import { SETTING_DEFS, settingRefusalReason, type SettingDef, type SettingValue } from "@/lib/settings/constants";
import {
  LOGIN_PROTECTION_KEYS,
  LOGIN_PROTECTION_LABELS,
  isLoginProtectionKey,
  isLoosenedAbuseControl,
} from "@/lib/settings/restrictions";

export type SettingState = {
  key: string;
  value: SettingValue;
  isOverridden: boolean;
  updatedAt: string | null;
};

/** The board's 140×38 store input: right-aligned figures, the strong edge every control carries. */
const STORE_INPUT =
  "box-border h-[38px] w-[140px] rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-right text-[16px] leading-[1.5] tracking-[-0.02em] tabular-nums text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] aria-[invalid=true]:border-[var(--error)] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The Advanced screen (p-adm-advanced): a warning for any abuse control that has been loosened, the
 * raw settings store, and the login-protection knobs.
 *
 * Every row still saves on its own. SA-4.3 requires every section to save independently, and a
 * whole-form submit means one refused value discards three good ones — so a row's Save appears
 * only once that row is edited, and Enter in its field does the same thing.
 *
 * `initial` holds only the keys this viewer may manage (the page filters by role), so a
 * platform_config session never draws a login-protection control it would be refused on.
 */
export function SettingsForm({
  initial,
  canManageLoginProtection,
}: {
  initial: SettingState[];
  canManageLoginProtection: boolean;
}) {
  const initialByKey = useMemo(() => new Map(initial.map((setting) => [setting.key, setting])), [initial]);
  const defs = useMemo(() => SETTING_DEFS.filter((def) => initialByKey.has(def.key)) as SettingDef[], [initialByKey]);
  const valueFor = (def: SettingDef): SettingValue => {
    const value = initialByKey.get(def.key)?.value;
    // A stale or hand-edited settings response can contain an empty string for a numeric key.
    // Treat that the same as a missing override so the operator never sees a blank safety limit.
    return typeof value === "string" && value.trim() === "" ? def.default : value ?? def.default;
  };
  const [live, setLive] = useState<Record<string, SettingValue>>(() =>
    Object.fromEntries(defs.map((def) => [def.key, valueFor(def)])),
  );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(defs.map((def) => [def.key, String(valueFor(def))])),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Read from the live value, not from the props the page rendered with: after a Reset the row is
  // at its default and must say so, without waiting for a reload. Same rule as getAllSettings —
  // "overridden" means changed from the coded default, not merely that a row exists.
  const isOverridden = (def: SettingDef) => String(live[def.key]) !== String(def.default);
  const isDirty = (def: SettingDef) => draft[def.key] !== String(live[def.key]);

  async function save(def: SettingDef, override?: SettingValue) {
    const raw = override ?? draft[def.key];

    // Validated with the same function the API uses, so the form can never accept something the
    // server refuses — or refuse something it would have taken.
    const refusal = settingRefusalReason(def, raw);
    if (refusal) {
      setErrors((e) => ({ ...e, [def.key]: refusal }));
      return;
    }

    setBusy(def.key);
    setErrors((e) => ({ ...e, [def.key]: null }));

    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: def.key, value: raw }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(null);

    if (!res || !res.ok) {
      // The typed value stays in the field — a refused save must never discard what was entered.
      setErrors((e) => ({ ...e, [def.key]: body?.error ?? "Could not save this setting." }));
      return;
    }

    setLive((v) => ({ ...v, [def.key]: body.value }));
    setDraft((d) => ({ ...d, [def.key]: String(body.value) }));
    notify.done(body.changed ? `${def.label} saved` : `${def.label} is already that`);
  }

  /**
   * Restores the coded default and saves it in one action.
   *
   * It used to only fill the field and leave you to press Save, which read the draft from its
   * render closure — so clicking Default and Save in quick succession saved the OLD value and
   * reported "already that". A button labelled "Reset" should restore the default, not stage it.
   */
  function reset(def: SettingDef) {
    setDraft((d) => ({ ...d, [def.key]: String(def.default) }));
    setErrors((e) => ({ ...e, [def.key]: null }));
    void save(def, def.default);
  }

  function onFieldKey(def: SettingDef, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (isDirty(def) && busy !== def.key) void save(def);
    } else if (event.key === "Escape" && isDirty(def)) {
      // Back to what is live, so an edit abandoned halfway cannot be saved by a stray Enter later.
      event.preventDefault();
      setDraft((d) => ({ ...d, [def.key]: String(live[def.key]) }));
      setErrors((e) => ({ ...e, [def.key]: null }));
    }
  }

  const setValue = (def: SettingDef, value: string) => setDraft((d) => ({ ...d, [def.key]: value }));

  const storeDefs = defs.filter((def) => !isLoginProtectionKey(def.key));
  const loginDefs = LOGIN_PROTECTION_KEYS.map((key) => defs.find((def) => def.key === key)).filter(
    (def): def is SettingDef => Boolean(def),
  );
  const overriddenCount = storeDefs.filter(isOverridden).length;
  // Only keys this viewer can see: the page never sends a platform_config session the login knobs.
  const loosened = defs.filter((def) => isLoosenedAbuseControl(def.key, live[def.key], def.default));

  function rowActions(def: SettingDef) {
    const saving = busy === def.key;
    const overridden = isOverridden(def);
    return (
      <>
        {isDirty(def) && (
          <button type="button" className={btn("primary-sm")} onClick={() => void save(def)} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        <Pill tone={overridden ? "brand" : "neutral"}>{overridden ? "Overridden" : "Default"}</Pill>
        {overridden && (
          <button
            type="button"
            className={btn("secondary")}
            onClick={() => reset(def)}
            disabled={saving}
            aria-label={`Reset ${def.key} to its default of ${String(def.default)}`}
            title={`Restore the default (${String(def.default)})`}
          >
            Reset
          </button>
        )}
      </>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {loosened.map((def) => (
        <Callout
          key={def.key}
          tone="warning"
          title={`${def.key} is raised to ${Number(live[def.key]).toLocaleString("en-US")}${def.unit ? ` ${def.unit}` : ""}, above its default of ${Number(def.default).toLocaleString("en-US")}.`}
        />
      ))}

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
          <h2 className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Settings store</h2>
          <span className="flex items-center gap-2.5">
            <Pill tone={overriddenCount > 0 ? "brand" : "neutral"}>{overriddenCount} overridden</Pill>
          </span>
        </div>

        {storeDefs.map((def, index) => {
          const error = errors[def.key];
          const helpId = `${def.key}-help`;
          const errorId = `${def.key}-error`;
          return (
            <div
              key={def.key}
              className={`flex flex-wrap items-center gap-4 px-4 py-3 ${index === 0 ? "" : "border-t border-[var(--border)]"}`}
            >
              <span className="block w-full min-w-0 sm:w-[300px] sm:shrink-0">
                <label htmlFor={def.key} className="block font-mono text-[13px] break-all text-[var(--ink)]">
                  {def.key}
                </label>
                <span id={helpId} className="mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                  {def.help}
                </span>
                {error && (
                  <span id={errorId} role="alert" className="mt-1 block text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--error-ink)]">
                    {error}
                  </span>
                )}
              </span>

              <span className="flex items-center gap-2">
                {def.type === "select" ? (
                  <select
                    id={def.key}
                    className={`${STORE_INPUT} text-left`}
                    value={draft[def.key]}
                    aria-describedby={error ? `${helpId} ${errorId}` : helpId}
                    onChange={(e) => setValue(def, e.target.value)}
                    onKeyDown={(e) => onFieldKey(def, e)}
                  >
                    {def.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={def.key}
                    type="text"
                    className={STORE_INPUT}
                    inputMode={def.type === "number" ? "numeric" : "text"}
                    value={draft[def.key]}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${helpId} ${errorId}` : helpId}
                    onChange={(e) => setValue(def, e.target.value)}
                    onKeyDown={(e) => onFieldKey(def, e)}
                  />
                )}
                {def.unit && <span className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{def.unit}</span>}
              </span>

              <span className="flex-1" aria-hidden="true" />
              <span className="flex flex-wrap items-center gap-2.5">{rowActions(def)}</span>
            </div>
          );
        })}
      </section>

      {canManageLoginProtection && loginDefs.length > 0 ? (
        <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Login protection</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {loginDefs.map((def) => {
              const key = def.key as (typeof LOGIN_PROTECTION_KEYS)[number];
              const error = errors[def.key];
              return (
                <div key={def.key} className="min-w-0">
                  <Field label={LOGIN_PROTECTION_LABELS[key]} htmlFor={def.key} hint={def.help} error={error}>
                    <input
                      id={def.key}
                      type="text"
                      inputMode="numeric"
                      className={control}
                      value={draft[def.key]}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => setValue(def, e.target.value)}
                      onKeyDown={(e) => onFieldKey(def, e)}
                    />
                  </Field>
                  <div className="mt-2 flex flex-wrap items-center gap-2.5">
                    <code className="font-mono text-[12px] text-[var(--muted)]">{def.key}</code>
                    <span className="flex-1" aria-hidden="true" />
                    {rowActions(def)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <Callout tone="info" title="Login protection is managed by a super admin." />
      )}

      {canManageLoginProtection && <LoginProtectionPanel />}
    </div>
  );
}
