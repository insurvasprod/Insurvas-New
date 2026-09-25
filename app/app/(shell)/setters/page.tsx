import Link from "next/link";

import { RebookButton } from "@/components/app/appointment-rebook";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/appointments/appointmentFacts";
import { VERDICT_LABEL, VERDICT_MIN_CLOSED, NOISE_BELOW_PCT, type AppointmentDetail, type DayRowKind } from "@/lib/setters/dayView";
import { getSettersOverview } from "@/lib/setters/overview";

/**
 * Appointments & setters (p-app-setters): the licensed agent's view of the appointments setters
 * book for them. Owners and producers — the people who hold a calendar (Settings › Calendar lists
 * only them as bookable). Setters book from the dialer and see their own numbers on Activity.
 */
function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** A booked row's chip says what became of it (LA-2 §11 concept): Shown, No-show, Awaiting close-out. */
const STATUS_TONE: Record<string, string> = { booked: "is-accent", confirmed: "is-accent", showed: "is-success", no_show: "is-error", pending: "is-warning" };

/**
 * The line under a booked row's name: the customer's own clock, the face amount, whether the
 * reminder went, the setter's note — and on a no-show, what can be done about it.
 */
function BookedDetail({ detail }: { detail: AppointmentDetail }) {
  const facts = [detail.startsIn, detail.customerTime, detail.face, detail.reminderSent ? "Reminder sent" : null].filter(Boolean).join(" · ");
  return (
    <>
      {facts && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
      {detail.note && <span className="mt-0.5 block whitespace-normal text-xs text-[var(--body)]"><strong className="font-semibold text-foreground">Setter note.</strong> {detail.note}</span>}
      {detail.status === "no_show" && (
        <span className="mt-1.5 flex flex-wrap items-center gap-2 whitespace-normal">
          {detail.callable === false
            ? <span className="text-xs text-muted-foreground">Call now: outside their calling window right now</span>
            // Decided 2026-09-25: "Call now" opens the dialer on this lead; the dialer checks the
            // calling window again when it dials.
            : <Button asChild size="sm"><Link href={`/app/dialer?lead=${detail.leadId}`}>Call now</Link></Button>}
          {detail.rebookable && <RebookButton appointmentId={detail.appointmentId} agentUserId={detail.agentUserId} customerName={detail.customerName} />}
          {detail.rebooked && <span className="text-xs text-muted-foreground">Rebooked</span>}
        </span>
      )}
    </>
  );
}

const KIND_CHIP: Record<DayRowKind, { label: string; tone: string }> = {
  booked: { label: "Booked", tone: "is-accent" },
  open: { label: "Open", tone: "is-neutral" },
  blocked: { label: "Blocked", tone: "is-neutral" },
  busy: { label: "Busy", tone: "is-neutral" },
  buffer: { label: "Buffer", tone: "is-neutral" },
  past: { label: "Past", tone: "is-neutral" },
};

export default async function SettersPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Appointments & setters" description="Your setters book into your real availability. You arrive to people expecting your call." eyebrow={sectionForPath("/app/setters") ?? undefined} />;
  if (!["owner", "producer"].includes(guard.role))
    return <RoleGateNotice featureLabel="Appointments & setters" detail="This is the licensed agent's view of their own calendar. Setters book from the dialer and see their numbers on Activity & scorecard." eyebrow={sectionForPath("/app/setters") ?? undefined} />;

  const view = await getSettersOverview({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  const t = view.tiles;
  const showRate = t.closedThisMonth ? (t.showedThisMonth / t.closedThisMonth) * 100 : null;
  const noisy = view.setters.filter((row) => row.verdict === "noise").length;

  return (
    <div className="m-stagger portal-setters-page">
      <PageHeader
        eyebrow={sectionForPath("/app/setters") ?? undefined}
        title="Appointments & setters"
        description="Your setters book into your real availability. You arrive to people expecting your call."
        actions={<>
          <Button variant="outline" asChild><Link href="/app/settings#calendar">Availability</Link></Button>
          <Button asChild><Link href="/app/settings#calendar">Block time</Link></Button>
        </>}
      />

      {!view.bookable && <div className="portal-setters-note is-warning"><strong>You have no working hours yet</strong><p>Setters can only book inside your availability, so nobody can book you until it is set. Add your hours in Settings › Calendar.</p></div>}

      <div className="portal-setters-tiles">
        <StatTile label="Booked today" value={t.bookedToday} footnote={[t.nextAt ? `next at ${t.nextAt}` : "nothing still to come", t.shownToday || t.noShowToday ? `${t.shownToday} shown · ${t.noShowToday} no-show` : null].filter(Boolean).join(" · ")} />
        <StatTile label="Open slots left" value={t.openLeft} footnote={`of ${t.slotsToday} today`} />
        <StatTile label="Show rate this month" value={showRate === null ? "—" : showRate.toFixed(1)} unit={showRate === null ? undefined : "%"} valueTone={showRate === null ? undefined : showRate >= 70 ? "good" : "warning"} footnote={`${t.showedThisMonth} of ${t.closedThisMonth} closed out`} />
        <StatTile label="Sold from appointments" value={t.sold} valueTone={t.sold ? "good" : undefined} footnote={t.showedForSold ? `${((t.sold / t.showedForSold) * 100).toFixed(1)}% of shown · 30 days` : "30 days"} />
        <StatTile label="Double-bookings" value={t.doubleBookings} valueTone={t.doubleBookings ? "danger" : "good"} footnote={t.doubleBookingAllowed ? "double booking is on in Settings" : "impossible by construction"} />
      </div>

      <div className="portal-setters-body">
        <div className="portal-setters-main">
          <section className="portal-setters-panel" aria-labelledby="setters-day-heading">
            <div className="portal-setters-bar"><h2 id="setters-day-heading">{view.dateLabel} &mdash; your calendar</h2><span className="portal-status-chip">all times your local</span></div>
            {view.day.length === 0 ? <p className="portal-setters-empty">No working hours today and nothing booked.</p> : view.day.map((row) => (
              <div key={`${row.kind}-${row.minute}-${row.appointmentId ?? ""}`} className={`portal-setters-slot is-${row.kind}`}>
                <span className="portal-setters-time">{clock(row.minute)}</span>
                {row.detail
                  ? <span className="portal-setters-what"><span className="block truncate">{row.label}</span><BookedDetail detail={row.detail} /></span>
                  : <span className="portal-setters-what">{row.label}</span>}
                <span className="portal-setters-who">{row.setter ?? "—"}</span>
                {row.detail
                  ? <span className={`portal-status-chip ${STATUS_TONE[row.detail.status] ?? "is-accent"}`}>{APPOINTMENT_STATUS_LABEL[row.detail.status] ?? KIND_CHIP.booked.label}</span>
                  : <span className={`portal-status-chip ${KIND_CHIP[row.kind].tone}`}>{KIND_CHIP[row.kind].label}</span>}
              </div>
            ))}
          </section>

          <section className="portal-setters-panel" aria-labelledby="setters-scorecard-heading">
            <div className="portal-setters-bar">
              <h2 id="setters-scorecard-heading">Setter scorecard</h2>
              {noisy > 0 && <span className="portal-status-chip is-error">{noisy} setter{noisy === 1 ? "" : "s"} booking noise</span>}
            </div>
            {view.setters.length === 0 ? <p className="portal-setters-empty">No setter has dialled or booked in the last 30 days.</p> : <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Setter</TableHead>
                  <TableHead className="w-[80px] text-right">Dials</TableHead>
                  <TableHead className="w-[90px] text-right">Contacts</TableHead>
                  <TableHead className="w-[80px] text-right">Booked</TableHead>
                  <TableHead className="w-[80px] text-right">Shown</TableHead>
                  <TableHead className="w-[100px] text-right">Show rate</TableHead>
                  <TableHead className="w-[70px] text-right">Sold</TableHead>
                  <TableHead className="w-[150px]"><span className="sr-only">Verdict</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {view.setters.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell><strong className="portal-setters-name">{row.name}</strong>{row.place && <span className="portal-setters-place"> &middot; {row.place}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.dials.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.contacts.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.booked}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.showed}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.showRatePct === null ? "—" : `${row.showRatePct.toFixed(1)}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.sold}</TableCell>
                      <TableCell><span className={`portal-status-chip ${row.verdict === "solid" ? "is-success" : row.verdict === "noise" ? "is-error" : "is-neutral"}`}><span aria-hidden="true" />{VERDICT_LABEL[row.verdict]}</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {view.setters.filter((row) => row.verdict === "noise").slice(0, 3).map((row) => (
                <p key={row.userId} className="m-0 border-t border-[var(--surface-alt)] px-4 py-3 text-sm leading-normal text-[var(--body)]">
                  <strong className="font-semibold text-foreground">{row.name} is booking noise.</strong>{" "}
                  {row.booked} booked, {row.showed} shown and {row.noShow} no-show{row.noShow === 1 ? "" : "s"} &mdash; {row.noShow} of your slots spent on people who did not turn up.
                </p>
              ))}
              <p className="portal-setters-foot">{view.scorecardScope === "calendar" ? "Setters who booked into your calendar, ranked by shown. " : "Every setter in the agency, ranked by shown (your own calendar’s view needs a database update that has not been applied yet). "}Last 30 days. Booking noise is a show rate under {NOISE_BELOW_PCT}% over at least {VERDICT_MIN_CLOSED} closed-out appointments; appointments still waiting to be closed out never count against a setter.</p>
            </>}
          </section>
        </div>

        <aside className="portal-setters-side">
          <section className="portal-setters-card" aria-labelledby="setters-availability-heading">
            <h2 id="setters-availability-heading">Your availability</h2>
            <p className="portal-setters-lede">Setters can only book inside this. There is no free-text time field.</p>
            <dl>
              <div><dt>Working hours</dt><dd>{view.availability.hours}<small>{view.availability.hoursNote}</small></dd></div>
              <div><dt>Appointment length</dt><dd>{view.availability.lengthMinutes} min</dd></div>
              <div><dt>Buffer after</dt><dd>{view.availability.bufferMinutes ? `${view.availability.bufferMinutes} min` : "None"}</dd></div>
              <div><dt>Blocked</dt><dd>{view.availability.blocks.length ? view.availability.blocks.join("; ") : "Nothing repeating"}{view.availability.linkedCalendar && <small>Plus anything on your linked calendar.</small>}</dd></div>
            </dl>
            <Link className="portal-setters-link" href="/app/settings#calendar">Change in Settings</Link>
          </section>
          <div className="portal-setters-note is-info">
            <strong>{t.doubleBookingAllowed ? "Double booking is on for you" : "Double-booking is impossible, not discouraged"}</strong>
            <p>{t.doubleBookingAllowed
              ? "You allow a second seat in Settings › Calendar, so two appointments can share a time. Everything else still holds: a setter is only offered slots your hours, blocks, buffers and linked calendar leave free."
              : "A setter is offered real slots computed from your hours minus blocks minus buffers minus what is already taken, and the database refuses a second booking at the same time. There is no way to type a time that does not exist."}</p>
          </div>
          <section className="portal-setters-card" aria-labelledby="setters-reminders-heading">
            <h2 id="setters-reminders-heading">Reminders</h2>
            <dl>
              <div><dt>To you</dt><dd>24 h before<small>by email and in-app, when the reminder job runs</small></dd></div>
              <div><dt>To the customer</dt><dd>Not sent<small>there are no customer reminders yet</small></dd></div>
              <div><dt>Channel</dt><dd>Email &middot; in-app<small>SMS is not available</small></dd></div>
              <div><dt>No-show marked</dt><dd>By a person<small>at close-out, from the Dashboard</small></dd></div>
            </dl>
            <p className="portal-setters-lede">The reminder job is not on this deployment&rsquo;s schedule yet, so reminders go out only when it is run.</p>
          </section>
          <div className="portal-setters-note is-info">
            <strong>A setter cannot sell</strong>
            <p>Dial, disposition, book. No commission figures, no vendor cost, no application. That boundary is a role, enforced by the API, not a screen that hides buttons.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
