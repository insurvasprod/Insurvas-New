import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { WsPanel, WsPanelError, agoWords } from "@/components/admin/billing/ws-panel";
import { GraphCard, GraphCardError, GraphEmpty } from "@/components/admin/dashboard/ov-card";
import { LineSeries } from "@/components/ui/chart";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { signInDayCounts } from "@/lib/adminDashboard/securityQueries";
import { chartDays, changeWords, WORKSPACE_RANGES, type WorkspaceRange } from "@/lib/adminMonitoring/workspace";
import { staffLoginsVisibleTo } from "@/lib/loginEvents/present";
import {
  canSeeLockouts,
  canSeeSignIns,
  currentLockouts,
  jobsHealth,
  signInFigures,
  staffActions,
  worthItems,
  type MonitoringViewer,
} from "@/lib/adminMonitoring/workspaceQueries";
import { lockedAccounts } from "@/lib/loginEvents/lockouts";
import { cn } from "@/lib/utils";

/**
 * Monitoring › Workspace sections (admin round 1, docs/design/admin-r1/monitoring.html screen 1). Each is an async
 * server component the page wraps in Suspense, so it streams and fails on its own (frame first, UI-CONSISTENCY
 * §7a). What a role sees follows the pages behind it: sign-ins for a role that can open Login activity, lockouts for
 * a super admin, staff actions under the audit log's own-actions rule.
 */

const n = (value: number) => value.toLocaleString("en-US");

/** The request's clock: the page reads it once and hands it to every section, so their cached reads are shared. */
export function readMonitoringClock(): number {
  return Date.now();
}

async function settle<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-monitoring] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

const phraseOf = (range: WorkspaceRange) => WORKSPACE_RANGES.find((item) => item.key === range) ?? WORKSPACE_RANGES[0];
const activityHref = (range: WorkspaceRange, extra: Record<string, string> = {}) => {
  const query = new URLSearchParams(extra);
  if (range !== "today") query.set("range", range);
  const text = query.toString();
  return `/admin/activity${text ? `?${text}` : ""}`;
};
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const rowLink = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground no-underline last:border-b-0 hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const rowPlain = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground last:border-b-0";
const Chevron = () => <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;

/* ── Figures ─────────────────────────────────────────────────────────────────────────────────── */

export async function WsFigures({ viewer, range, now }: { viewer: MonitoringViewer; range: WorkspaceRange; now: number }) {
  const signIns = canSeeSignIns(viewer.role);
  const locks = canSeeLockouts(viewer.role);
  const [figures, lockouts, actions, jobs] = await Promise.all([
    signIns ? settle("sign-ins", () => signInFigures(viewer.role, range, now)) : Promise.resolve(null),
    locks ? settle("lockouts", () => currentLockouts(now)) : Promise.resolve(null),
    settle("staff actions", () => staffActions(viewer, range, now)),
    settle("jobs", () => jobsHealth(viewer)),
  ]);
  const meta = phraseOf(range);
  const label = (text: string) => `${text} ${range === "today" ? "today" : `· ${meta.label.toLowerCase()}`}`;
  const change = figures ? changeWords(figures.succeeded, figures.previousSucceeded, meta.versus) : null;
  const locked = lockouts ? lockouts.filter((entry) => entry.unlocksAt) : null;
  const ownOnly = viewer.role !== "super_admin";
  const auditHref = canOpenAdminHref(viewer.role, "/admin/audit-log") ? "/admin/audit-log" : undefined;
  const jobsHref = canOpenAdminHref(viewer.role, "/admin/monitoring/jobs") ? "/admin/monitoring/jobs" : undefined;

  return (
    <StatStrip label="Monitoring figures">
      {signIns && (
        <StatTile
          label={label("Sign-ins")}
          value={figures ? n(figures.succeeded) : "—"}
          footnote={
            figures === null ? "Could not be read" : change ? <span className={cn(change.rise && "font-semibold text-[var(--highlight-ink)]")}>{change.text}</span> : "nothing earlier to compare"
          }
          labelTitle={`Successful sign-ins, ${figures?.includeStaff ? "customers and staff" : "customers"}, UTC.`}
          href={activityHref(range, { outcome: "success" })}
        />
      )}
      {signIns && (
        <StatTile
          label={label("Failed")}
          value={figures ? n(figures.failed) : "—"}
          footnote={figures === null ? "Could not be read" : `of ${n(figures.succeeded + figures.failed)} ${figures.succeeded + figures.failed === 1 ? "attempt" : "attempts"}`}
          labelTitle="Failed and blocked sign-in attempts, UTC."
          href={activityHref(range, { outcome: "failure" })}
        />
      )}
      {locks && (
        <StatTile
          label="Lockouts active"
          value={lockouts ? n(lockedAccounts(lockouts)) : "—"}
          footnote={locked === null ? "Could not be read" : locked.length ? `unlocks at ${hhmm(locked[0].unlocksAt as string)} UTC` : "nobody is locked out"}
          labelTitle="Accounts locked after repeated failed sign-ins, right now."
          href="/admin/monitoring/lockouts"
        />
      )}
      <StatTile
        label={label(ownOnly ? "Your actions" : "Staff actions")}
        value={actions ? n(actions.total) : "—"}
        footnote={actions === null ? "Could not be read" : `${n(actions.money)} money ${actions.money === 1 ? "action" : "actions"}`}
        labelTitle={ownOnly ? "Changes you made, from the audit log; sign-ins left out." : "Changes any staff member made, from the audit log; sign-ins left out."}
        href={auditHref}
      />
      <StatTile
        label="Jobs failing"
        value={jobs ? n(jobs.failing.length) : "—"}
        valueTone={jobs && jobs.failing.length > 0 ? "danger" : undefined}
        footnote={jobs === null ? "Could not be read" : `of ${n(jobs.watched)} watched`}
        labelTitle="Scheduled jobs and outside services that are not working, as the dashboard's Platform health reads them."
        href={jobsHref}
      />
    </StatStrip>
  );
}

const FIGURE_SKELETON = <span aria-hidden="true" className="m-skel inline-block h-6 w-16 rounded-md" />;

export function WsFiguresLoading() {
  return (
    <StatStrip label="Monitoring figures">
      {Array.from({ length: 4 }, (_, index) => (
        <StatTile key={index} label=" " value={FIGURE_SKELETON} reserveFootnote />
      ))}
    </StatStrip>
  );
}

/* ── Sign-ins chart ──────────────────────────────────────────────────────────────────────────── */

export async function WsSignInChart({ viewer, range, now }: { viewer: MonitoringViewer; range: WorkspaceRange; now: number }) {
  const days = chartDays(range);
  const title = `Sign-ins · ${days} days`;
  if (!canSeeSignIns(viewer.role)) return null;
  const includeStaff = staffLoginsVisibleTo(viewer.role);
  const series = await settle(title, () => signInDayCounts(days, includeStaff, now));
  if (!series) return <GraphCardError title={title} />;
  const any = series.some((day) => day.succeeded + day.failed > 0);
  const total = series.reduce((sum, day) => sum + day.succeeded, 0);
  const failed = series.reduce((sum, day) => sum + day.failed, 0);
  return (
    <GraphCard
      title={title}
      link={{ label: "Login activity", href: activityHref(range === "today" ? "7d" : range) }}
      value={n(total)}
      line={`signed in · ${n(failed)} failed`}
      foot={`${includeStaff ? "Customers and staff" : "Customers"}, UTC days. The dashed line is failed attempts.`}
    >
      {any ? (
        <LineSeries
          points={series.map((day) => ({ key: day.key, label: day.label, value: day.succeeded }))}
          summary={`Successful sign-ins per day over the last ${days} days`}
          unit="sign-ins"
          minHeight={140}
          legend={{ label: "Signed in" }}
          lines={[{ key: "failed", label: "Failed", tone: "warning", dashed: true, points: series.map((day) => ({ key: day.key, label: day.label, value: day.failed })) }]}
        />
      ) : (
        <GraphEmpty title="No sign-ins yet" hint={`Nobody signed in during the last ${days} days.`} />
      )}
    </GraphCard>
  );
}

/* ── Worth a look ────────────────────────────────────────────────────────────────────────────── */

const WORTH_TONE = { danger: "danger", warning: "warning", info: "info" } as const;

export async function WsWorth({ viewer, range, now }: { viewer: MonitoringViewer; range: WorkspaceRange; now: number }) {
  const worth = await settle("worth", () => worthItems(viewer, range, now));
  if (!worth) return <WsPanelError title="Worth a look" />;
  return (
    <WsPanel title="Worth a look" count={worth.items.length} note="each opens its page, filtered">
      {worth.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">{worth.incomplete ? "Nothing found, but some checks didn't run" : "Nothing unusual"}</p>
          <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">
            {worth.incomplete ? "One of the reads didn't answer. Reload to check again." : `No address failed again and again, nobody is locked out and no staff change was made at night ${phraseOf(range).phrase}.`}
          </p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {worth.items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className={rowLink}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground" title={item.detail}>{item.detail}</span>
                </span>
                <StatusChip tone={WORTH_TONE[item.tone]} dot>{item.verb}</StatusChip>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WsPanel>
  );
}

/* ── Jobs failing ────────────────────────────────────────────────────────────────────────────── */

export async function WsJobs({ viewer }: { viewer: MonitoringViewer }) {
  const jobs = await settle("jobs", () => jobsHealth(viewer));
  if (!jobs) return <WsPanelError title="Jobs failing" />;
  const href = canOpenAdminHref(viewer.role, "/admin/monitoring/jobs") ? "/admin/monitoring/jobs" : null;
  const shown = jobs.failing.slice(0, 3);
  const more = jobs.failing.length - shown.length;
  return (
    <WsPanel title="Jobs failing" note={`${n(jobs.failing.length)} of ${n(jobs.watched)} watched`}>
      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">Every watched job is working</p>
          <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">Scheduled jobs and outside services answered their last runs.</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((row) => {
            const body = (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="truncate text-xs text-muted-foreground" title={row.reason}>
                    {row.lastWorked === "—" || row.lastWorked === "Never" ? row.reason : `last worked ${row.lastWorked}`}
                  </span>
                </span>
                <StatusChip tone="danger" dot>Failing</StatusChip>
                {href && <Chevron />}
              </>
            );
            return <li key={row.key}>{href ? <Link href={href} className={rowLink}>{body}</Link> : <div className={rowPlain}>{body}</div>}</li>;
          })}
          {more > 0 && (
            <li className="px-4 py-2 text-xs text-muted-foreground">
              and {n(more)} more{href ? <> · <Link href={href} className="text-foreground underline underline-offset-2">see every job</Link></> : null}
            </li>
          )}
        </ul>
      )}
    </WsPanel>
  );
}

/* ── Latest staff actions ────────────────────────────────────────────────────────────────────── */

export async function WsLatest({ viewer, range, now }: { viewer: MonitoringViewer; range: WorkspaceRange; now: number }) {
  const own = viewer.role !== "super_admin";
  const title = own ? "Your latest actions" : "Latest staff actions";
  const actions = await settle("staff actions", () => staffActions(viewer, range, now));
  if (!actions) return <WsPanelError title={title} />;
  const audit = canOpenAdminHref(viewer.role, "/admin/audit-log");
  return (
    <WsPanel title={title} note={`${n(actions.total)} ${phraseOf(range).phrase}`}>
      {actions.latest.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">Nothing changed</p>
          <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">{own ? "You haven't changed anything" : "No staff member changed anything"} {phraseOf(range).phrase}.</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {actions.latest.map((row) => {
            const href = audit ? (row.targetId ? `/admin/audit-log?target=${encodeURIComponent(row.targetId)}` : "/admin/audit-log") : null;
            const body = (
              <>
                {/* Staff, so initials; gold marks people (BRAND.md). */}
                <span title={row.who} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--highlight-soft)] text-xs font-semibold text-[var(--highlight-ink)]">
                  {row.initials}
                  <span className="sr-only"> {row.who}</span>
                </span>
                <span className="min-w-0 flex-1 truncate" title={row.what}>{row.what}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{range === "today" ? hhmm(row.ts) : agoWords(row.ts, now)}</span>
                {href && <Chevron />}
              </>
            );
            return <li key={row.id}>{href ? <Link href={href} className={rowLink}>{body}</Link> : <div className={rowPlain}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </WsPanel>
  );
}
