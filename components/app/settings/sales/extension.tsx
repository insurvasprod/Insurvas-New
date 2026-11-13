"use client";

/**
 * Settings › Browser extension, settings round 8 wave 3 (board docs/design/settings-r8/team-carriers.html,
 * screens 12–14; owner "Build all four", 2026-11-12). One calm page: is it installed (the status line and
 * a small side card), which carrier sites it fills and whether each still works, who may use it (one line
 * a person, Revoke at the row's end), and how it works in three lines. Grant history, every grant and
 * every revocation, opens from "Recent fills". `?preview=sample` (outside production) shows the fixtures.
 *
 * Reads GET /api/app/extension/grants (the sites and recent grants) and, for an owner,
 * GET /api/app/extension/people (who can use it). Revoking one person goes through
 * POST /api/app/extension/people; "Revoke everyone" through POST /api/app/extension/grants/revoke.
 */

import { useCallback, useEffect, useState } from "react";

import { useExtensionVersion } from "@/components/app/applications/submit/use-extension";
import { SettingsStack, st } from "@/components/app/settings/primitives";
import { Avatar, CheckLine, InlineLink, StatusLine, plural, send, SendError, type LineTone } from "@/components/app/settings/team/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { EXTENSION_GRANTS, EXTENSION_STATE, GRANT_MINUTES, SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { EXTENSION_LATEST_VERSION, GRANT_LIFETIME_MINUTES, type GrantStatus } from "@/lib/extension/constants";
import type { CarrierSiteView, GrantView } from "@/lib/extension/types";
import { dateTime, dayMonth, dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { SalesPanelTop, notRefreshed, notSaved, useSalesSample } from "./shared";

const host = (origin: string) => origin.replace(/^https:\/\//, "");
const when = (iso: string) => dateTime(iso, viewerTimeZone(), { clock: "12h" });
const sameDay = (a: string, b: number) => dayMonthYear(a, viewerTimeZone()) === dayMonthYear(new Date(b).toISOString(), viewerTimeZone());

type Row = { id: string; clientName: string; reference: string | null; carrierName: string; origin: string; issuedAt: string; revokedAt: string | null; fieldsRead: number; status: GrantStatus; mine: boolean };
type Site = CarrierSiteView & { fillsThisMonth: number };
type Person = { id: string; name: string; role: string; blockedAll: boolean; blockedCarrierIds: string[]; usedCarrierIds: string[]; fillsThisMonth: number; lastFillAt: string | null; firstFillAt: string | null; activeGrantIds: string[] };
type People = { people: Person[]; sites: Site[]; lastFill: { at: string; name: string } | null; blocksReady: boolean };
type Live = { grants: GrantView[]; sites: CarrierSiteView[]; canRevokeAll: boolean };

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SAMPLE_ROWS: Row[] = EXTENSION_GRANTS.map((g) => ({
  id: g.id, clientName: g.clientName, reference: g.reference, carrierName: g.carrierName, origin: g.origin, issuedAt: minutesAgo(g.openedMinutesAgo),
  revokedAt: g.status === "revoked" ? minutesAgo(Math.max(0, g.openedMinutesAgo - 5)) : null, fieldsRead: g.fieldsRead, mine: true,
  status: g.status === "active" && g.openedMinutesAgo >= GRANT_MINUTES ? "expired" : g.status,
}));
const SAMPLE_SITES: Site[] = SALES_CARRIERS.map((c, index) => ({ carrierId: c.id, name: c.name, origin: c.portalOrigin, fieldMap: index === 3 ? "needs_review" : "published", fillsThisMonth: 0 }));

const WORKS: Record<CarrierSiteView["fieldMap"], { tone: StatusTone; label: string; fills: string }> = {
  published: { tone: "good", label: "Working", fills: "Application" },
  needs_review: { tone: "warning", label: "Site changed", fills: "Application" },
  draft: { tone: "info", label: "Being mapped", fills: "Not yet" },
  none: { tone: "neutral", label: "Not mapped", fills: "Not yet" },
};

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

export function SalesExtension() {
  const sample = useSalesSample();
  const version = useExtensionVersion();
  const now = useNow(30_000);
  const [live, setLive] = useState<Live | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [peopleDenied, setPeopleDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);
  const [query, setQuery] = useState("");
  const [revoking, setRevoking] = useState<Person | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);
  const [history, setHistory] = useState(false);
  const [note, setNote] = useState<{ tone: LineTone; text: string; retry?: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [grants, who] = await Promise.all([
        send<Live>("/api/app/extension/grants", "GET"),
        send<People>("/api/app/extension/people", "GET").then((value) => ({ value, denied: false }), (failure) => ({ value: null, denied: failure instanceof SendError && failure.status === 403 })),
      ]);
      setLive(grants);
      setPeople(who.value);
      setPeopleDenied(who.denied);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't reach Insurvas. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const rows: Row[] = sample ? SAMPLE_ROWS : (live?.grants ?? []).map((g) => ({
    id: g.id, clientName: g.clientName, reference: g.reference, carrierName: g.carrierName, origin: g.origin, fieldsRead: g.fieldsRead, mine: g.mine,
    issuedAt: g.issuedAt, revokedAt: g.revokedAt,
    status: g.status === "active" && new Date(g.expiresAt).getTime() <= now ? "expired" : g.status,
  }));
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sites: Site[] = sample ? SAMPLE_SITES : people?.sites ?? (live?.sites ?? []).map((site) => ({ ...site, fillsThisMonth: rows.filter((g) => g.origin === site.origin && Date.parse(g.issuedAt) >= monthStart.getTime()).length }));
  const canRevokeAll = sample || Boolean(live?.canRevokeAll);
  const active = rows.filter((g) => g.status === "active");
  const detected = sample ? EXTENSION_STATE.detected : Boolean(version);
  const installedVersion = sample ? EXTENSION_STATE.version : version;
  const latest = sample ? EXTENSION_STATE.latestVersion : EXTENSION_LATEST_VERSION;
  const refresh = sample ? notRefreshed : load;
  const nameOf = (carrierId: string) => sites.find((site) => site.carrierId === carrierId)?.name ?? "a carrier";
  const allowedOf = (person: Person) => (person.blockedAll ? [] : sites.filter((site) => !person.blockedCarrierIds.includes(site.carrierId)));
  // Revoked: barred from every site (or from each of the sites there are). With no sites yet, nobody is.
  const isRevoked = (person: Person) => person.blockedAll || (sites.length > 0 && allowedOf(person).length === 0);
  const canUse = (people?.people ?? []).filter((person) => !isRevoked(person));

  // ── the status line ────────────────────────────────────────────────────────────────────────────
  const changed = sites.find((site) => site.fieldMap === "needs_review") ?? null;
  const lastFill = people?.lastFill ?? (rows[0] ? { at: rows[0].issuedAt, name: rows[0].mine ? "you" : "a teammate" } : null);
  let tone: LineTone = detected ? (changed ? "warn" : "ok") : "warn";
  let line: React.ReactNode = (
    <>
      {detected ? `Installed on this device · version ${installedVersion}${installedVersion && installedVersion !== latest ? ` (latest is ${latest})` : ""}` : "Not installed on this device"}
      {people ? ` · ${plural(canUse.length, "person", "people")} can use it` : ""}
      {lastFill ? ` · last fill ${sameDay(lastFill.at, now) ? "today" : dayMonth(lastFill.at, viewerTimeZone())} ${when(lastFill.at).split(", ")[1] ?? ""} by ${lastFill.name}` : ""}
      {changed ? ` · ${changed.name} changed its site; fills may miss fields until it is re-mapped, and agents can finish by hand` : ""}
    </>
  );
  if (loading && !live) { tone = "muted"; line = <>Checking the extension</>; }
  if (error && !sample) { tone = "bad"; line = <>{error} · <InlineLink onClick={() => void load()}>Try again</InlineLink></>; }
  if (note) { tone = note.tone; line = <>{note.text}{note.retry && <> · <InlineLink onClick={note.retry}>Try again</InlineLink></>}</>; }

  async function revokePerson(person: Person, carrierId: string | null) {
    if (sample) { notSaved(); setRevoking(null); return; }
    setNote(null);
    try {
      const result = await send<{ revoked: number; blocked: boolean }>("/api/app/extension/people", "POST", { userId: person.id, carrierId });
      setRevoking(null);
      notify.done(result.blocked
        ? `${person.name} can no longer use the extension${carrierId ? ` for ${nameOf(carrierId)}` : ""}.`
        : `${person.name}'s live fills ended (${result.revoked}). Stopping new ones needs a database update.`);
      await load();
    } catch (failure) {
      setRevoking(null);
      setNote({ tone: "bad", text: `Couldn't revoke ${person.name}'s access. They can still use it. ${failure instanceof Error ? failure.message : ""}`.trim(), retry: () => void revokePerson(person, carrierId) });
    }
  }

  async function giveBack(person: Person) {
    setNote(null);
    try {
      await send("/api/app/extension/people", "DELETE", { userId: person.id, carrierId: null });
      notify.done(`${person.name} can use the extension again.`);
      await load();
    } catch (failure) {
      setNote({ tone: "bad", text: failure instanceof Error ? failure.message : "Couldn't give access back.", retry: () => void giveBack(person) });
    }
  }

  async function revokeEveryone() {
    if (sample) { notSaved(); setRevokeAll(false); return; }
    try {
      const result = await send<{ revoked: number }>("/api/app/extension/grants/revoke", "POST", {});
      notify.done(result.revoked ? `${plural(result.revoked, "live fill")} ended` : "Nothing was live");
      await load();
    } catch (failure) {
      setNote({ tone: "bad", text: failure instanceof Error ? failure.message : "Couldn't revoke. Try again.", retry: () => void revokeEveryone() });
    } finally {
      setRevokeAll(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const peopleShown = (people?.people ?? []).filter((person) => !needle || person.name.toLowerCase().includes(needle));
  const siteWords = (person: Person) => {
    const allowed = allowedOf(person);
    if (allowed.length === sites.length) return sites.length ? `All ${sites.length}` : "Every site, once added";
    return allowed.map((site) => site.name).join(", ");
  };

  return (
    <SettingsStack className="gap-4">
      <SalesPanelTop sample={sample} actions={<Button type="button" variant="outline" onClick={() => void refresh()}>Check again</Button>} />
      <StatusLine tone={tone}>{line}</StatusLine>

      <div className="flex flex-col gap-4 @5xl:flex-row @5xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TableCard title="Carrier sites it fills" action={<span className="text-xs text-[var(--muted)]">{plural(sites.length, "site")}</span>}>
            {loading && !live && !sample ? <SectionLoading rows={4} columns={5} label="Reading the carrier sites" /> : sites.length === 0 ? (
              <EmptyState title="No carrier sites yet" hint="A carrier with a portal address in Carriers gets a site here. It has no access to any other site." />
            ) : (
              <table className={cn(st.table, "min-w-[640px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Carrier</th>
                    <th scope="col" className={st.th}>Site</th>
                    <th scope="col" className={st.th}>Fills</th>
                    <th scope="col" className={cn(st.th, st.num)}>Fills this month</th>
                    <th scope="col" className={st.th}>Works</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.carrierId}>
                      <td className={cn(st.td, "font-semibold whitespace-nowrap text-[var(--ink)]")}>{site.name}</td>
                      <td className={cn(st.td, "max-w-[220px] truncate whitespace-nowrap")} title={host(site.origin)}>{host(site.origin)}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{WORKS[site.fieldMap].fills}</td>
                      <td className={cn(st.td, st.num)}>{site.fillsThisMonth}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={WORKS[site.fieldMap].tone}>{WORKS[site.fieldMap].label}</StatusChip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>

          <TableCard
            title="Who can use it"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {people && people.people.length > 0 && <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a person" className="sm:w-44" />}
                <Button type="button" variant="ghost" size="sm" onClick={() => setHistory(true)}>Recent fills</Button>
                {canRevokeAll && <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" disabled={active.length === 0} title={active.length === 0 ? "No fill is live right now." : undefined} onClick={() => setRevokeAll(true)}>Revoke everyone…</Button>}
              </div>
            }
            footer={<span className="text-xs text-[var(--muted)]">Setters and intake never get the extension{people && !people.blocksReady ? " · revoking for good, or for one carrier, needs a database update" : ""}</span>}
          >
            {loading && !people && !sample ? <SectionLoading rows={4} columns={5} label="Reading who can use it" /> : peopleDenied || sample ? (
              <EmptyState title="Only admins and the owner can give or revoke access" hint="Your own fills are under Recent fills." />
            ) : !people ? (
              <EmptyState title="Couldn't read who can use it" hint="The carrier sites above still work." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
            ) : people.people.length === 0 ? (
              <EmptyState title="Nobody can use it yet" hint="Owners and agents can, once they're on the team." />
            ) : peopleShown.length === 0 ? (
              <NoMatches noun="people" onClear={() => setQuery("")} />
            ) : (
              <table className={cn(st.table, "min-w-[640px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Person</th>
                    <th scope="col" className={st.th}>Carrier sites</th>
                    <th scope="col" className={cn(st.th, st.num)}>Fills this month</th>
                    <th scope="col" className={st.th}>Last fill</th>
                    <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Revoke</span></th>
                  </tr>
                </thead>
                <tbody>
                  {peopleShown.map((person) => {
                    const off = isRevoked(person);
                    return (
                      <tr key={person.id}>
                        <td className={cn(st.td, "whitespace-nowrap")}><span className="flex items-center gap-2"><Avatar name={person.name} size="sm" /><span className="font-semibold text-[var(--ink)]">{person.name}</span>{person.role === "owner" && <span className="text-xs text-[var(--muted)]">Owner</span>}</span></td>
                        <td className={cn(st.td, "max-w-[280px] truncate whitespace-nowrap")} title={siteWords(person)}>{off ? <StatusChip tone="neutral">Revoked</StatusChip> : siteWords(person)}</td>
                        <td className={cn(st.td, st.num)}>{person.fillsThisMonth}</td>
                        <td className={cn(st.td, "whitespace-nowrap")}>{person.lastFillAt ? dayMonth(person.lastFillAt, viewerTimeZone()) : <span className="text-[var(--muted)]">Never</span>}</td>
                        <td className={cn(st.td, "text-right whitespace-nowrap")}>
                          {person.role === "owner" ? null : off || person.blockedCarrierIds.length > 0 ? (
                            <InlineLink onClick={() => void giveBack(person)}>Give back</InlineLink>
                          ) : (
                            <InlineLink onClick={() => { setNote(null); setRevoking(person); }}>Revoke</InlineLink>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 @5xl:w-[340px]">
          <TableCard>
            {detected ? (
              <div className="flex items-center gap-3 p-4">
                <span aria-hidden="true" className="inline-grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--primary-soft)] font-bold text-[var(--accent-ink)]">✓</span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-[var(--ink)]">Installed in Chrome</span>
                  <span className="block text-xs text-[var(--muted)]">This device · version {installedVersion} · {installedVersion === latest ? "up to date" : `latest is ${latest}`}</span>
                </span>
              </div>
            ) : (
              <EmptyState
                title="Not installed on this device"
                hint="Install it in Chrome to fill carrier applications from a case in one click. Per device and per person."
                action={<Button type="button" variant="highlight" onClick={() => (sample ? notSaved() : notify.warn("The extension isn't in the Chrome Web Store yet — your Insurvas admin can load it for you."))}>Install for Chrome</Button>}
              />
            )}
          </TableCard>
          <TableCard title="How it works">
            <ol className="m-0 flex list-none flex-col px-4 pb-2">
              {[
                "An agent opens a case and clicks “Fill on carrier site”.",
                "The extension copies the answers into the carrier’s own e-app. The agent reviews and submits there.",
                `Each fill lasts ${GRANT_LIFETIME_MINUTES} minutes and reads one application; Social Security, bank and card numbers are revealed one at a time. It never stores carrier passwords and only works for people listed here.`,
              ].map((text, index) => (
                <li key={index} className="flex gap-2.5 border-t border-[var(--border)] py-2.5 text-sm text-[var(--body)] first:border-t-0">
                  <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-xs font-bold text-[var(--muted)]">{index + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
          </TableCard>
        </aside>
      </div>

      {revoking && <RevokeDialog person={revoking} sites={allowedOf(revoking)} blocksReady={people?.blocksReady ?? false} onCancel={() => setRevoking(null)} onRevoke={(carrierId) => revokePerson(revoking, carrierId)} />}

      <Dialog open={revokeAll} onOpenChange={setRevokeAll}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>End {plural(active.length, "live fill")}?</DialogTitle>
            <DialogDescription>Every live fill, for every person in the agency, ends on the extension&rsquo;s next request. Each agent starts again from the case&rsquo;s Submit step. Nobody loses access.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRevokeAll(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void revokeEveryone()}>End them all</Button>
          </div>
        </DialogContent>
      </Dialog>

      {history && <HistorySheet rows={rows} onClose={() => setHistory(false)} />}
    </SettingsStack>
  );
}

/** Board screen 13 · Revoke one person: what stops and what doesn't; optionally only one carrier. */
function RevokeDialog({ person, sites, blocksReady, onCancel, onRevoke }: { person: Person; sites: Site[]; blocksReady: boolean; onCancel: () => void; onRevoke: (carrierId: string | null) => Promise<void> }) {
  const [onlyOne, setOnlyOne] = useState(false);
  const [carrierId, setCarrierId] = useState(sites.at(-1)?.carrierId ?? "");
  const [busy, setBusy] = useState(false);
  const names = sites.map((site) => site.name);
  const listed = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Revoke {person.name}&rsquo;s extension access?</DialogTitle>
          <DialogDescription>
            {person.name.split(/\s+/)[0]} stops filling {listed || "carrier"} applications from Insurvas straight away. Applications already sent aren&rsquo;t touched.
            {!blocksReady && " Stopping new fills for good needs a database update; until then only the live fills end."}
          </DialogDescription>
        </DialogHeader>
        {sites.length > 1 && (
          <div className="flex flex-col gap-2">
            <CheckLine checked={onlyOne} disabled={!blocksReady} onChange={setOnlyOne} title="Only for one carrier" help={blocksReady ? "Keep the others" : "Needs a database update"} />
            {onlyOne && (
              <select aria-label="Which carrier" className="h-9 rounded-md border border-[var(--border-strong)] bg-[var(--color-card)] px-3 text-sm text-[var(--body)]" value={carrierId} onChange={(event) => setCarrierId(event.target.value)}>
                {sites.map((site) => <option key={site.carrierId} value={site.carrierId}>{site.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { await onRevoke(onlyOne && carrierId ? carrierId : null); } finally { setBusy(false); } }}>{busy ? "Revoking…" : "Revoke"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Every grant and every revocation, newest first (it was its own card). */
function HistorySheet({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const events = rows
    .flatMap((g) => [{ key: `${g.id}-g`, at: g.issuedAt, revoked: false, g }, ...(g.revokedAt ? [{ key: `${g.id}-r`, at: g.revokedAt, revoked: true, g }] : [])])
    .sort((a, b) => b.at.localeCompare(a.at));
  const shown = paginate(events, page, 20);
  return (
    <Sheet title="Recent fills" subtitle="Every fill and every revocation in the last 30 days, newest first" onClose={onClose} footer={events.length > 20 ? <Pager page={shown.current} total={events.length} noun="events" pageSize={20} onPage={setPage} /> : undefined}>
      {events.length === 0 ? <EmptyState title="No fills yet" hint="A fill starts from an application's Submit step when the agent fills it on a carrier site." /> : (
        <ol className="m-0 flex list-none flex-col p-0">
          {shown.rows.map((h) => (
            <li key={h.key} className="flex gap-3 border-t border-[var(--border)] py-2.5 first:border-t-0">
              <span aria-hidden className={cn("mt-2 size-[7px] shrink-0 rounded-full", h.revoked ? "bg-[var(--error)]" : "bg-[var(--success)]")} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)]">{h.revoked ? "Revoked" : `${h.g.mine ? "You" : "A teammate"} filled`} on {host(h.g.origin)}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {when(h.at)} · {h.g.clientName}{h.g.reference ? ` (${h.g.reference})` : ""}{h.revoked ? "" : ` · ${plural(h.g.fieldsRead, "field")} read`}{!h.revoked && h.g.status === "active" ? " · live now" : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
