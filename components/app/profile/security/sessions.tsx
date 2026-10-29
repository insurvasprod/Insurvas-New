"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { ProfileRow } from "../row";
import { call, LoadFailed, post, type Session, type When } from "./shared";

/** How many devices show before "Show N more". */
const FIRST = 3;

/**
 * Devices signed in: everywhere you are signed in. Signing one out ends it on its next click.
 * "Sign out the others" asks first and names how many, because it is a surprise for whoever is on them.
 */
export function Sessions({ sessions, failed, onRetry, onChanged, when }: {
  /** undefined while loading; null when the list is not available on this install. */
  sessions: Session[] | null | undefined;
  failed: boolean;
  onRetry: () => void;
  onChanged: () => void;
  when: When;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const others = sessions ? sessions.filter((s) => !s.current).length : 0;
  // This device first, then the most recently used; three show, the rest open on request.
  const ordered = sessions ? [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt)) : [];
  const first = ordered.slice(0, FIRST);
  const rest = ordered.slice(FIRST);

  const item = (s: Session) => (
    <li key={s.id} className="flex min-h-9 items-center justify-between gap-3 border-t border-[var(--border)] py-2 first:border-t-0 first:pt-0.5">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[var(--ink)]">{s.device}</div>
        <div className="text-xs text-[var(--muted)] tabular-nums">
          {[s.location ?? "Place unknown", s.ip, s.tenantName, `signed in ${when(s.createdAt)}`, s.current ? null : `last used ${when(s.lastSeenAt)}`].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="shrink-0">
        {s.current
          ? <StatusChip tone="good">You&apos;re using this</StatusChip>
          : <Button type="button" variant="ghost" disabled={busy} aria-label={`Sign out ${s.device}`} onClick={() => void endSession(s.id)}>Sign out</Button>}
      </div>
    </li>
  );

  async function endSession(id: string | null) {
    setBusy(true);
    const result = await call<{ ended: number }>("/api/app/profile/sessions", post(id ? { action: "end", id } : { action: "end_others" }));
    setBusy(false);
    setConfirming(false);
    if (!result.ok) { notify.fail(result.error); return; }
    notify.done(id ? "Signed out" : result.data.ended ? `${result.data.ended} other device${result.data.ended === 1 ? "" : "s"} signed out` : "No other devices were signed in");
    onChanged();
  }

  return (
    <ProfileRow
      id="security-sessions"
      label="Devices signed in"
      top
      actions={sessions && others > 0 ? <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>Sign out the others</Button> : undefined}
    >
      {sessions === undefined ? <SectionLoading rows={2} columns={2} label="Loading your devices" /> : failed ? (
        <div className="sm:pt-1"><LoadFailed what="your devices" onRetry={onRetry} /></div>
      ) : sessions === null ? (
        <p className="m-0 text-sm text-[var(--muted)] sm:pt-2">The list of devices is not available yet. Contact support.</p>
      ) : (
        <div className="flex flex-col text-sm">
          <ul className="m-0 flex list-none flex-col p-0">{first.map(item)}</ul>
          {rest.length > 0 && (
            <>
              {/* The rest slide open under the first three: rows of the same list, not a new page.
                  Closed, they are inert, so Tab and screen readers skip what cannot be seen. */}
              <div id="security-sessions-more" inert={!showAll} className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", showAll ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <ul className="m-0 flex min-h-0 list-none flex-col overflow-hidden p-0">{rest.map(item)}</ul>
              </div>
              <div className="border-t border-[var(--border)] pt-1.5">
                <Button type="button" variant="ghost" className="-ml-3" aria-expanded={showAll} aria-controls="security-sessions-more" onClick={() => setShowAll((value) => !value)}>
                  <ChevronDown aria-hidden="true" className={cn("transition-transform duration-200 motion-reduce:transition-none", showAll && "rotate-180")} />
                  {showAll ? "Show fewer" : `Show ${rest.length} more`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(open) => { if (!busy) setConfirming(open); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Sign out {others} other device{others === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>{others === 1 ? "It" : "They"} will need your password next time. You stay signed in here.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void endSession(null)}>{busy ? "Signing out…" : others === 1 ? "Sign it out" : "Sign them out"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProfileRow>
  );
}
