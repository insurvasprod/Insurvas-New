import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loginFailureLabel, type LoginEventRow } from "@/lib/loginEvents/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

export function LoginActivityTable({
  events,
  showActor = false,
  footer,
}: {
  events: LoginEventRow[];
  showActor?: boolean;
  /** Rendered inside the bordered shell, so a pagination bar sits flush with the table. */
  footer?: React.ReactNode;
}) {
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
              <TableCell
                colSpan={showActor ? 5 : 4}
                className="h-24 text-center text-muted-foreground"
              >
                No login attempts recorded yet.
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
                      <Badge variant="outline" className="text-[10px]">
                        Admin
                      </Badge>
                    )}
                  </span>
                </TableCell>
              )}
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    event.success
                      ? "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]"
                      : "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                  }
                >
                  {event.success ? "Success" : loginFailureLabel(event.failure_reason)}
                </Badge>
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
