"use client";

import { useMemo, useState } from "react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Field, control } from "@/components/app/settings/primitives";
import { canTakeOver, describeOpenWork, reassignableCount, type OpenWork } from "@/lib/tenantTeam/openWork";
import type { TeamMember } from "@/lib/tenantTeam/service";

/**
 * LA-8.6 · the part of Manage that acts at once: the member's own time zone, and deactivating or
 * reactivating them. Deactivating asks who takes their open work first, and says what that work is;
 * their history stays theirs. Roles and what they may do are LA-0.2's — nothing here defines them.
 */

function zones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch { /* older browsers: the short list below */ }
  return ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Asia/Manila", "Asia/Kolkata", "Europe/London", "UTC"];
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(json?.error ?? "That did not work"), { body: json });
  return json;
}

export function MemberAccountPanel({ member, members, onChanged }: { member: TeamMember; members: TeamMember[]; onChanged: () => Promise<void> }) {
  const active = member.status === "active" || member.status === "suspended";
  const deactivated = member.status === "inactive" || member.status === "deactivated";
  const [timezone, setTimezone] = useState(member.timezone ?? "");
  const [savingZone, setSavingZone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openWork, setOpenWork] = useState<OpenWork | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneList = useMemo(() => zones(), []);
  // Only someone who can work what is open: a bookkeeper or a setter cannot take over leads or callbacks.
  const takers = members.filter((m) => m.id !== member.id && m.acceptedAt && m.status === "active" && (openWork === null || canTakeOver(m.role, openWork)));

  /** Opening the confirmation reads what is still open in their name. */
  function startDeactivate() {
    setConfirming(true);
    setOpenWork(null);
    setError(null);
    send(`/api/app/team/${member.id}/deactivate`, "GET").then((r) => setOpenWork(r.openWork), (e) => setError(e instanceof Error ? e.message : "Could not read their open work"));
  }

  async function saveZone(next: string) {
    setTimezone(next);
    setSavingZone(true);
    try {
      await send(`/api/app/team/${member.id}/timezone`, "PUT", { timezone: next || null });
      notify.done(next ? `${member.name}'s time zone is ${next}.` : `${member.name}'s time zone is cleared.`);
    } catch (e) {
      setTimezone(member.timezone ?? "");
      notify.block(e instanceof Error ? e.message : "Could not save the time zone");
    } finally {
      setSavingZone(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/app/team/${member.id}/deactivate`, "POST", { reassignTo: reassignTo || null });
      notify.done(`${member.name} is deactivated. Their sessions end on their next click, and their work history stays theirs.`);
      await onChanged();
    } catch (e) {
      const body = (e as { body?: { openWork?: OpenWork } }).body;
      if (body?.openWork) setOpenWork(body.openWork);
      setError(e instanceof Error ? e.message : "Could not deactivate");
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setBusy(true);
    try {
      await send(`/api/app/team/${member.id}/reactivate`, "POST");
      notify.done(`${member.name} is active again.`);
      await onChanged();
    } catch (e) {
      notify.block(e instanceof Error ? e.message : "Could not reactivate");
    } finally {
      setBusy(false);
    }
  }

  const needsTaker = openWork !== null && reassignableCount(openWork) > 0;

  return (
    <div className="grid gap-3 rounded-[12px] border border-[var(--border)] px-4 py-3">
      <Field label="Time zone" htmlFor="member-timezone" hint="Their own clock, for the roster. Calling windows always follow the customer's state.">
        <select id="member-timezone" className={control} value={timezone} disabled={savingZone} onChange={(event) => void saveZone(event.target.value)}>
          <option value="">Not set (the agency&rsquo;s)</option>
          {zoneList.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
        </select>
      </Field>

      {active && !confirming && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 text-sm leading-[1.5] text-[var(--body)]">
            <span className="block font-semibold text-[var(--ink)]">Deactivate</span>
            Ends their sessions and frees the seat. What they did stays theirs.
          </span>
          <Button type="button" variant="outline" className="text-[var(--error-ink)]" onClick={startDeactivate}>Deactivate</Button>
        </div>
      )}

      {active && confirming && (
        <div className="grid gap-3">
          <p className="text-sm leading-[1.5] text-[var(--body)]">
            {openWork === null && !error
              ? "Checking their open work…"
              : openWork && describeOpenWork(openWork)
                ? <>{member.name} has {describeOpenWork(openWork)}.{openWork.servicing_requests > 0 ? " Servicing requests keep who asked for them; the person you choose follows them up." : ""}</>
                : <>{member.name} has no open work.</>}
          </p>
          {needsTaker && (
            <Field label="Hand their open work to" htmlFor="member-reassign" hint="Their queue items, reinstatement cases, callbacks, claimed leads, upcoming appointments and servicing requests move to this person. Only teammates who can work them are listed.">
              <select id="member-reassign" className={control} value={reassignTo} onChange={(event) => setReassignTo(event.target.value)}>
                <option value="">Choose a teammate</option>
                {takers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
          {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep them</Button>
            <Button type="button" variant="destructive" disabled={busy || openWork === null || (needsTaker && !reassignTo)} onClick={() => void deactivate()}>
              {busy ? "Deactivating…" : needsTaker ? "Hand over and deactivate" : "Deactivate"}
            </Button>
          </div>
        </div>
      )}

      {deactivated && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 text-sm leading-[1.5] text-[var(--body)]">
            <span className="block font-semibold text-[var(--ink)]">Deactivated</span>
            Reactivating takes a seat again.
          </span>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reactivate()}>{busy ? "Reactivating…" : "Reactivate"}</Button>
        </div>
      )}
    </div>
  );
}
