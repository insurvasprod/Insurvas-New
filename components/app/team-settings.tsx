"use client";

/**
 * Settings › Team & access, settings round 8 wave 3 (board docs/design/settings-r8/team-carriers.html,
 * screens 1–5; owner "Build all four", 2026-11-12).
 *
 *   People · Invites · Deactivated   the sub-page bar on the title line, with counts.
 *   status line                      seats, invites waiting, buffer and setter seats (the four tiles went).
 *   one line a person                gold initials, access, licensed in, last seen, colour only in Status.
 *   a person opens as a right sheet  access, licensed in, open work with a hand-over, account.
 *   Invite someone                   a right sheet that says the seat cost before it sends.
 *   Deactivate…                      a dialog that says what moves where before anything changes.
 */

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { DeactivateDialog } from "@/components/app/settings/team/deactivate-dialog";
import { InviteSheet } from "@/components/app/settings/team/invite-sheet";
import { Avatar, InlineLink, StatusLine, rowOpen, send, type LineTone } from "@/components/app/settings/team/parts";
import { PersonSheet } from "@/components/app/settings/team/person-sheet";
import { accessLabel, groupOf, isLicensed, memberRole, type Group } from "@/components/app/settings/team/roles";
import { useViewerTimeZone } from "@/components/app/use-viewer-time-zone";
import { carriersIn, todayIso } from "@/lib/appointments/tickModel";
import type { AppointmentRow } from "@/lib/appointments/service-types";
import { dayMonth } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import { TENANT_ROLES } from "@/lib/tenantAuth/roles";
import { lastSeenCell } from "@/lib/tenantTeam/lastSeen";
import type { TeamMember, TeamSnapshot } from "@/lib/tenantTeam/service";
import { cn } from "@/lib/utils";

type Tab = "people" | "invites" | "deactivated";
type Note = { tone: LineTone; text: string; retry?: () => void } | null;

const isDeactivated = (member: TeamMember) => member.status === "inactive" || member.status === "deactivated";
const isInvite = (member: TeamMember) => !member.acceptedAt;
/** A licence that ends within 60 days is named in the Status chip. */
const SOON_MS = 60 * 86_400_000;

function statusOf(member: TeamMember, now: number): { tone: StatusTone; label: string } {
  if (isInvite(member)) {
    const expired = member.inviteExpiresAt && Date.parse(member.inviteExpiresAt) < now;
    return expired ? { tone: "danger", label: "Invite expired" } : { tone: "info", label: "Invited" };
  }
  if (isDeactivated(member)) return { tone: "neutral", label: "Deactivated" };
  if (member.status === "suspended") return { tone: "neutral", label: "Suspended" };
  if (member.status !== "active") return { tone: "neutral", label: member.status };
  const soonest = Object.entries(member.licensedStateExpiries ?? {})
    .filter(([state, date]) => date && (member.licensedStates ?? []).includes(state))
    .map(([, date]) => `${date}T12:00:00Z`)
    .filter((date) => Date.parse(date) - now < SOON_MS)
    .sort()[0];
  if (soonest) return { tone: "warning", label: Date.parse(soonest) < now ? "Licence ended" : `Licence ends ${dayMonth(soonest, "UTC")}` };
  return { tone: "good", label: "Active" };
}

export function TeamSettings({ initial, workspace }: { initial: TeamSnapshot; workspace?: WorkspaceSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const viewerId = initial.viewerId;
  const [tab, setTab] = useState<Tab>("people");
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<TeamMember | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[] | null>(null);
  // Fixed at mount: relative times and invite expiry do not need to tick while the page is open.
  const [now] = useState(() => Date.now());
  const zone = useViewerTimeZone() ?? "UTC";

  // "Licensed in" reads the agency's carrier appointments: TX · 3 carriers. Garnish: without it the chips show the state only.
  useEffect(() => {
    let live = true;
    void fetch("/api/app/appointment-vault", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (live && response.ok) setAppointments((body?.appointments ?? []) as AppointmentRow[]);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const today = todayIso();
  const carriersInState = appointments ? (code: string) => carriersIn(appointments, code, today).length : undefined;

  async function refresh() {
    try {
      const fresh = await send<TeamSnapshot>("/api/app/team", "GET");
      setSnapshot((current) => ({ ...fresh, viewerId, teamAccess: fresh.teamAccess ?? current.teamAccess }));
    } catch {
      setNote({ tone: "bad", text: "Couldn't read the team again. What you see may be out of date.", retry: () => void refresh() });
    }
  }

  const members = snapshot.members;
  const people = members.filter((member) => !isInvite(member) && !isDeactivated(member));
  const invites = members.filter(isInvite);
  const gone = members.filter((member) => !isInvite(member) && isDeactivated(member));
  const listOf: Record<Tab, TeamMember[]> = { people, invites, deactivated: gone };

  // The filter's groups are read off LA-0.2's roles (lib/tenantAuth/roles.ts); nothing here defines one.
  const counts = { all: people.length, agents: 0, setters: 0, office: 0 };
  for (const [role, n] of TENANT_ROLES.map((item) => [item, people.filter((member) => member.role === item).length] as const)) {
    if (role === "producer") counts.agents += n;
    else if (role === "setter") counts.setters += n;
    else counts.office += n;
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listOf[tab].filter((member) => {
      if (tab === "people" && group !== "all" && groupOf(memberRole(member)) !== group) return false;
      return !needle || member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listOf is derived from members each render
  }, [members, tab, group, query]);

  // ── seats, on the status line ────────────────────────────────────────────────────────────────────
  const seats = snapshot.seats;
  const atSeatLimit = seats.max !== null && seats.used >= seats.max;
  const setter = snapshot.outboundLimits?.find((item) => item.key === "max_setter_seats" && item.limit !== null) ?? null;
  const setterAtLimit = setter !== null && setter.usage >= (setter.limit ?? 0);
  const bufferAtLimit = snapshot.bufferSeats.max !== null && snapshot.bufferSeats.used >= snapshot.bufferSeats.max;
  const freeSeats = seats.max === null ? null : Math.max(0, seats.max - seats.used);
  const seatFacts = [
    seats.max === null ? `${seats.used} seats used` : `${seats.used} of ${seats.max} seats used`,
    invites.length ? `${invites.length} ${invites.length === 1 ? "invite" : "invites"} waiting` : null,
    snapshot.bufferSeats.max !== null ? `buffer seats ${snapshot.bufferSeats.used} of ${snapshot.bufferSeats.max}` : null,
    setter ? `setter seats ${setter.usage} of ${setter.limit}${setterAtLimit ? " (the setter-seat limit is reached)" : ""}` : null,
  ].filter(Boolean).join(" · ");

  const open = openId ? members.find((member) => member.id === openId) ?? null : null;
  let tone: LineTone = atSeatLimit ? "warn" : "ok";
  let line: React.ReactNode = <>{seatFacts}{workspace?.planName ? ` on ${workspace.planName}` : ""} · <InlineLink href="/app/settings#billing">Plan &amp; billing</InlineLink></>;
  if (atSeatLimit) line = <>Every seat is in use ({seatFacts}). Free one, or <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href="/app/settings#billing">upgrade the plan</Link>, before another invite can go</>;
  if (open && sheetNote) { tone = "warn"; line = <>{open.name} · {sheetNote}</>; }
  if (note) { tone = note.tone; line = <>{note.text}{note.retry && <> · <InlineLink onClick={note.retry}>Try again</InlineLink></>}</>; }

  const inviteButton = (
    <Button type="button" variant="highlight" data-guide="team-invite" onClick={() => setInviteOpen(true)} disabled={atSeatLimit} title={atSeatLimit ? `All ${seats.max} seats are in use, pending invitations included. Free one or add seats.` : undefined}>
      <Plus aria-hidden="true" />Invite someone
    </Button>
  );

  async function resend(member: TeamMember) {
    setNote(null);
    try {
      const body = await send<{ invite?: { delivered?: boolean } }>(`/api/app/team/${member.id}/resend-invite`, "POST");
      notify.done(body.invite?.delivered ? `Invitation resent to ${member.email}` : "New invitation issued — copy the link from the server log if email is not configured");
      await refresh();
    } catch (error) {
      setNote({ tone: "bad", text: error instanceof Error ? error.message : "Could not resend this invitation", retry: () => void resend(member) });
    }
  }

  const head = (
    <tr className={st.headRow}>
      <th scope="col" className={st.th}>Person</th>
      <th scope="col" className={cn(st.th, "w-[200px]")}>Access</th>
      {tab !== "invites" && <th scope="col" className={cn(st.th, "w-[170px]")}>Licensed in</th>}
      <th scope="col" className={cn(st.th, "w-[150px]")} title={snapshot.presenceRecorded === false ? "Presence is not recorded until a database update is applied, so this shows the last sign-in." : "“Now” means Insurvas was open in the last two minutes."}>
        {tab === "invites" ? "Expires" : "Last seen"}
      </th>
      <th scope="col" className={cn(st.th, "w-[170px]")}>Status</th>
      <th scope="col" className={cn(st.th, "w-[96px] text-right")}><span className="sr-only">Open</span></th>
    </tr>
  );

  const row = (member: TeamMember) => {
    const role = memberRole(member);
    const status = statusOf(member, now);
    const you = member.id === viewerId;
    const sub = [role === "owner" && !member.agencyTitle ? "Owner" : null, role === "manager" ? "Team lead" : null, you ? "you" : null].filter(Boolean).join(" · ");
    const states = member.licensedStates ?? [];
    return (
      <tr key={member.id} {...rowOpen(() => { setNote(null); setOpenId(member.id); })} aria-label={`Open ${member.name}`}>
        <td className={st.td}>
          <span className="flex min-w-0 items-center gap-2.5 whitespace-nowrap">
            <Avatar name={member.name} />
            <span className="truncate font-semibold text-[var(--ink)]" title={member.email}>{member.name}</span>
            {sub && <span className="truncate text-xs text-[var(--muted)]">{sub}</span>}
          </span>
        </td>
        <td className={cn(st.td, "whitespace-nowrap")}>{accessLabel(role)}</td>
        {tab !== "invites" && (
          <td className={cn(st.td, "max-w-[170px] truncate whitespace-nowrap")}>
            {!isLicensed(role) ? <span className="text-[var(--muted)]">Not needed</span> : states.length ? <span title={states.join(", ")}>{states.join(", ")}</span> : <span className="text-[var(--muted)]" title="No personal licences recorded, so lead assignment uses the agency's licences.">Any agency state</span>}
          </td>
        )}
        <td className={cn(st.td, "whitespace-nowrap")}>
          {tab === "invites" ? (member.inviteExpiresAt ? dayMonth(member.inviteExpiresAt, zone) : "—") : lastSeenCell(member, now, zone)}
        </td>
        <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={status.tone}>{status.label}</StatusChip></td>
        <td className={cn(st.td, "text-right whitespace-nowrap")}>
          {tab === "invites" ? (
            <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void resend(member); }} aria-label={`Resend invitation to ${member.name}`}>Resend</Button>
          ) : <span aria-hidden="true" className="text-[var(--muted)]">›</span>}
        </td>
      </tr>
    );
  };

  const onlyYou = people.length <= 1 && invites.length === 0 && tab === "people" && !query.trim() && group === "all";

  return (
    <SettingsStack className="gap-4 lg:min-h-0 lg:flex-1">
      <SettingsSectionHeader
        tabs={
          <UnderlineTabs
            label="Team and access"
            value={tab}
            onChange={(next) => { setTab(next); setQuery(""); setGroup("all"); }}
            tabs={[
              { key: "people" as const, label: "People", count: people.length },
              { key: "invites" as const, label: "Invites", count: invites.length },
              { key: "deactivated" as const, label: "Deactivated", count: gone.length },
            ]}
          />
        }
        actions={inviteButton}
      />
      <StatusLine tone={tone}>{line}</StatusLine>

      <TableCard
        className="lg:min-h-0 lg:flex-1"
        bodyClassName="min-h-[200px] overflow-y-auto lg:min-h-0"
        title={tab === "people" ? "People" : tab === "invites" ? "Invites" : "Deactivated"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {tab === "people" && (
              <Segmented
                label="Show"
                value={group}
                onChange={setGroup}
                options={[
                  { key: "all" as const, label: "All", count: counts.all },
                  { key: "agents" as const, label: "Agents", count: counts.agents },
                  { key: "setters" as const, label: "Setters", count: counts.setters },
                  { key: "office" as const, label: "Office", count: counts.office },
                ]}
              />
            )}
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a person" className="sm:w-52" />
          </div>
        }
        footer={shown.length > 0 && tab === "people" ? <span className="text-xs text-[var(--muted)]">Showing {shown.length} of {people.length} · &ldquo;Now&rdquo; means Insurvas was open in the last two minutes</span> : undefined}
      >
        {onlyYou ? (
          <EmptyState
            title="It's just you so far"
            hint={`Invite agents, setters and office staff.${freeSeats !== null ? ` ${freeSeats} ${freeSeats === 1 ? "seat is" : "seats are"} free on your plan.` : ""}`}
            action={<Button type="button" variant="outline" onClick={() => setInviteOpen(true)} disabled={atSeatLimit}>Invite someone</Button>}
          />
        ) : listOf[tab].length === 0 ? (
          <EmptyState
            title={tab === "invites" ? "No invites waiting" : tab === "deactivated" ? "Nobody is deactivated" : "No one here yet"}
            hint={tab === "invites" ? "An invite holds a seat until it is accepted or revoked." : tab === "deactivated" ? "Someone you deactivate is listed here, and can be reactivated from their sheet." : "Invite someone to give them access."}
          />
        ) : shown.length === 0 ? (
          <NoMatches noun="people" onClear={() => { setQuery(""); setGroup("all"); }} />
        ) : (
          <table className={cn(st.table, "min-w-[760px]")} data-testid="team-settings">
            <thead>{head}</thead>
            <tbody>{shown.map(row)}</tbody>
          </table>
        )}
      </TableCard>

      {open && (
        <PersonSheet
          key={open.id}
          member={open}
          members={members}
          viewerId={viewerId}
          access={snapshot.teamAccess}
          statesAvailable={snapshot.licensedStatesAvailable !== false}
          bufferAtLimit={bufferAtLimit}
          setterAtLimit={setterAtLimit}
          setterFree={setter ? Math.max(0, (setter.limit ?? 0) - setter.usage) : null}
          carriersIn={carriersInState}
          onDirty={(count) => setSheetNote(count ? `${count} unsaved ${count === 1 ? "change" : "changes"}` : null)}
          onError={(text, retry) => setNote(text ? { tone: "bad", text, retry } : null)}
          onDeactivate={() => setDeactivating(open)}
          onChanged={refresh}
          onClose={() => { setOpenId(null); setSheetNote(null); }}
        />
      )}
      {inviteOpen && (
        <InviteSheet
          access={snapshot.teamAccess}
          freeSeats={freeSeats}
          atSeatLimit={atSeatLimit}
          bufferAtLimit={bufferAtLimit}
          setterAtLimit={setterAtLimit}
          statesAvailable={snapshot.licensedStatesAvailable !== false}
          onClose={() => setInviteOpen(false)}
          onInvited={async () => { setInviteOpen(false); setTab("invites"); await refresh(); }}
        />
      )}
      {deactivating && (
        <DeactivateDialog
          member={deactivating}
          members={members}
          onClose={() => setDeactivating(null)}
          onDone={async () => { setDeactivating(null); setOpenId(null); setSheetNote(null); await refresh(); }}
        />
      )}
    </SettingsStack>
  );
}
