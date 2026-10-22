import Link from "next/link";

import { RebookButton } from "@/components/app/appointment-rebook";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/view-tabs";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/appointments/appointmentFacts";
import { VERDICT_LABEL, VERDICT_MIN_CLOSED, NOISE_BELOW_PCT, type AppointmentDetail, type DayRowKind } from "@/lib/setters/dayView";
import { getSettersOverview } from "@/lib/setters/overview";

/**
 * Appointments & setters (p-app-setters): the licensed agent's view of the appointments setters
 * book for them. Owners and producers — the people who hold a calendar (Settings › Calendar lists
 * only them as bookable). Setters book from the dialer and see their own numbers on Activity.
 *
 * Laid out to the UI consistency standard (docs/design/UI-CONSISTENCY.md): header, one strip of
 * figures, then two tabs (2026-10-06 redesign) — today's calendar beside the availability it is
 * computed from, and the setter scorecard. The tab is in the URL (?view=scorecard), so the page
 * stays a server page.
 */
function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** A booked row's chip says what became of it (LA-2 §11 concept): Shown, No-show, Awaiting close-out. */
const STATUS_TONE: Record<string, StatusTone> = { booked: "action", confirmed: "action", showed: "good", no_show: "danger", pending: "warning" };

/** The row's ground carries the slot's kind, as the day view always has: booked tinted, blocked grey. */
const ROW_TONE: Record<DayRowKind, string> = {
  booked: "bg-[var(--primary-soft)]",
  open: "",
  blocked: "bg-[var(--surface-alt)]",
  busy: "bg-[var(--surface-alt)]",
  buffer: "bg-[var(--canvas)]",
  past: "opacity-70",
};

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

export default async function SettersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Appointments & setters" description="Setters book into your real availability." />;
  if (!actAsPage(guard, ["owner", "producer"]))
    return <RoleGateNotice featureLabel="Appointments & setters" detail="Setters book from the dialer and see their numbers on Activity & scorecard." />;

  const view = await getSettersOverview({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  const t = view.tiles;
  const showRate = t.closedThisMonth ? (t.showedThisMonth / t.closedThisMonth) * 100 : null;
  const noisy = view.setters.filter((row) => row.verdict === "noise").length;
  const tab = (await searchParams).view === "scorecard" ? "scorecard" : "today";
  const dayNote = <span>All times your local · {view.day.filter((row) => row.kind === "booked").length} booked · {view.day.filter((row) => row.kind === "open").length} open</span>;
  const scorecardNote = <span className="inline-flex flex-wrap items-center gap-2">{noisy > 0 && <StatusChip tone="danger">{noisy} setter{noisy === 1 ? "" : "s"} booking noise</StatusChip>}Last 30 days · ranked by shown · {view.scorecardScope === "calendar" ? "setters who booked into your calendar" : "every setter in the agency"}</span>;

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
          <strong className="font-semibold">Add your working hours so setters can book you.</strong>{" "}
          <Link className="font-semibold underline underline-offset-2" href="/app/settings#calendar">Open Settings › Calendar</Link>
        </p>
      )}

      <ViewTabs
        label="Appointments & setters views"
        value={tab}
        controls="setters-panel"
        tabs={[
          { key: "today", label: `${view.dateLabel} — your calendar`, count: t.bookedToday, href: "/app/setters" },
          { key: "scorecard", label: "Setter scorecard", count: noisy || null, tone: "danger", href: "/app/setters?view=scorecard" },
        ]}
      />

      <div id="setters-panel" role="tabpanel" aria-labelledby={`setters-panel-tab-${tab}`}>
      {tab === "today" ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <PagedTableCard
            total={view.day.length}
            noun="slots"
            suffix={dayNote}
            className="flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] min-w-0 flex-1 flex-col [&>*:nth-child(1)]:flex-1"
            footer={view.day.length ? dayNote : undefined}
          >
            {view.day.length === 0 ? <EmptyState title="Nothing today" hint="No hours set and nothing booked." action={<Button asChild variant="outline"><Link href="/app/settings#calendar">Set availability</Link></Button>} /> : (
              <table className="portal-lead-table w-full min-w-[920px] text-left">
                <thead><tr>
                  <th scope="col">Time</th>
                  <th scope="col">Appointment</th>
                  <th scope="col">Details</th>
                  <th scope="col">Setter</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="!text-right"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <PagedBody>
                  {view.day.map((row) => {
                    const facts = row.detail ? bookedFacts(row.detail) : "";
                    return (
                      <tr key={`${row.kind}-${row.minute}-${row.appointmentId ?? ""}`} className={ROW_TONE[row.kind]}>
                        <td className={`whitespace-nowrap font-semibold tabular-nums ${row.kind === "booked" ? "text-[var(--accent-ink)]" : row.kind === "open" ? "text-[var(--body)]" : "text-muted-foreground"}`}>{clock(row.minute)}</td>
                        <td className={`max-w-[220px] truncate ${row.kind === "booked" ? "font-semibold text-[var(--body)]" : "text-muted-foreground"}`} title={row.label}>{row.label}</td>
                        <td className="max-w-[340px] truncate text-xs text-muted-foreground" title={facts || undefined}>{facts || "—"}</td>
                        <td className="max-w-[140px] truncate text-xs text-muted-foreground" title={row.setter ?? undefined}>{row.setter ?? "—"}</td>
                        <td className="whitespace-nowrap">
                          {row.detail
                            ? <StatusChip tone={STATUS_TONE[row.detail.status] ?? "action"}>{APPOINTMENT_STATUS_LABEL[row.detail.status] ?? KIND_LABEL.booked}</StatusChip>
                            : <StatusChip tone={row.kind === "booked" ? "action" : "neutral"}>{KIND_LABEL[row.kind]}</StatusChip>}
                        </td>
                        <td className="whitespace-nowrap text-right">{row.detail ? <NoShowActions detail={row.detail} /> : null}</td>
                      </tr>
                    );
                  })}
                </PagedBody>
              </table>
            )}
          </PagedTableCard>

          {/* The availability the calendar is computed from: real content beside it, not notes. */}
          <TableCard title="Your availability" className="lg:w-[30%] lg:shrink-0">
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
      ) : (
        <PagedTableCard
          total={view.setters.length}
          noun="setters"
          suffix={scorecardNote}
          className="flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(1)]:flex-1"
          footer={view.setters.length ? scorecardNote : undefined}
        >
          {view.setters.length === 0 ? <EmptyState title="No setter activity" hint="No dials or bookings in the last 30 days." /> : (
            <table className="portal-lead-table w-full min-w-[900px] text-left">
              <thead><tr>
                <th scope="col">Setter</th>
                <th scope="col">Location</th>
                <th scope="col" className="!text-right">Dials</th>
                <th scope="col" className="!text-right">Contacts</th>
                <th scope="col" className="!text-right">Booked</th>
                <th scope="col" className="!text-right">Shown</th>
                <th scope="col" className="!text-right">Show rate</th>
                <th scope="col" className="!text-right">Sold</th>
                <th scope="col" className="!text-right"><span className="inline-flex items-center gap-1">Verdict<InfoTip label="About the verdict" side="left">Booking noise: a show rate under {NOISE_BELOW_PCT}% over at least {VERDICT_MIN_CLOSED} closed-out appointments. Appointments waiting to be closed out never count against a setter.</InfoTip></span></th>
              </tr></thead>
              <PagedBody>
                {view.setters.map((row) => (
                  <tr key={row.userId}>
                    <td className="max-w-[200px] truncate font-semibold text-foreground" title={row.name}>{row.name}</td>
                    <td className="max-w-[160px] truncate text-muted-foreground" title={row.place ?? undefined}>{row.place ?? "—"}</td>
                    <td className="text-right tabular-nums">{row.dials.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{row.contacts.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{row.booked}</td>
                    <td className="text-right tabular-nums">{row.showed}</td>
                    <td className="text-right tabular-nums">{row.showRatePct === null ? "—" : `${row.showRatePct.toFixed(1)}%`}</td>
                    <td className="text-right tabular-nums">{row.sold}</td>
                    <td className="text-right"><StatusChip tone={row.verdict === "solid" ? "good" : row.verdict === "noise" ? "danger" : "neutral"} dot>{VERDICT_LABEL[row.verdict]}</StatusChip></td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      )}
      </div>
    </div>
  );
}
