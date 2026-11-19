import { GraphCard, GraphCardError, GraphEmpty, settleCard } from "@/components/admin/dashboard/ov-card";
import { LineSeries } from "@/components/ui/chart";
import { signInDayCounts } from "@/lib/adminDashboard/securityQueries";

const DAYS = 14;
const n = (value: number) => value.toLocaleString("en-US");

/**
 * Login activity's 14-day chart (admin round 1, monitoring.html screen 2): sign-ins and failed attempts per UTC day,
 * from the same login events as the table and under the same staff rule. Streams on its own; a failed read says so.
 */
export async function LoginChart({ includeStaff, now }: { includeStaff: boolean; now: number }) {
  const title = `Sign-ins · ${DAYS} days`;
  const days = await settleCard("login chart", () => signInDayCounts(DAYS, includeStaff, now));
  if (!days) return <GraphCardError title={title} />;
  const succeeded = days.reduce((sum, day) => sum + day.succeeded, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const any = succeeded + failed > 0;
  return (
    <GraphCard
      title={title}
      value={n(succeeded)}
      line={`signed in · ${n(failed)} failed`}
      foot={`${includeStaff ? "Customers and staff" : "Customers"}, UTC days. The dashed line is failed attempts.`}
    >
      {any ? (
        <LineSeries
          points={days.map((day) => ({ key: day.key, label: day.label, value: day.succeeded }))}
          summary={`Successful sign-ins per day over the last ${DAYS} days`}
          unit="sign-ins"
          minHeight={120}
          legend={{ label: "Signed in" }}
          lines={[{ key: "failed", label: "Failed", tone: "warning", dashed: true, points: days.map((day) => ({ key: day.key, label: day.label, value: day.failed })) }]}
        />
      ) : (
        <GraphEmpty title="No sign-ins yet" hint={`Nobody signed in during the last ${DAYS} days.`} />
      )}
    </GraphCard>
  );
}
