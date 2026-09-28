import { CircleCheck, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { agoLabel } from "@/lib/format/ago";
import { weekdayDayMonth } from "@/lib/format/dates";
import type { SlaDigestDay, SlaJobStatus } from "@/lib/queueSla/digest";

/**
 * The alert centre's two unclaimed-SLA cards (LA-1.23-6, LA-1.23-7), below the alert lists:
 *
 *   The SLA job     whether the job that sends the escalation alerts, the partner's notice and the
 *                   nurture move is running, and what it did for this workspace in the last day. A
 *                   failing or stopped job is drawn as an alert, because it is one.
 *   Daily digest    escalated and expired transfers by partner, one day per block, in the agency's
 *                   own timezone. Today's block fills as the day goes.
 *
 * Server-rendered from what the database job writes every minute (20260925709910).
 */

const PENDING = "This needs a database update that has not been applied yet.";

function jobHeadline(status: SlaJobStatus, nowMs: number): { tone: "ok" | "alert"; title: string; detail: string } {
  const ago = status.lastRunAt ? agoLabel(Date.parse(status.lastRunAt), nowMs) : null;
  switch (status.state) {
    case "ok":
      return { tone: "ok", title: "Running every minute", detail: `Last run ${ago}.` };
    case "failing":
      return {
        tone: "alert",
        title: "The SLA job is failing",
        detail: `${status.lastError ?? status.lastDay.latestError ?? "A side effect could not be delivered."} Failed items are tried again every minute. Last run ${ago}.`,
      };
    case "stale":
      return { tone: "alert", title: "The SLA job has stopped", detail: `Last run ${ago}. Escalation alerts, partner notices and expiries are not being sent.` };
    case "never_run":
      return { tone: "alert", title: "The SLA job has not run yet", detail: "Escalation alerts, partner notices and expiries are sent once it runs." };
    default:
      return { tone: "alert", title: "The SLA job is not set up yet", detail: PENDING };
  }
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[8rem] flex-col gap-0.5">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{value.toLocaleString()}</span>
    </div>
  );
}

export function SlaJobCard({ status, nowMs }: { status: SlaJobStatus; nowMs: number }) {
  const head = jobHeadline(status, nowMs);
  const day = status.lastDay;
  return (
    <TableCard title="Unclaimed SLA job" action={<span className="text-xs text-[var(--muted)]">Last 24 hours</span>}>
      {head.tone === "alert" ? (
        <div className="portal-top-alert border-t border-[var(--border)]" data-severity="critical" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="portal-top-alert-title">{head.title}</span>
            <span className="portal-top-alert-body">{head.detail}</span>
          </span>
        </div>
      ) : (
        <div className="flex gap-2.5 border-t border-[var(--border)] px-4 py-3">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">{head.title}</span>
            <span className="mt-0.5 block text-xs text-[var(--body)]">{head.detail}</span>
          </span>
        </div>
      )}
      {status.ready && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-[var(--border)] px-4 py-3">
          <Figure label="Escalations alerted" value={day.escalationsAlerted} />
          <Figure label="Partner notices" value={day.partnerNotices} />
          <Figure label="Nobody-claimed alerts" value={day.nobodyClaimedAlerts} />
          <Figure label="Moved to nurture" value={day.nurtured} />
          <Figure label="Escalation emails sent" value={day.emailsSent} />
          <Figure label="Emails waiting to send" value={day.emailsOwed} />
          <Figure label="Recorded, not sent" value={day.skipped} />
          <Figure label="Failing" value={day.retrying + day.gaveUp} />
        </div>
      )}
    </TableCard>
  );
}

export function SlaDigestCard({ ready, days }: { ready: boolean; days: SlaDigestDay[] }) {
  return (
    <TableCard
      title="Daily digest"
      action={<span className="text-xs text-[var(--muted)]">Escalated and expired, by partner</span>}
      footer={ready && days.length > 0 ? <span>Days run midnight to midnight, {[...new Set(days.map((day) => day.timezone))].join(", ")}.</span> : undefined}
    >
      {!ready ? (
        <EmptyState title="The daily digest is not set up yet" hint={PENDING} />
      ) : days.length === 0 ? (
        <EmptyState title="Nothing escalated or expired this week" hint="Each day's escalated and expired transfers are counted here by partner." />
      ) : (
        <ul className="border-t border-[var(--border)]">
          {days.map((day) => (
            <li key={day.date} className="border-b border-[var(--border)] px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--ink)]">
                  {day.today ? `Today so far · ${weekdayDayMonth(day.date)}` : weekdayDayMonth(day.date)}
                </span>
                <span className="text-xs text-[var(--body)] tabular-nums">
                  {day.escalated.toLocaleString()} escalated · {day.expired.toLocaleString()} expired
                </span>
              </div>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--muted)]">
                    <th scope="col" className="py-1 font-medium">Partner</th>
                    <th scope="col" className="w-24 py-1 text-right font-medium">Escalated</th>
                    <th scope="col" className="w-24 py-1 text-right font-medium">Expired</th>
                  </tr>
                </thead>
                <tbody>
                  {day.partners.map((partner) => (
                    <tr key={partner.partnerId ?? partner.partnerName} className="border-t border-[var(--border)] text-[var(--body)]">
                      <td className="py-1.5">{partner.partnerName}</td>
                      <td className="py-1.5 text-right tabular-nums">{partner.escalated.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{partner.expired.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </TableCard>
  );
}
