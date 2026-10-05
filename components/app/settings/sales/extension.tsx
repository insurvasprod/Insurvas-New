"use client";

/**
 * Settings › Sales › Browser extension (board l3-set-extension, LA-3.12). Reads
 * GET /api/app/extension/grants and revokes through POST /api/app/extension/grants/revoke;
 * `?preview=sample` (outside production) renders the design fixtures instead.
 *
 * Whether this browser has the extension; the carrier sites it may run on (built from each carrier's
 * portal origin — it has no access to any other site) with who last opened a grant there; every
 * grant and revocation; and the fixed facts about what a grant can do. Each grant lets the extension
 * read one application's fields on one carrier site for 60 minutes, and revocation is checked on
 * every request.
 */

import { useCallback, useEffect, useState } from "react";
import { notify } from "@/lib/notify";

import { useExtensionVersion } from "@/components/app/applications/submit/use-extension";
import { Pill, SettingsCard, SettingsStack, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { EXTENSION_GRANTS, EXTENSION_STATE, GRANT_MINUTES, SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { EXTENSION_LATEST_VERSION, GRANT_LIFETIME_MINUTES, type GrantStatus } from "@/lib/extension/constants";
import type { CarrierSiteView, GrantView } from "@/lib/extension/types";
import { cn } from "@/lib/utils";

import { DialogActions, SalesDialog, SalesLoadError, SalesPanelTop, WithReason, notRefreshed, notSaved, plural, useSalesSample } from "./shared";

const HISTORY_PAGE = 10;
const host = (origin: string) => origin.replace(/^https:\/\//, "");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

type Row = { id: string; clientName: string; reference: string | null; carrierName: string; origin: string; issuedAt: string; revokedAt: string | null; fieldsRead: number; status: GrantStatus; mine: boolean };
type Site = { id: string; name: string; origin: string };
type Live = { grants: GrantView[]; sites: CarrierSiteView[]; canRevokeAll: boolean };

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SAMPLE_ROWS: Row[] = EXTENSION_GRANTS.map((g) => ({
  id: g.id, clientName: g.clientName, reference: g.reference, carrierName: g.carrierName, origin: g.origin, issuedAt: minutesAgo(g.openedMinutesAgo),
  revokedAt: g.status === "revoked" ? minutesAgo(Math.max(0, g.openedMinutesAgo - 5)) : null, fieldsRead: g.fieldsRead, mine: true,
  status: g.status === "active" && g.openedMinutesAgo >= GRANT_MINUTES ? "expired" : g.status,
}));
const SAMPLE_SITES: Site[] = SALES_CARRIERS.map((c) => ({ id: c.id, name: c.name, origin: c.portalOrigin }));

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Who opened a grant. The grants API marks the viewer's own; it does not name teammates. */
const who = (g: Row) => (g.mine ? "You" : "A teammate");

export function SalesExtension() {
  const sample = useSalesSample();
  const version = useExtensionVersion();
  const now = useNow(30_000);
  const [confirming, setConfirming] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);
  const [busy, setBusy] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/extension/grants", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Grants could not be loaded.");
      } else {
        setLive(data as Live);
        setError(null);
      }
    } catch {
      setError("Couldn't reach Insurvas. Check your connection and try again.");
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
    // An active grant whose hour has passed on this clock reads as expired without a reload.
    status: g.status === "active" && new Date(g.expiresAt).getTime() <= now ? "expired" : g.status,
  }));
  const sites: Site[] = sample ? SAMPLE_SITES : (live?.sites ?? []).map((s) => ({ id: s.carrierId, name: s.name, origin: s.origin }));
  const canRevokeAll = sample || Boolean(live?.canRevokeAll);
  const active = rows.filter((g) => g.status === "active");
  const detected = sample ? EXTENSION_STATE.detected : Boolean(version);
  const installedVersion = sample ? EXTENSION_STATE.version : version;
  const latest = sample ? EXTENSION_STATE.latestVersion : EXTENSION_LATEST_VERSION;
  const refresh = sample ? notRefreshed : load;

  const history = rows
    .flatMap((g) => [
      { key: `${g.id}-g`, at: g.issuedAt, revoked: false, g },
      ...(g.revokedAt ? [{ key: `${g.id}-r`, at: g.revokedAt, revoked: true, g }] : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
  const shownHistory = paginate(history, historyPage, HISTORY_PAGE);

  async function revoke(grantIds: string[] | null) {
    if (sample) return notSaved();
    setBusy(true);
    try {
      let revoked = 0;
      for (const id of grantIds ?? [null]) {
        const res = await fetch("/api/app/extension/grants/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { grant_id: id } : {}) });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          notify.block(data?.error ?? "Couldn't revoke. Try again.");
          break;
        }
        revoked += Number(data?.revoked ?? 0);
      }
      notify.done(revoked ? `${plural(revoked, "grant")} revoked` : "Nothing was active");
      await load();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function getExtension() {
    if (sample) return notSaved();
    notify.warn("The extension isn't in the Chrome Web Store yet — your Insurvas admin can load it for you.");
  }

  const revokeAllReason = !canRevokeAll ? "Only an owner can revoke every grant." : active.length === 0 ? "No grant is active right now." : null;
  const pending = loading && !sample;
  const loadingRows = <SectionLoading rows={4} columns={4} label="Loading grants" />;

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {error && !sample && <SalesLoadError message={error} onRetry={load} />}

      <SettingsCard title="Install" sub="Per device and per person. Nothing is installed for an agent on their behalf.">
        <div className="flex flex-wrap items-center gap-[14px]">
          {detected ? <Pill tone="success" dot>Installed on this device</Pill> : <Pill tone="warning" dot>Not installed on this device</Pill>}
          <span className="text-[14px] leading-[1.5] text-[var(--body)]">{installedVersion ? `Version ${installedVersion}${installedVersion !== latest ? ` · latest is ${latest}` : ""}` : `Latest is ${latest}`}</span>
          <span className="ml-auto flex flex-wrap gap-2.5">
            <Button type="button" variant="outline" onClick={refresh}>Check again</Button>
            {!detected && <Button type="button" onClick={getExtension}>Install for Chrome</Button>}
          </span>
        </div>
      </SettingsCard>

      <TableCard
        title="Where it is allowed to run"
        description="It has no access to any site that is not on this list."
        toolbar={
          <DataToolbar
            actions={
              <>
                <WithReason reason={revokeAllReason}>
                  <Button type="button" variant="outline" className="border-[var(--error)] text-[var(--error-ink)] hover:bg-[var(--error-surface)]" disabled={Boolean(revokeAllReason) || busy} onClick={() => setConfirming(true)}>Revoke every grant</Button>
                </WithReason>
                <RefreshButton onClick={refresh} refreshing={pending} />
              </>
            }
          />
        }
      >
        {pending ? loadingRows : sites.length === 0 ? (
          <EmptyState title="No carrier sites yet" hint="Add a carrier with a portal address in Carriers and products." />
        ) : (
          <table className={cn(st.table, "min-w-[640px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Domain</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Carrier</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Granted by</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Granted at</th>
                <th scope="col" className={cn(st.th, "w-[100px] text-right")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {sites.map((s) => {
                const onSite = rows.filter((g) => g.origin === s.origin);
                const last = [...onSite].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
                const revocable = onSite.filter((g) => g.status === "active" && (g.mine || canRevokeAll));
                return (
                  <tr key={s.id} className="m-row">
                    <td className={st.td}><code className="font-mono text-[12px] text-[var(--ink)]">{host(s.origin)}</code></td>
                    <td className={st.td}>{s.name}</td>
                    <td className={st.td}>{last ? who(last) : "—"}</td>
                    <td className={st.td}>{last ? day(last.issuedAt) : <span className="text-[var(--muted)]">Never granted</span>}</td>
                    <td className={cn(st.td, "text-right")}>
                      {revocable.length > 0 ? (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => revoke(revocable.map((g) => g.id))} aria-label={`Revoke the active grants on ${host(s.origin)}`}>Revoke</Button>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard
        title="Grant history"
        description="Every grant and every revocation, newest first."
        footer={history.length > 0 ? <Pager page={shownHistory.current} total={history.length} noun="events" pageSize={HISTORY_PAGE} onPage={setHistoryPage} /> : undefined}
      >
        {pending ? loadingRows : history.length === 0 ? (
          <EmptyState title="No grants yet" hint="A grant is opened from an application's Submit step when the agent fills it on a carrier site." />
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {shownHistory.rows.map((h) => (
              <li key={h.key} className="flex gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
                <span aria-hidden className={cn("mt-2 size-[7px] shrink-0 rounded-full", h.revoked ? "bg-[var(--error)]" : "bg-[var(--success)]")} />
                <span className="min-w-0">
                  <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {h.revoked ? "Revoked" : `${who(h.g)} granted`} <strong>{host(h.g.origin)}</strong>
                  </span>
                  <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">
                    {when(h.at)} · {h.g.clientName}{h.g.reference ? ` (${h.g.reference})` : ""}{h.revoked ? "" : ` · ${plural(h.g.fieldsRead, "field")} read`}
                    {!h.revoked && h.g.status === "active" ? " · active now" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </TableCard>

      <SettingsCard title="Tokens" sub="What a granted session can do. These are not settings.">
        <dl className="m-0 flex flex-col">
          {[
            { label: "Token lifetime", help: "Scoped to one application and one carrier domain.", value: `${GRANT_LIFETIME_MINUTES} minutes` },
            { label: "What a token can read", help: "It cannot list cases, or see a second application on the same household.", value: "One application" },
            { label: "Sensitive fields", help: "Social Security, bank and card numbers are revealed one at a time and audited.", value: "One at a time" },
          ].map((f) => (
            <div key={f.label} className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] py-[11px] first:border-t-0 first:pt-0">
              <dt className="min-w-0">
                <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{f.label}</span>
                <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">{f.help}</span>
              </dt>
              <dd className="m-0 text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">{f.value}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>

      <SalesDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Revoke ${plural(active.length, "active grant")}?`}
        description="Every active grant for every person in this agency ends on the extension's next request. Each agent re-grants from the Submit step, one carrier at a time."
      >
        <DialogActions>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => revoke(null)}>Revoke all</Button>
        </DialogActions>
      </SalesDialog>
    </SettingsStack>
  );
}
