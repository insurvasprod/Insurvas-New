import { Fragment } from "react";

import { PageRefreshButton } from "@/components/app/alert-centre";
import { Callout } from "@/components/app/settings/primitives";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { agoLabel } from "@/lib/format/ago";
import { weekdayDayMonth } from "@/lib/format/dates";
import type { SlaDigestDay, SlaJobStatus } from "@/lib/queueSla/digest";
import { SLA_PENDING_LINE, slaJobWords } from "@/lib/queueSla/digestView";

/**
 * The alert centre's unclaimed-SLA parts (LA-1.23-6, LA-1.23-7), read from what the pg_cron job
 * writes every minute (20260925709910):
 *
 *   SlaJobStrip     the page's one stat strip: whether the job runs, and what it did for this
 *                   workspace in the last 24 hours. A failing or stopped job adds one alert line.
 *   SlaDigestCard   escalated and expired transfers by partner, one day at a time, in the agency's
 *                   own timezone. Today's rows fill as the day goes.
 *
 * Until that migration is applied both say so in one line.
 */

export function SlaJobStrip({ status, nowMs }: { status: SlaJobStatus; nowMs: number }) {
  if (!status.ready) return <p className="m-0 text-sm text-[var(--muted)]">{SLA_PENDING_LINE}</p>;
  const words = slaJobWords(status.state);
  const day = status.lastDay;
  const ago = status.lastRunAt ? agoLabel(Date.parse(status.lastRunAt), nowMs) : null;
  const failing = day.retrying + day.gaveUp;
  const alert = words.alert
    ? [words.alert, status.state === "failing" ? status.lastError : null, ago ? `Last run ${ago}.` : null].filter(Boolean).join(" ")
    : null;
  return (
    <>
      {alert && <Callout tone="error" title={alert} />}
      <StatStrip label="Unclaimed SLA job, last 24 hours">
        <StatTile label="SLA job" value={words.label} valueSize="text" valueTone={status.state === "ok" ? "good" : "danger"} footnote={ago ? `Last run ${ago}` : "No run recorded"} />
        <StatTile label="Escalations alerted" value={day.escalationsAlerted.toLocaleString()} footnote={`${day.emailsSent.toLocaleString()} emailed · ${day.emailsOwed.toLocaleString()} waiting`} />
        <StatTile label="Partner notices" value={day.partnerNotices.toLocaleString()} footnote={`${day.nobodyClaimedAlerts.toLocaleString()} nobody-claimed alerts`} />
        <StatTile label="Moved to nurture" value={day.nurtured.toLocaleString()} reserveFootnote />
        <StatTile label="Not sent" value={day.skipped.toLocaleString()} footnote="Day-old or already claimed" />
        <StatTile label="Failing" value={failing.toLocaleString()} valueTone={failing > 0 ? "danger" : undefined} footnote={failing > 0 ? "Retried every minute" : undefined} reserveFootnote />
      </StatStrip>
    </>
  );
}

export function SlaDigestCard({ ready, days }: { ready: boolean; days: SlaDigestDay[] }) {
  const zones = [...new Set(days.map((day) => day.timezone))].join(", ");
  return (
    <TableCard
      title="Daily digest"
      action={ready ? <PageRefreshButton /> : undefined}
      footer={ready && days.length > 0 ? <span>Escalated and expired transfers by partner. Days run midnight to midnight, {zones}.</span> : undefined}
    >
      {!ready ? (
        <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">{SLA_PENDING_LINE}</p>
      ) : days.length === 0 ? (
        <EmptyState title="Nothing escalated or expired this week" hint="Each day's escalated and expired transfers are counted here by partner." />
      ) : (
        <table className="portal-lead-table w-full">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Partner</th>
              <th scope="col" className="text-right">Escalated</th>
              <th scope="col" className="text-right">Expired</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const label = day.today ? `Today so far · ${weekdayDayMonth(day.date)}` : weekdayDayMonth(day.date);
              const partners = day.partners.length ? day.partners : [{ partnerId: null, partnerName: "No transfers", escalated: 0, expired: 0 }];
              return (
                <Fragment key={day.date}>
                  {partners.map((partner, index) => (
                    <tr key={`${day.date}:${partner.partnerId ?? partner.partnerName}`}>
                      {index === 0 && (
                        <td rowSpan={partners.length} className="align-top font-semibold text-[var(--ink)]">
                          {label}
                          <span className="block text-xs font-normal text-[var(--muted)] tabular-nums">
                            {day.escalated.toLocaleString()} escalated · {day.expired.toLocaleString()} expired
                          </span>
                        </td>
                      )}
                      <td>{partner.partnerName}</td>
                      <td className="text-right tabular-nums">{partner.escalated.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{partner.expired.toLocaleString()}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
