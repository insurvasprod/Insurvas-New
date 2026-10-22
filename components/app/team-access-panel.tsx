"use client";

import { useState } from "react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import { AGENT_MENU, menuRoleAdmits } from "@/lib/menu/definition";
import { TENANT_ROLE_LABELS, MEMBER_ROLE_LABELS, baseRoleOf, type MemberRole, type TenantRole } from "@/lib/tenantAuth/roles";
import { accessSummary, EXTRA_ROLES, UNHIDEABLE_PAGES, type ExtraRole } from "@/lib/tenantAuth/teamAccess";
import type { TeamAccessSnapshot } from "@/lib/tenantTeam/access";

export type AccessDraft = { extraRoles: ExtraRole[]; hiddenPages: string[] };

/**
 * Custom team access (docs/team-access/DESIGN.md) · one person's extra roles, the pages they see, and presets.
 * Used in Manage (saves at once, like the account panel) and in Invite (a draft sent after the invite is made).
 * Only pages the person's roles open are listed: hiding removes, it never grants.
 */
export function TeamAccessPanel({
  access,
  mainRole,
  value,
  onChange,
  onPreset,
  onSave,
  saving,
  blockedReason,
}: {
  access: TeamAccessSnapshot;
  /** The main role as currently chosen in the dialog (a title counts as its base role). */
  mainRole: MemberRole;
  value: AccessDraft;
  onChange: (next: AccessDraft) => void;
  /** A preset was picked: it also sets the main role. */
  onPreset?: (mainRole: MemberRole) => void;
  /** Manage only: save now. Absent in Invite, where the draft rides on the invitation. */
  onSave?: () => void;
  saving?: boolean;
  /** Why this person's access cannot be changed here (the billing owner, yourself). */
  blockedReason?: string | null;
}) {
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState(access.presets);
  const [busy, setBusy] = useState(false);
  const base: TenantRole = baseRoleOf(mainRole);
  const holdsEverything = base === "owner";
  const extras = holdsEverything ? [] : value.extraRoles.filter((role) => role !== base);
  const roles: MemberRole[] = [mainRole, ...extras];
  const summary = accessSummary([base, ...extras], mainRole === "manager");
  const mainAlone = accessSummary([base], mainRole === "manager");
  const granted = new Set(access.features);
  const sections = AGENT_MENU.map((section) => ({
    id: section.id,
    label: section.label,
    items: section.items.filter((entry) =>
      !UNHIDEABLE_PAGES.has(entry.key) &&
      entry.sidebar !== false &&
      (!entry.required_feature || granted.has(entry.required_feature)) &&
      roles.some((role) => menuRoleAdmits(entry.required_roles, role))),
  })).filter((section) => section.items.length > 0);

  if (!access.schemaReady) return null;
  if (!access.available) {
    return <p className="text-xs leading-[1.5] text-[var(--muted)]">More than one role per person and hidden pages come with the Custom team access add-on.</p>;
  }
  if (blockedReason) return <p className="text-xs leading-[1.5] text-[var(--muted)]">{blockedReason}</p>;

  const hidden = new Set(value.hiddenPages);
  const toggleRole = (role: ExtraRole, on: boolean) => onChange({ ...value, extraRoles: on ? [...extras, role] : extras.filter((item) => item !== role) });
  const togglePage = (key: string, visible: boolean) => {
    const next = new Set(hidden);
    if (visible) next.delete(key); else next.add(key);
    onChange({ ...value, hiddenPages: [...next].sort() });
  };

  function applyPreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    onPreset?.(preset.mainRole);
    onChange({ extraRoles: preset.extraRoles, hiddenPages: preset.hiddenPages });
  }

  async function savePreset() {
    setBusy(true);
    const body = { name: presetName, mainRole, extraRoles: extras, hiddenPages: value.hiddenPages };
    const response = await fetch("/api/app/team/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { notify.fail(result?.error ?? "Could not save the preset"); return; }
    setPresets((current) => [...current, { id: result.id, name: presetName.trim(), mainRole, extraRoles: extras, hiddenPages: value.hiddenPages }].sort((a, b) => a.name.localeCompare(b.name)));
    setPresetName("");
    notify.done("Preset saved");
  }

  async function deletePreset(id: string) {
    setBusy(true);
    const response = await fetch(`/api/app/team/presets/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) { notify.fail("Could not delete the preset"); return; }
    setPresets((current) => current.filter((item) => item.id !== id));
    notify.done("Preset deleted. Nobody's access changed.");
  }

  return (
    <div className="grid gap-4 rounded-[12px] border border-[var(--border)] px-4 py-3" data-testid="team-access-panel">
      {presets.length > 0 && (
        <Field label="Preset" htmlFor="access-preset" hint="Copies the preset's roles and pages. Changing the preset later changes nobody.">
          <div className="flex gap-2">
            <select id="access-preset" className={control} defaultValue="" onChange={(event) => { applyPreset(event.target.value); event.target.value = ""; }}>
              <option value="" disabled>Apply a preset</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </div>
        </Field>
      )}

      <fieldset disabled={holdsEverything} className="min-w-0">
        <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Extra roles</legend>
        <span className="mt-1 block text-xs leading-[1.5] text-[var(--muted)]">
          {holdsEverything ? `${MEMBER_ROLE_LABELS[mainRole]} already has every role.` : "They can do what each role does. Lead routing, seat limits and their home page follow the main role."}
        </span>
        {!holdsEverything && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXTRA_ROLES.filter((role) => role !== base).map((role) => (
              <label key={role} className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--body)]">
                <input type="checkbox" className="size-4 accent-[var(--brand-500)]" checked={extras.includes(role)} onChange={(event) => toggleRole(role, event.target.checked)} />
                {TENANT_ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <p className="text-sm leading-[1.5] text-[var(--body)]" data-testid="team-access-summary">
        Sees {summary.rows === "everyone in the agency" ? "everyone's clients and leads" : `${summary.rows} clients and leads`}.
        {" "}Money: {summary.money === "all" ? "every producer's commissions and pay" : summary.money === "own" ? "their own commissions" : "none"}.
      </p>
      {summary.money === "all" && mainAlone.money !== "all" && <Callout tone="warning" title="This person will see commissions and pay for the whole agency." />}

      <fieldset className="min-w-0">
        <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Pages they see</legend>
        <span className="mt-1 block text-xs leading-[1.5] text-[var(--muted)]">Untick a page to hide it from their menu. Hiding never opens anything their roles do not.</span>
        <div className="mt-2 grid max-h-64 gap-3 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.id}>
              <span className="block text-xs font-semibold text-[var(--muted)]">{section.label}</span>
              <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {section.items.map((entry) => (
                  <label key={entry.key} className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--body)]">
                    <input type="checkbox" className="size-4 shrink-0 accent-[var(--brand-500)]" checked={!hidden.has(entry.key)} onChange={(event) => togglePage(entry.key, event.target.checked)} />
                    <span className="truncate" title={entry.label}>{entry.navLabel ?? entry.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input aria-label="Preset name" placeholder="Save as preset…" className={`${control} w-48`} value={presetName} maxLength={60} onChange={(event) => setPresetName(event.target.value)} />
          <Button type="button" variant="outline" disabled={busy || !presetName.trim()} onClick={() => void savePreset()}>Save preset</Button>
          {presets.length > 0 && (
            <select aria-label="Delete a preset" className={`${control} w-40`} defaultValue="" disabled={busy} onChange={(event) => { const id = event.target.value; event.target.value = ""; if (id) void deletePreset(id); }}>
              <option value="" disabled>Delete a preset</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          )}
        </div>
        {onSave && <Button type="button" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save access"}</Button>}
      </div>
    </div>
  );
}
