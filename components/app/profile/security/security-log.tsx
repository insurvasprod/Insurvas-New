"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";

import { LoadFailed, type SecurityEvent, type When } from "./shared";

/** The latest ten, then "Show more" up to the fifty the route returns. */
const FIRST = 10;
const MOST = 50;

/**
 * What the log holds (lib/users/securityEvents.ts), said on the card: it is not a list of every
 * sign-in, and "Nothing yet" read as broken without it (owner, 2026-10-27).
 */
const WHAT_IT_LISTS = "Changes to how you sign in (password, email, two-step sign-in, devices signed out) and runs of wrong passwords in the last 90 days.";

/**
 * My profile › History › Sign-ins and security (moved here from Signing in, owner 2026-10-27): the
 * account's own security log, beside the settings it changed. What to do about a line you do not
 * recognize lives on Signing in, so the card links back there.
 */
export function SignInHistory({ events, failed, onRetry, when, onGoToSigningIn }: {
  /** undefined while loading; null when the log is not available on this install. */
  events: SecurityEvent[] | null | undefined;
  failed: boolean;
  onRetry: () => void;
  when: When;
  onGoToSigningIn: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = events ? events.slice(0, all ? MOST : FIRST) : [];
  const more = events ? Math.min(events.length, MOST) > FIRST : false;

  return (
    <section id="security-log" aria-labelledby="security-log-heading" className="scroll-mt-24 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <header className="px-5 py-3">
        {/* Named for screen readers only: the History switch above already says it. */}
        <h3 id="security-log-heading" className="sr-only">Sign-ins and security</h3>
        <p className="text-sm text-[var(--muted)]">{WHAT_IT_LISTS}</p>
      </header>
      <div className="border-t border-[var(--border)] px-5 py-3">
        {events === undefined ? <SectionLoading rows={3} columns={2} label="Loading your sign-ins" /> : failed ? (
          <LoadFailed what="your sign-ins" onRetry={onRetry} />
        ) : events === null ? (
          <p className="m-0 text-sm text-[var(--muted)]">This list is not available yet. Contact support.</p>
        ) : events.length === 0 ? (
          <p className="m-0 text-sm text-[var(--ink)]">Nothing has happened yet.</p>
        ) : (
          <ul id="security-log-list" className="m-0 flex list-none flex-col p-0">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-[var(--border)] py-2 text-sm first:border-t-0 first:pt-0">
                <span className={e.type === "failed_logins" ? "font-semibold text-[var(--warning-ink)]" : "text-[var(--ink)]"}>{e.label}</span>
                <span className="text-xs text-[var(--muted)] tabular-nums">{when(e.at)}{e.ip ? ` · ${e.ip}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-2.5">
        <p className="m-0 text-xs text-[var(--muted)]">Don&apos;t recognize something? Change your password, then sign out the other devices.</p>
        <span className="flex gap-2">
          {more && <Button type="button" variant="ghost" aria-expanded={all} aria-controls="security-log-list" onClick={() => setAll((value) => !value)}>{all ? "Show fewer" : "Show more"}</Button>}
          <Button type="button" variant="outline" onClick={onGoToSigningIn}>Go to Signing in</Button>
        </span>
      </footer>
    </section>
  );
}
