"use client";

import { useCallback, useEffect, useState } from "react";

import type { RuleRow } from "@/lib/compliance/retention";
import type { Hold, Run } from "@/lib/compliance/retentionStore";
import type { ComplianceSettings } from "@/lib/compliance/settingsStore";
import { checkboxControl } from "@/components/ui/field";
import { notify } from "@/lib/notify";

/**
 * LA-6.8 · what the Compliance settings page and its record pages read: one GET of
 * /api/app/compliance/settings, and the writes that go with it. Every write is validated, capped and
 * audited on the server.
 */
export type Bundle = {
  settings: ComplianceSettings;
  caps: { deletionHoldFloorDays: number; lockedGateChecks: string[]; neverDelete: string[] };
  deadlines: { available: boolean; rows: { regulator: string; responseDays: number; notes: string | null }[]; coverage: { licensed: number; covered: number; missing: string[]; ftc: boolean; sentence: string } };
  rules: RuleRow[];
  holds: Hold[];
  runs: Run[];
  changes: { section: string; setting: string; from: unknown; to: unknown; by: string | null; at: string }[];
  team: { id: string; role: string; name: string }[];
};

export const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
export const regulatorName = (regulator: string) => (regulator === "FTC" ? "FTC" : `${regulator} DOI`);
export const SETTINGS_URL = "/app/compliance/settings";

export function useComplianceBundle() {
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    fetch("/api/app/compliance/settings").then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Settings could not be loaded");
      else { setError(null); setData(body); }
    });
    return () => { live = false; };
  }, [reloads]);

  /** True when it worked. A settings write answers with the whole bundle; the others reload it. */
  const write = useCallback(async (url: string, payload: unknown, done: string, method = "POST") => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't save");
      if (url === "/api/app/compliance/settings" && body?.settings) setData(body);
      else reload();
      notify.done(done);
      return true;
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return { data, error, busy, reload, write };
}

/** People who can receive an email, as a short list of checkboxes. Owners when nobody is chosen. */
export function Recipients({ team, value, disabled, onChange, label }: { team: Bundle["team"]; value: string[]; disabled: boolean; onChange: (ids: string[]) => void; label: string }) {
  const people = team.filter((t) => t.role === "owner" || t.role === "producer");
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {people.map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input type="checkbox" className={checkboxControl} checked={value.includes(p.id)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          {p.name} <span className="text-[var(--muted)]">({p.role})</span>
        </label>
      ))}
      {value.length === 0 && <p className="m-0 text-xs text-[var(--muted)]">Nobody chosen: the agency owners get it.</p>}
    </fieldset>
  );
}
