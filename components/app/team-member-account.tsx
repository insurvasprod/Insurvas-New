"use client";

import { useMemo, useState } from "react";

import { notify } from "@/lib/notify";
import { Field, control } from "@/components/app/settings/primitives";
import { canTakeOver, type OpenWork } from "@/lib/tenantTeam/openWork";
import type { TeamMember } from "@/lib/tenantTeam/service";

/**
 * LA-8.6 · the member's own time zone, in the person sheet's Account section (settings round 8). It
 * saves the moment it is picked, like before. Deactivating moved to the sheet's footer and its dialog
 * (components/app/settings/team/deactivate-dialog.tsx); reactivating to the sheet of someone deactivated.
 */

function zones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch { /* older browsers: the short list below */ }
  return ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Asia/Manila", "Asia/Kolkata", "Europe/London", "UTC"];
}

export function MemberTimezoneField({ member, disabled }: { member: TeamMember; disabled?: boolean }) {
  const [timezone, setTimezone] = useState(member.timezone ?? "");
  const [saving, setSaving] = useState(false);
  const zoneList = useMemo(() => zones(), []);

  async function save(next: string) {
    setTimezone(next);
    setSaving(true);
    try {
      const response = await fetch(`/api/app/team/${member.id}/timezone`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: next || null }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not save the time zone");
      notify.done(next ? `${member.name}'s time zone is ${next.replace(/_/g, " ")}.` : `${member.name}'s time zone is cleared.`);
    } catch (error) {
      setTimezone(member.timezone ?? "");
      notify.block(error instanceof Error ? error.message : "Could not save the time zone");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field label="Time zone" htmlFor={`member-timezone-${member.id}`} hint="Their own clock, for the roster. Saved when picked. Calling windows always follow the customer's state.">
      <select id={`member-timezone-${member.id}`} className={control} value={timezone} disabled={saving || disabled} onChange={(event) => void save(event.target.value)}>
        <option value="">Not set (the agency&rsquo;s)</option>
        {zoneList.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
      </select>
    </Field>
  );
}

/**
 * Who may take over a person's open work: an active teammate whose role can work every kind of it (a
 * bookkeeper or a setter cannot take leads or callbacks). The database checks the same rule
 * (tenant_deactivate_member, tenant_hand_over_member_work). Before the work is read, everyone active.
 */
export function takersFor(members: TeamMember[], member: TeamMember, openWork: OpenWork | null): TeamMember[] {
  return members.filter((m) => m.id !== member.id && m.acceptedAt && m.status === "active" && (openWork === null || canTakeOver(m.role, openWork)));
}
