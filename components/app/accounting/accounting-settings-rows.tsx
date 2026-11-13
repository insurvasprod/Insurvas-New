"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { COLUMNS, type AccountingSettings } from "@/lib/accounting/settingsCore";
import { notify } from "@/lib/notify";

/**
 * Settings › Accounting, round 8 (docs/design/settings-r8/money-compliance-settings.html §1–3, owner "Build all
 * four" 2026-11-12). The rows and sheets are the shared Money & compliance kit (components/app/settings/money/
 * setting-kit.tsx); this file keeps Accounting's own save: only the keys a sheet changed go to the PATCH, an error
 * stays in the sheet beside the field, and the toast offers Undo.
 */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function patchSettings(patch: Partial<AccountingSettings>): Promise<AccountingSettings> {
  const body = Object.fromEntries(Object.entries(patch).map(([key, value]) => [COLUMNS[key as keyof AccountingSettings], value]));
  const res = await fetch("/api/app/accounting/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json.settings as AccountingSettings;
}

/**
 * A sheet's save (one setting, "PATCH accounting/settings"): only the keys whose value changed go to the PATCH, which
 * takes a partial body. A failure stays in the sheet (`error`), the typed value kept. The toast names the setting
 * and offers Undo, which sends the old values of those keys back.
 */
export function useAccountingSave(current: AccountingSettings, onSaved: (next: AccountingSettings) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<AccountingSettings>, what = "the setting"): Promise<boolean> => {
    const keys = (Object.keys(patch) as (keyof AccountingSettings)[]).filter((k) => !same(patch[k], current[k]));
    if (!keys.length) { notify.done("Nothing changed"); return true; }
    const changed = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<AccountingSettings>;
    const before = Object.fromEntries(keys.map((k) => [k, current[k]])) as Partial<AccountingSettings>;
    setBusy(true);
    setError(null);
    try {
      onSaved(await patchSettings(changed));
      router.refresh();
      notify.done(`Saved · ${what}. Recorded figures are unchanged.`, {
        action: {
          label: "Undo",
          onClick: () => void patchSettings(before).then(
            (next) => { onSaved(next); router.refresh(); notify.done("Put back as it was."); },
            (err: unknown) => notify.fail(err instanceof Error ? err.message : "That didn't save"),
          ),
        },
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, save };
}
