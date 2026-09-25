import { guardPage } from "@/lib/entitlements/guardPage";
import { AppointmentCalendar } from "@/components/app/appointment-calendar";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { sectionForPath } from "@/lib/menu/definition";

/**
 * `/app/calendar` — and the path matters. `book_appointment` has always written its notification
 * with `link = '/app/calendar?appointment=' || v_id`, which was a 404 because the page did not
 * exist. Building it here makes that link work rather than repointing it somewhere else.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ appointment?: string }>;
}) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Calendar"
        description="The appointments booked onto your calendar, by day or by week, with each customer's own local time."
      />
    );
  // A setter books into this diary, so a setter can see it. Changing it is the availability editor,
  // which they cannot reach — "book appointments into Ray's slots" and "cannot change availability
  // or configuration" are two lines of the same role table.
  if (!["owner", "producer", "setter"].includes(guard.role))
    return <RoleGateNotice featureLabel="Calendar" detail="Only owners, producers and setters can see the appointment calendar." />;

  const { appointment } = await searchParams;

  // The header lives in the calendar itself: its "Day" and "Book an appointment" actions drive the
  // calendar's own state.
  return <AppointmentCalendar highlightId={appointment} eyebrow={sectionForPath("/app/calendar") ?? undefined} />;
}
