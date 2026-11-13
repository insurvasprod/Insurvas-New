"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { Field, control } from "@/components/app/settings/primitives";
import { takersFor } from "@/components/app/team-member-account";
import { notify } from "@/lib/notify";
import { reassignableCount, type OpenWork } from "@/lib/tenantTeam/openWork";
import type { TeamMember } from "@/lib/tenantTeam/service";

import { CheckLine, SendError, plural, send } from "./parts";

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/**
 * Board screen 4 · Deactivate, confirmed: it says what happens to their work, their seat and their
 * history before anything changes. Everything open moves to the one teammate named (the database
 * moves it all in one go, 20261015640000); extension access ends with the account either way.
 */
export function DeactivateDialog({ member, members, onClose, onDone }: { member: TeamMember; members: TeamMember[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [work, setWork] = useState<OpenWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taker, setTaker] = useState("");
  const [busy, setBusy] = useState(false);
  const name = firstName(member.name);

  useEffect(() => {
    let live = true;
    send<{ openWork: OpenWork }>(`/api/app/team/${member.id}/deactivate`, "GET")
      .then((body) => { if (live) setWork(body.openWork); })
      .catch((failure) => { if (live) setError(failure instanceof SendError && failure.status === 503 ? "Deactivating needs a database update that has not been applied yet." : failure instanceof Error ? failure.message : "Couldn't read their open work."); });
    return () => { live = false; };
  }, [member.id]);

  const takers = useMemo(() => takersFor(members, member, work), [members, member, work]);
  const needsTaker = work !== null && reassignableCount(work) > 0;
  const takerName = takers.find((m) => m.id === taker)?.name ?? "the teammate you pick";
  const follow = work ? work.queue_items + work.reinstatement_cases + work.servicing_requests : 0;

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/app/team/${member.id}/deactivate`, "POST", { reassignTo: needsTaker ? taker : null });
      notify.done(`${member.name} is deactivated. Their sessions end on their next click, and their history stays theirs.`);
      await onDone();
    } catch (failure) {
      if (failure instanceof SendError && failure.body?.openWork) setWork(failure.body.openWork as OpenWork);
      setError(failure instanceof Error ? `${failure.message} Nothing changed.` : "Couldn't deactivate. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Deactivate {member.name}?</DialogTitle>
          <DialogDescription>{name} can&rsquo;t sign in from now on. The seat is freed for someone new.</DialogDescription>
        </DialogHeader>
        {work === null && !error ? <SectionLoading rows={3} columns={1} label="Reading their open work" /> : (
          <div className="flex flex-col gap-3">
            {needsTaker && (
              <Field label="Hand their work to" htmlFor="deactivate-taker" hint="Only teammates who can work all of it are listed.">
                <select id="deactivate-taker" className={control} value={taker} onChange={(event) => setTaker(event.target.value)}>
                  <option value="">Choose a teammate</option>
                  {takers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
            )}
            <div>
              {work && (work.claimed_leads > 0 || work.callbacks > 0) && (
                <CheckLine checked disabled title={`Move ${name}'s ${[work.claimed_leads ? plural(work.claimed_leads, "lead") : null, work.callbacks ? plural(work.callbacks, "callback") : null].filter(Boolean).join(" and ")} to ${takerName}`} />
              )}
              {work && work.appointments > 0 && <CheckLine checked disabled title={`Move ${plural(work.appointments, "upcoming appointment")} to ${takerName}`} />}
              {work && follow > 0 && (
                <CheckLine checked disabled title={`Move ${plural(follow, "open follow-up")} to ${takerName}`} help="Queue items, reinstatement cases and servicing requests. Who asked for a request stays on it." />
              )}
              {work && !needsTaker && <CheckLine checked disabled title={`${name} has no open work`} />}
              <CheckLine checked disabled title={`End ${name}'s browser-extension access`} help="Done anyway when they're deactivated" />
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">Their policies and commission history stay. You can reactivate them from Deactivated.</p>
            {error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{error}</p>}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy || work === null || (needsTaker && !taker)} onClick={() => void deactivate()}>
            {busy ? "Deactivating…" : `Deactivate ${name}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
