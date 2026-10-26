import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { AppointmentCalendar } from "@/components/app/appointment-calendar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

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
        description="Booked appointments by day or week, in each customer's own time."
      />
    );
  // A setter books into this diary, so a setter can see it. Changing it is the availability editor,
  // which they cannot reach — "book appointments into Ray's slots" and "cannot change availability
  // or configuration" are two lines of the same role table.
  // LA-0.2: an assistant keeps the calendar for the producers he works for (calendar.manage + appointments.book).
  if (!actAsPage(guard, ["owner", "producer", "assistant", "setter"]))
    return <RoleGateNotice featureLabel="Calendar" detail="Only owners, producers, assistants and setters can see the appointment calendar." />;

  const { appointment } = await searchParams;

  // The header lives in the calendar itself: its "Day" and "Book an appointment" actions drive the
  // calendar's own state.
  // On the dashboard's moving ribbon, its cards frosted over it (owner ask 2026-10-26).
  return (
    <DashboardStage ribbon>
      <AppointmentCalendar highlightId={appointment} />
    </DashboardStage>
  );
}
