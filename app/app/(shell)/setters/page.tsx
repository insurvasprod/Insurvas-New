import Link from "next/link";

import { RebookButton } from "@/components/app/appointment-rebook";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { guardPage } from "@/lib/entitlements/guardPage";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/appointments/appointmentFacts";
import { VERDICT_LABEL, VERDICT_MIN_CLOSED, NOISE_BELOW_PCT, type AppointmentDetail, type DayRowKind } from "@/lib/setters/dayView";
import { getSettersOverview } from "@/lib/setters/overview";

/**
 * Appointments & setters (p-app-setters): the licensed agent's view of the appointments setters
 * book for them. Owners and producers — the people who hold a calendar (Settings › Calendar lists
 * only them as bookable). Setters book from the dialer and see their own numbers on Activity.
 *
 * Laid out to the UI consistency standard (docs/design/UI-CONSISTENCY.md): header, one strip of
 * figures, today's calendar beside the availability it is computed from, then the setter scorecard.
 */
function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** A booked row's chip says what became of it (LA-2 §11 concept): Shown, No-show, Awaiting close-out. */
const STATUS_TONE: Record<string, StatusTone> = { booked: "action", confirmed: "action", showed: "good", no_show: "danger", pending: "warning" };

/** The row's ground carries the slot's kind, as the day view always has: booked tinted, blocked grey. */
const ROW_TONE: Record<DayRowKind, string> = {
  booked: "bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface))]",
  open: "",
  blocked: "bg-[var(--surface-alt)]",
  busy: "bg-[var(--surface-alt)]",
  buffer: "bg-[var(--canvas)]",
  past: "opacity-70",
};

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
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Appointments & setters" description="Your setters book into your real availability. You arrive to people expecting your call." />;
  if (!["owner", "producer"].includes(guard.role))
    return <RoleGateNotice featureLabel="Appointments & setters" detail="This is the licensed agent's view of their own calendar. Setters book from the dialer and see their numbers on Activity & scorecard." />;

  const view = await getSettersOverview({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  const t = view.tiles;
  const showRate = t.closedThisMonth ? (t.showedThisMonth / t.closedThisMonth) * 100 : null;
  const noisy = view.setters.filter((row) => row.verdict === "noise").length;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Appointments & setters"
        description="Your setters book into your real availability."
        actions={<>
          <Button variant="outline" asChild><Link href="/app/settings#calendar">Availability</Link></Button>
          <Button asChild><Link href="/app/settings#calendar">Block time</Link></Button>
        </>}
      />

      <StatStrip label="Appointment totals">
        <StatTile label="Booked today" value={t.bookedToday} footnote={[t.nextAt ? `next at ${t.nextAt}` : "nothing still to come", t.shownToday || t.noShowToday ? `${t.shownToday} shown · ${t.noShowToday} no-show` : null].filter(Boolean).join(" · ")} />
        <StatTile label="Open slots left" value={t.openLeft} footnote={`of ${t.slotsToday} today`} />
        <StatTile label="Show rate this month" value={showRate === null ? "—" : showRate.toFixed(1)} unit={showRate === null ? undefined : "%"} valueTone={showRate === null ? undefined : showRate >= 70 ? "good" : "warning"} footnote={`${t.showedThisMonth} of ${t.closedThisMonth} closed out`} />
        <StatTile label="Sold from appointments" value={t.sold} valueTone={t.sold ? "good" : undefined} footnote={t.showedForSold ? `${((t.sold / t.showedForSold) * 100).toFixed(1)}% of shown · 30 days` : "30 days"} />
        <StatTile label="Double-bookings" value={t.doubleBookings} valueTone={t.doubleBookings ? "danger" : "good"} footnote={t.doubleBookingAllowed ? "double booking is on in Settings" : "not possible"} />
      </StatStrip>

      {!view.bookable && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          <strong className="font-semibold">You have no working hours yet, so nobody can book you.</strong>{" "}
          <Link className="font-semibold underline underline-offset-2" href="/app/settings#calendar">Add your hours in Settings › Calendar</Link>
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <TableCard title={`${view.dateLabel} — your calendar`} description="All times your local.">
          {view.day.length === 0 ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No working hours today and nothing booked.</p> : (
            <table className="portal-lead-table w-full min-w-[640px] table-fixed text-left">
              <thead><tr>
                <th scope="col" className="w-[92px]">Time</th>
                <th scope="col">Appointment</th>
                <th scope="col" className="w-[130px]">Setter</th>
                <th scope="col" className="w-[160px] !text-right">Status</th>
              </tr></thead>
              <tbody>
                {view.day.map((row) => (
                  <tr key={`${row.kind}-${row.minute}-${row.appointmentId ?? ""}`} className={`align-top ${ROW_TONE[row.kind]}`}>
                    <td className={`font-semibold tabular-nums ${row.kind === "booked" ? "text-[var(--accent-ink)]" : row.kind === "open" ? "text-[var(--body)]" : "text-muted-foreground"}`}>{clock(row.minute)}</td>
                    <td className="min-w-0">
                      <span className={`block truncate ${row.kind === "booked" ? "text-[var(--body)]" : "text-muted-foreground"}`}>{row.label}</span>
                      {row.detail && <BookedDetail detail={row.detail} />}
                    </td>
                    <td className="truncate text-xs text-muted-foreground">{row.setter ?? "—"}</td>
                    <td className="text-right">
                      {row.detail
                        ? <StatusChip tone={STATUS_TONE[row.detail.status] ?? "action"}>{APPOINTMENT_STATUS_LABEL[row.detail.status] ?? KIND_LABEL.booked}</StatusChip>
                        : <StatusChip tone={row.kind === "booked" ? "action" : "neutral"}>{KIND_LABEL[row.kind]}</StatusChip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>

        <TableCard title="Your availability">
          <dl className="divide-y divide-border border-t border-border text-sm">
            {[
              { term: "Working hours", value: view.availability.hours, note: view.availability.hoursNote },
              { term: "Appointment length", value: `${view.availability.lengthMinutes} min`, note: null },
              { term: "Buffer after", value: view.availability.bufferMinutes ? `${view.availability.bufferMinutes} min` : "None", note: null },
              { term: "Blocked", value: view.availability.blocks.length ? view.availability.blocks.join("; ") : "Nothing repeating", note: view.availability.linkedCalendar ? "Plus anything on your linked calendar." : null },
            ].map((item) => (
              <div key={item.term} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5">
                <dt className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{item.term}</dt>
                <dd className="text-foreground">{item.value}{item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}</dd>
              </div>
            ))}
          </dl>
        </TableCard>
      </div>

      <TableCard
        title="Setter scorecard"
        action={noisy > 0 ? <StatusChip tone="danger">{noisy} setter{noisy === 1 ? "" : "s"} booking noise</StatusChip> : undefined}
        footer={view.setters.length ? <span>Last 30 days · ranked by shown · {view.scorecardScope === "calendar" ? "setters who booked into your calendar" : "every setter in the agency until a pending database update is applied"}</span> : undefined}
      >
        {view.setters.length === 0 ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No setter has dialled or booked in the last 30 days.</p> : (
          <table className="portal-lead-table w-full min-w-[760px] text-left">
            <thead><tr>
              <th scope="col">Setter</th>
              <th scope="col" className="w-[80px] !text-right">Dials</th>
              <th scope="col" className="w-[90px] !text-right">Contacts</th>
              <th scope="col" className="w-[80px] !text-right">Booked</th>
              <th scope="col" className="w-[80px] !text-right">Shown</th>
              <th scope="col" className="w-[100px] !text-right">Show rate</th>
              <th scope="col" className="w-[70px] !text-right">Sold</th>
              <th scope="col" className="w-[150px] !text-right" title={`Booking noise: a show rate under ${NOISE_BELOW_PCT}% over at least ${VERDICT_MIN_CLOSED} closed-out appointments. Appointments waiting to be closed out never count against a setter.`}>Verdict</th>
            </tr></thead>
            <tbody>
              {view.setters.map((row) => (
                <tr key={row.userId}>
                  <td><strong className="font-semibold text-foreground">{row.name}</strong>{row.place && <span className="text-muted-foreground"> &middot; {row.place}</span>}</td>
                  <td className="text-right tabular-nums">{row.dials.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{row.contacts.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{row.booked}</td>
                  <td className="text-right tabular-nums">{row.showed}</td>
                  <td className="text-right tabular-nums">{row.showRatePct === null ? "—" : `${row.showRatePct.toFixed(1)}%`}</td>
                  <td className="text-right tabular-nums">{row.sold}</td>
                  <td className="text-right"><StatusChip tone={row.verdict === "solid" ? "good" : row.verdict === "noise" ? "danger" : "neutral"} dot>{VERDICT_LABEL[row.verdict]}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
