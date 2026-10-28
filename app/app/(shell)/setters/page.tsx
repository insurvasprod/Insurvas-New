import Link from "next/link";

import { RebookButton } from "@/components/app/appointment-rebook";
import { SetterRanking } from "@/components/app/setters/setter-ranking";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { type AppointmentDetail, type DayRowKind } from "@/lib/setters/dayView";
import { getSettersOverview } from "@/lib/setters/overview";

/**
 * Appointments & setters (p-app-setters): the licensed agent's view of the appointments setters
 * book for them. Owners and producers — the people who hold a calendar (Settings › Calendar lists
 * only them as bookable). Setters book from the dialer and see their own numbers on Activity.
 *
 * Setters A (owner pick 2026-10-25, canvas M2 · Calendar): header, one strip of figures, the setter
 * ranking with the chosen setter's bookings beside it (components/app/setters/setter-ranking.tsx),
 * then today's hours as slots with the availability they come from. The old ?view=scorecard tab is
 * gone: the scorecard is the page.
 */
function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** The row's ground carries the slot's kind, as the day view always has: booked tinted, blocked grey. */
const SLOT_TONE: Record<DayRowKind, string> = {
  booked: "bg-[var(--surface-alt)] text-[var(--ink)]",
  open: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  blocked: "border border-dashed border-[var(--border-strong)] text-muted-foreground",
  busy: "border border-dashed border-[var(--border-strong)] text-muted-foreground",
  buffer: "text-muted-foreground",
  past: "text-muted-foreground opacity-60",
};

/** The show rate the page measures setters against (the figure turns amber under it). */
const SHOW_TARGET = 70;

/**
 * A booked row's facts, as one line in their own column: when it starts, the customer's own clock,
 * the face amount, whether the reminder went, and the setter's note.
 */
function bookedFacts(detail: AppointmentDetail) {
  return [detail.startsIn, detail.customerTime, detail.face, detail.reminderSent ? "Reminder sent" : null, detail.note ? `Setter note: ${detail.note}` : null].filter(Boolean).join(" · ");
}

/** On a no-show, what can be done about it — the row's last column. */
function NoShowActions({ detail }: { detail: AppointmentDetail }) {
  if (detail.status !== "no_show") return null;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {detail.callable === false
        ? <span className="text-xs text-muted-foreground" title="Outside their calling window right now">Call now: outside their window</span>
        // Decided 2026-09-25: "Call now" opens the dialer on this lead; the dialer checks the
        // calling window again when it dials.
        : <Button asChild size="sm"><Link href={`/app/dialer?lead=${detail.leadId}`}>Call now</Link></Button>}
      {detail.rebookable && <RebookButton appointmentId={detail.appointmentId} agentUserId={detail.agentUserId} customerName={detail.customerName} />}
      {detail.rebooked && <span className="text-xs text-muted-foreground">Rebooked</span>}
    </span>
  );
}

const KIND_LABEL: Record<DayRowKind, string> = {
  booked: "Booked",
  open: "Open",
  blocked: "Blocked",
  busy: "Busy",
  buffer: "Buffer",
  past: "Past",
};

export default async function SettersPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Appointments & setters" description="Setters book into your real availability." />;
  if (!actAsPage(guard, ["owner", "producer"]))
    return <RoleGateNotice featureLabel="Appointments & setters" detail="Setters book from the dialer and see their numbers on Team activity." />;

  const view = await getSettersOverview({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  const t = view.tiles;
  const showRate = t.closedThisMonth ? (t.showedThisMonth / t.closedThisMonth) * 100 : null;
  const booked = view.day.filter((row) => row.kind === "booked");
  const noShows = booked.filter((row) => row.detail?.status === "no_show");

  // On the dashboard's static stage backdrop, its cards frosted over it (owner ask 2026-10-26).
  return (
    <>
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Appointments & setters"
        description="Your setters book into your real availability."
        actions={<Button variant="outline" asChild><Link href="/app/settings#calendar">Hours &amp; blocks</Link></Button>}
      />

      <StatStrip label="Appointment totals">
        <StatTile label="Booked today" value={t.bookedToday} footnote={[t.nextAt ? `next at ${t.nextAt}` : "nothing still to come", t.shownToday || t.noShowToday ? `${t.shownToday} shown · ${t.noShowToday} no-show` : null].filter(Boolean).join(" · ")} />
        <StatTile label="Open slots left" value={t.openLeft} footnote={`of ${t.slotsToday} today`} />
        <StatTile label="Show rate this month" value={showRate === null ? "—" : showRate.toFixed(1)} unit={showRate === null ? undefined : "%"} valueTone={showRate === null ? undefined : showRate >= SHOW_TARGET ? "good" : "warning"} footnote={`${t.showedThisMonth} of ${t.closedThisMonth} closed out · target ${SHOW_TARGET}%`} />
        <StatTile label="Sold from appointments" value={t.sold} valueTone={t.sold ? "good" : undefined} footnote={t.showedForSold ? `${((t.sold / t.showedForSold) * 100).toFixed(1)}% of shown · 30 days` : "30 days"} />
        <StatTile label="Double-bookings" value={t.doubleBookings} valueTone={t.doubleBookings ? "danger" : "good"} footnote={t.doubleBookingAllowed ? "double booking is on in Settings" : "not possible"} />
      </StatStrip>

      {!view.bookable && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          <strong className="font-semibold">Add your working hours so setters can book you.</strong>{" "}
          <Link className="font-semibold underline underline-offset-2" href="/app/settings#calendar">Open Settings › Calendar</Link>
        </p>
      )}

      {/* Setters A (owner pick 2026-10-25): the ranking, the chosen setter beside it, your hours below. */}
      <SetterRanking setters={view.setters} target={SHOW_TARGET} scope={view.scorecardScope} />

      <TableCard
        title={`Your hours today · ${view.dateLabel}`}
        description={`All times your local · ${booked.length} booked · ${view.day.filter((row) => row.kind === "open").length} open`}
        action={<Button variant="outline" size="sm" asChild><Link href="/app/settings#calendar">Edit hours &amp; blocks</Link></Button>}
      >
        {view.day.length === 0 ? <EmptyState title="Nothing today" hint="No hours set and nothing booked." action={<Button asChild variant="outline"><Link href="/app/settings#calendar">Set availability</Link></Button>} /> : (
          <div className="flex flex-col gap-4 p-4">
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-0">
              {view.day.map((row) => (
                <li
                  key={`${row.kind}-${row.minute}-${row.appointmentId ?? ""}`}
                  title={row.detail ? bookedFacts(row.detail) : row.label}
                  className={`flex min-h-12 flex-col justify-center rounded-lg px-3 py-1.5 text-xs ${SLOT_TONE[row.kind]} ${row.detail?.status === "no_show" ? "!bg-[var(--error-surface)] !text-[var(--error-ink)]" : ""}`}
                >
                  <strong className="tabular-nums">{clock(row.minute)}</strong>
                  <span className="truncate">{row.kind === "booked" ? row.label : KIND_LABEL[row.kind]}</span>
                </li>
              ))}
            </ol>
            {noShows.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 border-t border-border p-0 pt-3">
                {noShows.map((row) => row.detail && (
                  <li key={row.detail.appointmentId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><strong className="font-semibold">{row.detail.customerName}</strong> <span className="text-muted-foreground">didn&rsquo;t show at {clock(row.minute)}{row.setter ? ` · set by ${row.setter}` : ""}</span></span>
                    <NoShowActions detail={row.detail} />
                  </li>
                ))}
              </ul>
            )}
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              {[
                ["Working hours", `${view.availability.hours}${view.availability.hoursNote ? ` (${view.availability.hoursNote})` : ""}`],
                ["Appointment length", `${view.availability.lengthMinutes} min`],
                ["Buffer after", view.availability.bufferMinutes ? `${view.availability.bufferMinutes} min` : "None"],
                ["Blocked", `${view.availability.blocks.length ? view.availability.blocks.join("; ") : "Nothing repeating"}${view.availability.linkedCalendar ? ", plus your linked calendar" : ""}`],
              ].map(([term, value]) => <div key={term} className="flex gap-1.5"><dt className="font-semibold">{term}:</dt><dd className="m-0 text-[var(--body)]">{value}</dd></div>)}
            </dl>
          </div>
        )}
      </TableCard>
    </div>
    </>
  );
}
