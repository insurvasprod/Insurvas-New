"use client";

import { useMemo, useState } from "react";
import { Check, LogOut, MoreHorizontal, Pencil, Search, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { inputControl } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { canAddPeople, canChangeRole, canManage, canRemove, ROLE_HINT, ROLE_LABEL, type ChannelMember, type ChannelRole } from "@/lib/partnerChat/groupRules";
import { cn } from "@/lib/utils";

/**
 * Group members (owner, 2026-10-28): who is in a group and what each may do. The owner and admins add
 * and remove people and set each person's role — Admin, Member or Read only — and whether a member may
 * add people too. Anyone but the owner can leave; when the owner leaves, the longest-standing admin
 * takes over. The rules live in lib/partnerChat/groupRules.ts, which the server applies as well.
 */

export type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; partnerId?: string; partnerName?: string; role?: string };
export type GroupAction = (body: Record<string, unknown>, done: string) => Promise<boolean>;

function initials(name: string) { return name.split(/\s+/).filter((part) => /^[\p{L}\p{N}]/u.test(part)).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "?").join(""); }

export function PersonFace({ name, partner = false, scale = "md" }: { name: string; partner?: boolean; scale?: "sm" | "md" }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", scale === "sm" ? "size-7 text-xs" : "size-8 text-xs", partner ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
      {initials(name) || "?"}
    </span>
  );
}

/**
 * Pick people: search, then tick. A conversation may hold people from one partner at most (the server
 * refuses a mix), so once someone from a partner is picked, other partners' people are greyed out.
 */
export function PeoplePicker({ people, selected, onChange, single = false, lockedPartnerId = null }: { people: DirectoryUser[]; selected: string[]; onChange: (ids: string[]) => void; single?: boolean; lockedPartnerId?: string | null }) {
  const [query, setQuery] = useState("");
  const chosenPartner = lockedPartnerId ?? people.find((person) => selected.includes(person.id) && person.partnerId)?.partnerId ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((person) => !q || `${person.name} ${person.email} ${person.partnerName ?? ""}`.toLowerCase().includes(q));
  }, [people, query]);
  const team = shown.filter((person) => person.scope === "agent");
  const partners = shown.filter((person) => person.scope === "partner");
  const row = (person: DirectoryUser) => {
    const on = selected.includes(person.id);
    const blocked = !on && Boolean(person.partnerId && chosenPartner && person.partnerId !== chosenPartner);
    return (
      <li key={person.id}>
        <button
          type="button"
          role={single ? "radio" : "checkbox"}
          aria-checked={on}
          disabled={blocked}
          title={blocked ? "People from another partner go in a separate conversation" : undefined}
          onClick={() => onChange(single ? (on ? [] : [person.id]) : on ? selected.filter((id) => id !== person.id) : [...selected, person.id])}
          className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors", on ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]", blocked && "cursor-not-allowed opacity-45")}
        >
          <PersonFace name={person.name} partner={person.scope === "partner"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{person.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{person.partnerName ?? person.email}</span>
          </span>
          <span aria-hidden="true" className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-md border", single && "rounded-full", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--border-strong)]")}>{on && <Check className="size-3.5" />}</span>
        </button>
      </li>
    );
  };
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Search people</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or partner" className={cn(toolbarControl, "w-full pl-9")} />
      </label>
      <div className="max-h-72 min-h-0 overflow-y-auto rounded-xl border border-border p-1">
        {shown.length === 0 ? <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">Nobody matches “{query}”.</p> : (
          <>
            {team.length > 0 && <><p className="m-0 px-2 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">Your team</p><ul className="m-0 list-none p-0">{team.map(row)}</ul></>}
            {partners.length > 0 && <><p className="m-0 px-2 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">Partners</p><ul className="m-0 list-none p-0">{partners.map(row)}</ul></>}
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_CHOICES: ChannelRole[] = ["admin", "member", "viewer"];

/** The members section of a group's details. */
export function GroupMembers({ channelId, channelName, members, directory, viewerId, closed, act }: { channelId: string; channelName: string; members: ChannelMember[]; directory: DirectoryUser[]; viewerId: string | null; closed: boolean; act: GroupAction }) {
  const me = members.find((member) => member.userId === viewerId);
  const person = (id: string) => directory.find((user) => user.id === id);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const manage = !closed && canManage(me);

  async function leave() {
    const owner = me?.role === "owner";
    const ok = await confirmAction({ title: "Leave this group?", description: owner ? "You stop seeing new messages. The longest-standing admin becomes the owner." : "You stop seeing new messages. Someone in the group can add you back.", confirmLabel: "Leave group", cancelLabel: "Stay" });
    if (ok && viewerId) await act({ action: "remove_member", channel_id: channelId, user_id: viewerId }, "You left the group");
  }
  async function remove(member: ChannelMember) {
    const name = person(member.userId)?.name ?? "This person";
    const ok = await confirmAction({ title: `Remove ${name}?`, description: `${name} stops seeing this group. The messages they wrote stay.`, confirmLabel: "Remove", cancelLabel: "Keep" });
    if (ok) await act({ action: "remove_member", channel_id: channelId, user_id: member.userId }, `${name} removed`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="m-0 flex-1 text-xs font-semibold tracking-[0.02em] text-muted-foreground uppercase">Members · {members.length}</h3>
        {!closed && canAddPeople(me) && <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}><UserPlus aria-hidden="true" />Add people</Button>}
      </div>
      {manage && (renaming === null
        ? <button type="button" onClick={() => setRenaming(channelName)} className="-mx-2 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-alt)]"><Pencil className="size-3.5" aria-hidden="true" />Rename the group</button>
        : (
          <form className="flex gap-1.5" onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "rename_channel", channel_id: channelId, name: renaming }, "Group renamed")) setRenaming(null); }}>
            <input aria-label="Group name" autoFocus maxLength={160} value={renaming} onChange={(event) => setRenaming(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} className={cn(inputControl, "min-w-0 flex-1")} />
            <Button type="submit" size="sm" disabled={!renaming.trim()}>Save</Button>
          </form>
        ))}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {members.map((member) => {
          const user = person(member.userId);
          const name = user?.name ?? "Former teammate";
          const you = member.userId === viewerId;
          const roles = ROLE_CHOICES.filter((role) => role === member.role || canChangeRole(me, member, role));
          const editable = !closed && !you && (roles.length > 1 || canRemove(me, member));
          return (
            <li key={member.userId} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-alt)]">
              <PersonFace name={name} partner={user?.scope === "partner"} scale="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{name}{you && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.partnerName ?? "Your team"}{member.role === "member" && member.canAddMembers ? " · can add people" : ""}</span>
              </span>
              <StatusChip tone={member.role === "owner" || member.role === "admin" ? "action" : "neutral"} dot={false}>{ROLE_LABEL[member.role]}</StatusChip>
              {editable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Change ${name}'s role`}><MoreHorizontal aria-hidden="true" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {roles.length > 1 && (
                      <>
                        <DropdownMenuLabel>Role</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={member.role} onValueChange={(role) => { void act({ action: "set_member", channel_id: channelId, user_id: member.userId, role, can_add_members: role === "member" && member.canAddMembers }, `${name} is now ${ROLE_LABEL[role as ChannelRole].toLowerCase()}`); }}>
                          {roles.map((role) => (
                            <DropdownMenuRadioItem key={role} value={role} className="items-start">
                              <span className="flex flex-col"><span>{ROLE_LABEL[role]}</span><span className="text-xs text-muted-foreground">{ROLE_HINT[role]}</span></span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {member.role === "member" && (
                          <DropdownMenuCheckboxItem checked={member.canAddMembers} onCheckedChange={(checked) => { void act({ action: "set_member", channel_id: channelId, user_id: member.userId, role: "member", can_add_members: checked === true }, checked ? `${name} can add people` : `${name} can no longer add people`); }}>
                            Can add people
                          </DropdownMenuCheckboxItem>
                        )}
                      </>
                    )}
                    {canRemove(me, member) && (
                      <>
                        {roles.length > 1 && <DropdownMenuSeparator />}
                        <DropdownMenuItem variant="destructive" onSelect={() => { void remove(member); }}><UserMinus aria-hidden="true" />Remove from group</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
      {me && !closed && <Button type="button" variant="ghost" size="sm" className="self-start text-[var(--error-ink)]" onClick={() => void leave()}><LogOut aria-hidden="true" />Leave group</Button>}
      {adding && <AddPeopleDialog channelId={channelId} members={members} directory={directory} viewerId={viewerId} canGiveRoles={manage} ownerGiving={me?.role === "owner"} act={act} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddPeopleDialog({ channelId, members, directory, viewerId, canGiveRoles, ownerGiving, act, onClose }: { channelId: string; members: ChannelMember[]; directory: DirectoryUser[]; viewerId: string | null; canGiveRoles: boolean; ownerGiving: boolean; act: GroupAction; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [role, setRole] = useState<ChannelRole>("member");
  const [busy, setBusy] = useState(false);
  const inGroup = new Set(members.map((member) => member.userId));
  const people = directory.filter((user) => !inGroup.has(user.id) && user.id !== viewerId);
  // The group's partner, if it already holds someone from one: only that partner's people may join.
  const groupPartner = directory.find((user) => inGroup.has(user.id) && user.partnerId)?.partnerId ?? null;
  const roleChoices = ROLE_CHOICES.filter((choice) => choice !== "admin" || ownerGiving);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>They see the group from now on, with the messages already in it.</DialogDescription>
        </DialogHeader>
        <PeoplePicker people={people} selected={ids} onChange={setIds} lockedPartnerId={groupPartner} />
        {canGiveRoles && (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-label text-[var(--body)]">Their role</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {roleChoices.map((choice) => (
                <button key={choice} type="button" aria-pressed={role === choice} onClick={() => setRole(choice)} title={ROLE_HINT[choice]} className={cn("flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors", role === choice ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border hover:bg-[var(--surface-alt)]")}>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">{choice === "admin" && <ShieldCheck className="size-3.5" aria-hidden="true" />}{ROLE_LABEL[choice]}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{ROLE_HINT[choice]}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || ids.length === 0} onClick={async () => { setBusy(true); const ok = await act({ action: "add_members", channel_id: channelId, user_ids: ids, role }, ids.length === 1 ? "Added to the group" : `${ids.length} people added`); setBusy(false); if (ok) onClose(); }}>
            {busy ? "Adding…" : ids.length > 1 ? `Add ${ids.length} people` : "Add to group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
