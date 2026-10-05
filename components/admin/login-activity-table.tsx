import { TableCard } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pill } from "@/components/app/settings/primitives";
import { loginFailureLabel, type LoginEventRow } from "@/lib/loginEvents/constants";
import { loginEventTime, loginOutcomeLabel, summariseUserAgent } from "@/lib/loginEvents/present";
import { cn } from "@/lib/utils";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { DashboardUtcTime } from "./dashboard-utc-time";

/**
 * Login attempts as a table. Two layouts:
 *
 *  - "default" (users/[id] and anything else that passes nothing): unchanged — shadcn table,
 *    When / Account / Result / IP / Device.
 *  - "board": the p-adm-activity board — When / Actor / Outcome / IP / User agent, fixed column
 *    widths, UTC times with local time on hover, a parsed user agent (raw on hover), "Success ·
 *    admin" in the pill, and a 3px error edge on failed rows. The caller supplies the empty state,
 *    because only it knows whether "nothing" means no data, no matches, or a failed load.
 */
export function LoginActivityTable({
  events,
  showActor = false,
  footer,
  layout = "default",
  empty,
  busy = false,
  hideActor = false,
  minWidth = 980,
  framed = true,
}: {
  events: LoginEventRow[];
  showActor?: boolean;
  /** Rendered inside the bordered shell, so a pagination bar sits flush with the table. */
  footer?: React.ReactNode;
  layout?: "default" | "board";
  /** Board layout only: what to show when `events` is empty. */
  empty?: React.ReactNode;
  /** Board layout only: a request for new rows is in flight; the old rows stay, dimmed. */
  busy?: boolean;
  /** Board layout only: drop the Actor column, for a page that is already about one person. */
  hideActor?: boolean;
  /** Board layout only: the width below which the table scrolls inside its card. */
  minWidth?: number;
  /** Board layout only: false when a TableCard already draws the card around the table. */
  framed?: boolean;
}) {
  if (layout === "board") return <BoardLoginTable events={events} footer={footer} empty={empty} busy={busy} hideActor={hideActor} minWidth={minWidth} framed={framed} />;

  return (
    <div className={tableShell}>
      <Table>
        <TableHeader>
          <TableRow className={tableHeaderRow}>
            <TableHead className={tableHeadCell}>When</TableHead>
            {showActor && <TableHead className={tableHeadCell}>Account</TableHead>}
            <TableHead className={tableHeadCell}>Result</TableHead>
            <TableHead className={tableHeadCell}>IP</TableHead>
            <TableHead className={tableHeadCell}>Device</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 && (
            <TableRow>
              <TableCell colSpan={showActor ? 5 : 4} className="p-0">
                <EmptyState
                  title="No login attempts recorded yet"
                  hint="Every sign-in and failed attempt lands here, so this fills up on its own. An empty list this early is normal."
                />
              </TableCell>
            </TableRow>
          )}
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="text-muted-foreground">{new Date(event.ts).toLocaleString()}</TableCell>
              {showActor && (
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{event.email}</span>
                    {event.actor_type === "admin" && (
                      <StatusChip>Admin</StatusChip>
                    )}
                  </span>
                </TableCell>
              )}
              <TableCell>
                <StatusChip tone={event.success ? "good" : "danger"}>
                  {event.success ? "Success" : loginFailureLabel(event.failure_reason)}
                </StatusChip>
              </TableCell>
              <TableCell className="text-muted-foreground">{event.ip ?? "—"}</TableCell>
              <TableCell
                className="max-w-[280px] truncate text-muted-foreground"
                title={event.user_agent ?? undefined}
              >
                {event.user_agent ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}

const TH = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase whitespace-nowrap text-[var(--muted)]";
const TD = "border-t border-[var(--border)] px-3 py-2 text-left align-middle text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

function BoardLoginTable({
  events,
  footer,
  empty,
  busy,
  hideActor,
  minWidth,
  framed,
}: {
  events: LoginEventRow[];
  footer?: React.ReactNode;
  empty?: React.ReactNode;
  busy: boolean;
  hideActor: boolean;
  minWidth: number;
  framed: boolean;
}) {
  return (
    <Shell framed={framed}>
      <div className="min-w-0 overflow-x-auto">
        <table className={cn("w-full table-fixed border-collapse transition-opacity", busy && "opacity-60")} style={{ minWidth }} aria-busy={busy || undefined}>
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={cn(TH, "w-[210px]")}>When</th>
              {!hideActor && <th scope="col" className={TH}>Actor</th>}
              <th scope="col" className={cn(TH, "w-[210px]")}>Outcome</th>
              <th scope="col" className={cn(TH, "w-[170px]")}>IP</th>
              <th scope="col" className={cn(TH, !hideActor && "w-[240px]")}>User agent</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {events.length === 0 && (
              <tr>
                <td colSpan={hideActor ? 4 : 5} className="border-t border-[var(--border)] p-0">
                  {empty}
                </td>
              </tr>
            )}
            {events.map((event) => {
              const agent = summariseUserAgent(event.user_agent);
              return (
                <tr key={event.id} className="m-row hover:bg-[var(--brand-50)]">
                  {/* Failed rows are marked at the edge, not filled: a wall of red is unreadable
                      during exactly the incident this page is opened for. */}
                  <td className={cn(TD, "whitespace-nowrap tabular-nums", !event.success && "shadow-[inset_3px_0_0_var(--error)]")}>
                    <DashboardUtcTime iso={event.ts} text={loginEventTime(event.ts)} />
                  </td>
                  {!hideActor && (
                    <td className={cn(TD, "truncate")} title={event.email}>
                      {event.email}
                    </td>
                  )}
                  <td className={cn(TD, "overflow-hidden")} title={event.success ? undefined : loginFailureLabel(event.failure_reason)}>
                    <Pill tone={event.success ? "success" : "error"} dot>
                      {loginOutcomeLabel(event)}
                    </Pill>
                  </td>
                  <td className={cn(TD, "tabular-nums")}>{event.ip ?? "—"}</td>
                  <td className={cn(TD, "truncate")} title={event.user_agent ?? undefined}>
                    {agent ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex-1" />
      {footer}
    </Shell>
  );
}

/** The board table's card: the shared TableCard, or nothing when the caller's card already is one. */
function Shell({ framed, children }: { framed: boolean; children: React.ReactNode }) {
  return framed
    ? <TableCard className="flex min-w-0 flex-1 flex-col">{children}</TableCard>
    : <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}
