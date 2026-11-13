"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, control } from "@/components/app/settings/primitives";
import { TeamAccessPanel, type AccessDraft } from "@/components/app/team-access-panel";
import { notify } from "@/lib/notify";
import type { MemberRole } from "@/lib/tenantAuth/roles";
import type { TeamAccessSnapshot } from "@/lib/tenantTeam/access";

import { ChoiceCard, SheetSection, send } from "./parts";
import { MAIN_ROLES, MORE_ROLES, isLicensed } from "./roles";
import { StateChips } from "./state-chips";

/**
 * Board screen 3 · Invite someone, as a right sheet: who, what they'll do, where they're licensed
 * (optional), and the seat it uses said before it sends. Licensed states and custom access are saved
 * on the new person straight after the invitation is made.
 */
export function InviteSheet({ access, freeSeats, atSeatLimit, bufferAtLimit, setterAtLimit, statesAvailable, onClose, onInvited }: {
  access?: TeamAccessSnapshot;
  freeSeats: number | null;
  atSeatLimit: boolean;
  bufferAtLimit: boolean;
  setterAtLimit: boolean;
  statesAvailable: boolean;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("producer");
  const [more, setMore] = useState(false);
  const [states, setStates] = useState<string[]>([]);
  const [expiries, setExpiries] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState<AccessDraft>({ extraRoles: [], hiddenPages: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = atSeatLimit ? "Every seat is in use. Free one or add seats before this invite can go."
    : role === "setter" && setterAtLimit ? "Your plan's setter seats are all in use."
      : role === "assistant" && bufferAtLimit ? "Your plan's buffer seats are all in use."
        : null;

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const body = await send<{ member?: { id?: string }; invite?: { delivered?: boolean } }>("/api/app/team", "POST", { name, email, role });
      const memberId = body.member?.id;
      const later: string[] = [];
      if (memberId && states.length && isLicensed(role) && statesAvailable) {
        await send(`/api/app/team/${memberId}/licensed-states`, "PUT", { states: [...states].sort(), expiries: Object.fromEntries(states.map((state) => [state, expiries[state] ?? null])) }).catch(() => later.push("licensed states"));
      }
      if (memberId && access?.available && (draft.extraRoles.length || draft.hiddenPages.length)) {
        await send(`/api/app/team/${memberId}/access`, "PUT", { extraRoles: draft.extraRoles, hiddenPages: draft.hiddenPages }).catch(() => later.push("extra roles and pages"));
      }
      if (later.length) notify.fail(`Invited, but their ${later.join(" and ")} did not save. Open them on Invites to try again.`);
      else notify.done(body.invite?.delivered ? `Invitation sent to ${email}` : "Invited — copy the link from the server log if email is not configured");
      await onInvited();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not invite this teammate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Invite someone"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-[var(--muted)]">{blocked ?? (freeSeats === null ? "Uses a seat until it is accepted or revoked" : `Uses 1 of ${freeSeats} free ${freeSeats === 1 ? "seat" : "seats"} until it is accepted or revoked`)}</span>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="team-invite-form" disabled={busy || Boolean(blocked)}>{busy ? "Sending…" : "Send invite"}</Button>
        </div>
      }
    >
      <form id="team-invite-form" className="flex flex-col gap-4" onSubmit={(event) => void invite(event)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First and last name" htmlFor="invite-name" required>
            <input id="invite-name" className={control} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoComplete="off" />
          </Field>
          <Field label="Work email" htmlFor="invite-email" required>
            <input id="invite-email" type="email" className={control} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required autoComplete="off" />
          </Field>
        </div>
        <SheetSection title="What they'll do">
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Role">
            {[...MAIN_ROLES, ...(more ? MORE_ROLES : [])].map((choice) => (
              <ChoiceCard key={choice.role} name="invite-role" selected={role === choice.role} onSelect={() => setRole(choice.role)} title={choice.label} help={choice.help} />
            ))}
            {!more && <button type="button" className="w-fit border-0 bg-transparent p-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => setMore(true)}>More roles</button>}
          </div>
        </SheetSection>
        {isLicensed(role) && statesAvailable && (
          <SheetSection title="Licensed in" help="Optional. You can add these after they accept.">
            <StateChips states={states} expiries={expiries} onChange={(nextStates, nextExpiries) => { setStates(nextStates); setExpiries(nextExpiries); }} />
          </SheetSection>
        )}
        {access?.schemaReady && access.available && (
          <SheetSection title="Extra roles and pages">
            <TeamAccessPanel access={access} mainRole={role} value={draft} onChange={setDraft} onPreset={(preset) => setRole(preset)} />
          </SheetSection>
        )}
        {error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{error}</p>}
      </form>
    </Sheet>
  );
}
