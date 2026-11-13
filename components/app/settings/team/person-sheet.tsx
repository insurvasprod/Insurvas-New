"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch, control } from "@/components/app/settings/primitives";
import { TeamAccessPanel, type AccessDraft } from "@/components/app/team-access-panel";
import { MemberTimezoneField, takersFor } from "@/components/app/team-member-account";
import { useViewerTimeZone } from "@/components/app/use-viewer-time-zone";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import { dayMonth } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { baseRoleOf, type MemberRole } from "@/lib/tenantAuth/roles";
import type { TeamAccessSnapshot } from "@/lib/tenantTeam/access";
import { lastSeenCell } from "@/lib/tenantTeam/lastSeen";
import type { OpenWork } from "@/lib/tenantTeam/openWork";
import type { TeamMember } from "@/lib/tenantTeam/service";

import { Avatar, ChoiceCard, FactTile, SendError, SheetSection, send } from "./parts";
import { MAIN_ROLES, MORE_ROLES, isLicensed, memberRole } from "./roles";
import { StateChips } from "./state-chips";

const sameList = (a: string[], b: string[]) => [...a].sort().join(",") === [...b].sort().join(",");
const sameExpiries = (a: Record<string, string | null>, b: Record<string, string | null>, states: string[]) => states.every((state) => (a[state] ?? null) === (b[state] ?? null));
const firstName = (name: string) => name.split(/\s+/)[0] || name;

/** The work a person holds, in the board's four tiles: leads, callbacks, appointments, and the follow-ups. */
export function workTiles(work: OpenWork) {
  return [
    { label: "Leads", value: work.claimed_leads },
    { label: "Callbacks", value: work.callbacks },
    { label: "Appointments", value: work.appointments },
    { label: "Follow-ups", value: work.queue_items + work.reinstatement_cases + work.servicing_requests },
  ];
}

/**
 * Board screen 2 · one person, in a right sheet: Access (one role), Licensed in (read with the agency's
 * carrier appointments, edited only here), Open work with a hand-over, and Account. One Save for the
 * role, the states and the custom access; the time zone and the hand-over act at once, and say so.
 */
export function PersonSheet({ member, members, viewerId, access, statesAvailable, bufferAtLimit, setterAtLimit, setterFree, carriersIn, onDirty, onError, onDeactivate, onChanged, onClose }: {
  member: TeamMember;
  members: TeamMember[];
  viewerId?: string;
  access?: TeamAccessSnapshot;
  statesAvailable: boolean;
  bufferAtLimit: boolean;
  setterAtLimit: boolean;
  setterFree: number | null;
  carriersIn?: (code: string) => number;
  onDirty: (count: number) => void;
  onError: (text: string | null, retry?: () => void) => void;
  onDeactivate: () => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const zone = useViewerTimeZone() ?? "UTC";
  const [now] = useState(() => Date.now());
  const initialRole = memberRole(member);
  const [role, setRole] = useState<MemberRole>(initialRole);
  const [moreRoles, setMoreRoles] = useState(MORE_ROLES.some((choice) => choice.role === initialRole));
  const [states, setStates] = useState<string[]>(member.licensedStates ?? []);
  const [expiries, setExpiries] = useState<Record<string, string | null>>(member.licensedStateExpiries ?? {});
  const [draft, setDraft] = useState<AccessDraft>({ extraRoles: member.extraRoles ?? [], hiddenPages: member.hiddenPages ?? [] });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"revoke" | "reactivate" | "hand" | null>(null);
  const [work, setWork] = useState<OpenWork | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [taker, setTaker] = useState("");

  const you = member.id === viewerId;
  const invited = !member.acceptedAt;
  const deactivated = member.status === "inactive" || member.status === "deactivated";
  const active = !invited && !deactivated;
  const billingOwner = member.role === "owner" && !member.agencyTitle;
  const roleLocked = you || billingOwner || deactivated;
  const licensed = isLicensed(role);

  // What is still open in their name: the same read the deactivation uses.
  useEffect(() => {
    if (!active) return;
    let live = true;
    send<{ openWork: OpenWork }>(`/api/app/team/${member.id}/deactivate`, "GET")
      .then((body) => { if (live) setWork(body.openWork); })
      .catch((error) => { if (live) setWorkError(error instanceof SendError && error.status === 503 ? "Open work is shown once a database update is applied." : "Couldn't read their open work."); });
    return () => { live = false; };
  }, [active, member.id]);

  const roleChanged = role !== initialRole;
  const statesChanged = licensed && statesAvailable && (!sameList(states, member.licensedStates ?? []) || !sameExpiries(expiries, member.licensedStateExpiries ?? {}, states));
  const accessReady = Boolean(access?.schemaReady && access.available) && !roleLocked;
  const accessChanged = accessReady && (!sameList(draft.extraRoles, member.extraRoles ?? []) || !sameList(draft.hiddenPages, member.hiddenPages ?? []));
  const changes = Number(roleChanged) + Number(statesChanged) + Number(accessChanged);
  useEffect(() => { onDirty(changes); }, [changes, onDirty]);

  const takers = useMemo(() => takersFor(members, member, work), [members, member, work]);
  const openTotal = work ? Object.values(work).reduce((sum, n) => sum + n, 0) : 0;

  function discard() {
    setRole(initialRole);
    setStates(member.licensedStates ?? []);
    setExpiries(member.licensedStateExpiries ?? {});
    setDraft({ extraRoles: member.extraRoles ?? [], hiddenPages: member.hiddenPages ?? [] });
  }

  async function save() {
    setSaving(true);
    onError(null);
    const failures: string[] = [];
    if (roleChanged) {
      try { await send(`/api/app/team/${member.id}`, "PATCH", { role }); } catch (error) { failures.push(error instanceof Error ? error.message : "the role did not save"); }
    }
    if (statesChanged) {
      const kept = Object.fromEntries(states.map((state) => [state, expiries[state] ?? null]));
      try { await send(`/api/app/team/${member.id}/licensed-states`, "PUT", { states: [...states].sort(), expiries: kept }); } catch (error) { failures.push(error instanceof SendError && error.status === 503 ? SCHEMA_PENDING_MESSAGE : error instanceof Error ? error.message : "the states did not save"); }
    }
    if (accessChanged) {
      try { await send(`/api/app/team/${member.id}/access`, "PUT", { extraRoles: draft.extraRoles.filter((extra) => extra !== baseRoleOf(role)), hiddenPages: draft.hiddenPages }); } catch (error) { failures.push(error instanceof Error ? error.message : "the pages did not save"); }
    }
    setSaving(false);
    await onChanged();
    if (failures.length) {
      onError(`Couldn't save ${firstName(member.name)}'s access. ${failures.join(" ")}`, () => void save());
      return;
    }
    notify.done(`${member.name} saved. It applies on their next page.`);
    onClose();
  }

  async function handOver() {
    if (!taker) return;
    setBusy("hand");
    onError(null);
    try {
      await send(`/api/app/team/${member.id}/hand-over`, "POST", { to: taker });
      const to = members.find((m) => m.id === taker)?.name ?? "them";
      notify.done(`${firstName(member.name)}'s open work is with ${to} now.`);
      setWork(await send<{ openWork: OpenWork }>(`/api/app/team/${member.id}/deactivate`, "GET").then((body) => body.openWork).catch(() => null));
      await onChanged();
    } catch (error) {
      onError(error instanceof SendError && error.status === 503 ? "Hand over now needs a database update. Deactivating still hands everything over." : error instanceof Error ? error.message : "Couldn't hand the work over.", () => void handOver());
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite() {
    setBusy("revoke");
    onError(null);
    try {
      const body = await send<{ accountRemoved?: boolean }>(`/api/app/team/${member.id}/invite`, "DELETE");
      notify.done(body.accountRemoved ? `Invitation to ${member.email} revoked; the seat is free` : `Invitation revoked; the seat is free. The unused account for ${member.email} could not be removed, so inviting that address again needs support.`);
      onClose();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not revoke this invitation", () => void revokeInvite());
    } finally {
      setBusy(null);
    }
  }

  async function reactivate() {
    setBusy("reactivate");
    onError(null);
    try {
      await send(`/api/app/team/${member.id}/reactivate`, "POST");
      notify.done(`${member.name} is active again.`);
      onClose();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not reactivate", () => void reactivate());
    } finally {
      setBusy(null);
    }
  }

  const status = invited ? <StatusChip tone="info">Invited</StatusChip> : deactivated ? <StatusChip tone="neutral">Deactivated</StatusChip> : member.status === "suspended" ? <StatusChip tone="neutral">Suspended</StatusChip> : <StatusChip tone="good">Active</StatusChip>;
  const subtitle = [
    member.email,
    invited ? (member.inviteExpiresAt ? `invite expires ${dayMonth(member.inviteExpiresAt, zone)}` : "invited") : member.acceptedAt ? `joined ${dayMonth(member.acceptedAt, zone)}` : null,
    invited ? null : `last seen ${lastSeenCell(member, now, zone).replace(/^Now$/, "now").replace(/^Signed in /, "")}`,
  ].filter(Boolean).join(" · ");

  const roleNote = (choice: MemberRole) => {
    if (choice === "producer") return "uses an agent seat";
    if (choice === "setter") return setterFree === null ? "setter seat" : setterFree > 0 ? `setter seat · ${setterFree} free` : "no setter seats left";
    if (choice === "assistant") return bufferAtLimit ? "no buffer seats left" : "buffer seat";
    return undefined;
  };
  const choiceOff = (choice: MemberRole) => choice !== initialRole && ((choice === "setter" && setterAtLimit) || (choice === "assistant" && bufferAtLimit));
  const agentPicked = role === "producer" || role === "manager";

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {active && !you && <Button type="button" variant="outline" className="mr-auto text-[var(--error-ink)]" onClick={onDeactivate} disabled={saving}>Deactivate…</Button>}
      {invited && <Button type="button" variant="outline" className="mr-auto text-[var(--error-ink)]" onClick={() => void revokeInvite()} disabled={busy !== null}>{busy === "revoke" ? "Revoking…" : "Revoke invite"}</Button>}
      {deactivated ? (
        <>
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
          <Button type="button" onClick={() => void reactivate()} disabled={busy !== null}>{busy === "reactivate" ? "Reactivating…" : "Reactivate"}</Button>
        </>
      ) : (
        <>
          <Button type="button" variant="ghost" className={active && !you ? undefined : invited ? undefined : "ml-auto"} onClick={() => { discard(); onClose(); }} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || changes === 0}>{saving ? "Saving…" : "Save"}</Button>
        </>
      )}
    </div>
  );

  return (
    <Sheet
      title={<span className="flex min-w-0 items-center gap-2.5"><Avatar name={member.name} size="large" /><span className="truncate">{member.name}</span></span>}
      subtitle={subtitle}
      status={status}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={footer}
    >
      <LeaveGuard dirty={changes > 0} onDiscard={discard} what={`${member.name}'s changes`} />

      <SheetSection title="Access" help="One role; it decides the pages they see and the leads they're given.">
        {roleLocked ? (
          <p className="m-0 text-sm text-[var(--body)]">
            {billingOwner ? "The account owner has every role and page. Make someone else the owner first to change this." : you ? "You can't change your own access. Another admin or the owner can." : "Reactivate them to change their access."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Role">
            {[...MAIN_ROLES, ...(moreRoles ? MORE_ROLES : [])].map((choice) => (
              <ChoiceCard
                key={choice.role}
                name={`role-${member.id}`}
                selected={choice.role === "producer" ? agentPicked : role === choice.role}
                onSelect={() => setRole(choice.role === "producer" && role === "manager" ? "manager" : choice.role)}
                title={choice.label}
                help={choice.help}
                end={roleNote(choice.role)}
                disabled={choiceOff(choice.role)}
              />
            ))}
            {!moreRoles && (
              <p className="m-0 mt-1 text-xs text-[var(--muted)]">
                <button type="button" className="border-0 bg-transparent p-0 font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => setMoreRoles(true)}>Show {MORE_ROLES.length} more roles</button> · {MORE_ROLES.map((choice) => choice.label).join(", ")}
              </p>
            )}
            {agentPicked && (
              <div className="mt-2 flex items-start justify-between gap-4 border-t border-[var(--border)] pt-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--ink)]">Team lead</span>
                  <span className="block text-xs text-[var(--muted)]">Sees their team&rsquo;s calls and is told when a transfer escalates. On an agency plan.</span>
                </span>
                <Switch checked={role === "manager"} onChange={(on) => setRole(on ? "manager" : "producer")} label="Team lead" />
              </div>
            )}
          </div>
        )}
      </SheetSection>

      {accessReady && access && (
        <SheetSection title="Extra roles and pages" help="With Custom team access: more than one role, and pages hidden from their menu.">
          <TeamAccessPanel access={access} mainRole={role} value={draft} onChange={setDraft} />
        </SheetSection>
      )}

      <SheetSection title="Licensed in" help={licensed ? "Read with the agency's carrier appointments. Leads are only assigned in these states; with none, the agency's licences apply." : undefined}>
        {!licensed ? (
          <p className="m-0 text-sm text-[var(--muted)]">{role === "setter" ? "Not needed: a setter books only and is never given a lead that needs a licence." : "Not needed: this role is not given leads to sell."}</p>
        ) : !statesAvailable ? (
          <p className="m-0 text-sm text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</p>
        ) : (
          <StateChips states={states} expiries={expiries} carriersIn={carriersIn} disabled={deactivated} onChange={(nextStates, nextExpiries) => { setStates(nextStates); setExpiries(nextExpiries); }} />
        )}
      </SheetSection>

      {active && (
        <SheetSection title="Open work" help={`What ${firstName(member.name)} holds right now. Hand it over before they leave or change role.`}>
          {workError ? <p className="m-0 text-sm text-[var(--muted)]">{workError}</p> : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(work ? workTiles(work) : workTiles({ queue_items: 0, reinstatement_cases: 0, callbacks: 0, claimed_leads: 0, appointments: 0, servicing_requests: 0 })).map((tile) => (
                  <FactTile key={tile.label} label={tile.label} value={work ? tile.value : "—"} />
                ))}
              </div>
              {work && openTotal > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`hand-to-${member.id}`} className="text-xs font-semibold text-[var(--ink)]">Hand over to</label>
                  <select id={`hand-to-${member.id}`} className={`${control} mt-0 w-60`} value={taker} onChange={(event) => setTaker(event.target.value)}>
                    <option value="">Choose a teammate</option>
                    {takers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <Button type="button" variant="outline" size="sm" disabled={!taker || busy !== null} onClick={() => void handOver()}>{busy === "hand" ? "Handing over…" : "Hand over now"}</Button>
                </div>
              )}
              <p className="m-0 text-xs text-[var(--muted)]">{work && openTotal === 0 ? "Nothing open. " : ""}Policies stay on their book for commission history; follow-ups move to the person you pick.</p>
            </>
          )}
        </SheetSection>
      )}

      {!invited && (
        <SheetSection title="Account">
          <MemberTimezoneField member={member} disabled={deactivated} />
        </SheetSection>
      )}
    </Sheet>
  );
}
